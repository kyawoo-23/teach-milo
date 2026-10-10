import { SignupSchema } from "@/lib/contracts";
import {
  createUser,
  createUserSession,
  migrateGuestData,
  toPublicUser,
} from "@/server/auth";
import {
  assertOrigin,
  currentGuestId,
  json,
  respond,
  route,
} from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const input = await json(request, SignupSchema);
    const guestId = await currentGuestId();
    const user = await createUser({
      email: input.email,
      name: input.name,
      password: input.password,
    });
    await createUserSession(user.id);
    if (guestId) {
      await migrateGuestData(guestId, user.id);
    }
    return respond({ user: toPublicUser(user) }, 201);
  });
}
