import { z } from "zod";
import { Id, Session } from "@/lib/contracts";
import { readOwned } from "@/server/db";
import {
  assertOrigin,
  requireLearningOwnerId,
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
      await requireLearningOwnerId(),
      [],
    );
    const input = await json(
      request,
      z
        .object({
          name: z.enum([
            "board_opened",
            "board_tool_sketch",
            "board_tool_concept_map",
            "board_tool_matching",
            "board_tool_table",
            "board_tool_suggested",
          ]),
        })
        .strict(),
    );
    await event(id, input.name);
    return respond({ ok: true });
  });
}
