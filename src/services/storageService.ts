import { apiClient } from "@/services/apiClient";

export type StorageTargetFolder =
  | "assignments"
  | "research"
  | "pending"
  | "draft"
  | "deliverable"
  | "proofreading"
  | "revision"
  | "dispute";

export type VerificationDocumentType =
  | "degree_certificate"
  | "transcript"
  | "cv"
  | "certifications"
  | "publications"
  | "supporting_docs";

export interface AuthorizedUploadResult {
  authorized: boolean;
  provider: "r2";
  fileId: string;
  storageKey: string;
  storagePath: string;
  uploadUrl: string;
  method: "PUT";
  headers: Record<string, string>;
  expiresInSeconds: number;
  maxSizeBytes: number;
}

export interface CompletedUploadResult {
  url: string;
  path: string;
  fileId: string;
  storageKey: string;
  storageProvider: "r2";
  fileName: string;
  contentType: string;
  sizeBytes: number;
}

export interface AuthorizedFileReference {
  fileId?: string;
  storageKey?: string;
  storagePath?: string;
  url?: string;
  name?: string;
  disposition?: "attachment" | "inline";
}

const SINGLE_PUT_THRESHOLD_BYTES = 15 * 1024 * 1024;
const DEFAULT_PART_SIZE_BYTES = 5 * 1024 * 1024;

const EXT_TO_MIME: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  csv: "text/csv",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

function inferContentType(file: File): string {
  const explicit = (file.type || "").split(";")[0].trim().toLowerCase();
  if (explicit && explicit !== "application/octet-stream") {
    return explicit;
  }
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  return EXT_TO_MIME[ext] || "application/octet-stream";
}

export function extractR2FileId(refOrUrl?: string): string | undefined {
  if (!refOrUrl || typeof refOrUrl !== "string") return undefined;
  const trimmed = refOrUrl.trim();
  if (trimmed.startsWith("r2://")) {
    return trimmed.slice(5) || undefined;
  }
  return undefined;
}

async function computeFileSha256(file: File): Promise<string | undefined> {
  try {
    if (typeof crypto === "undefined" || !crypto.subtle) return undefined;
    const buffer = await file.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } catch {
    return undefined;
  }
}

function uploadBlobViaXhr(params: {
  url: string;
  body: Blob;
  headers?: Record<string, string>;
  onProgress?: (loadedBytes: number, totalBytes: number) => void;
  timeoutMs?: number;
}): Promise<{ etag?: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", params.url, true);
    xhr.timeout = params.timeoutMs ?? 120000;

    if (params.headers) {
      for (const [k, v] of Object.entries(params.headers)) {
        if (k.toLowerCase() === "content-length") continue;
        xhr.setRequestHeader(k, v);
      }
    }

    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable && params.onProgress) {
        params.onProgress(evt.loaded, evt.total);
      }
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        const etag = xhr.getResponseHeader("ETag")?.replace(/"/g, "") || undefined;
        resolve({ etag });
      } else {
        const bodySnippet = xhr.responseText ? `: ${xhr.responseText.slice(0, 200)}` : "";
        reject(new Error(`Direct R2 upload failed with HTTP ${xhr.status} (${xhr.statusText || "Error"})${bodySnippet}`));
      }
    };

    xhr.onerror = () => {
      reject(new Error("Network error during Cloudflare R2 upload (check bucket CORS configuration or network connection)"));
    };

    xhr.ontimeout = () => {
      reject(new Error("Upload to Cloudflare R2 timed out. Please retry."));
    };

    xhr.send(params.body);
  });
}

async function uploadBlobWithRetry(params: {
  url: string;
  body: Blob;
  headers?: Record<string, string>;
  onProgress?: (loadedBytes: number, totalBytes: number) => void;
  maxAttempts?: number;
}): Promise<{ etag?: string }> {
  const attempts = params.maxAttempts ?? 2;
  let lastError: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await uploadBlobViaXhr(params);
    } catch (err) {
      lastError = err;
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, 400 * i));
      }
    }
  }
  throw lastError;
}

