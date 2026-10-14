import { applicationDefault, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
try {
  process.loadEnvFile(".env.local");
} catch {}
if (!process.env.GOOGLE_CLOUD_PROJECT)
  throw new Error("Set GOOGLE_CLOUD_PROJECT before cleanup.");
initializeApp({
  projectId: process.env.GOOGLE_CLOUD_PROJECT,
  ...(process.env.FIRESTORE_EMULATOR_HOST
    ? {}
    : { credential: applicationDefault() }),
});
const db = getFirestore();
for (const collection of [
  "sessions",
  "materials",
  "extraction_cache",
  "lessons",
  "guests",
  "operations",
  "usage",
  "events",
  "user_sessions",
  "passkey_challenges",
]) {
  let deleted = 0;
  while (true) {
    const batch = await db
      .collection(collection)
      .where("expiresAt", "<=", Timestamp.now())
      .limit(100)
      .select()
      .get();
    if (batch.empty) break;
    for (const doc of batch.docs) {
      await db.recursiveDelete(doc.ref);
      deleted++;
    }
  }
  console.log(`${collection}: removed ${deleted} expired records`);
}
await db.terminate();
