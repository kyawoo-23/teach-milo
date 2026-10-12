import { Id, TransferSchema } from "@/lib/contracts";
import {
  assertOrigin,
  requireUserId,
  json,
  respond,
  route,
} from "@/server/http";
import { publicSession, submitTransfer } from "@/server/sessions";
import { callContext } from "@/server/usage";
export const maxDuration = 120;
export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    assertOrigin(request);
    const owner = await requireUserId();
    const id = Id.parse((await context.params).id);
    const input = await json(request, TransferSchema);
    const snapshot = await submitTransfer(
      id,
      input,
      callContext(owner, request),
    );
    return respond(await publicSession(id, owner, snapshot));
  });
}
