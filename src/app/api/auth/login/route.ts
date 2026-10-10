import { LoginSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import {
  createUserSession,
  findUserByEmail,
  migrateGuestData,
  toPublicUser,
  verifyPassword,
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
    const input = await json(request, LoginSchema);
    const user = await findUserByEmail(input.email);
    if (
      !user ||
      !user.passwordHash ||
      !user.passwordSalt ||
      !verifyPassword(input.password, user.passwordHash, user.passwordSalt)
    ) {
      throw new AppError(
        "INVALID_CREDENTIALS",
        "Invalid email or password.",
        401,
      );
    }
    const guestId = await currentGuestId();
    await createUserSession(user.id);
    if (guestId) {
      await migrateGuestData(guestId, user.id);
    }
    return respond({ user: toPublicUser(user) });
  });
}
