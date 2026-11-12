import "./env.js";
import { initializeApp, getApps, cert, App } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { getAuth, Auth } from "firebase-admin/auth";
import { getStorage, Storage } from "firebase-admin/storage";

const projectId = process.env.FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || "databoy-aa871";
const clientEmail = process.env.FIREBASE_CLIENT_EMAIL?.trim();
const privateKey = process.env.FIREBASE_PRIVATE_KEY?.trim();

// If Firestore emulator host is configured, log local connection target
if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log(`[Backend Firebase] Connecting to Firestore Emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
}

let app: App;
if (getApps().length === 0) {
  if (!process.env.FIRESTORE_EMULATOR_HOST && clientEmail && privateKey) {
    app = initializeApp({
      projectId,
      credential: cert({
        projectId,
        clientEmail,
        privateKey: privateKey.replace(/\\n/g, "\n"),
      }),
    });
  } else {
    app = initializeApp({ projectId });
  }
} else {
  app = getApps()[0];
}

export const adminDb: Firestore = getFirestore(app);
export const adminAuth: Auth = getAuth(app);
export const adminStorage: Storage = getStorage(app);
export { app };
