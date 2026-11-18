import crypto from "crypto";
import path from "path";
import { Router, Request, Response } from "express";
import { z } from "zod";
import { adminDb } from "../config/firebaseAdmin.js";
import { validateR2Config } from "../config/env.js";
import { authMiddleware } from "../middleware/authMiddleware.js";
import { requireRole } from "../middleware/roleGuard.js";
import { RateLimiterBundle } from "../middleware/rateLimit.js";
import { logAuditEvent } from "../services/auditService.js";
import {
  r2StorageService,
  R2StorageError,
  sanitizeStorageErrorMessage,
  DEFAULT_R2_CORS_RULES,
} from "../services/r2StorageService.js";
import { ocrProcessingService } from "../services/ocrProcessingService.js";

const TARGET_TYPES = [
  "assignment",
  "research",
  "verification",
  "pending",
  "draft",
  "deliverable",
  "proofreading",
  "revision",
  "dispute",
] as const;

type UploadTargetType = (typeof TARGET_TYPES)[number];

const EXTENSION_MIME_ALLOWLIST: Record<string, readonly string[]> = {
  ".pdf": ["application/pdf"],
  ".doc": ["application/msword"],
  ".docx": [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ],
  ".txt": ["text/plain"],
  ".csv": ["text/csv", "application/csv", "text/plain"],
  ".xls": ["application/vnd.ms-excel"],
  ".xlsx": [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ],
  ".pptx": [
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ],
  ".png": ["image/png"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".webp": ["image/webp"],
};

const FILE_OBJECTS_COLLECTION = "fileObjects";

const authorizeUploadSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().min(1).max(128),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  category: z.string().max(64).optional(),
});

const completeUploadSchema = z.object({
  fileId: z.string().min(1).max(128),
  checksumSha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  includePreviewUrl: z.boolean().optional(),
});

const downloadUrlSchema = z.object({
  fileId: z.string().min(1).max(128).optional(),
  storageKey: z.string().min(1).max(512).optional(),
  disposition: z.enum(["attachment", "inline"]).optional(),
});

const initiateMultipartSchema = z.object({
  targetType: z.enum(TARGET_TYPES),
  targetId: z.string().min(1).max(128),
  fileName: z.string().min(1).max(255),
  contentType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
  checksumSha256: z
    .string()
    .regex(/^[a-fA-F0-9]{64}$/)
    .optional(),
  category: z.string().max(64).optional(),
});

const partUrlSchema = z.object({
  fileId: z.string().min(1).max(128),
  partNumber: z.number().int().min(1).max(10000),
  contentLength: z.number().int().positive().max(100 * 1024 * 1024).optional(),
});

const completeMultipartSchema = z.object({
  fileId: z.string().min(1).max(128),
  parts: z
    .array(
      z.object({
        partNumber: z.number().int().min(1).max(10000),
        etag: z.string().min(1).max(256),
      })
    )
    .min(1)
    .max(10000),
  includePreviewUrl: z.boolean().optional(),
});

const abortMultipartSchema = z.object({
  fileId: z.string().min(1).max(128),
});

function sanitizeUploadFileName(raw: string): string {
  const base = path.basename(raw.trim());
  return base.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/\.{2,}/g, "_");
}

function validateFileTypeAndExtension(
  fileName: string,
  rawContentType: string
): { valid: boolean; normalizedContentType: string; ext: string; error?: string } {
  const clean = sanitizeUploadFileName(fileName);
  const ext = path.extname(clean).toLowerCase();
  const normalizedContentType = rawContentType.split(";")[0].trim().toLowerCase();

  if (!ext || !Object.prototype.hasOwnProperty.call(EXTENSION_MIME_ALLOWLIST, ext)) {
    return {
      valid: false,
      normalizedContentType,
      ext,
      error:
        "Unsupported file extension. Allowed formats: PDF, Word (.doc/.docx), Excel (.xls/.xlsx/.csv), PowerPoint (.pptx), Text (.txt), and raster images (.png/.jpg/.jpeg/.webp).",
    };
  }

  const allowedMimes = EXTENSION_MIME_ALLOWLIST[ext];
  if (!allowedMimes.includes(normalizedContentType)) {
    return {
      valid: false,
      normalizedContentType,
      ext,
      error: `MIME type '${normalizedContentType}' does not match extension '${ext}'.`,
    };
  }

  return { valid: true, normalizedContentType, ext };
}

function buildFolderPrefix(targetType: UploadTargetType): string {
  switch (targetType) {
    case "pending":
      return "pending";
    case "verification":
      return "verifications";
    case "assignment":
      return "assignments";
    case "research":
      return "research";
    case "draft":
    case "deliverable":
      return "deliverables";
    case "proofreading":
      return "proofreading";
    case "revision":
      return "revisions";
    case "dispute":
      return "disputes";
  }
}

