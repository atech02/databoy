import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../config/firebaseAdmin.js";
function applyWalletDelta(uData, entryType, amount) {
    let availableBalance = Number(uData.availableBalance || 0);
    let reservedBalance = Number(uData.reservedBalance || 0);
    let totalEarned = Number(uData.totalEarned || 0);
    let totalPaidOut = Number(uData.totalPaidOut || 0);
    if (entryType === "writer_earning" || entryType === "proofreader_earning") {
        availableBalance = parseFloat((availableBalance + amount).toFixed(2));
        totalEarned = parseFloat((totalEarned + amount).toFixed(2));
    }
    else if (entryType === "payout_request") {
        availableBalance = parseFloat((availableBalance - amount).toFixed(2));
        reservedBalance = parseFloat((reservedBalance + amount).toFixed(2));
    }
    else if (entryType === "payout_rejected") {
        availableBalance = parseFloat((availableBalance + amount).toFixed(2));
        reservedBalance = parseFloat(Math.max(0, reservedBalance - amount).toFixed(2));
    }
    else if (entryType === "payout_completed") {
        reservedBalance = parseFloat(Math.max(0, reservedBalance - amount).toFixed(2));
        totalPaidOut = parseFloat((totalPaidOut + amount).toFixed(2));
    }
    return { availableBalance, reservedBalance, totalEarned, totalPaidOut };
}
function buildLedgerDocData(entry, docId, now) {
    const docData = {
        id: docId,
        status: "completed",
        createdAt: now,
        timestamp: FieldValue.serverTimestamp(),
    };
    for (const [key, val] of Object.entries(entry)) {
        if (val !== undefined) {
            docData[key] = val;
        }
    }
    return docData;
}
export const ledgerService = {
    /**
     * Records a traceable, immutable ledger entry with strict idempotency.
     */
    async recordEntry(entry) {
        const { idempotencyKey } = entry;
        const ledgerRef = adminDb.collection("ledger");
        const deterministicRef = ledgerRef.doc(idempotencyKey);
        return adminDb.runTransaction(async (transaction) => {
            // 1. All Reads First
            const [detSnap, existingQuery] = await Promise.all([
                transaction.get(deterministicRef),
                transaction.get(ledgerRef.where("idempotencyKey", "==", idempotencyKey).limit(1)),
            ]);
            if (detSnap.exists) {
                return {
                    success: true,
                    entryId: detSnap.id,
                    alreadyProcessed: true,
                };
            }
            if (!existingQuery.empty) {
                const existingDoc = existingQuery.docs[0];
                return {
                    success: true,
                    entryId: existingDoc.id,
                    alreadyProcessed: true,
                };
            }
            let userRef = null;
            let userSnap = null;
            if (entry.userRole === "writer" && entry.userId) {
                userRef = adminDb.collection("users").doc(entry.userId);
                userSnap = await transaction.get(userRef);
            }
            // 2. All Writes Second
            const now = new Date().toISOString();
            const docData = buildLedgerDocData(entry, deterministicRef.id, now);
            transaction.set(deterministicRef, docData);
            // 3. Update user profile balance fields if this impacts a writer's wallet
            if (userSnap && userSnap.exists && userRef) {
                const nextBalances = applyWalletDelta(userSnap.data() || {}, entry.type, entry.amount);
                transaction.update(userRef, {
                    ...nextBalances,
                    updatedAt: now,
                });
            }
            return {
                success: true,
                entryId: deterministicRef.id,
                alreadyProcessed: false,
            };
        });
    },
    /**
     * Atomically validates writer balance, checks conflicting reservations, creates a payout request,
     * debits availableBalance, and writes the immutable payout_request ledger entry in ONE transaction.
     */
    async reserveWriterPayout(params) {
        const { userId, userEmail, amount, paymentMethod, paymentDetails, idempotencyKey } = params;
        if (!Number.isFinite(amount) || amount <= 0) {
            throw new Error("INVALID_AMOUNT");
        }
        const userRef = adminDb.collection("users").doc(userId);
        const payoutsRef = adminDb.collection("payoutRequests");
        const ledgerCol = adminDb.collection("ledger");
        return adminDb.runTransaction(async (transaction) => {
            const userSnap = await transaction.get(userRef);
            if (!userSnap.exists) {
                throw new Error("USER_NOT_FOUND");
            }
            if (idempotencyKey) {
                const existingPayoutQuery = await transaction.get(payoutsRef.where("idempotencyKey", "==", idempotencyKey).limit(1));
                if (!existingPayoutQuery.empty) {
                    const existing = existingPayoutQuery.docs[0];
                    const uData = userSnap.data() || {};
                    return {
                        payoutId: existing.id,
                        ledgerEntryId: `payout_req_${existing.id}`,
                        remainingBalance: Number(uData.availableBalance || 0),
                        alreadyProcessed: true,
                    };
                }
            }
            // Check existing active reservations so concurrent requests cannot race unobserved state
            const pendingSnap = await transaction.get(payoutsRef.where("userId", "==", userId).where("status", "in", ["pending", "processing"]));
            const uData = userSnap.data() || {};
            const availableBalance = Number(uData.availableBalance || 0);
            // Verify sufficient balance against atomic snapshot
            if (amount > availableBalance || availableBalance - amount < -0.001) {
                throw new Error(`INSUFFICIENT_BALANCE:${availableBalance}`);
            }
            // Ensure legacy seeded reservations without reservedBalance tracking don't cause silent discrepancy
            const trackedPendingTotal = pendingSnap.docs.reduce((sum, d) => sum + Number(d.data().amount || 0), 0);
            const payoutRef = payoutsRef.doc();
            const ledgerKey = `payout_req_${payoutRef.id}`;
            const ledgerDocRef = ledgerCol.doc(ledgerKey);
            const now = new Date().toISOString();
            const nextBalances = applyWalletDelta(uData, "payout_request", amount);
            if (nextBalances.availableBalance < 0) {
                throw new Error(`INSUFFICIENT_BALANCE:${availableBalance}`);
            }
            // Keep reservedBalance at least the sum of pending payouts including this one
            nextBalances.reservedBalance = parseFloat(Math.max(nextBalances.reservedBalance, trackedPendingTotal + amount).toFixed(2));
            transaction.set(payoutRef, {
                id: payoutRef.id,
                userId,
                userEmail,
                amount,
                currency: "ZMW",
                paymentMethod,
                paymentDetails,
                status: "pending",
                ...(idempotencyKey ? { idempotencyKey } : {}),
                requestedAt: now,
                updatedAt: now,
            });
            transaction.set(ledgerDocRef, buildLedgerDocData({
                idempotencyKey: ledgerKey,
                type: "payout_request",
                userId,
                userEmail,
                userRole: "writer",
                amount,
                currency: "ZMW",
                referenceId: payoutRef.id,
                description: `Payout request of ${amount} ZMW via ${paymentMethod}`,
            }, ledgerDocRef.id, now));
            transaction.update(userRef, {
                ...nextBalances,
                updatedAt: now,
            });
            return {
                payoutId: payoutRef.id,
                ledgerEntryId: ledgerDocRef.id,
                remainingBalance: nextBalances.availableBalance,
                alreadyProcessed: false,
            };
        });
    },
    /**
     * Atomically completes a pending payout request with a required, globally unique externalTransactionId.
     * Idempotent if retried for the same payoutId and identical externalTransactionId;
     * rejects reuse of an already-claimed externalTransactionId across different payouts.
     */
    async completeWriterPayout(params) {
        const { payoutId, adminUid, externalTransactionId, confirmationNotes } = params;
        const normalizedExternalTxId = typeof externalTransactionId === "string" ? externalTransactionId.trim() : "";
        if (!normalizedExternalTxId) {
            throw new Error("MISSING_EXTERNAL_TX_ID");
        }
        const canonicalKey = normalizedExternalTxId.toLowerCase();
        const extRefDocId = Buffer.from(canonicalKey, "utf8").toString("base64url");
        const payoutRef = adminDb.collection("payoutRequests").doc(payoutId);
        const ledgerKey = `payout_complete_${payoutId}`;
        const ledgerDocRef = adminDb.collection("ledger").doc(ledgerKey);
        const extRefLockRef = adminDb.collection("payoutExternalRefs").doc(extRefDocId);
        return adminDb.runTransaction(async (transaction) => {
            const [payoutSnap, ledgerSnap, extRefLockSnap] = await Promise.all([
                transaction.get(payoutRef),
                transaction.get(ledgerDocRef),
                transaction.get(extRefLockRef),
            ]);
            if (!payoutSnap.exists) {
                throw new Error("NOT_FOUND");
            }
            // Enforce global uniqueness across all payouts
            if (extRefLockSnap.exists) {
                const lockData = extRefLockSnap.data();
                if (lockData.payoutId !== payoutId) {
                    throw new Error("DUPLICATE_EXTERNAL_TX_ID");
                }
            }
            const payout = payoutSnap.data();
            if (payout.status === "completed" || ledgerSnap.exists) {
                const existingTxId = typeof payout.externalTransactionId === "string" ? payout.externalTransactionId.trim().toLowerCase() : "";
                if (existingTxId && existingTxId !== canonicalKey) {
                    throw new Error("CONFLICT_EXTERNAL_TX_ID");
                }
                return { payout, alreadyCompleted: true };
            }
            if (payout.status !== "pending" && payout.status !== "processing") {
                throw new Error("ALREADY_PROCESSED");
            }
            const userRef = adminDb.collection("users").doc(payout.userId);
            const userSnap = await transaction.get(userRef);
            const now = new Date().toISOString();
            const amount = Number(payout.amount);
            transaction.set(extRefLockRef, {
                payoutId,
                writerId: payout.userId,
                amount,
                externalTransactionId: normalizedExternalTxId,
                canonicalKey,
                claimedBy: adminUid,
                createdAt: now,
            });
            const completedPayoutPatch = {
                status: "completed",
                processedAt: now,
                processedBy: adminUid,
                externalTransactionId: normalizedExternalTxId,
                ...(confirmationNotes ? { confirmationNotes } : {}),
                updatedAt: now,
            };
            transaction.update(payoutRef, completedPayoutPatch);
            transaction.set(ledgerDocRef, buildLedgerDocData({
                idempotencyKey: ledgerKey,
                type: "payout_completed",
                userId: payout.userId,
                userEmail: payout.userEmail,
                userRole: "writer",
                amount,
                currency: "ZMW",
                referenceId: payoutId,
                description: `Completed payout of ${amount} ZMW to ${payout.userEmail} (Ref: ${normalizedExternalTxId})`,
                metadata: {
                    externalTransactionId: normalizedExternalTxId,
                    adminUid,
                    ...(confirmationNotes ? { confirmationNotes } : {}),
                },
            }, ledgerDocRef.id, now));
            if (userSnap.exists) {
                const nextBalances = applyWalletDelta(userSnap.data() || {}, "payout_completed", amount);
                transaction.update(userRef, {
                    ...nextBalances,
                    updatedAt: now,
                });
            }
            return {
                payout: {
                    ...payout,
                    ...completedPayoutPatch,
                },
                alreadyCompleted: false,
            };
        });
    },
    /**
     * Atomically rejects a pending payout request and restores reserved funds to availableBalance once.
     */
    async rejectWriterPayout(params) {
        const { payoutId, adminUid, reason } = params;
        const payoutRef = adminDb.collection("payoutRequests").doc(payoutId);
        const ledgerKey = `payout_reject_${payoutId}`;
        const ledgerDocRef = adminDb.collection("ledger").doc(ledgerKey);
        return adminDb.runTransaction(async (transaction) => {
            const [payoutSnap, ledgerSnap] = await Promise.all([
                transaction.get(payoutRef),
                transaction.get(ledgerDocRef),
            ]);
            if (!payoutSnap.exists) {
                throw new Error("NOT_FOUND");
            }
            const payout = payoutSnap.data();
            if (payout.status === "rejected" || ledgerSnap.exists) {
                return { payout, alreadyRejected: true };
            }
            if (payout.status !== "pending" && payout.status !== "processing") {
                throw new Error("ALREADY_PROCESSED");
            }
            const userRef = adminDb.collection("users").doc(payout.userId);
            const userSnap = await transaction.get(userRef);
            const now = new Date().toISOString();
            const amount = Number(payout.amount);
            transaction.update(payoutRef, {
                status: "rejected",
                rejectionReason: reason || "Administrative rejection",
                processedAt: now,
                processedBy: adminUid,
                updatedAt: now,
            });
            transaction.set(ledgerDocRef, buildLedgerDocData({
                idempotencyKey: ledgerKey,
                type: "payout_rejected",
                userId: payout.userId,
                userEmail: payout.userEmail,
                userRole: "writer",
                amount,
                currency: "ZMW",
                referenceId: payoutId,
                description: `Rejected payout of ${amount} ZMW returned to balance: ${reason || "Admin rejection"}`,
            }, ledgerDocRef.id, now));
            if (userSnap.exists) {
                const nextBalances = applyWalletDelta(userSnap.data() || {}, "payout_rejected", amount);
                transaction.update(userRef, {
                    ...nextBalances,
                    updatedAt: now,
                });
            }
            return { payout, alreadyRejected: false };
        });
    },
    /**
     * Retrieves live traceable wallet summary for a writer.
     */
    async getWalletSummary(userId) {
        const userDoc = await adminDb.collection("users").doc(userId).get();
        const data = userDoc.data() || {};
        return {
            userId,
            availableBalance: Number(data.availableBalance || 0),
            pendingBalance: Number(data.pendingBalance || 0),
            totalEarned: Number(data.totalEarned || 0),
            totalPaidOut: Number(data.totalPaidOut || 0),
            currency: "ZMW",
        };
    },
    /**
     * Lists ledger entries for a specific user.
     */
    async listUserEntries(userId, limitCount = 50) {
        const snap = await adminDb
            .collection("ledger")
            .where("userId", "==", userId)
            .orderBy("createdAt", "desc")
            .limit(limitCount)
            .get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    },
    /**
     * Releases escrow deterministically inside an existing Firestore transaction.
     * Performs all ledger & wallet reads BEFORE writes so the caller's assignment/task status updates
     * commit atomically with writer, proofreader, and platform fee settlement.
     */
    async releaseAssignmentEscrowInTransaction(transaction, params) {
        const { assignmentId, budget, writerId, writerEmail, proofreaderId, proofreaderEmail, metadata, } = params;
        const now = params.now || new Date().toISOString();
        const writerAmount = parseFloat((budget * 0.50).toFixed(2));
        const proofreaderAmount = proofreaderId ? parseFloat((budget * 0.1667).toFixed(2)) : 0;
        const databoyAmount = parseFloat((budget - writerAmount - proofreaderAmount).toFixed(2));
        const ledgerCol = adminDb.collection("ledger");
        const writerKey = `release_asg_${assignmentId}_writer`;
        const proofKey = `release_asg_${assignmentId}_proofreader`;
        const databoyKey = `release_asg_${assignmentId}_databoy`;
        const writerLedgerRef = ledgerCol.doc(writerKey);
        const proofLedgerRef = ledgerCol.doc(proofKey);
        const databoyLedgerRef = ledgerCol.doc(databoyKey);
        const writerRef = writerId ? adminDb.collection("users").doc(writerId) : null;
        const proofRef = proofreaderId && proofreaderId !== writerId
            ? adminDb.collection("users").doc(proofreaderId)
            : null;
        const [writerLedgerSnap, proofLedgerSnap, databoyLedgerSnap, writerSnap, proofSnap] = await Promise.all([
            writerId ? transaction.get(writerLedgerRef) : Promise.resolve(null),
            proofreaderId ? transaction.get(proofLedgerRef) : Promise.resolve(null),
            transaction.get(databoyLedgerRef),
            writerRef ? transaction.get(writerRef) : Promise.resolve(null),
            proofRef ? transaction.get(proofRef) : Promise.resolve(null),
        ]);
        const alreadyReleased = Boolean(databoyLedgerSnap.exists) &&
            (!writerId || Boolean(writerLedgerSnap?.exists)) &&
            (!proofreaderId || Boolean(proofLedgerSnap?.exists));
        if (writerId && writerLedgerSnap && !writerLedgerSnap.exists) {
            transaction.set(writerLedgerRef, buildLedgerDocData({
                idempotencyKey: writerKey,
                type: "writer_earning",
                userId: writerId,
                userEmail: writerEmail || "",
                userRole: "writer",
                amount: writerAmount,
                currency: "ZMW",
                assignmentId,
                referenceId: assignmentId,
                description: `Author payout for assignment ${assignmentId}`,
                ...(metadata ? { metadata } : {}),
            }, writerLedgerRef.id, now));
            if (writerSnap && writerSnap.exists && writerRef) {
                const nextBalances = applyWalletDelta(writerSnap.data() || {}, "writer_earning", writerAmount);
                transaction.update(writerRef, { ...nextBalances, updatedAt: now });
            }
        }
        if (proofreaderId && proofLedgerSnap && !proofLedgerSnap.exists) {
            transaction.set(proofLedgerRef, buildLedgerDocData({
                idempotencyKey: proofKey,
                type: "proofreader_earning",
                userId: proofreaderId,
                userEmail: proofreaderEmail || "",
                userRole: "writer",
                amount: proofreaderAmount,
                currency: "ZMW",
                assignmentId,
                referenceId: assignmentId,
                description: `Proofreading quality review payout for assignment ${assignmentId}`,
                ...(metadata ? { metadata } : {}),
            }, proofLedgerRef.id, now));
            const targetProofRef = proofRef || writerRef;
            const targetProofSnap = proofRef ? proofSnap : writerSnap;
            if (targetProofSnap && targetProofSnap.exists && targetProofRef) {
                const baseData = !proofRef && writerId && writerLedgerSnap && !writerLedgerSnap.exists
                    ? applyWalletDelta(writerSnap?.data() || {}, "writer_earning", writerAmount)
                    : targetProofSnap.data() || {};
                const nextBalances = applyWalletDelta(baseData, "proofreader_earning", proofreaderAmount);
                transaction.update(targetProofRef, { ...nextBalances, updatedAt: now });
            }
        }
        if (!databoyLedgerSnap.exists) {
            transaction.set(databoyLedgerRef, buildLedgerDocData({
                idempotencyKey: databoyKey,
                type: "platform_fee",
                userId: "databoy_platform",
                userRole: "platform",
                amount: databoyAmount,
                currency: "ZMW",
                assignmentId,
                referenceId: assignmentId,
                description: `Platform service commission for assignment ${assignmentId}`,
                ...(metadata ? { metadata } : {}),
            }, databoyLedgerRef.id, now));
        }
        return { alreadyReleased, writerAmount, proofreaderAmount, databoyAmount };
    },
    /**
     * Releases escrow on an assignment deterministically:
     * 50% to writer, 16.67% to proofreader, remaining exactly to DataBoy platform fee.
     */
    async releaseAssignmentEscrow(assignmentId, budget, writerId, writerEmail, proofreaderId, proofreaderEmail) {
        await adminDb.runTransaction(async (transaction) => {
            await this.releaseAssignmentEscrowInTransaction(transaction, {
                assignmentId,
                budget,
                writerId,
                writerEmail,
                proofreaderId,
                proofreaderEmail,
            });
        });
    },
    /**
     * Atomically resolves an administrative dispute with financial escrow & ledger enforcement.
     * - "refund": Requires funded target and verified externalRefundReference (manual mobile-money settlement).
     *   Blocks double-settlement or refunding an already released/refunded/unfunded target, and writes an immutable refund ledger entry.
     * - "complete": Requires funded target and releases assignment escrow deterministically once (50% writer, 16.67% proofreader, remainder platform).
     * - Mediation/dismissal outcomes (e.g. "in_progress", "dismiss", or arbitration notes): Preserves held escrow and transitions dispute to resolved.
     */
    async resolveDisputeWithAccounting(params) {
        const { disputeId, adminUid, resolution, notes, externalRefundReference } = params;
        const trimmedResolution = typeof resolution === "string" ? resolution.trim() : "";
        const normalizedLower = trimmedResolution.toLowerCase();
        const outcome = normalizedLower === "refund"
            ? "refund"
            : normalizedLower === "complete"
                ? "complete"
                : normalizedLower === "dismiss"
                    ? "dismiss"
                    : "in_progress";
        const normalizedRefundRef = typeof externalRefundReference === "string" ? externalRefundReference.trim() : "";
        if (outcome === "refund" && !normalizedRefundRef) {
            throw new Error("MISSING_REFUND_REFERENCE");
        }
        const disputeRef = adminDb.collection("disputes").doc(disputeId);
        const txResult = await adminDb.runTransaction(async (transaction) => {
            const disputeSnap = await transaction.get(disputeRef);
            if (!disputeSnap.exists) {
                throw new Error("NOT_FOUND");
            }
            const dispute = disputeSnap.data();
            const targetId = dispute.assignmentId || dispute.relatedId;
            const isResearch = dispute.relatedType === "research" && !dispute.assignmentId;
            const targetType = targetId
                ? isResearch
                    ? "research"
                    : "assignment"
                : undefined;
            // Enforce idempotency / block conflicting re-resolution on already resolved disputes
            if (dispute.status === "resolved") {
                const sameOutcome = (dispute.outcome || dispute.resolution) === outcome ||
                    (outcome === "in_progress" &&
                        dispute.resolution === (trimmedResolution || "in_progress"));
                const sameRefundRef = outcome !== "refund" ||
                    (typeof dispute.externalRefundReference === "string" &&
                        dispute.externalRefundReference.trim() === normalizedRefundRef);
                if (sameOutcome && sameRefundRef) {
                    return {
                        alreadyResolved: true,
                        outcome,
                        dispute,
                        targetType,
                        targetId,
                    };
                }
                throw new Error("DISPUTE_ALREADY_RESOLVED");
            }
            const now = new Date().toISOString();
            if (!targetId || !targetType) {
                if (outcome === "refund" || outcome === "complete") {
                    throw new Error("TARGET_NOT_FOUND");
                }
                transaction.update(disputeRef, {
                    status: "resolved",
                    outcome,
                    resolution: trimmedResolution || outcome,
                    resolutionNotes: notes || "",
                    resolvedAt: now,
                    resolvedBy: adminUid,
                    updatedAt: now,
                });
                return { alreadyResolved: false, outcome, dispute, targetType, targetId };
            }
            const targetCollection = targetType === "research" ? "researchRequests" : "assignments";
            const targetRef = adminDb.collection(targetCollection).doc(targetId);
            const refundLedgerRef = adminDb.collection("ledger").doc(`refund_${targetId}`);
            const releaseWriterLedgerRef = adminDb.collection("ledger").doc(`release_asg_${targetId}_writer`);
            const releaseProofLedgerRef = adminDb.collection("ledger").doc(`release_asg_${targetId}_proofreader`);
            const releaseDataboyLedgerRef = adminDb.collection("ledger").doc(`release_asg_${targetId}_databoy`);
            const refundExtRefKey = outcome === "refund" && normalizedRefundRef
                ? Buffer.from(normalizedRefundRef.toLowerCase(), "utf8").toString("base64url")
                : null;
            const refundExtRefLockRef = refundExtRefKey
                ? adminDb.collection("refundExternalRefs").doc(refundExtRefKey)
                : null;
            const [targetSnap, refundSnap, relWriterSnap, relProofSnap, relDataboySnap, refundExtLockSnap] = await Promise.all([
                transaction.get(targetRef),
                transaction.get(refundLedgerRef),
                transaction.get(releaseWriterLedgerRef),
                transaction.get(releaseProofLedgerRef),
                transaction.get(releaseDataboyLedgerRef),
                refundExtRefLockRef ? transaction.get(refundExtRefLockRef) : Promise.resolve(null),
            ]);
            if (!targetSnap.exists) {
                throw new Error("TARGET_NOT_FOUND");
            }
            const target = targetSnap.data();
            const isFunded = target.paymentStatus === "funded" ||
                target.escrowStatus === "held" ||
                target.payoutStatus === "escrowed";
            const alreadyReleased = target.escrowStatus === "released" ||
                target.payoutStatus === "released" ||
                relWriterSnap.exists ||
                relDataboySnap.exists;
            const alreadyRefunded = target.escrowStatus === "refunded" ||
                target.payoutStatus === "refunded" ||
                target.paymentStatus === "refunded" ||
                refundSnap.exists;
            if (outcome === "refund") {
                if (refundExtLockSnap &&
                    refundExtLockSnap.exists &&
                    refundExtLockSnap.data()?.disputeId !== disputeId) {
                    throw new Error("DUPLICATE_EXTERNAL_REFUND_REF");
                }
                if (alreadyReleased || alreadyRefunded) {
                    throw new Error("ESCROW_ALREADY_SETTLED");
                }
                if (!isFunded) {
                    throw new Error("TARGET_NOT_FUNDED");
                }
                const refundAmount = Number(target.budget || target.quoteAmount || 0);
                if (!Number.isFinite(refundAmount) || refundAmount <= 0) {
                    throw new Error("TARGET_NOT_FUNDED");
                }
                const customerId = target.customerId || target.studentId || dispute.studentId || "";
                if (refundExtRefLockRef) {
                    transaction.set(refundExtRefLockRef, {
                        externalRefundReference: normalizedRefundRef,
                        disputeId,
                        targetType,
                        targetId,
                        adminUid,
                        createdAt: now,
                    });
                }
                transaction.update(disputeRef, {
                    status: "resolved",
                    outcome: "refund",
                    resolution: "refund",
                    resolutionNotes: notes || "",
                    externalRefundReference: normalizedRefundRef,
                    refundSettlementMode: "manual_admin_settled",
                    refundAmount,
                    resolvedAt: now,
                    resolvedBy: adminUid,
                    updatedAt: now,
                });
                transaction.update(targetRef, {
                    disputeStatus: "resolved",
                    status: "cancelled",
                    escrowStatus: "refunded",
                    payoutStatus: "refunded",
                    paymentStatus: "refunded",
                    externalRefundReference: normalizedRefundRef,
                    refundedAt: now,
                    updatedAt: now,
                });
                transaction.set(refundLedgerRef, buildLedgerDocData({
                    idempotencyKey: `refund_${targetId}`,
                    type: "refund",
                    userId: customerId,
                    userEmail: target.customerEmail || target.studentEmail || "",
                    userRole: "customer",
                    amount: refundAmount,
                    currency: "ZMW",
                    ...(targetType === "research" ? { researchRequestId: targetId } : { assignmentId: targetId }),
                    referenceId: normalizedRefundRef,
                    description: `Manual dispute refund settled for ${targetType} ${targetId} (Ref: ${normalizedRefundRef})`,
                    metadata: {
                        disputeId,
                        adminUid,
                        externalRefundReference: normalizedRefundRef,
                        settlementMode: "manual_admin_settled",
                    },
                }, refundLedgerRef.id, now));
                return {
                    alreadyResolved: false,
                    outcome: "refund",
                    dispute,
                    targetType,
                    targetId,
                    amount: refundAmount,
                };
            }
            if (outcome === "complete") {
                if (alreadyRefunded) {
                    throw new Error("ESCROW_ALREADY_SETTLED");
                }
                if (!isFunded && !alreadyReleased) {
                    throw new Error("TARGET_NOT_FUNDED");
                }
                const budget = Number(target.budget || target.quoteAmount || 0);
                const writerId = target.writerId || target.assignedWriterId || "";
                const writerEmail = target.writerEmail || "";
                const proofreaderId = target.proofreaderId || null;
                const proofreaderEmail = target.proofreaderEmail || null;
                let writerSnap = null;
                let proofSnap = null;
                if (!alreadyReleased) {
                    const userReads = [];
                    const writerRef = writerId ? adminDb.collection("users").doc(writerId) : null;
                    const proofRef = proofreaderId && proofreaderId !== writerId
                        ? adminDb.collection("users").doc(proofreaderId)
                        : null;
                    if (writerRef)
                        userReads.push(transaction.get(writerRef));
                    if (proofRef)
                        userReads.push(transaction.get(proofRef));
                    const readSnaps = await Promise.all(userReads);
                    let idx = 0;
                    if (writerRef)
                        writerSnap = readSnaps[idx++];
                    if (proofRef)
                        proofSnap = readSnaps[idx++];
                    const writerAmount = parseFloat((budget * 0.50).toFixed(2));
                    const proofreaderAmount = proofreaderId ? parseFloat((budget * 0.1667).toFixed(2)) : 0;
                    const databoyAmount = parseFloat((budget - writerAmount - proofreaderAmount).toFixed(2));
                    if (writerId && !relWriterSnap.exists) {
                        transaction.set(releaseWriterLedgerRef, buildLedgerDocData({
                            idempotencyKey: `release_asg_${targetId}_writer`,
                            type: "writer_earning",
                            userId: writerId,
                            userEmail: writerEmail,
                            userRole: "writer",
                            amount: writerAmount,
                            currency: "ZMW",
                            ...(targetType === "research" ? { researchRequestId: targetId } : { assignmentId: targetId }),
                            referenceId: targetId,
                            description: `Dispute completion payout for ${targetType} ${targetId}`,
                            metadata: { disputeId, adminUid },
                        }, releaseWriterLedgerRef.id, now));
                        if (writerSnap && writerSnap.exists && writerRef) {
                            const nextBalances = applyWalletDelta(writerSnap.data() || {}, "writer_earning", writerAmount);
                            transaction.update(writerRef, { ...nextBalances, updatedAt: now });
                        }
                    }
                    if (proofreaderId && !relProofSnap.exists) {
                        transaction.set(releaseProofLedgerRef, buildLedgerDocData({
                            idempotencyKey: `release_asg_${targetId}_proofreader`,
                            type: "proofreader_earning",
                            userId: proofreaderId,
                            userEmail: proofreaderEmail || "",
                            userRole: "writer",
                            amount: proofreaderAmount,
                            currency: "ZMW",
                            ...(targetType === "research" ? { researchRequestId: targetId } : { assignmentId: targetId }),
                            referenceId: targetId,
                            description: `Dispute completion proofreading payout for ${targetType} ${targetId}`,
                            metadata: { disputeId, adminUid },
                        }, releaseProofLedgerRef.id, now));
                        const targetProofRef = proofRef || writerRef;
                        const targetProofSnap = proofRef ? proofSnap : writerSnap;
                        if (targetProofSnap && targetProofSnap.exists && targetProofRef) {
                            // If dual role same UID (rare), recompute off updated balances
                            const baseData = !proofRef && writerId && !relWriterSnap.exists
                                ? applyWalletDelta(writerSnap.data() || {}, "writer_earning", writerAmount)
                                : targetProofSnap.data() || {};
                            const nextBalances = applyWalletDelta(baseData, "proofreader_earning", proofreaderAmount);
                            transaction.update(targetProofRef, { ...nextBalances, updatedAt: now });
                        }
                    }
                    if (!relDataboySnap.exists) {
                        transaction.set(releaseDataboyLedgerRef, buildLedgerDocData({
                            idempotencyKey: `release_asg_${targetId}_databoy`,
                            type: "platform_fee",
                            userId: "databoy_platform",
                            userRole: "platform",
                            amount: databoyAmount,
                            currency: "ZMW",
                            ...(targetType === "research" ? { researchRequestId: targetId } : { assignmentId: targetId }),
                            referenceId: targetId,
                            description: `Platform service commission from dispute completion for ${targetType} ${targetId}`,
                            metadata: { disputeId, adminUid },
                        }, releaseDataboyLedgerRef.id, now));
                    }
                }
                transaction.update(disputeRef, {
                    status: "resolved",
                    outcome: "complete",
                    resolution: "complete",
                    resolutionNotes: notes || "",
                    resolvedAt: now,
                    resolvedBy: adminUid,
                    updatedAt: now,
                });
                transaction.update(targetRef, {
                    disputeStatus: "resolved",
                    status: "completed",
                    escrowStatus: "released",
                    payoutStatus: "released",
                    completedAt: target.completedAt || now,
                    updatedAt: now,
                });
                return {
                    alreadyResolved: false,
                    outcome: "complete",
                    dispute,
                    targetType,
                    targetId,
                    amount: budget,
                };
            }
            // Non-financial arbitration / dismissal / resume work (preserves held escrow intact)
            transaction.update(disputeRef, {
                status: "resolved",
                outcome,
                resolution: trimmedResolution || outcome,
                resolutionNotes: notes || "",
                resolvedAt: now,
                resolvedBy: adminUid,
                updatedAt: now,
            });
            transaction.update(targetRef, {
                disputeStatus: "resolved",
                status: "in_progress",
                updatedAt: now,
            });
            return {
                alreadyResolved: false,
                outcome,
                dispute,
                targetType,
                targetId,
            };
        });
        return txResult;
    },
};
