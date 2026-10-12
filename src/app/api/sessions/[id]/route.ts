import { Id, Session } from "@/lib/contracts";
import { z } from "zod";
import { database, readOwned } from "@/server/db";
import { assertOrigin, requireUserId, respond, route } from "@/server/http";
import { publicSession, sessionUpdate } from "@/server/sessions";
type Context = { params: Promise<{ id: string }> };
export async function GET(request: Request, context: Context) {
  return route(async () => {
    const ownerId = await requireUserId();
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
    const ownerId = await requireUserId();
    const id = Id.parse((await context.params).id);
    const session = await readOwned<
      Pick<Session, "ownerId" | "expiresAt" | "revision">
    >("sessions", id, ownerId, ["revision"]);
    // Invalidate before deletion so an in-flight generation cannot restore a deleted session.
    await database()
      .collection("sessions")
      .doc(id)
      .update({ expiresAt: new Date(0), revision: session.revision + 1 });
    await database().recursiveDelete(database().collection("sessions").doc(id));
    return respond({ deleted: true });
  });
}
