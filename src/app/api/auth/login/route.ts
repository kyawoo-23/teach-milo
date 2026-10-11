import { LoginSchema } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import {
  createUserSession,
  findUserByEmail,
  toPublicUser,
  verifyPassword,
} from "@/server/auth";
import { assertOrigin, json, respond, route } from "@/server/http";

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
    await createUserSession(user.id);
    return respond({ user: toPublicUser(user) });
  });
}