function mapFolderToTargetType(
  folder: StorageTargetFolder
): "assignment" | "research" | "pending" | "draft" | "deliverable" | "proofreading" | "revision" | "dispute" {
  switch (folder) {
    case "assignments":
      return "assignment";
    case "research":
      return "research";
    case "pending":
      return "pending";
    default:
      return folder;
  }
}

async function executeUploadFlow(params: {
  targetType:
    | "assignment"
    | "research"
    | "verification"
    | "pending"
    | "draft"
    | "deliverable"
    | "proofreading"
    | "revision"
    | "dispute";
  targetId: string;
  file: File;
  fileNameOverride?: string;
  category?: string;
  onProgress?: (progress: number) => void;
}): Promise<CompletedUploadResult> {
  const { file, targetType, targetId, onProgress, category } = params;
  const uploadName = params.fileNameOverride || file.name;
  const contentType = inferContentType(file);
  const checksumSha256 = file.size <= SINGLE_PUT_THRESHOLD_BYTES ? await computeFileSha256(file) : undefined;

  if (onProgress) onProgress(2);

  if (file.size <= SINGLE_PUT_THRESHOLD_BYTES) {
    const authRes = await apiClient.post<AuthorizedUploadResult>("/api/uploads/authorize", {
      targetType,
      targetId,
      fileName: uploadName,
      contentType,
      sizeBytes: file.size,
      ...(checksumSha256 ? { checksumSha256 } : {}),
      ...(category ? { category } : {}),
    });

    if (onProgress) onProgress(8);

    await uploadBlobWithRetry({
      url: authRes.uploadUrl,
      body: file,
      headers: {
        "Content-Type": contentType,
      },
      onProgress: (loaded, total) => {
        if (onProgress && total > 0) {
          const pct = Math.min(94, Math.max(8, Math.round(8 + (loaded / total) * 86)));
          onProgress(pct);
        }
      },
    });

    const completeRes = await apiClient.post<{
      success: boolean;
      file: {
        fileId: string;
        storageKey: string;
        fileName: string;
        contentType: string;
        sizeBytes: number;
      };
    }>("/api/uploads/complete", {
      fileId: authRes.fileId,
      ...(checksumSha256 ? { checksumSha256 } : {}),
    });

    if (onProgress) onProgress(100);

    return {
      url: `r2://${completeRes.file.fileId}`,
      path: completeRes.file.storageKey,
      fileId: completeRes.file.fileId,
      storageKey: completeRes.file.storageKey,
      storageProvider: "r2",
      fileName: completeRes.file.fileName,
      contentType: completeRes.file.contentType,
      sizeBytes: completeRes.file.sizeBytes,
    };
  }

  // Large-file multipart upload path
  const initRes = await apiClient.post<{
    fileId: string;
    uploadId: string;
    storageKey: string;
    recommendedPartSizeBytes?: number;
  }>("/api/uploads/multipart/initiate", {
    targetType,
    targetId,
    fileName: uploadName,
    contentType,
    sizeBytes: file.size,
    ...(category ? { category } : {}),
  });

  const partSize = initRes.recommendedPartSizeBytes || DEFAULT_PART_SIZE_BYTES;
  const totalParts = Math.ceil(file.size / partSize);
  const completedParts: Array<{ partNumber: number; etag: string }> = [];

  try {
    let uploadedBytes = 0;

    for (let partNumber = 1; partNumber <= totalParts; partNumber++) {
      const start = (partNumber - 1) * partSize;
      const end = Math.min(start + partSize, file.size);
      const chunk = file.slice(start, end);

      const partSign = await apiClient.post<{ uploadUrl: string }>("/api/uploads/multipart/part-url", {
        fileId: initRes.fileId,
        partNumber,
        contentLength: chunk.size,
      });

      const { etag } = await uploadBlobWithRetry({
        url: partSign.uploadUrl,
        body: chunk,
        onProgress: (loaded) => {
          if (onProgress && file.size > 0) {
            const pct = Math.min(95, Math.round(5 + ((uploadedBytes + loaded) / file.size) * 90));
            onProgress(pct);
          }
        },
      });

      if (!etag) {
        throw new Error(`Missing ETag from R2 for multipart part ${partNumber}`);
      }

      completedParts.push({ partNumber, etag });
      uploadedBytes += chunk.size;
    }

    const completeRes = await apiClient.post<{
      success: boolean;
      file: {
        fileId: string;
        storageKey: string;
        fileName: string;
        contentType: string;
        sizeBytes: number;
      };
    }>("/api/uploads/multipart/complete", {
      fileId: initRes.fileId,
      parts: completedParts,
    });

    if (onProgress) onProgress(100);

    return {
      url: `r2://${completeRes.file.fileId}`,
      path: completeRes.file.storageKey,
      fileId: completeRes.file.fileId,
      storageKey: completeRes.file.storageKey,
      storageProvider: "r2",
      fileName: completeRes.file.fileName,
      contentType: completeRes.file.contentType,
      sizeBytes: completeRes.file.sizeBytes,
    };
  } catch (err) {
    try {
      await apiClient.post("/api/uploads/multipart/abort", { fileId: initRes.fileId });
    } catch {
      // Best-effort abort; stale cleanups also handle abandoned uploads
    }
    throw err;
  }
}

