import { adminDb } from "../config/firebaseAdmin.js";
import { logAuditEvent } from "./auditService.js";
import { createNotification } from "./notificationService.js";
export function computeTaskScore(params) {
    // 1. Deliverable Quality: 40% (default 5.0 unless evaluated lower)
    let qualityScore = typeof params.qualityScore === "number" && params.qualityScore >= 1 && params.qualityScore <= 5
        ? params.qualityScore
        : 5.0;
    // 2. Deadline Adherence: 30%
    let deadlineScore = 5.0;
    if (params.approvedExtension) {
        deadlineScore = 5.0; // Approved extensions are never penalized
    }
    else if (params.onTime === false || (typeof params.hoursLate === "number" && params.hoursLate > 0)) {
        const hours = params.hoursLate || 1;
        if (hours <= 12) {
            deadlineScore = 3.5;
        }
        else if (hours <= 24) {
            deadlineScore = 2.5;
        }
        else {
            deadlineScore = 1.0;
        }
    }
    // 3. Rejections / Corrections: 20%
    let rejectionScore = 5.0;
    if (params.seriousRejection) {
        rejectionScore = 1.0;
    }
    else {
        const revisions = params.revisionCount || 0;
        if (revisions === 1) {
            rejectionScore = 4.0;
        }
        else if (revisions === 2) {
            rejectionScore = 3.0;
        }
        else if (revisions >= 3) {
            rejectionScore = 1.5;
        }
    }
    // 4. Verified Complaints: 10%
    let complaintScore = 5.0;
    if (params.verifiedComplaint) {
        complaintScore = 1.0;
    }
    const rawScore = (0.40 * qualityScore) + (0.30 * deadlineScore) + (0.20 * rejectionScore) + (0.10 * complaintScore);
    const calculatedTaskScore = Number(Math.min(5.0, Math.max(1.0, rawScore)).toFixed(2));
    return {
        score: calculatedTaskScore,
        breakdown: {
            qualityScore,
            deadlineScore,
            rejectionScore,
            complaintScore,
            calculatedTaskScore,
            onTime: params.onTime !== false && !params.hoursLate,
            approvedExtension: !!params.approvedExtension,
            revisionCount: params.revisionCount || 0,
            seriousRejection: !!params.seriousRejection,
            verifiedComplaint: !!params.verifiedComplaint,
        },
    };
}
export function calculateAggregatedRating(taskScores) {
    const n = taskScores.length;
    if (n === 0)
        return 0;
    if (n < 5) {
        // Bayesian smoothing: Prior B = 3.5, weight K = 2
        const priorB = 3.5;
        const priorK = 2;
        const sum = taskScores.reduce((acc, val) => acc + val, 0);
        const bayesian = ((priorK * priorB) + sum) / (priorK + n);
        return Number(Math.min(5.0, Math.max(1.0, bayesian)).toFixed(2));
    }
    // Rolling window of last 20 tasks
    const windowSlice = taskScores.slice(-20);
    const avg = windowSlice.reduce((acc, val) => acc + val, 0) / windowSlice.length;
    return Number(Math.min(5.0, Math.max(1.0, avg)).toFixed(2));
}
export function determinePreferenceTier(rating, reviewStatus) {
    if (reviewStatus === "at_risk" || reviewStatus === "suspended") {
        return "at_risk";
    }
    if (rating === 0) {
        // Unrated approved writers receive normal provisional allocation
        return "normal";
    }
    if (rating >= 4.50)
        return "highest";
    if (rating >= 4.00)
        return "high";
    if (rating >= 3.00)
        return "normal";
    if (rating >= 2.00)
        return "low";
    if (rating > 1.00)
        return "very_low";
    return "at_risk";
}
export function calculateCombinedOverallRating(writingRating, proofreadingRating) {
    if (writingRating > 0 && proofreadingRating > 0) {
        return Number(((writingRating * 0.70) + (proofreadingRating * 0.30)).toFixed(2));
    }
    if (writingRating > 0)
        return writingRating;
    if (proofreadingRating > 0)
        return proofreadingRating;
    return 0;
}
export class PerformanceService {
    /**
     * Records a task completion for a writer or proofreader.
     * Calculates new task performance, updates rolling history and stats.
     * Completely idempotent: if taskId and taskType was already evaluated, returns existing profile.
     */
    async recordTaskCompletion(params) {
        const { userId, taskType, taskId, taskTitle, deadline, completedAt, approvedExtension, revisionCount, seriousRejection, qualityScore, actorId, actorRole } = params;
        const userRef = adminDb.collection("users").doc(userId);
        return await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(userRef);
            if (!snap.exists) {
                throw new Error("USER_NOT_FOUND");
            }
            const userData = snap.data();
            const existingHistory = Array.isArray(userData.ratingHistory) ? userData.ratingHistory : [];
            // Idempotency check: prevent double-scoring identical task
            const alreadyEvaluated = existingHistory.find((h) => h.taskId === taskId && h.taskType === taskType && h.actionType === "task_completed");
            if (alreadyEvaluated) {
                const curRating = taskType === "writing" ? (userData.writingRating || 0) : (userData.proofreadingRating || 0);
                return {
                    previousRating: curRating,
                    newRating: curRating,
                    overallRating: userData.overallRating || 0,
                    preferenceTier: userData.allocationPreference || "normal",
                };
            }
            // Determine deadline lateness
            let hoursLate = 0;
            let onTime = true;
            if (deadline && completedAt && !approvedExtension) {
                const due = new Date(deadline).getTime();
                const done = new Date(completedAt).getTime();
                if (done > due) {
                    hoursLate = Math.max(0, (done - due) / (1000 * 60 * 60));
                    onTime = false;
                }
            }
            const { score: taskScore, breakdown } = computeTaskScore({
                qualityScore,
                onTime,
                approvedExtension,
                hoursLate,
                revisionCount,
                seriousRejection,
                verifiedComplaint: false,
            });
            // Retrieve previous task scores for this taskType
            const prevTaskScores = existingHistory
                .filter((h) => h.taskType === taskType && h.breakdown && typeof h.breakdown.calculatedTaskScore === "number")
                .map((h) => h.breakdown.calculatedTaskScore);
            const updatedTaskScores = [...prevTaskScores, taskScore];
            const previousRating = taskType === "writing"
                ? (userData.writingRating || 0)
                : (userData.proofreadingRating || 0);
            const newRating = calculateAggregatedRating(updatedTaskScores);
            const scoreChange = Number((newRating - previousRating).toFixed(2));
            // Calculate updated counts and rates
            let writingCompleted = userData.writingCompletedTasks || (userData.completedAssignments || 0);
            let proofreadingCompleted = userData.proofreadingCompletedTasks || 0;
            let writingOnTimeRate = userData.writingOnTimeRate ?? 100;
            let proofreadingOnTimeRate = userData.proofreadingOnTimeRate ?? 100;
            let writingRejectionRate = userData.writingRejectionRate ?? 0;
            let proofreadingRejectionRate = userData.proofreadingRejectionRate ?? 0;
            if (taskType === "writing") {
                writingCompleted += 1;
                // Running on-time rate
                const totalOnTime = Math.round((writingOnTimeRate / 100) * (writingCompleted - 1)) + (onTime ? 1 : 0);
                writingOnTimeRate = Math.round((totalOnTime / writingCompleted) * 100);
                // Running rejection rate
                const hadRejection = (revisionCount && revisionCount > 0) || seriousRejection;
                const totalRejections = Math.round((writingRejectionRate / 100) * (writingCompleted - 1)) + (hadRejection ? 1 : 0);
                writingRejectionRate = Math.round((totalRejections / writingCompleted) * 100);
            }
            else {
                proofreadingCompleted += 1;
                const totalOnTime = Math.round((proofreadingOnTimeRate / 100) * (proofreadingCompleted - 1)) + (onTime ? 1 : 0);
                proofreadingOnTimeRate = Math.round((totalOnTime / proofreadingCompleted) * 100);
            }
            const writingRating = taskType === "writing" ? newRating : (userData.writingRating || 0);
            const proofreadingRating = taskType === "proofreading" ? newRating : (userData.proofreadingRating || 0);
            const overallRating = calculateCombinedOverallRating(writingRating, proofreadingRating);
            // Total tasks evaluated across both roles
            const totalCompleted = writingCompleted + proofreadingCompleted;
            // Status determination: at-risk triggers at rating <= 1.0 after at least 5 completed tasks
            let currentStatus = userData.performanceReviewStatus || (totalCompleted > 0 ? "good_standing" : "unrated");
            if (totalCompleted >= 5 && (newRating <= 1.0 || (overallRating > 0 && overallRating <= 1.0))) {
                currentStatus = "at_risk";
            }
            else if (currentStatus === "at_risk" && overallRating > 1.0) {
                currentStatus = "monitoring";
            }
            else if (currentStatus === "unrated" && totalCompleted > 0) {
                currentStatus = "good_standing";
            }
            const preferenceTier = determinePreferenceTier(overallRating, currentStatus);
            const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const nowIso = new Date().toISOString();
            const historyEntry = {
                id: eventId,
                timestamp: nowIso,
                taskType,
                taskId,
                taskTitle,
                previousRating,
                newRating,
                scoreChange,
                reason: `Task completed (${taskType}): ${taskTitle}`,
                breakdown,
                actorId,
                actorRole,
                actionType: "task_completed",
            };
            const newHistory = [...existingHistory, historyEntry];
            transaction.update(userRef, {
                ...(taskType === "writing" ? { writingRating, writingCompletedTasks: writingCompleted, writingOnTimeRate, writingRejectionRate } : {}),
                ...(taskType === "proofreading" ? { proofreadingRating, proofreadingCompletedTasks: proofreadingCompleted, proofreadingOnTimeRate, proofreadingRejectionRate } : {}),
                overallRating,
                reputation: overallRating > 0 ? overallRating : (userData.reputation || 0),
                performanceReviewStatus: currentStatus,
                allocationPreference: preferenceTier,
                ratingHistory: newHistory,
                lastPerformanceReviewDate: nowIso,
                updatedAt: nowIso,
            });
            return {
                previousRating,
                newRating,
                overallRating,
                preferenceTier,
            };
        });
    }
    /**
     * Records a task rejection / revision request for a writer.
     */
    async recordTaskRejection(params) {
        const { userId, taskId, taskTitle, feedback, seriousRejection, actorId, actorRole } = params;
        const userRef = adminDb.collection("users").doc(userId);
        await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(userRef);
            if (!snap.exists)
                return;
            const userData = snap.data();
            const existingHistory = Array.isArray(userData.ratingHistory) ? userData.ratingHistory : [];
            const nowIso = new Date().toISOString();
            const eventId = `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
            const entry = {
                id: eventId,
                timestamp: nowIso,
                taskType: "writing",
                taskId,
                taskTitle,
                previousRating: userData.writingRating || 0,
                newRating: userData.writingRating || 0,
                scoreChange: 0,
                reason: `Draft returned for revision: ${feedback.substring(0, 100)}`,
                actorId,
                actorRole,
                actionType: "task_rejected",
                breakdown: {
                    qualityScore: 3.0,
                    deadlineScore: 5.0,
                    rejectionScore: seriousRejection ? 1.0 : 3.0,
                    complaintScore: 5.0,
                    calculatedTaskScore: seriousRejection ? 2.8 : 3.8,
                    revisionCount: (userData.revisionCount || 0) + 1,
                    seriousRejection: !!seriousRejection,
                },
            };
            const revisions = (userData.revisionCount || 0) + 1;
            const completed = userData.writingCompletedTasks || 1;
            const newRejectionRate = Math.min(100, Math.round((revisions / Math.max(1, completed)) * 100));
            transaction.update(userRef, {
                revisionCount: revisions,
                writingRejectionRate: newRejectionRate,
                ratingHistory: [...existingHistory, entry],
                updatedAt: nowIso,
            });
        });
    }
    /**
     * Records verified complaint / dispute settlement against a writer.
     */
    async recordVerifiedComplaint(params) {
        const { userId, disputeId, reason, actorId, actorRole } = params;
        const userRef = adminDb.collection("users").doc(userId);
        await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(userRef);
            if (!snap.exists)
                return;
            const userData = snap.data();
            const existingHistory = Array.isArray(userData.ratingHistory) ? userData.ratingHistory : [];
            const verifiedComplaints = (userData.verifiedComplaintCount || 0) + 1;
            const nowIso = new Date().toISOString();
            // Slightly decrease writing rating by 0.20 if active rating exists
            const prevRating = userData.writingRating || 0;
            let newRating = prevRating;
            if (prevRating > 1.0) {
                newRating = Number(Math.max(1.0, prevRating - 0.20).toFixed(2));
            }
            const scoreChange = Number((newRating - prevRating).toFixed(2));
            const overallRating = calculateCombinedOverallRating(newRating, userData.proofreadingRating || 0);
            const totalCompleted = (userData.writingCompletedTasks || 0) + (userData.proofreadingCompletedTasks || 0);
            let currentStatus = userData.performanceReviewStatus || "good_standing";
            if (totalCompleted >= 5 && (newRating <= 1.0 || overallRating <= 1.0)) {
                currentStatus = "at_risk";
            }
            else if (verifiedComplaints >= 2) {
                currentStatus = "monitoring";
            }
            const preferenceTier = determinePreferenceTier(overallRating, currentStatus);
            const entry = {
                id: `evt_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                timestamp: nowIso,
                taskType: "writing",
                taskId: disputeId,
                taskTitle: `Verified Dispute ${disputeId}`,
                previousRating: prevRating,
                newRating,
                scoreChange,
                reason: `Verified customer dispute: ${reason}`,
                actorId,
                actorRole,
                actionType: "dispute_verified",
                breakdown: {
                    qualityScore: 2.0,
                    deadlineScore: 3.0,
                    rejectionScore: 2.0,
                    complaintScore: 1.0,
                    calculatedTaskScore: 2.1,
                    verifiedComplaint: true,
                },
            };
            transaction.update(userRef, {
                verifiedComplaintCount: verifiedComplaints,
                writingRating: newRating,
                overallRating,
                reputation: overallRating > 0 ? overallRating : (userData.reputation || 0),
                performanceReviewStatus: currentStatus,
                allocationPreference: preferenceTier,
                ratingHistory: [...existingHistory, entry],
                updatedAt: nowIso,
            });
        });
    }
    /**
     * Admin audited manual performance adjustment.
     * Requires mandatory reason, records in rating history & audit log.
     */
    async adminAdjustPerformance(params) {
        const { targetUid, adminUid, adminEmail, writingRating, proofreadingRating, performanceReviewStatus, allocationPreference, reason, ip } = params;
        if (!reason || reason.trim().length < 5) {
            throw new Error("MANDATORY_REASON_REQUIRED");
        }
        const userRef = adminDb.collection("users").doc(targetUid);
        const result = await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(userRef);
            if (!snap.exists)
                throw new Error("USER_NOT_FOUND");
            const userData = snap.data();
            const existingHistory = Array.isArray(userData.ratingHistory) ? userData.ratingHistory : [];
            const nowIso = new Date().toISOString();
            const newWriting = typeof writingRating === "number" ? writingRating : (userData.writingRating || 0);
            const newProof = typeof proofreadingRating === "number" ? proofreadingRating : (userData.proofreadingRating || 0);
            const newOverall = calculateCombinedOverallRating(newWriting, newProof);
            const newStatus = performanceReviewStatus || userData.performanceReviewStatus || "good_standing";
            const newTier = allocationPreference || determinePreferenceTier(newOverall, newStatus);
            const entry = {
                id: `evt_adj_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                timestamp: nowIso,
                taskType: "manual_adjustment",
                previousRating: userData.overallRating || 0,
                newRating: newOverall,
                scoreChange: Number((newOverall - (userData.overallRating || 0)).toFixed(2)),
                reason: reason.trim(),
                actorId: adminUid,
                actorRole: "admin",
                actionType: "admin_adjustment",
            };
            const updates = {
                writingRating: newWriting,
                proofreadingRating: newProof,
                overallRating: newOverall,
                reputation: newOverall > 0 ? newOverall : (userData.reputation || 0),
                performanceReviewStatus: newStatus,
                allocationPreference: newTier,
                ratingHistory: [...existingHistory, entry],
                lastPerformanceReviewDate: nowIso,
                updatedAt: nowIso,
            };
            transaction.update(userRef, updates);
            return {
                uid: targetUid,
                ...userData,
                ...updates,
            };
        });
        await logAuditEvent({
            action: "admin_adjusted_performance",
            actorId: adminUid,
            actorRole: "admin",
            targetId: targetUid,
            details: {
                reason,
                writingRating,
                proofreadingRating,
                performanceReviewStatus,
                allocationPreference,
            },
            ip,
        });
        return { updatedUser: result };
    }
    /**
     * Admin performance intervention action (warning, improvement plan, suspension).
     */
    async adminPerformanceAction(params) {
        const { targetUid, adminUid, adminEmail, actionType, message, ip } = params;
        if (!message || message.trim().length < 5) {
            throw new Error("MANDATORY_REASON_REQUIRED");
        }
        const userRef = adminDb.collection("users").doc(targetUid);
        const result = await adminDb.runTransaction(async (transaction) => {
            const snap = await transaction.get(userRef);
            if (!snap.exists)
                throw new Error("USER_NOT_FOUND");
            const userData = snap.data();
            const existingHistory = Array.isArray(userData.ratingHistory) ? userData.ratingHistory : [];
            const nowIso = new Date().toISOString();
            let targetStatus = userData.performanceReviewStatus || "good_standing";
            let targetTier = userData.allocationPreference || "normal";
            let historyAction = "admin_warning";
            let userStatus = userData.status;
            if (actionType === "warning") {
                targetStatus = userData.performanceReviewStatus === "at_risk" ? "at_risk" : "monitoring";
                historyAction = "admin_warning";
            }
            else if (actionType === "improvement_plan") {
                targetStatus = "under_review";
                historyAction = "admin_improvement_plan";
            }
            else if (actionType === "suspend_allocation") {
                targetStatus = "suspended";
                targetTier = "at_risk";
                historyAction = "admin_suspension";
            }
            else if (actionType === "suspend_account") {
                targetStatus = "suspended";
                targetTier = "at_risk";
                historyAction = "admin_suspension";
                userStatus = "suspended";
            }
            const entry = {
                id: `evt_act_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
                timestamp: nowIso,
                taskType: "manual_adjustment",
                previousRating: userData.overallRating || 0,
                newRating: userData.overallRating || 0,
                scoreChange: 0,
                reason: `${actionType.toUpperCase()}: ${message.trim()}`,
                actorId: adminUid,
                actorRole: "admin",
                actionType: historyAction,
            };
            transaction.update(userRef, {
                status: userStatus,
                performanceReviewStatus: targetStatus,
                allocationPreference: targetTier,
                performanceNotes: message.trim(),
                ratingHistory: [...existingHistory, entry],
                lastPerformanceReviewDate: nowIso,
                updatedAt: nowIso,
            });
            return { targetStatus };
        });
        await logAuditEvent({
            action: `admin_performance_${actionType}`,
            actorId: adminUid,
            actorRole: "admin",
            targetId: targetUid,
            details: { actionType, message },
            ip,
        });
        await createNotification({
            userId: targetUid,
            title: actionType === "warning"
                ? "Performance Advisory"
                : actionType === "improvement_plan"
                    ? "Performance Improvement Plan Required"
                    : "Account Allocation Notice",
            message: message.trim(),
            type: "system",
            link: "/app/writer",
        });
        return { success: true, status: result.targetStatus };
    }
}
export const performanceService = new PerformanceService();
