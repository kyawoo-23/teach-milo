import { getAuthenticatedUser } from "@/server/auth";
import { AppError } from "@/lib/errors";
import { respond, route } from "@/server/http";
import { listPasskeys } from "@/server/passkeys";

export const runtime = "nodejs";
export async function GET() {
  return route(async () => {
    const user = await getAuthenticatedUser();
    if (!user)
      throw new AppError(
        "AUTH_REQUIRED",
        "Sign in or create an account to continue.",
        401,
      );
    return respond(await listPasskeys(user));
  });
}