async function verifyTargetUploadAuthorization(
  user: NonNullable<Request["user"]>,
  targetType: UploadTargetType,
  targetId: string
): Promise<{ allowed: boolean; status?: number; error?: string }> {
  if (targetType === "pending") {
    if (targetId !== user.uid && user.role !== "admin") {
      return {
        allowed: false,
        status: 403,
        error: "Cannot stage uploads under another user's pending workspace",
      };
    }
    return { allowed: true };
  }

  if (targetType === "verification") {
    if (targetId !== user.uid && user.role !== "admin") {
      return {
        allowed: false,
        status: 403,
        error: "Cannot upload verification documents for another user",
      };
    }
    return { allowed: true };
  }

  if (targetType === "research") {
    const snap = await adminDb.collection("researchRequests").doc(targetId).get();
    if (!snap.exists) {
      return { allowed: false, status: 404, error: "Target research request not found for upload" };
    }
    const data = snap.data()!;
    const isParticipant =
      data.studentId === user.uid ||
      data.assignedWriterId === user.uid ||
      user.role === "admin";
    if (!isParticipant) {
      return {
        allowed: false,
        status: 403,
        error: "Only participants or admins may upload files to this research request",
      };
    }
    return { allowed: true };
  }

  if (targetType === "dispute") {
    const disputeSnap = await adminDb.collection("disputes").doc(targetId).get();
    if (disputeSnap.exists) {
      const dispute = disputeSnap.data()!;
      if (dispute.raisedBy === user.uid || user.role === "admin") {
        return { allowed: true };
      }
      if (dispute.relatedId) {
        const col = dispute.relatedType === "research" ? "researchRequests" : "assignments";
        const parentSnap = await adminDb.collection(col).doc(dispute.relatedId).get();
        if (parentSnap.exists) {
          const p = parentSnap.data()!;
          if (
            p.customerId === user.uid ||
            p.studentId === user.uid ||
            p.writerId === user.uid ||
            p.assignedWriterId === user.uid ||
            p.proofreaderId === user.uid
          ) {
            return { allowed: true };
          }
        }
      }
      return { allowed: false, status: 403, error: "Only dispute participants or admins may upload evidence" };
    }

    // Fallback when targetId refers directly to an assignment during dispute escalation
    const asgSnap = await adminDb.collection("assignments").doc(targetId).get();
    if (!asgSnap.exists) {
      return { allowed: false, status: 404, error: "Target dispute or assignment record not found" };
    }
    const asg = asgSnap.data()!;
    const isAsgParticipant =
      asg.customerId === user.uid ||
      asg.writerId === user.uid ||
      asg.proofreaderId === user.uid ||
      user.role === "admin";
    return isAsgParticipant
      ? { allowed: true }
      : { allowed: false, status: 403, error: "Only assignment participants or admins may upload dispute evidence" };
  }

  // assignment | draft | deliverable | proofreading | revision
  const asgSnap = await adminDb.collection("assignments").doc(targetId).get();
  if (!asgSnap.exists) {
    return { allowed: false, status: 404, error: "Target assignment record not found for upload" };
  }
  const data = asgSnap.data()!;

  if (targetType === "draft" || targetType === "deliverable") {
    if (data.writerId !== user.uid && user.role !== "admin") {
      return {
        allowed: false,
        status: 403,
        error: "Only the assigned writer or an admin may upload draft deliverables",
      };
    }
    return { allowed: true };
  }

  if (targetType === "proofreading") {
    let isAssignedProofreader = data.proofreaderId === user.uid;
    if (!isAssignedProofreader) {
      const taskSnap = await adminDb.collection("proofreadingTasks").doc(`proof_${targetId}`).get();
      if (taskSnap.exists && taskSnap.data()?.proofreaderId === user.uid) {
        isAssignedProofreader = true;
      }
    }
    if (!isAssignedProofreader && user.role !== "admin") {
      return {
        allowed: false,
        status: 403,
        error: "Only the assigned proofreader or an admin may upload proofreading files",
      };
    }
    return { allowed: true };
  }

  const isParticipant =
    data.customerId === user.uid ||
    data.studentId === user.uid ||
    data.writerId === user.uid ||
    data.assignedWriterId === user.uid ||
    data.proofreaderId === user.uid ||
    user.role === "admin";

  if (!isParticipant) {
    return {
      allowed: false,
      status: 403,
      error: "Only participants or admins may upload files to this record",
    };
  }
  return { allowed: true };
}

async function verifyUserCanAccessFileRecord(
  user: NonNullable<Request["user"]>,
  fileRecord: FirebaseFirestore.DocumentData
): Promise<boolean> {
  if (user.role === "admin") return true;
  if (fileRecord.ownerUid === user.uid) return true;

  const checkLinkedTarget = async (tType: string | undefined, tId: string | undefined): Promise<boolean> => {
    if (!tType || !tId) return false;

    if (tType === "verification" || tType === "pending") {
      return tId === user.uid;
    }

    if (tType === "research") {
      const snap = await adminDb.collection("researchRequests").doc(tId).get();
      if (!snap.exists) return false;
      const d = snap.data()!;
      return d.studentId === user.uid || d.assignedWriterId === user.uid;
    }

    if (tType === "dispute") {
      const dispSnap = await adminDb.collection("disputes").doc(tId).get();
      if (dispSnap.exists) {
        const disp = dispSnap.data()!;
        if (disp.raisedBy === user.uid) return true;
        if (disp.relatedId) {
          return checkLinkedTarget(disp.relatedType || "assignment", disp.relatedId);
        }
      }
      return checkLinkedTarget("assignment", tId);
    }

    // assignment | draft | deliverable | proofreading | revision
    const asgSnap = await adminDb.collection("assignments").doc(tId).get();
    if (!asgSnap.exists) return false;
    const d = asgSnap.data()!;
    return (
      d.customerId === user.uid ||
      d.studentId === user.uid ||
      d.writerId === user.uid ||
      d.assignedWriterId === user.uid ||
      d.proofreaderId === user.uid ||
      d.candidateWriterId === user.uid
    );
  };

  if (await checkLinkedTarget(fileRecord.targetType, fileRecord.targetId)) {
    return true;
  }
  if (fileRecord.linkedTargetType && fileRecord.linkedTargetId) {
    return checkLinkedTarget(fileRecord.linkedTargetType, fileRecord.linkedTargetId);
  }
  return false;
}

