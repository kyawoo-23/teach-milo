import { UpdateProfileSchema } from "@/lib/contracts";
import { toPublicUser, updateProfile } from "@/server/auth";
import {
  assertOrigin,
  json,
  requireUserId,
  respond,
  route,
} from "@/server/http";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const userId = await requireUserId();
    const input = await json(request, UpdateProfileSchema);
    const user = await updateProfile(userId, input.name);
    return respond({ user: toPublicUser(user) });
  });
}
