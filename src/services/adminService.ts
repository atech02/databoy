import {
  collection,
  getDocs,
  getDoc,
  doc,
  addDoc,
  updateDoc,
  query,
  orderBy,
  limit,
  where,
  Timestamp
} from "firebase/firestore";
import { db } from "@/config/firebase";
import { UserProfile, Dispute } from "@/types/domain";
import { apiClient } from "./apiClient";

const DISPUTES_COLLECTION = "disputes";
const AUDIT_LOGS_COLLECTION = "auditLogs";

export interface PlatformAuditLog {
  id: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  action: string;
  targetId: string;
  targetType: "user" | "assignment" | "research" | "dispute" | "system";
  details: string;
  createdAt: string;
}

export interface PlatformMetrics {
  totalResearch: number;
  pendingResearch: number;
  totalAssignments: number;
  activeAssignments: number;
  unassignedAssignments: number;
  pendingVerifications: number;
  openDisputes: number;
  totalUsers: number;
  totalWriters: number;
}

export const adminService = {
  // ---------------------------------------------------------------------------
  // DISPUTES
  // ---------------------------------------------------------------------------

  async listDisputes(): Promise<Dispute[]> {
    try {
      const colRef = collection(db, DISPUTES_COLLECTION);
      const q = query(colRef, orderBy("createdAt", "desc"));
      const snap = await getDocs(q);
      const list: Dispute[] = [];
      snap.forEach((d) => {
        list.push({ disputeId: d.id, ...d.data() } as Dispute);
      });
      return list;
    } catch (e) {
      console.error("Error listing disputes:", e);
      throw e;
    }
  },

  async createDispute(
    dispute: Omit<Dispute, "disputeId" | "createdAt" | "updatedAt">,
    _adminProfile: UserProfile
  ): Promise<Dispute> {
    const timestamp = new Date().toISOString();
    const res = await apiClient.post<{ success: boolean; disputeId: string }>("/api/admin/disputes", {
      relatedId: dispute.relatedId,
      relatedType: dispute.relatedType,
      reason: dispute.reason,
      details: (dispute as any).details || dispute.reason,
    });
    return {
      ...dispute,
      disputeId: res.disputeId,
      status: "open",
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  },

  async resolveDispute(
    disputeId: string,
    resolution: string,
    adminNotes: string,
    _adminProfile: UserProfile,
    externalRefundReference?: string
  ): Promise<void> {
    await this.resolveDisputeBackend(disputeId, resolution, adminNotes, externalRefundReference);
  },

  async refundDispute(
    disputeId: string,
    _adminProfile: UserProfile,
    externalRefundReference?: string
  ): Promise<void> {
    await this.resolveDisputeBackend(
      disputeId,
      "refund",
      "Admin issued manual refund settlement from disputes queue",
      externalRefundReference
    );
  },

  // ---------------------------------------------------------------------------
  // PLATFORM METRICS
  // ---------------------------------------------------------------------------

  async getPlatformMetrics(): Promise<PlatformMetrics> {
    try {
      const [
        researchSnap,
        assignmentSnap,
        userSnap,
        disputeSnap,
        verificationSnap,
        writerSnap,
      ] = await Promise.all([
        getDocs(collection(db, "researchRequests")),
        getDocs(collection(db, "assignments")),
        getDocs(collection(db, "users")),
        getDocs(query(collection(db, DISPUTES_COLLECTION), where("status", "==", "open"))),
        getDocs(query(collection(db, "users"), where("verificationStatus", "==", "pending"))),
        getDocs(query(collection(db, "users"), where("role", "==", "writer"))),
      ]);

      // Count active assignments (not draft, not cancelled, not completed)
      let activeAssignments = 0;
      let unassignedAssignments = 0;
      assignmentSnap.forEach((d) => {
        const status = d.data().status;
        if (!["draft", "cancelled", "completed"].includes(status)) activeAssignments++;
        if (status === "unassigned") unassignedAssignments++;
      });

      // Count pending research
      let pendingResearch = 0;
      researchSnap.forEach((d) => {
        const status = d.data().status;
        if (["submitted", "under_review", "needs_clarification"].includes(status)) pendingResearch++;
      });

      return {
        totalResearch: researchSnap.size,
        pendingResearch,
        totalAssignments: assignmentSnap.size,
        activeAssignments,
        unassignedAssignments,
        pendingVerifications: verificationSnap.size,
        openDisputes: disputeSnap.size,
        totalUsers: userSnap.size,
        totalWriters: writerSnap.size,
      };
    } catch (e) {
      console.error("Error fetching platform metrics:", e);
      throw e;
    }
  },

  // ---------------------------------------------------------------------------
  // PLATFORM AUDIT LOGS
  // ---------------------------------------------------------------------------

  async logPlatformAudit(
    _actor: UserProfile,
    _action: string,
    _targetId: string,
    _targetType: PlatformAuditLog["targetType"],
    _details: string
  ): Promise<void> {
    // Platform audit logs are immutable and written server-side by Admin SDK endpoints.
    return;
  },

  async getPlatformAuditLogs(maxLogs = 100): Promise<PlatformAuditLog[]> {
    try {
      const apiRes = await apiClient.get<{ auditLogs: any[] }>(`/api/admin/audit-logs?limit=${maxLogs}`);
      if (apiRes && Array.isArray(apiRes.auditLogs)) {
        return apiRes.auditLogs.map((log) => ({
          id: log.id,
          actorId: log.actorId || "unknown",
          actorName: log.actorName || log.actorRole || "System",
          actorRole: log.actorRole || "admin",
          action: log.action || "action",
          targetId: log.targetId || "",
          targetType: (log.targetType || "system") as PlatformAuditLog["targetType"],
          details: typeof log.details === "object" ? JSON.stringify(log.details) : String(log.details || ""),
          createdAt: log.timestamp?.toDate ? log.timestamp.toDate().toISOString() : log.createdAt || new Date().toISOString(),
        }));
      }
    } catch (apiErr) {
      console.warn("[adminService] Backend API audit log fetch failed or unreachable, falling back to Firestore:", apiErr);
    }

    try {
      const colRef = collection(db, AUDIT_LOGS_COLLECTION);
      const q = query(colRef, orderBy("createdAt", "desc"), limit(maxLogs));
      const snap = await getDocs(q);
      const logs: PlatformAuditLog[] = [];
      snap.forEach((d) => {
        logs.push({ id: d.id, ...d.data() } as PlatformAuditLog);
      });
      return logs;
    } catch (e) {
      console.error("Error fetching platform audit logs:", e);
      throw e;
    }
  },

  // ---------------------------------------------------------------------------
  // WRITER MATCHING — for assignment governance panel
  // ---------------------------------------------------------------------------

  async listVerifiedWriters(): Promise<UserProfile[]> {
    try {
      const colRef = collection(db, "users");
      const q = query(
        colRef,
        where("role", "==", "writer"),
        where("verificationStatus", "==", "approved")
      );
      const snap = await getDocs(q);
      const writers: UserProfile[] = [];
      snap.forEach((d) => {
        const writer = { uid: d.id, ...d.data() } as UserProfile;
        if (writer.writerStatus === "active" && writer.isVerifiedWriter === true) {
          writers.push(writer);
        }
      });
      return writers.sort((a, b) => (b.reputation || 0) - (a.reputation || 0));
    } catch (e) {
      console.error("Error fetching verified writers:", e);
      throw e;
    }
  },

  // ---------------------------------------------------------------------------
  // BACKEND API INTEGRATIONS (Phase 4)
  // ---------------------------------------------------------------------------

  async getRealtimeAnalytics(): Promise<any> {
    try {
      const res = await apiClient.get<{ analytics: any }>("/api/admin/analytics");
      return res.analytics;
    } catch (e) {
      console.warn("[adminService] Backend analytics fetch failed, falling back to local metrics:", e);
      return null;
    }
  },

  async listPayoutRequests(): Promise<any[]> {
    try {
      const res = await apiClient.get<{ payouts: any[] }>("/api/admin/payouts");
      return res.payouts || [];
    } catch (e) {
      console.error("Error fetching payouts from backend:", e);
      return [];
    }
  },

  async approvePayoutRequest(
    payoutId: string,
    externalTransactionId: string,
    confirmationNotes?: string
  ): Promise<any> {
    if (!externalTransactionId || !externalTransactionId.trim()) {
      throw new Error("A valid externalTransactionId is required to approve a payout.");
    }
    return apiClient.post(`/api/admin/payouts/${payoutId}/approve`, {
      externalTransactionId: externalTransactionId.trim(),
      confirmationNotes,
    });
  },

  async rejectPayoutRequest(payoutId: string, reason: string): Promise<any> {
    return apiClient.post(`/api/admin/payouts/${payoutId}/reject`, { reason });
  },

  async resolveDisputeBackend(
    disputeId: string,
    resolution: string,
    adminNotes?: string,
    externalRefundReference?: string
  ): Promise<any> {
    return apiClient.post(`/api/admin/disputes/${disputeId}/resolve`, {
      resolution,
      adminNotes,
      ...(externalRefundReference ? { externalRefundReference } : {}),
    });
  },

  async reassignAssignmentBackend(assignmentId: string, writerId: string): Promise<any> {
    return apiClient.post(`/api/admin/assignments/${assignmentId}/reassign`, { writerId });
  },
};
