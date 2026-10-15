import { Id, TurnSchema } from "@/lib/contracts";
import {
  assertOrigin,
  requireLearningOwnerId,
  json,
  respond,
  route,
} from "@/server/http";
import { publicSession, submitTurn } from "@/server/sessions";
import { callContext } from "@/server/usage";
export const maxDuration = 120;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    assertOrigin(request);
    const owner = await requireLearningOwnerId();
    const id = Id.parse((await context.params).id);
    const input = await json(request, TurnSchema);
    const snapshot = await submitTurn(id, input, callContext(owner, request));
    return respond(await publicSession(id, owner, snapshot));
  });
}
