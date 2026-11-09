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
    adminProfile: UserProfile
  ): Promise<Dispute> {
    const timestamp = new Date().toISOString();
    const payload = {
      ...dispute,
      status: "open" as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    try {
      const colRef = collection(db, DISPUTES_COLLECTION);
      const docRef = await addDoc(colRef, payload);

      await this.logPlatformAudit(
        adminProfile,
        "DISPUTE_OPENED",
        docRef.id,
        "dispute",
        `Admin opened dispute for ${dispute.relatedType} [${dispute.relatedId}]. Reason: ${dispute.reason}`
      );

      return { disputeId: docRef.id, ...payload };
    } catch (e) {
      console.error("Error creating dispute:", e);
      throw e;
    }
  },

  async resolveDispute(
    disputeId: string,
    resolution: string,
    adminNotes: string,
    adminProfile: UserProfile
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    try {
      const docRef = doc(db, DISPUTES_COLLECTION, disputeId);
      await updateDoc(docRef, {
        status: "resolved",
        resolution,
        adminNotes,
        updatedAt: timestamp,
      });

      await this.logPlatformAudit(
        adminProfile,
        "DISPUTE_RESOLVED",
        disputeId,
        "dispute",
        `Admin resolved dispute [${disputeId}]. Resolution: ${resolution}`
      );
    } catch (e) {
      console.error("Error resolving dispute:", e);
      throw e;
    }
  },

  async refundDispute(
    disputeId: string,
    adminProfile: UserProfile
  ): Promise<void> {
    const timestamp = new Date().toISOString();
    try {
      const docRef = doc(db, DISPUTES_COLLECTION, disputeId);
      await updateDoc(docRef, {
        status: "resolved",
        resolution: "Escrow refunded to student.",
        updatedAt: timestamp,
      });

      await this.logPlatformAudit(
        adminProfile,
        "DISPUTE_REFUNDED",
        disputeId,
        "dispute",
        `Admin issued escrow refund for dispute [${disputeId}]`
      );
    } catch (e) {
      console.error("Error processing refund:", e);
      throw e;
    }
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
    actor: UserProfile,
    action: string,
    targetId: string,
    targetType: PlatformAuditLog["targetType"],
    details: string
  ): Promise<void> {
    try {
      const colRef = collection(db, AUDIT_LOGS_COLLECTION);
      await addDoc(colRef, {
        actorId: actor.uid,
        actorName: actor.displayName,
        actorRole: actor.role,
        action,
        targetId,
        targetType,
        details,
        createdAt: new Date().toISOString(),
      });
    } catch (e) {
      // Audit log failures should not crash the caller
      console.error("Failed to write platform audit log:", e);
    }
  },

  async getPlatformAuditLogs(maxLogs = 100): Promise<PlatformAuditLog[]> {
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
};