async function checkDeletionRetentionBlock(
  user: NonNullable<Request["user"]>,
  fileRecord: FirebaseFirestore.DocumentData
): Promise<{ blocked: boolean; code?: string; error?: string }> {
  const linkedType = fileRecord.linkedTargetType || fileRecord.targetType;
  const linkedId = fileRecord.linkedTargetId || fileRecord.targetId;

  if (linkedType === "dispute") {
    const dispSnap = await adminDb.collection("disputes").doc(linkedId).get();
    if (dispSnap.exists && dispSnap.data()?.status !== "resolved" && dispSnap.data()?.status !== "closed") {
      return {
        blocked: true,
        code: "DISPUTE_HOLD_ACTIVE",
        error: "Files attached to an open dispute cannot be deleted",
      };
    }
  }

  if (
    linkedType === "assignment" ||
    linkedType === "draft" ||
    linkedType === "deliverable" ||
    linkedType === "proofreading" ||
    linkedType === "revision"
  ) {
    const asgSnap = await adminDb.collection("assignments").doc(linkedId).get();
    if (asgSnap.exists) {
      const asg = asgSnap.data()!;
      if (asg.status === "disputed" || asg.activeDisputeId) {
        return {
          blocked: true,
          code: "DISPUTE_HOLD_ACTIVE",
          error: "Documents belonging to a disputed assignment are locked under dispute retention hold",
        };
      }
      if (user.role !== "admin") {
        if (
          asg.paymentStatus === "funded" ||
          asg.escrowStatus === "held" ||
          asg.escrowStatus === "released" ||
          asg.payoutStatus === "released" ||
          ["assigned", "in_progress", "draft_submitted", "under_review", "completed"].includes(asg.status)
        ) {
          return {
            blocked: true,
            code: "RETENTION_POLICY_LOCKED",
            error: "Funded or completed assignment documents are protected by audit retention policy",
          };
        }
      }
    }
  }

  if (linkedType === "research") {
    const resSnap = await adminDb.collection("researchRequests").doc(linkedId).get();
    if (resSnap.exists) {
      const rr = resSnap.data()!;
      if (rr.status === "disputed" || rr.activeDisputeId) {
        return {
          blocked: true,
          code: "DISPUTE_HOLD_ACTIVE",
          error: "Documents belonging to a disputed research request are locked under dispute hold",
        };
      }
      if (user.role !== "admin" && (rr.quoteStatus === "paid" || rr.status === "completed")) {
        return {
          blocked: true,
          code: "RETENTION_POLICY_LOCKED",
          error: "Paid or completed research request files are protected by audit retention policy",
        };
      }
    }
  }

  return { blocked: false };
}

function toSafeFileSummary(id: string, record: FirebaseFirestore.DocumentData) {
  return {
    fileId: id,
    storageProvider: record.storageProvider || "r2",
    storageKey: record.storageKey,
    storagePath: record.storageKey,
    fileName: record.fileName,
    contentType: record.contentType,
    sizeBytes: record.actualSizeBytes || record.expectedSizeBytes || 0,
    targetType: record.targetType,
    targetId: record.targetId,
    linkedTargetType: record.linkedTargetType || null,
    linkedTargetId: record.linkedTargetId || null,
    ownerUid: record.ownerUid,
    status: record.status,
    uploadMode: record.uploadMode || "single",
    etag: record.etag || null,
    createdAt: record.createdAt,
    completedAt: record.completedAt || null,
  };
}

function handleStorageRouteError(res: Response, context: string, err: any): void {
  if (err instanceof R2StorageError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
    });
    return;
  }
  console.error(`[UploadRoutes:${context}]`, sanitizeStorageErrorMessage(err));
  res.status(500).json({ error: `Storage operation failed (${context})` });
}

