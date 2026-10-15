import "server-only";
import { randomUUID } from "node:crypto";
import { Message, Session } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import {
  assertGuestWritable,
  assertOwned,
  database,
  decode,
  encode,
  expiresAt,
} from "./db";
import { hash } from "./http";

type Operation = {
  status: "running" | "complete" | "failed";
  fingerprint: string;
  token: string;
  until: number;
  result?: string;
  expiresAt: string;
};
export async function ownerOperation(
  ownerId: string,
  id: string,
  payload: unknown,
  work: () => Promise<string>,
) {
  const ref = database().collection("operations").doc(`${ownerId}-${id}`);
  const fingerprint = hash(JSON.stringify(payload));
  const token = randomUUID();
  const cached = await database().runTransaction(async (tx) => {
    await assertGuestWritable(tx, ownerId);
    const doc = await tx.get(ref);
    const op = doc.exists ? decode<Operation>(doc.data()) : undefined;
    if (op && op.fingerprint !== fingerprint)
      throw new AppError(
        "OPERATION_CONFLICT",
        "This request ID was used for different content.",
        409,
      );
    if (op?.status === "complete") return op.result;
    if (op?.status === "running" && op.until > Date.now())
      throw new AppError(
        "BUSY",
        "This request is still processing. Please wait, then retry.",
        409,
        5,
      );
    tx.set(
      ref,
      encode({
        ownerId,
        fingerprint,
        status: "running",
        token,
        until: Date.now() + 15 * 60_000,
        expiresAt: expiresAt(),
      }),
    );
    return undefined;
  });
  if (cached) return cached;
  try {
    const result = await work();
    await database().runTransaction(async (tx) => {
      await assertGuestWritable(tx, ownerId);
      const op = await tx.get(ref);
      if (op.data()?.token !== token)
        throw new AppError(
          "STALE_REQUEST",
          "A newer request has replaced this one.",
          409,
        );
      tx.update(ref, { status: "complete", result });
    });
    return result;
  } catch (e) {
    await database()
      .runTransaction(async (tx) => {
        await assertGuestWritable(tx, ownerId);
        const op = await tx.get(ref);
        if (op.data()?.token === token) tx.update(ref, { status: "failed" });
      })
      .catch(() => {});
    throw e;
  }
}
export async function sessionOperation(
  ownerId: string,
  id: string,
  operationId: string,
  revision: number,
  payload: unknown,
  work: (
    session: Session,
  ) => Promise<{ session: Session; messages?: Message[] }>,
) {
  const f = database();
  const ref = f.collection("sessions").doc(id);
  const opRef = ref.collection("operations").doc(operationId);
  const fingerprint = hash(JSON.stringify(payload));
  const token = randomUUID();
  const reserved = await f.runTransaction(async (tx) => {
    await assertGuestWritable(tx, ownerId);
    const [sessionDoc, opDoc] = await tx.getAll(ref, opRef);
    const session = sessionDoc.exists
      ? decode<Session>(sessionDoc.data())
      : undefined;
    assertOwned(session, ownerId);
    const op = opDoc.exists ? decode<Operation>(opDoc.data()) : undefined;
    if (op && op.fingerprint !== fingerprint)
      throw new AppError(
        "OPERATION_CONFLICT",
        "This request ID was used for different content.",
        409,
      );
    if (op?.status === "complete") return { session: session!, cached: true };
    if (session!.revision !== revision)
      throw new AppError(
        "STALE_SESSION",
        "This lesson changed in another tab. Refresh to continue.",
        409,
      );
    if (session!.activeOperation && session!.activeOperation.until > Date.now())
      throw new AppError(
        "BUSY",
        "Milo is still processing a response. Wait a moment, then retry.",
        409,
        5,
      );
    const until = Date.now() + 150_000;
    tx.update(ref, { activeOperation: { id: operationId, token, until } });
    tx.set(
      opRef,
      encode({
        ownerId,
        fingerprint,
        status: "running",
        token,
        until,
        expiresAt: session!.expiresAt,
      }),
    );
    return { session: session!, cached: false };
  });
  if (reserved.cached) return reserved.session;
  try {
    const result = await work(reserved.session);
    return await f.runTransaction(async (tx) => {
      await assertGuestWritable(tx, ownerId);
      const current = await tx.get(ref);
      if (
        current.data()?.activeOperation?.token !== token ||
        current.data()?.revision !== revision
      )
        throw new AppError(
          "STALE_REQUEST",
          "This response was replaced. Refresh the session.",
          409,
        );
      const { activeOperation: _lock, ...next } = result.session;
      const committed: Session = {
        ...next,
        revision: revision + 1,
        updatedAt: new Date().toISOString(),
      };
      tx.set(ref, encode(committed));
      for (const message of result.messages || [])
        tx.create(
          ref.collection("messages").doc(message.id),
          encode({ ...message, expiresAt: result.session.expiresAt }),
        );
      tx.update(opRef, { status: "complete" });
      return committed;
    });
  } catch (e) {
    await f
      .runTransaction(async (tx) => {
        await assertGuestWritable(tx, ownerId);
        const current = await tx.get(ref);
        if (current.data()?.activeOperation?.token === token) {
          const session = decode<Session>(current.data());
          delete session.activeOperation;
          tx.set(ref, encode(session));
          tx.update(opRef, { status: "failed" });
        }
      })
      .catch(() => {});
    throw e;
  }
}
