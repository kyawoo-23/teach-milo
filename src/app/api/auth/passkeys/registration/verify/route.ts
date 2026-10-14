import { getAuthenticatedUser } from "@/server/auth";
import { AppError } from "@/lib/errors";
import { PasskeyRegistrationSchema } from "@/lib/passkey-contracts";
import { assertOrigin, json, respond, route } from "@/server/http";
import { listPasskeys, registerPasskey } from "@/server/passkeys";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const user = await getAuthenticatedUser();
    if (!user)
      throw new AppError(
        "AUTH_REQUIRED",
        "Sign in or create an account to continue.",
        401,
      );
    const input = await json(request, PasskeyRegistrationSchema);
    await registerPasskey(user, input.ceremonyId, input.credential, input.name);
    return respond(await listPasskeys(user));
  });
}
