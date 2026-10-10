import "server-only";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type Firestore,
} from "firebase-admin/firestore";
import { AppError } from "@/lib/errors";

// Route bundles and development reloads share the Admin client. Its settings
// must be applied exactly once, before any bundle starts using it.
const state = globalThis as typeof globalThis & {
  teachbackFirestore?: Firestore;
};
export function database() {
  if (state.teachbackFirestore) return state.teachbackFirestore;
  const projectId = process.env.GOOGLE_CLOUD_PROJECT;
  if (!projectId)
    throw new AppError(
      "SETUP_REQUIRED",
      "Set GOOGLE_CLOUD_PROJECT and start the Firestore emulator. See the setup guide.",
      503,
    );
  if (!getApps().length)
    initializeApp({
      projectId,
      ...(process.env.FIRESTORE_EMULATOR_HOST
        ? {}
        : { credential: applicationDefault() }),
    });
  const firestore = getFirestore();
  firestore.settings({ ignoreUndefinedProperties: true });
  state.teachbackFirestore = firestore;
  return firestore;
}
export function encode<T extends object>(value: T) {
  const data = structuredClone(value) as Record<string, unknown>;
  if (typeof data.expiresAt === "string")
    data.expiresAt = Timestamp.fromDate(new Date(data.expiresAt));
  return data;
}
export function decode<T>(value: unknown): T {
  const clean = (x: unknown): unknown => {
    if (x instanceof Timestamp) return x.toDate().toISOString();
    if (Array.isArray(x)) return x.map(clean);
    if (x && typeof x === "object")
      return Object.fromEntries(
        Object.entries(x).map(([k, v]) => [k, clean(v)]),
      );
    return x;
  };
  return clean(value) as T;
}
export const expiresAt = () =>
  new Date(
    Date.now() + Number(process.env.SESSION_RETENTION_DAYS || 7) * 86_400_000,
  ).toISOString();
export function assertOwned(
  value: { ownerId: string; expiresAt: string } | undefined,
  ownerId: string,
) {
  if (!value || value.ownerId !== ownerId)
    throw new AppError(
      "NOT_FOUND",
      "This session or material is unavailable in this browser.",
      404,
    );
  if (new Date(value.expiresAt).getTime() <= Date.now())
    throw new AppError(
      "EXPIRED",
      "This material or session has expired. Start again with your notes.",
      410,
    );
}
export async function readOwned<
  T extends { ownerId: string; expiresAt: string },
>(collection: string, id: string, ownerId: string): Promise<T> {
  const snap = await database().collection(collection).doc(id).get();
  const item = snap.exists ? decode<T>(snap.data()) : undefined;
  assertOwned(item, ownerId);
  return item!;
}
