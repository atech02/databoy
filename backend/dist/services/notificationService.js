import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "../config/firebaseAdmin.js";
export async function createNotification(params) {
    const { userId, title, message, type = "system", link, metadata } = params;
    if (!userId || !title || !message) {
        throw new Error("Missing required notification fields: userId, title, or message");
    }
    const docRef = await adminDb.collection("notifications").add({
        userId,
        title,
        message,
        type,
        link: link || null,
        metadata: metadata || {},
        read: false,
        createdAt: FieldValue.serverTimestamp(),
    });
    return docRef.id;
}
