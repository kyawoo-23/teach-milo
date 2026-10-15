import { Id, Session } from "@/lib/contracts";
import { z } from "zod";
import {
  assertGuestWritable,
  assertOwned,
  database,
  decode,
} from "@/server/db";
import {
  assertOrigin,
  requireLearningOwnerId,
  respond,
  route,
} from "@/server/http";
import { publicSession, sessionUpdate } from "@/server/sessions";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return route(async () => {
    const ownerId = await requireLearningOwnerId();
    const id = Id.parse((await context.params).id);
    const revision = new URL(request.url).searchParams.get("sinceRevision");
    if (revision === null) return respond(await publicSession(id, ownerId));
    const sinceRevision = z
      .string()
      .regex(/^(0|[1-9]\d*)$/)
      .transform(Number)
      .pipe(z.number().int().max(Number.MAX_SAFE_INTEGER))
      .parse(revision);
    return respond(await sessionUpdate(id, ownerId, sinceRevision));
  });
}
export async function DELETE(request: Request, context: Context) {
  return route(async () => {
    assertOrigin(request);
    const ownerId = await requireLearningOwnerId();
    const id = Id.parse((await context.params).id);
    const ref = database().collection("sessions").doc(id);
    // Invalidate before deletion so an in-flight generation cannot restore a deleted session.
    await database().runTransaction(async (tx) => {
      await assertGuestWritable(tx, ownerId);
      const doc = await tx.get(ref);
      const session = doc.exists ? decode<Session>(doc.data()) : undefined;
      assertOwned(session, ownerId);
      tx.update(ref, {
        expiresAt: new Date(0),
        revision: session!.revision + 1,
      });
    });
    await database().recursiveDelete(ref);
    return respond({ deleted: true });
  });
}
