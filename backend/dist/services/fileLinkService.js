import { adminDb } from "../config/firebaseAdmin.js";
/**
 * Verifies caller owns any referenced fileObjects records and links them to the parent
 * assignment, research request, or dispute so authorized participants can obtain short-lived downloads.
 */
export async function linkUploadedFilesToTarget(params) {
    const files = params.files || [];
    if (files.length === 0)
        return;
    const nowIso = new Date().toISOString();
    for (const item of files) {
        const fileId = item.fileId;
        if (!fileId)
            continue;
        const ref = adminDb.collection("fileObjects").doc(fileId);
        const snap = await ref.get();
        if (!snap.exists)
            continue;
        const data = snap.data();
        if (data.ownerUid !== params.actorUid && params.actorRole !== "admin") {
            throw new Error("FORBIDDEN_FILE_REFERENCE");
        }
        await ref.update({
            linkedTargetType: params.targetType,
            linkedTargetId: params.targetId,
            updatedAt: nowIso,
        });
    }
}
