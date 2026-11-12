import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../config/firebaseAdmin.js";

export interface AuditLogEntry {
  action: string;
  actorId: string;
  actorRole: string;
  targetId?: string;
  details?: Record<string, any>;
  ip?: string;
  userAgent?: string;
}

export async function logAuditEvent(entry: AuditLogEntry): Promise<string> {
  try {
    const cleanEntry: any = {
      action: entry.action,
      actorId: entry.actorId,
      actorRole: entry.actorRole,
      timestamp: FieldValue.serverTimestamp(),
    };
    if (entry.targetId !== undefined) cleanEntry.targetId = entry.targetId;
    if (entry.ip !== undefined) cleanEntry.ip = entry.ip;
    if (entry.userAgent !== undefined) cleanEntry.userAgent = entry.userAgent;

    const cleanDetails: any = {};
    if (entry.details && typeof entry.details === "object") {
      for (const [k, v] of Object.entries(entry.details)) {
        if (v !== undefined) cleanDetails[k] = v;
      }
    }
    cleanEntry.details = cleanDetails;

    const docRef = await adminDb.collection("auditLogs").add(cleanEntry);
    return docRef.id;
  } catch (error) {
    console.error("[AuditService] Failed to record audit log:", error);
    // Non-blocking for primary path but logged to stdout/stderr
    return "";
  }
}
