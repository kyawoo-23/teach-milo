import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import {
  FieldPath,
  FieldValue,
  Timestamp,
  type Transaction,
} from "firebase-admin/firestore";
import type { GuestPublic } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { database, decode, encode } from "./db";

export const GUEST_COOKIE_NAME =
  process.env.NODE_ENV === "production"
    ? "__Host-teach-milo_guest"
    : "teach-milo_guest";
const digest = (token: string) =>
  createHash("sha256").update(token).digest("hex");
const cookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
};
type Guest = GuestPublic & {
  claimedBy?: string;
  claimStatus?: "pending" | "complete";
  stage?: number;
  cursor?: string;
};

export async function guestCookieId(): Promise<string | null> {
  const token = (await cookies()).get(GUEST_COOKIE_NAME)?.value;
  return token && /^[A-Za-z0-9_-]{43}$/.test(token)
    ? `guest_${digest(token)}`
    : null;
}

export async function readGuest(): Promise<Guest | null> {
  const id = await guestCookieId();
  if (!id) return null;
  const doc = await database().collection("guests").doc(id).get();
  if (!doc.exists) return null;
  const guest = decode<Guest>(doc.data());
  return Date.parse(guest.expiresAt) > Date.now() ? guest : null;
}

export async function getGuest(): Promise<GuestPublic | null> {
  const guest = await readGuest();
  return guest && !guest.claimedBy
    ? { id: guest.id, expiresAt: guest.expiresAt }
    : null;
}

export async function createGuest(): Promise<GuestPublic> {
  const existing = await readGuest();
  if (existing && !existing.claimedBy)
    return { id: existing.id, expiresAt: existing.expiresAt };
  // A fenced token must never silently become a different learning identity.
  if (existing?.claimedBy)
    throw new AppError(
      "GUEST_CHANGED",
      "Your browser access changed. Refresh to continue or start a new lesson.",
      409,
    );
  const token = randomBytes(32).toString("base64url");
  const guest: GuestPublic = {
    id: `guest_${digest(token)}`,
    expiresAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
  };
  await database()
    .collection("guests")
    .doc(guest.id)
    .create(
      encode({
        ...guest,
        createdAt: new Date().toISOString(),
      }),
    );
  (await cookies()).set(GUEST_COOKIE_NAME, token, {
    ...cookieOptions,
    expires: new Date(guest.expiresAt),
  });
  return guest;
}

// Called only after credentials have been verified, within session creation.
// The fence and today's usage merge commit atomically with the account session.
export async function bindGuest(
  tx: Transaction,
  guestId: string | null,
  userId: string,
) {
  if (!guestId) return;
  const f = database();
  const ref = f.collection("guests").doc(guestId);
  const doc = await tx.get(ref);
  if (!doc.exists) return;
  const guest = decode<Guest>(doc.data());
  if (Date.parse(guest.expiresAt) <= Date.now() || guest.claimedBy) return;
  const date = new Date().toISOString().slice(0, 10);
  const guestUsage = f.collection("usage").doc(`${date}-guest-${guestId}`);
  const userUsage = f.collection("usage").doc(`${date}-guest-${userId}`);
  const [source, target] = await tx.getAll(guestUsage, userUsage);
  tx.update(ref, {
    claimedBy: userId,
    claimStatus: "pending",
    stage: 0,
    cursor: "",
  });
  tx.set(userUsage, {
    count: Number(source.get("count") || 0) + Number(target.get("count") || 0),
    expiresAt: Timestamp.fromMillis(Date.now() + 7 * 86_400_000),
  });
}

export async function guestClaimState(userId: string) {
  const guest = await readGuest();
  return guest?.claimedBy === userId
    ? {
        fromOwnerId: guest.id,
        status: guest.claimStatus ?? ("pending" as const),
      }
    : undefined;
}

