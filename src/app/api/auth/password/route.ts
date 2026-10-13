import { UpdatePasswordSchema } from "@/lib/contracts";
import { updatePassword } from "@/server/auth";
import {
  assertOrigin,
  json,
  requireUserId,
  respond,
  route,
} from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const userId = await requireUserId();
    const input = await json(request, UpdatePasswordSchema);
    await updatePassword(userId, input.currentPassword, input.newPassword);
    return respond({ ok: true });
  });
}
