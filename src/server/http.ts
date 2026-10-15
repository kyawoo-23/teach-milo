import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { isTranslationKey } from "@/lib/i18n/messages";
import { AppError } from "@/lib/errors";
import { getAuthenticatedUser } from "./auth";
import { getGuest, guestClaimState } from "./guests";

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

export async function requireUserId() {
  const user = await getAuthenticatedUser();
  if (!user)
    throw new AppError(
      "AUTH_REQUIRED",
      "Sign in or create an account to continue.",
      401,
    );
  return user.id;
}
export async function requireLearningOwnerId() {
  const user = await getAuthenticatedUser();
  if (user) {
    if ((await guestClaimState(user.id))?.status === "pending")
      throw new AppError(
        "GUEST_SYNC_PENDING",
        "Moving your guest work to your account…",
        409,
        1,
      );
    return user.id;
  }
  const guest = await getGuest();
  if (!guest)
    throw new AppError(
      "GUEST_ACCESS_REQUIRED",
      "Your browser access expired or is unavailable. Sign in to your account or start a new lesson.",
      401,
    );
  return guest.id;
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
            messageKey: isTranslationKey(e.issues[0]?.message || "")
              ? e.issues[0].message
              : "Check the submitted values.",
          },
        },
        400,
      );
    if (e instanceof AppError)
      return Response.json(
        {
          error: {
            code: e.code,
            message: e.message,
            ...(e.messageKey ? { messageKey: e.messageKey } : {}),
            ...(e.params ? { params: e.params } : {}),
          },
        },
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
          messageKey:
            "The service is unavailable. Check that Firestore is running, then retry. Your saved progress is preserved.",
          message:
            "The service is unavailable. Check that Firestore is running, then retry. Your saved progress is preserved.",
        },
      },
      503,
    );
  }
}
