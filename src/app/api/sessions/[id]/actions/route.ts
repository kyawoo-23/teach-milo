import { ActionSchema, Id } from "@/lib/contracts";
import { assertOrigin, guest, json, respond, route } from "@/server/http";
import { publicSession, sessionAction } from "@/server/sessions";
import { callContext } from "@/server/usage";
export const maxDuration = 120;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    assertOrigin(request);
    const owner = await guest();
    const id = Id.parse((await context.params).id);
    const input = await json(request, ActionSchema);
    await sessionAction(id, input, callContext(owner, request));
    return respond(await publicSession(id, owner));
  });
}