export function createUploadRouter(limiters: RateLimiterBundle): Router {
  const router = Router();

  /**
   * POST /api/uploads/authorize
   * Authenticates caller, validates R2 config & file constraints, creates pending metadata in Firestore,
   * and returns a short-lived presigned PUT URL to Cloudflare R2.
   */
  router.post(
    "/authorize",
    authMiddleware,
    limiters.fileUpload,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = authorizeUploadSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({
            error: "Invalid upload metadata",
            details: parsed.error.format(),
          });
          return;
        }

        const r2Check = validateR2Config({ requireConfigured: true });
        if (!r2Check.valid || !r2Check.config) {
          res.status(503).json({
            error: r2Check.error || "Cloudflare R2 storage is not configured",
            code: "R2_NOT_CONFIGURED",
          });
          return;
        }
        const cfg = r2Check.config;

        const user = req.user!;
        const { targetType, targetId, fileName, contentType, sizeBytes, checksumSha256, category } = parsed.data;

        if (targetId.includes("/") || targetId.includes("\\") || targetId.includes("..")) {
          res.status(400).json({ error: "Invalid target identifier" });
          return;
        }

        if (sizeBytes > cfg.maxFileSizeBytes) {
          res.status(400).json({
            error: `File size exceeds single-upload limit of ${Math.round(cfg.maxFileSizeBytes / (1024 * 1024))} MB. Use multipart upload for larger files.`,
            code: "FILE_TOO_LARGE",
            maxSizeBytes: cfg.maxFileSizeBytes,
          });
          return;
        }

        const typeCheck = validateFileTypeAndExtension(fileName, contentType);
        if (!typeCheck.valid) {
          res.status(400).json({
            error: typeCheck.error,
            code: "UNSUPPORTED_FILE_TYPE",
          });
          return;
        }

        const cleanName = sanitizeUploadFileName(fileName);
        if (!cleanName) {
          res.status(400).json({ error: "Invalid file name" });
          return;
        }

        const authz = await verifyTargetUploadAuthorization(user, targetType, targetId);
        if (!authz.allowed) {
          res.status(authz.status || 403).json({ error: authz.error || "Access denied" });
          return;
        }

        const fileId = `file_${crypto.randomUUID()}`;
        const folder = buildFolderPrefix(targetType);
        const ownerSegment = targetType === "pending" || targetType === "verification" ? user.uid : targetId;
        const storageKey = `${folder}/${ownerSegment}/${fileId}_${cleanName}`;

        const presigned = await r2StorageService.createPresignedUploadUrl({
          storageKey,
          contentType: typeCheck.normalizedContentType,
          contentLength: sizeBytes,
        });

        const now = new Date();
        const nowIso = now.toISOString();
        const expiresAt = new Date(now.getTime() + presigned.expiresInSeconds * 1000).toISOString();

        await adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId).set({
          fileId,
          storageProvider: "r2",
          bucketName: presigned.bucketName,
          storageKey,
          ownerUid: user.uid,
          ownerEmail: user.email || null,
          targetType,
          targetId,
          category: category || null,
          fileName: cleanName,
          originalFileName: fileName,
          contentType: typeCheck.normalizedContentType,
          expectedSizeBytes: sizeBytes,
          checksumSha256: checksumSha256 || null,
          uploadMode: "single",
          status: "pending_upload",
          expiresAt,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await logAuditEvent({
          action: "file_upload_authorized",
          actorId: user.uid,
          actorRole: user.role,
          targetId: fileId,
          details: {
            targetType,
            targetId,
            storageKey,
            sizeBytes,
            contentType: typeCheck.normalizedContentType,
          },
          ip: req.ip as string | undefined,
        });

        console.log(`[UploadRoutes:authorize:success] fileId=${fileId} targetType=${targetType} contentType=${typeCheck.normalizedContentType} sizeBytes=${sizeBytes} signedHeaders=content-type,host expiresIn=${presigned.expiresInSeconds}s`);

        res.status(200).json({
          authorized: true,
          provider: "r2",
          fileId,
          storageKey,
          storagePath: storageKey,
          uploadUrl: presigned.uploadUrl,
          method: "PUT",
          headers: {
            "Content-Type": typeCheck.normalizedContentType,
          },
          expiresInSeconds: presigned.expiresInSeconds,
          expiresAt,
          maxSizeBytes: cfg.maxFileSizeBytes,
          validatedSizeBytes: sizeBytes,
        });
      } catch (err: any) {
        handleStorageRouteError(res, "authorize", err);
      }
    }
  );

  /**
   * POST /api/uploads/complete
   * Verifies the uploaded object exists in Cloudflare R2 (HeadObject size/MIME/ETag),
   * marks metadata 'uploaded' idempotently, and optionally returns a short-lived download URL.
   */
  router.post(
    "/complete",
    authMiddleware,
    limiters.fileUpload,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = completeUploadSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid upload completion payload", details: parsed.error.format() });
          return;
        }

        const r2Check = validateR2Config({ requireConfigured: true });
        if (!r2Check.valid || !r2Check.config) {
          res.status(503).json({
            error: r2Check.error || "Cloudflare R2 storage is not configured",
            code: "R2_NOT_CONFIGURED",
          });
          return;
        }
        const cfg = r2Check.config;

        const user = req.user!;
        const { fileId, checksumSha256, includePreviewUrl } = parsed.data;
        const fileRef = adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId);
        const snap = await fileRef.get();

        if (!snap.exists) {
          res.status(404).json({ error: "Upload session not found" });
          return;
        }

        const record = snap.data()!;
        if (record.ownerUid !== user.uid && user.role !== "admin") {
          res.status(403).json({ error: "Only the uploader or an admin may complete this upload" });
          return;
        }

        if (record.status === "deleted" || record.status === "aborted") {
          res.status(409).json({
            error: `Cannot complete upload because its status is '${record.status}'`,
            code: "INVALID_UPLOAD_STATE",
          });
          return;
        }

        if (record.status === "uploaded") {
          const preview = includePreviewUrl
            ? await r2StorageService.createPresignedDownloadUrl({
                storageKey: record.storageKey,
                fileName: record.fileName,
                contentType: record.contentType,
              })
            : null;
          res.status(200).json({
            success: true,
            alreadyCompleted: true,
            file: toSafeFileSummary(fileId, record),
            ...(preview ? { downloadUrl: preview.downloadUrl, expiresInSeconds: preview.expiresInSeconds } : {}),
          });
          return;
        }

        const head = await r2StorageService.headObject(record.storageKey);
        if (!head.exists) {
          res.status(400).json({
            error: "Uploaded file was not found in Cloudflare R2 storage. Retry uploading before completing.",
            code: "OBJECT_NOT_FOUND_IN_STORAGE",
          });
          return;
        }

        const actualSize = Number(head.contentLength ?? 0);
        if (!Number.isFinite(actualSize) || actualSize <= 0 || actualSize > cfg.maxFileSizeBytes) {
          res.status(400).json({
            error: "Uploaded object size failed validation constraints",
            code: "INVALID_OBJECT_SIZE",
          });
          return;
        }

        if (record.expectedSizeBytes && actualSize !== record.expectedSizeBytes) {
          res.status(400).json({
            error: `Uploaded size mismatch: expected ${record.expectedSizeBytes} bytes, found ${actualSize} bytes.`,
            code: "SIZE_MISMATCH",
          });
          return;
        }

        const nowIso = new Date().toISOString();
        const txResult = await adminDb.runTransaction(async (tx) => {
          const freshSnap = await tx.get(fileRef);
          if (!freshSnap.exists) throw new Error("NOT_FOUND");
          const fresh = freshSnap.data()!;
          if (fresh.status === "uploaded") {
            return { alreadyCompleted: true, record: fresh };
          }
          if (fresh.status === "deleted" || fresh.status === "aborted") {
            throw new Error("INVALID_STATE");
          }

          const updates = {
            status: "uploaded",
            actualSizeBytes: actualSize,
            verifiedContentType: head.contentType || fresh.contentType,
            etag: head.etag || null,
            checksumSha256: checksumSha256 || fresh.checksumSha256 || null,
            verifiedAt: nowIso,
            completedAt: nowIso,
            updatedAt: nowIso,
          };
          tx.update(fileRef, updates);
          return { alreadyCompleted: false, record: { ...fresh, ...updates } };
        });

        if (!txResult.alreadyCompleted) {
          await logAuditEvent({
            action: "file_upload_completed",
            actorId: user.uid,
            actorRole: user.role,
            targetId: fileId,
            details: {
              storageKey: record.storageKey,
              targetType: record.targetType,
              targetId: record.targetId,
              actualSizeBytes: actualSize,
              etag: head.etag || null,
            },
            ip: req.ip as string | undefined,
          });
        }

        const preview = includePreviewUrl
          ? await r2StorageService.createPresignedDownloadUrl({
              storageKey: record.storageKey,
              fileName: record.fileName,
              contentType: record.contentType,
            })
          : null;

        res.status(200).json({
          success: true,
          alreadyCompleted: txResult.alreadyCompleted,
          file: toSafeFileSummary(fileId, txResult.record),
          ...(preview ? { downloadUrl: preview.downloadUrl, expiresInSeconds: preview.expiresInSeconds } : {}),
        });
      } catch (err: any) {
        if (err?.message === "INVALID_STATE") {
          res.status(409).json({ error: "Upload session is no longer active", code: "INVALID_UPLOAD_STATE" });
          return;
        }
        handleStorageRouteError(res, "complete", err);
      }
    }
  );

  /**
   * POST /api/uploads/multipart/initiate
   * Starts a multipart upload session in Cloudflare R2 for larger files.
   */
  router.post(
    "/multipart/initiate",
    authMiddleware,
    limiters.fileUpload,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = initiateMultipartSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid multipart upload metadata", details: parsed.error.format() });
          return;
        }

        const r2Check = validateR2Config({ requireConfigured: true });
        if (!r2Check.valid || !r2Check.config) {
          res.status(503).json({
            error: r2Check.error || "Cloudflare R2 storage is not configured",
            code: "R2_NOT_CONFIGURED",
          });
          return;
        }
        const cfg = r2Check.config;

        const user = req.user!;
        const { targetType, targetId, fileName, contentType, sizeBytes, checksumSha256, category } = parsed.data;

        if (targetId.includes("/") || targetId.includes("\\") || targetId.includes("..")) {
          res.status(400).json({ error: "Invalid target identifier" });
          return;
        }

        if (sizeBytes > cfg.maxMultipartFileSizeBytes) {
          res.status(400).json({
            error: `File size exceeds multipart limit of ${Math.round(cfg.maxMultipartFileSizeBytes / (1024 * 1024))} MB`,
            code: "FILE_TOO_LARGE",
            maxSizeBytes: cfg.maxMultipartFileSizeBytes,
          });
          return;
        }

        const typeCheck = validateFileTypeAndExtension(fileName, contentType);
        if (!typeCheck.valid) {
          res.status(400).json({ error: typeCheck.error, code: "UNSUPPORTED_FILE_TYPE" });
          return;
        }

        const cleanName = sanitizeUploadFileName(fileName);
        if (!cleanName) {
          res.status(400).json({ error: "Invalid file name" });
          return;
        }

        const authz = await verifyTargetUploadAuthorization(user, targetType, targetId);
        if (!authz.allowed) {
          res.status(authz.status || 403).json({ error: authz.error || "Access denied" });
          return;
        }

        const fileId = `file_${crypto.randomUUID()}`;
        const folder = buildFolderPrefix(targetType);
        const ownerSegment = targetType === "pending" || targetType === "verification" ? user.uid : targetId;
        const storageKey = `${folder}/${ownerSegment}/${fileId}_${cleanName}`;

        const initRes = await r2StorageService.createMultipartUpload({
          storageKey,
          contentType: typeCheck.normalizedContentType,
        });

        const now = new Date();
        const nowIso = now.toISOString();
        const expiresAt = new Date(now.getTime() + cfg.multipartPartTtlSeconds * 1000).toISOString();

        await adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId).set({
          fileId,
          storageProvider: "r2",
          bucketName: initRes.bucketName,
          storageKey,
          ownerUid: user.uid,
          ownerEmail: user.email || null,
          targetType,
          targetId,
          category: category || null,
          fileName: cleanName,
          originalFileName: fileName,
          contentType: typeCheck.normalizedContentType,
          expectedSizeBytes: sizeBytes,
          checksumSha256: checksumSha256 || null,
          uploadMode: "multipart",
          uploadId: initRes.uploadId,
          status: "pending_multipart",
          expiresAt,
          createdAt: nowIso,
          updatedAt: nowIso,
        });

        await logAuditEvent({
          action: "multipart_upload_initiated",
          actorId: user.uid,
          actorRole: user.role,
          targetId: fileId,
          details: { targetType, targetId, storageKey, sizeBytes },
          ip: req.ip as string | undefined,
        });

        res.status(200).json({
          authorized: true,
          provider: "r2",
          fileId,
          uploadId: initRes.uploadId,
          storageKey,
          storagePath: storageKey,
          recommendedPartSizeBytes: 5 * 1024 * 1024,
          expiresInSeconds: cfg.multipartPartTtlSeconds,
          expiresAt,
        });
      } catch (err: any) {
        handleStorageRouteError(res, "multipart_initiate", err);
      }
    }
  );

  /**
   * POST /api/uploads/multipart/part-url
   * Generates a presigned UploadPart URL for a single part of an active multipart upload.
   */
  router.post(
    "/multipart/part-url",
    authMiddleware,
    limiters.writerAction,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = partUrlSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid multipart part request", details: parsed.error.format() });
          return;
        }

        const user = req.user!;
        const { fileId, partNumber, contentLength } = parsed.data;
        const snap = await adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId).get();
        if (!snap.exists) {
          res.status(404).json({ error: "Upload session not found" });
          return;
        }

        const record = snap.data()!;
        if (record.ownerUid !== user.uid && user.role !== "admin") {
          res.status(403).json({ error: "Only the uploader or an admin may request multipart part URLs" });
          return;
        }

        if (record.uploadMode !== "multipart" || !record.uploadId || record.status !== "pending_multipart") {
          res.status(409).json({ error: "Upload session is not open for multipart part uploads", code: "INVALID_UPLOAD_STATE" });
          return;
        }

        const signed = await r2StorageService.createPresignedPartUrl({
          storageKey: record.storageKey,
          uploadId: record.uploadId,
          partNumber,
          contentLength,
        });

        res.status(200).json({
          fileId,
          partNumber,
          uploadUrl: signed.uploadUrl,
          expiresInSeconds: signed.expiresInSeconds,
        });
      } catch (err: any) {
        handleStorageRouteError(res, "multipart_part_url", err);
      }
    }
  );

  /**
   * POST /api/uploads/multipart/complete
   * Completes the multipart upload in R2 and verifies final size with HeadObject.
   */
  router.post(
    "/multipart/complete",
    authMiddleware,
    limiters.fileUpload,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = completeMultipartSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid multipart completion payload", details: parsed.error.format() });
          return;
        }

        const r2Check = validateR2Config({ requireConfigured: true });
        if (!r2Check.valid || !r2Check.config) {
          res.status(503).json({
            error: r2Check.error || "Cloudflare R2 storage is not configured",
            code: "R2_NOT_CONFIGURED",
          });
          return;
        }
        const cfg = r2Check.config;

        const user = req.user!;
        const { fileId, parts, includePreviewUrl } = parsed.data;
        const fileRef = adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId);
        const snap = await fileRef.get();

        if (!snap.exists) {
          res.status(404).json({ error: "Upload session not found" });
          return;
        }

        const record = snap.data()!;
        if (record.ownerUid !== user.uid && user.role !== "admin") {
          res.status(403).json({ error: "Only the uploader or an admin may complete this upload" });
          return;
        }

        if (record.status === "uploaded") {
          res.status(200).json({
            success: true,
            alreadyCompleted: true,
            file: toSafeFileSummary(fileId, record),
          });
          return;
        }

        if (record.uploadMode !== "multipart" || !record.uploadId || record.status !== "pending_multipart") {
          res.status(409).json({ error: "Upload session is not open for multipart completion", code: "INVALID_UPLOAD_STATE" });
          return;
        }

        await r2StorageService.completeMultipartUpload({
          storageKey: record.storageKey,
          uploadId: record.uploadId,
          parts,
        });

        const head = await r2StorageService.headObject(record.storageKey);
        if (!head.exists) {
          res.status(502).json({ error: "Completed multipart object could not be verified in R2", code: "OBJECT_NOT_FOUND_IN_STORAGE" });
          return;
        }

        const actualSize = Number(head.contentLength ?? 0);
        if (!Number.isFinite(actualSize) || actualSize <= 0 || actualSize > cfg.maxMultipartFileSizeBytes) {
          res.status(400).json({ error: "Completed multipart object failed size limits", code: "INVALID_OBJECT_SIZE" });
          return;
        }

        const nowIso = new Date().toISOString();
        const updates = {
          status: "uploaded",
          actualSizeBytes: actualSize,
          verifiedContentType: head.contentType || record.contentType,
          etag: head.etag || null,
          partCount: parts.length,
          verifiedAt: nowIso,
          completedAt: nowIso,
          updatedAt: nowIso,
        };
        await fileRef.update(updates);

        await logAuditEvent({
          action: "multipart_upload_completed",
          actorId: user.uid,
          actorRole: user.role,
          targetId: fileId,
          details: {
            storageKey: record.storageKey,
            actualSizeBytes: actualSize,
            partCount: parts.length,
          },
          ip: req.ip as string | undefined,
        });

        const preview = includePreviewUrl
          ? await r2StorageService.createPresignedDownloadUrl({
              storageKey: record.storageKey,
              fileName: record.fileName,
              contentType: record.contentType,
            })
          : null;

        res.status(200).json({
          success: true,
          alreadyCompleted: false,
          file: toSafeFileSummary(fileId, { ...record, ...updates }),
          ...(preview ? { downloadUrl: preview.downloadUrl, expiresInSeconds: preview.expiresInSeconds } : {}),
        });
      } catch (err: any) {
        handleStorageRouteError(res, "multipart_complete", err);
      }
    }
  );

  /**
   * POST /api/uploads/multipart/abort
   * Explicitly aborts an incomplete multipart upload in R2 and marks metadata 'aborted'.
   */
  router.post(
    "/multipart/abort",
    authMiddleware,
    limiters.writerAction,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = abortMultipartSchema.safeParse(req.body);
        if (!parsed.success) {
          res.status(400).json({ error: "Invalid abort payload", details: parsed.error.format() });
          return;
        }

        const user = req.user!;
        const { fileId } = parsed.data;
        const fileRef = adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId);
        const snap = await fileRef.get();

        if (!snap.exists) {
          res.status(404).json({ error: "Upload session not found" });
          return;
        }

        const record = snap.data()!;
        if (record.ownerUid !== user.uid && user.role !== "admin") {
          res.status(403).json({ error: "Only the uploader or an admin may abort this upload" });
          return;
        }

        if (record.status === "aborted") {
          res.status(200).json({ success: true, alreadyAborted: true, fileId });
          return;
        }

        if (record.status === "uploaded") {
          res.status(409).json({ error: "Cannot abort an already completed upload", code: "ALREADY_COMPLETED" });
          return;
        }

        if (record.uploadId) {
          await r2StorageService.abortMultipartUpload({
            storageKey: record.storageKey,
            uploadId: record.uploadId,
          });
        }

        const nowIso = new Date().toISOString();
        await fileRef.update({
          status: "aborted",
          abortedAt: nowIso,
          abortedBy: user.uid,
          updatedAt: nowIso,
        });

        await logAuditEvent({
          action: "multipart_upload_aborted",
          actorId: user.uid,
          actorRole: user.role,
          targetId: fileId,
          details: { storageKey: record.storageKey },
          ip: req.ip as string | undefined,
        });

        res.status(200).json({ success: true, alreadyAborted: false, fileId, status: "aborted" });
      } catch (err: any) {
        handleStorageRouteError(res, "multipart_abort", err);
      }
    }
  );

  /**
   * POST /api/uploads/download-url
   * Generates a short-lived signed GET URL from Cloudflare R2 ONLY after verifying
   * participant, owner, or administrator authorization.
   */
  router.post(
    "/download-url",
    authMiddleware,
    limiters.general,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const parsed = downloadUrlSchema.safeParse(req.body);
        if (!parsed.success || (!parsed.data.fileId && !parsed.data.storageKey)) {
          res.status(400).json({ error: "Either fileId or storageKey is required" });
          return;
        }

        const user = req.user!;
        let fileId = parsed.data.fileId;
        let record: FirebaseFirestore.DocumentData | undefined;

        if (fileId) {
          const snap = await adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId).get();
          if (snap.exists) {
            record = snap.data()!;
          }
        } else if (parsed.data.storageKey) {
          const querySnap = await adminDb
            .collection(FILE_OBJECTS_COLLECTION)
            .where("storageKey", "==", parsed.data.storageKey)
            .limit(1)
            .get();
          if (!querySnap.empty) {
            fileId = querySnap.docs[0].id;
            record = querySnap.docs[0].data();
          }
        }

        if (!record || !fileId) {
          res.status(404).json({ error: "Document metadata record not found" });
          return;
        }

        const canAccess = await verifyUserCanAccessFileRecord(user, record);
        if (!canAccess) {
          res.status(403).json({ error: "Access denied: You are not authorized to download this document" });
          return;
        }

        if (record.status === "deleted" || record.status === "aborted") {
          res.status(410).json({ error: "Document has been deleted or aborted" });
          return;
        }

        if (record.status !== "uploaded") {
          res.status(409).json({
            error: "Document upload has not completed verification yet",
            code: "UPLOAD_NOT_COMPLETED",
          });
          return;
        }

        const signed = await r2StorageService.createPresignedDownloadUrl({
          storageKey: record.storageKey,
          fileName: record.fileName,
          contentType: record.contentType,
          disposition: parsed.data.disposition,
        });

        await logAuditEvent({
          action: "file_download_authorized",
          actorId: user.uid,
          actorRole: user.role,
          targetId: fileId,
          details: {
            targetType: record.targetType,
            targetId: record.linkedTargetId || record.targetId,
          },
          ip: req.ip as string | undefined,
        });

        res.status(200).json({
          success: true,
          fileId,
          storageKey: record.storageKey,
          fileName: record.fileName,
          contentType: record.contentType,
          sizeBytes: record.actualSizeBytes || record.expectedSizeBytes,
          downloadUrl: signed.downloadUrl,
          expiresInSeconds: signed.expiresInSeconds,
        });
      } catch (err: any) {
        handleStorageRouteError(res, "download_url", err);
      }
    }
  );

  /**
   * POST /api/uploads/admin/cleanup-multipart
   * Admin-triggered cleanup of abandoned multipart uploads older than maxAgeHours.
   */
  router.post(
    "/admin/cleanup-multipart",
    authMiddleware,
    requireRole("admin"),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const rawHours = Number(req.body?.maxAgeHours ?? 24);
        const maxAgeHours = Number.isFinite(rawHours) && rawHours >= 1 && rawHours <= 720 ? rawHours : 24;
        const result = await r2StorageService.cleanupStaleMultipartUploads({ maxAgeHours });

        await logAuditEvent({
          action: "r2_multipart_cleanup_executed",
          actorId: req.user!.uid,
          actorRole: req.user!.role,
          targetId: "r2_multipart_cleanup",
          details: { ...result, maxAgeHours },
          ip: req.ip as string | undefined,
        });

        res.status(200).json({ success: true, ...result, metrics: r2StorageService.getMetrics() });
      } catch (err: any) {
        handleStorageRouteError(res, "cleanup_multipart", err);
      }
    }
  );

  /**
   * GET /api/uploads/admin/metrics
   * Returns storage operational counters (zero secrets/URLs) to admins.
   */
  router.get(
    "/admin/metrics",
    authMiddleware,
    requireRole("admin"),
    async (_req: Request, res: Response): Promise<void> => {
      res.status(200).json({
        success: true,
        provider: "r2",
        metrics: r2StorageService.getMetrics(),
      });
    }
  );

  /**
   * GET /api/uploads/:fileId
   * Returns safe Firestore metadata summary for an authorized user.
   */
  router.get(
    "/:fileId",
    authMiddleware,
    limiters.general,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const fileId = req.params.fileId as string;
        const snap = await adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId).get();
        if (!snap.exists) {
          res.status(404).json({ error: "Document metadata record not found" });
          return;
        }
        const record = snap.data()!;
        const canAccess = await verifyUserCanAccessFileRecord(req.user!, record);
        if (!canAccess) {
          res.status(403).json({ error: "Access denied" });
          return;
        }
        res.status(200).json({
          success: true,
          file: toSafeFileSummary(fileId, record),
        });
      } catch (err: any) {
        handleStorageRouteError(res, "metadata_get", err);
      }
    }
  );

  /**
   * DELETE /api/uploads/:fileId
   * Deletes an authorized file from Cloudflare R2 and records audit trail,
   * while refusing deletion during active disputes or financial/audit retention holds.
   */
  router.delete(
    "/:fileId",
    authMiddleware,
    limiters.writerAction,
    async (req: Request, res: Response): Promise<void> => {
      try {
        const fileId = req.params.fileId as string;
        const user = req.user!;
        const fileRef = adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId);
        const snap = await fileRef.get();

        if (!snap.exists) {
          res.status(404).json({ error: "Document record not found" });
          return;
        }

        const record = snap.data()!;
        if (record.ownerUid !== user.uid && user.role !== "admin") {
          res.status(403).json({ error: "Only the document owner or an admin may delete this file" });
          return;
        }

        if (record.status === "deleted") {
          res.status(200).json({ success: true, alreadyDeleted: true, fileId });
          return;
        }

        const retentionCheck = await checkDeletionRetentionBlock(user, record);
        if (retentionCheck.blocked) {
          res.status(409).json({
            error: retentionCheck.error,
            code: retentionCheck.code,
          });
          return;
        }

        if (record.status === "pending_multipart" && record.uploadId) {
          await r2StorageService.abortMultipartUpload({
            storageKey: record.storageKey,
            uploadId: record.uploadId,
          });
        } else if (record.status === "uploaded") {
          await r2StorageService.deleteObject(record.storageKey);
        }

        const nowIso = new Date().toISOString();
        await fileRef.update({
          status: "deleted",
          deletedAt: nowIso,
          deletedBy: user.uid,
          updatedAt: nowIso,
        });

        await logAuditEvent({
          action: "file_deleted",
          actorId: user.uid,
          actorRole: user.role,
          targetId: fileId,
          details: {
            storageKey: record.storageKey,
            targetType: record.targetType,
            targetId: record.linkedTargetId || record.targetId,
          },
          ip: req.ip as string | undefined,
        });

        res.status(200).json({
          success: true,
          alreadyDeleted: false,
          fileId,
          status: "deleted",
        });
      } catch (err: any) {
        handleStorageRouteError(res, "delete", err);
      }
    }
  );

  /**
   * POST /api/uploads/:fileId/ocr
   * Runs authoritative OCR / assignment understanding on the verified R2 document.
   */
  const handleOcrRequest = async (req: Request, res: Response): Promise<void> => {
    try {
      const fileId = (req.params.fileId || req.body?.fileId) as string;
      if (!fileId || typeof fileId !== "string") {
        res.status(400).json({ error: "Missing required fileId parameter" });
        return;
      }

      const user = req.user!;
      const fileRef = adminDb.collection(FILE_OBJECTS_COLLECTION).doc(fileId);
      const snap = await fileRef.get();

      if (!snap.exists) {
        res.status(404).json({ error: "Uploaded file record not found" });
        return;
      }

      const fileRecord = snap.data()!;
      if (fileRecord.ownerUid !== user.uid && user.role !== "admin") {
        const canAccess = await verifyUserCanAccessFileRecord(user, fileRecord);
        if (!canAccess) {
          res.status(403).json({ error: "Access denied to document OCR" });
          return;
        }
      }

      if (fileRecord.status === "deleted" || fileRecord.status === "aborted") {
        res.status(409).json({ error: `Cannot run OCR on file in '${fileRecord.status}' state` });
        return;
      }

      const result = await ocrProcessingService.processFile({
        fileId,
        storageKey: fileRecord.storageKey,
        contentType: fileRecord.contentType || "application/octet-stream",
        fileName: fileRecord.fileName || "document",
        userUid: user.uid,
        clientRawText: typeof req.body?.clientRawText === "string" ? req.body.clientRawText : undefined,
        forceMultimodal: Boolean(req.body?.forceMultimodal),
      });

      res.status(200).json({
        success: true,
        fileId,
        rawText: result.rawText,
        parsedFields: result.parsedFields,
        parsed: result.parsedFields, // compatibility alias
        confidence: result.confidence,
        ocrMetrics: result.ocrMetrics,
      });
    } catch (err: any) {
      handleStorageRouteError(res, "ocr", err);
    }
  };

  router.post("/:fileId/ocr", authMiddleware, limiters.general, handleOcrRequest);
  router.post("/ocr", authMiddleware, limiters.general, handleOcrRequest);

  /**
   * Admin Storage CORS Diagnostics & Configuration
   * GET  /api/uploads/admin/cors
   * POST /api/uploads/admin/cors/apply
   */
  router.get(
    "/admin/cors",
    authMiddleware,
    requireRole("admin"),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const rules = await r2StorageService.getBucketCors();
        res.status(200).json({ success: true, rules });
      } catch (err: any) {
        handleStorageRouteError(res, "getBucketCors", err);
      }
    }
  );

  router.get(
    "/admin/test-direct-put",
    authMiddleware,
    requireRole("admin"),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const key = `diagnostics/probe_${Date.now()}.txt`;
        const directRes = await r2StorageService.putDirectObject(key, "probe-test-from-backend");
        res.status(200).json({
          success: true,
          etag: directRes.etag,
          key,
        });
      } catch (err: any) {
        // Probe list buckets to check token scoping
        let listResult: any = null;
        try {
          listResult = await (r2StorageService as any).probeBuckets?.();
        } catch (lErr: any) {
          listResult = { error: lErr.message, name: lErr.name };
        }

        res.status(502).json({
          success: false,
          error: err.message,
          name: err.name,
          code: err.code || err.Code,
          statusCode: err.$metadata?.httpStatusCode,
          listResult,
        });
      }
    }
  );

  router.post(
    "/admin/cors/apply",
    authMiddleware,
    requireRole("admin"),
    async (req: Request, res: Response): Promise<void> => {
      try {
        const rules = Array.isArray(req.body?.rules) ? req.body.rules : DEFAULT_R2_CORS_RULES;
        await r2StorageService.putBucketCors(rules);
        await logAuditEvent({
          action: "r2_cors_updated",
          actorId: req.user!.uid,
          actorRole: req.user!.role,
          targetId: "r2_bucket",
          details: { ruleCount: rules.length },
          ip: req.ip as string | undefined,
        });
        res.status(200).json({ success: true, rules });
      } catch (err: any) {
        handleStorageRouteError(res, "putBucketCors", err);
      }
    }
  );

  return router;
}
