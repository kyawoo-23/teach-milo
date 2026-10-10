import "server-only";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { database, encode, expiresAt } from "./db";
import { AppError } from "@/lib/errors";

export type CallContext = { ownerId: string; network: string };
export function callContext(ownerId: string, request: Request): CallContext {
  const raw =
    process.env.TRUST_PROXY === "true"
      ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() ||
        "unknown"
      : "local";
  const secret = process.env.RATE_LIMIT_SECRET;
  if (process.env.NODE_ENV === "production" && (!secret || secret.length < 32))
    throw new AppError(
      "SETUP_REQUIRED",
      "The server usage-limit secret is not configured.",
      503,
    );
  return {
    ownerId,
    network: createHmac("sha256", secret || "local-only")
      .update(`${new Date().toISOString().slice(0, 10)}:${raw}`)
      .digest("hex"),
  };
}
export async function reserveModelCall(ctx: CallContext) {
  const date = new Date().toISOString().slice(0, 10);
  const limits: [string, number][] = [
    [
      `${date}-guest-${ctx.ownerId}`,
      Number(process.env.MODEL_CALLS_PER_GUEST_DAY || 100),
    ],
    [
      `${date}-network-${ctx.network}`,
      Number(process.env.MODEL_CALLS_PER_NETWORK_DAY || 300),
    ],
    [`${date}-global`, Number(process.env.MODEL_CALLS_PER_GLOBAL_DAY || 1000)],
  ];
  if (limits.some(([, limit]) => !Number.isSafeInteger(limit) || limit < 0))
    throw new AppError(
      "SETUP_REQUIRED",
      "Model usage limits must be nonnegative whole numbers. Check the server configuration.",
      503,
    );
  const f = database();
  await f.runTransaction(async (tx) => {
    const refs = limits.map(([id]) => f.collection("usage").doc(id));
    const docs = await tx.getAll(...refs);
    for (let i = 0; i < docs.length; i++)
      if (Number(docs[i].data()?.count || 0) >= limits[i][1])
        throw new AppError(
          "USAGE_LIMIT",
          "Today's usage limit is reached. Your lesson is saved; continue after the daily limit resets.",
          429,
          3600,
        );
    for (let i = 0; i < docs.length; i++)
      tx.set(
        refs[i],
        encode({
          count: Number(docs[i].data()?.count || 0) + 1,
          expiresAt: expiresAt(),
        }),
      );
  });
}
export async function event(
  sessionId: string,
  name: string,
  operationId?: string,
) {
  const id = operationId
    ? createHash("sha256")
        .update(`${sessionId}:${name}:${operationId}`)
        .digest("hex")
    : randomUUID();
  try {
    await database()
      .collection("events")
      .doc(id)
      .create(
        encode({
          sessionId,
          name,
          createdAt: new Date().toISOString(),
          expiresAt: expiresAt(),
        }),
      );
  } catch {
    /* Duplicate telemetry and failures never block learning. */
  }
}