export const storageService = {
  /**
   * Authorizes and uploads a verification scan (degree, transcript, CV, etc.) to private Cloudflare R2 storage.
   * Returns a private reference (`r2://<fileId>`) — never a permanent public URL.
   */
  async uploadVerificationDocument(
    uid: string,
    documentType: VerificationDocumentType,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<string> {
    const result = await executeUploadFlow({
      targetType: "verification",
      targetId: uid,
      file,
      fileNameOverride: `${documentType}_${file.name}`,
      category: documentType,
      onProgress,
    });
    return result.url;
  },

  /**
   * Authorizes, uploads to private Cloudflare R2 storage, and verifies completion with the backend.
   */
  async uploadFile(
    folder: StorageTargetFolder,
    id: string,
    file: File,
    onProgress?: (progress: number) => void
  ): Promise<CompletedUploadResult> {
    return executeUploadFlow({
      targetType: mapFolderToTargetType(folder),
      targetId: id,
      file,
      onProgress,
    });
  },

  /**
   * Requests a short-lived authorized signed GET URL from the Express backend.
   * Maintains transparent read-only compatibility for legacy HTTPS URLs if present.
   */
  async getAuthorizedDownloadUrl(ref: AuthorizedFileReference): Promise<string> {
    const fileId = ref.fileId || extractR2FileId(ref.url);
    const storageKey = ref.storageKey || ref.storagePath;

    if (fileId || storageKey) {
      const res = await apiClient.post<{ downloadUrl: string }>("/api/uploads/download-url", {
        ...(fileId ? { fileId } : {}),
        ...(!fileId && storageKey ? { storageKey } : {}),
        ...(ref.disposition ? { disposition: ref.disposition } : {}),
      });
      if (!res?.downloadUrl) {
        throw new Error("Backend did not return a signed download URL");
      }
      return res.downloadUrl;
    }

    if (ref.url && (ref.url.startsWith("https://") || ref.url.startsWith("http://"))) {
      return ref.url;
    }

    throw new Error("No valid document reference available for download");
  },

  /**
   * Opens or downloads an authorized private document in a new tab using a short-lived signed URL.
   */
  async openAuthorizedFile(ref: AuthorizedFileReference): Promise<void> {
    const signedUrl = await this.getAuthorizedDownloadUrl(ref);
    if (typeof window !== "undefined") {
      window.open(signedUrl, "_blank", "noopener,noreferrer");
    }
  },

  /**
   * Deletes an authorized file record via the Express backend (enforcing audit logs and retention holds).
   */
  async deleteFile(fileIdOrUrl: string): Promise<void> {
    const fileId = extractR2FileId(fileIdOrUrl) || fileIdOrUrl;
    await apiClient.delete(`/api/uploads/${encodeURIComponent(fileId)}`);
  },
};