// One bounded page per call. Progress and ownership changes commit together;
// concurrent callers and retries continue from the same durable checkpoint.
export async function claimGuest(userId: string) {
  const guestId = await guestCookieId();
  if (!guestId) return { status: "complete" as const };
  const f = database();
  const ref = f.collection("guests").doc(guestId);
  const result = await f.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (!doc.exists) return { status: "complete" as const };
    const guest = decode<Guest>(doc.data());
    if (guest.claimedBy !== userId)
      throw new AppError(
        "GUEST_CHANGED",
        "Your browser access changed. Refresh to continue or start a new lesson.",
        409,
      );
    if (guest.claimStatus === "complete")
      return { status: "complete" as const, fromOwnerId: guestId };
    const collections = ["materials", "lessons", "sessions", "operations"];
    const stage = guest.stage ?? 0;
    const collection = collections[stage];
    let query = f
      .collection(collection)
      .where("ownerId", "==", guestId)
      .orderBy(FieldPath.documentId())
      .limit(50);
    if (guest.cursor) query = query.startAfter(guest.cursor);
    const page = await tx.get(query);
    const active = page.docs.filter(
      (d) => d.get("expiresAt")?.toMillis() > Date.now(),
    );
    // Read operation destinations before any writes (Firestore transaction rule).
    const targets =
      collection === "operations" && active.length
        ? await tx.getAll(
            ...active.map((d) =>
              f
                .collection("operations")
                .doc(`${userId}-${d.id.slice(guestId.length + 1)}`),
            ),
          )
        : [];
    active.forEach((item, i) => {
      if (collection === "operations") {
        const target = targets[i];
        if (
          target.exists &&
          target.get("fingerprint") !== item.get("fingerprint")
        )
          throw new AppError(
            "OPERATION_CONFLICT",
            "This request ID was used for different content.",
            409,
          );
        if (!target.exists)
          tx.create(target.ref, {
            ...item.data(),
            ownerId: userId,
            ...(item.get("status") === "running"
              ? { status: "failed", until: 0 }
              : {}),
          });
        tx.delete(item.ref);
      } else {
        tx.update(item.ref, {
          ownerId: userId,
          ...(collection === "sessions"
            ? { activeOperation: FieldValue.delete() }
            : {}),
        });
      }
    });
    const nextStage = page.size < 50 ? stage + 1 : stage;
    const complete = nextStage === collections.length;
    tx.update(ref, {
      stage: nextStage,
      cursor: nextStage === stage ? page.docs.at(-1)!.id : "",
      claimStatus: complete ? "complete" : "pending",
    });
    return {
      status: complete ? ("complete" as const) : ("pending" as const),
      fromOwnerId: guestId,
    };
  });
  if (result.status === "complete") (await cookies()).delete(GUEST_COOKIE_NAME);
  return result;
}

const OAUTH_COOKIE = "teach-milo_google_state";
export async function createGoogleState(returnTo: string) {
  const token = randomBytes(32).toString("base64url");
  const expiry = new Date(Date.now() + 10 * 60_000);
  await database()
    .collection("user_sessions")
    .doc(`oauth_${digest(token)}`)
    .create(
      encode({
        purpose: "google",
        returnTo,
        guestId: await guestCookieId(),
        expiresAt: expiry.toISOString(),
      }),
    );
  (await cookies()).set(OAUTH_COOKIE, token, {
    ...cookieOptions,
    expires: expiry,
  });
  return token;
}

export async function consumeGoogleState(
  state: string | null,
): Promise<string> {
  const jar = await cookies();
  const browser = jar.get(OAUTH_COOKIE)?.value;
  if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || browser !== state)
    throw new AppError(
      "AUTH_FAILED",
      "Google sign-in expired. Please try again.",
      401,
    );
  const guestId = await guestCookieId();
  const ref = database()
    .collection("user_sessions")
    .doc(`oauth_${digest(state)}`);
  const returnTo = await database().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    if (
      !doc.exists ||
      doc.get("purpose") !== "google" ||
      doc.get("expiresAt").toMillis() <= Date.now() ||
      doc.get("guestId") !== guestId
    )
      throw new AppError(
        "AUTH_FAILED",
        "Google sign-in expired. Please try again.",
        401,
      );
    tx.delete(ref);
    return doc.get("returnTo") as string;
  });
  jar.delete(OAUTH_COOKIE);
  return returnTo;
}
