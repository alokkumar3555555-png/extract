import "server-only";
import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";

// Lazy initialization allows builds and the mock endpoint to run without credentials.
export function getAdminFirestore() {
  const appName = "extractor-backend";
  let app = getApps().find((candidate) => candidate.name === appName);
  if (!app) {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    if (!projectId || !clientEmail || !privateKey) {
      throw new Error("Firebase Admin environment variables are missing");
    }
    app = initializeApp({ credential: cert({ projectId, clientEmail, privateKey }) }, appName);
  }
  return getFirestore(app);
}
