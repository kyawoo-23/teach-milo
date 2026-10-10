import { randomUUID } from "node:crypto";
import { z } from "zod";
import { assertOrigin, guest, json, respond, route } from "@/server/http";
import { ownerOperation } from "@/server/operations";
import { createSession, publicSession } from "@/server/sessions";
export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const ownerId = await guest();
    const input = await json(
      request,
      z
        .object({ operationId: z.string().uuid(), lessonId: z.string().uuid() })
        .strict(),
    );
    const id = await ownerOperation(
      ownerId,
      input.operationId,
      { type: "create", lessonId: input.lessonId },
      () => createSession(input.operationId, input.lessonId, ownerId),
    );
    return respond(await publicSession(id, ownerId), 201);
  });
}
