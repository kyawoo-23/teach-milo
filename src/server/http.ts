import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import { database, decode, encode, expiresAt } from "./db";

import { getAuthenticatedUser, User } from "./auth";

export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function assertOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = process.env.APP_ORIGIN || new URL(request.url).origin;
  if (
    !origin ||
    origin !== expected ||
    request.headers.get("sec-fetch-site") === "cross-site"
  )
    throw new AppError(
      "INVALID_ORIGIN",
      "Open TeachBack in its original tab and try again.",
      403,
    );
}

export async function currentGuestId(): Promise<string | null> {
  const jar = await cookies();
  const token = jar.get("teachback_guest")?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    return hash(token);
  }
  return null;
}

export async function resolveOwner(create = false): Promise<{
  ownerId: string;
  user: User | null;
  isGuest: boolean;
}> {
  const user = await getAuthenticatedUser();
  if (user) {
    return { ownerId: user.id, user, isGuest: false };
  }
  const guestId = await guest(create);
  return { ownerId: guestId, user: null, isGuest: true };
}

export async function guest(create = false) {
  const user = await getAuthenticatedUser();
  if (user) return user.id;

  const jar = await cookies();
  const token = jar.get("teachback_guest")?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const id = hash(token);
    const doc = await database().collection("guests").doc(id).get();
    if (
      doc.exists &&
      new Date(decode<{ expiresAt: string }>(doc.data()).expiresAt).getTime() >
        Date.now()
    )
      return id;
  }
  if (!create)
    throw new AppError(
      "SESSION_REQUIRED",
      "Your guest session has expired. Start again with your learning material.",
      401,
    );
  const secret = randomBytes(32).toString("base64url");
  const id = hash(secret);
  const expiry = expiresAt();
  await database()
    .collection("guests")
    .doc(id)
    .set(encode({ createdAt: new Date().toISOString(), expiresAt: expiry }));
  jar.set("teachback_guest", secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    expires: new Date(expiry),
  });
  return id;
}
export async function json<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit = 250_000,
): Promise<T> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new AppError("INVALID_CONTENT", "Send JSON content.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AppError("EMPTY_BODY", "The request is empty.");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > limit) {
        await reader.cancel();
        throw new AppError("TOO_LARGE", "This request is too large.", 413);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return schema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
  } catch (e) {
    if (e instanceof z.ZodError) throw e;
    throw new AppError("INVALID_JSON", "The request could not be read.");
  }
}
export function respond(data: unknown, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}
export async function route(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof z.ZodError)
      return respond(
        {
          error: {
            code: "VALIDATION",
            message: e.issues[0]?.message || "Check the submitted values.",
          },
        },
        400,
      );
    if (e instanceof AppError)
      return Response.json(
        { error: { code: e.code, message: e.message } },
        {
          status: e.status,
          headers: {
            "Cache-Control": "no-store",
            ...(e.retryAfter ? { "Retry-After": String(e.retryAfter) } : {}),
          },
        },
      );
    const code = (e as { code?: string | number })?.code;
    console.error("TeachBack request failed", {
      name: e instanceof Error ? e.name : "Error",
      code,
    });
    return respond(
      {
        error: {
          code: "SERVICE_UNAVAILABLE",
          message:
            "The service is unavailable. Check that Firestore is running, then retry. Your saved progress is preserved.",
        },
      },
      503,
    );
  }
}
