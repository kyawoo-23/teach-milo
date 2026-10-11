import { Id, Session } from "@/lib/contracts";
import { database, readOwned } from "@/server/db";
import { assertOrigin, requireUserId, respond, route } from "@/server/http";
import { publicSession } from "@/server/sessions";
type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  return route(async () =>
    respond(
      await publicSession(
        Id.parse((await context.params).id),
        await requireUserId(),
      ),
    ),
  );
}
export async function DELETE(request: Request, context: Context) {
  return route(async () => {
    assertOrigin(request);
    const ownerId = await requireUserId();
    const id = Id.parse((await context.params).id);
    const session = await readOwned<Session>("sessions", id, ownerId);
    // Invalidate before deletion so an in-flight generation cannot restore a deleted session.
    await database()
      .collection("sessions")
      .doc(id)
      .update({ expiresAt: new Date(0), revision: session.revision + 1 });
    await database().recursiveDelete(database().collection("sessions").doc(id));
    return respond({ deleted: true });
  });
}
