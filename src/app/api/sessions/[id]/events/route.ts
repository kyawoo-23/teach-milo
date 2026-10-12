import { z } from "zod";
import { Id, Session } from "@/lib/contracts";
import { readOwned } from "@/server/db";
import {
  assertOrigin,
  requireUserId,
  json,
  respond,
  route,
} from "@/server/http";
import { event } from "@/server/usage";
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    assertOrigin(request);
    const id = Id.parse((await context.params).id);
    await readOwned<Pick<Session, "ownerId" | "expiresAt">>(
      "sessions",
      id,
      await requireUserId(),
      [],
    );
    const input = await json(
      request,
      z.object({ name: z.literal("board_opened") }),
    );
    await event(id, input.name);
    return respond({ ok: true });
  });
}
