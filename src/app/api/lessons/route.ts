import { randomUUID } from "node:crypto";
import { Lesson, PrepareSchema, publicLesson } from "@/lib/contracts";
import { assertOrigin, guest, json, respond, route } from "@/server/http";
import { readOwned } from "@/server/db";
import { prepareLesson } from "@/server/lessons";
import { ownerOperation } from "@/server/operations";
import { callContext } from "@/server/usage";
export const runtime = "nodejs";
export const maxDuration = 180;
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const ownerId = await guest();
    const input = await json(request, PrepareSchema);
    const id = await ownerOperation(
      ownerId,
      input.operationId,
      { type: "prepare", ...input },
      () =>
        prepareLesson(input.operationId, input, callContext(ownerId, request)),
    );
    return respond(
      publicLesson(await readOwned<Lesson>("lessons", id, ownerId)),
      201,
    );
  });
}
