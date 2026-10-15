import "server-only";
import { applicationDefault, getApps, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  Timestamp,
  type Firestore,
  type Transaction,
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

// Read this fence before any transaction writes. Claiming a guest conflicts
// with these reads, so requests started before sign-in cannot restore ownership.
export async function assertGuestWritable(tx: Transaction, ownerId: string) {
  if (!ownerId.startsWith("guest_")) return;
  const guest = await tx.get(database().collection("guests").doc(ownerId));
  if (
    !guest.exists ||
    guest.get("claimedBy") ||
    !(guest.get("expiresAt") instanceof Timestamp) ||
    guest.get("expiresAt").toMillis() <= Date.now()
  )
    throw new AppError(
      "GUEST_CHANGED",
      "Your browser access changed. Refresh to continue or start a new lesson.",
      409,
    );
}
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
>(
  collection: string,
  id: string,
  ownerId: string,
  fields?: string[],
): Promise<T> {
  const f = database();
  const ref = f.collection(collection).doc(id);
  const snap = fields
    ? (
        await f.getAll(ref, {
          fieldMask: [...new Set(["ownerId", "expiresAt", ...fields])],
        })
      )[0]
    : await ref.get();
  const item = snap.exists ? decode<T>(snap.data()) : undefined;
  assertOwned(item, ownerId);
  return item!;
}
