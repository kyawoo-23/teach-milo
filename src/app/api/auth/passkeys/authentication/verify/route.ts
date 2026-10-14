import { createUserSession, toPublicUser } from "@/server/auth";
import { PasskeyAuthenticationSchema } from "@/lib/passkey-contracts";
import { assertOrigin, json, respond, route } from "@/server/http";
import { authenticatePasskey } from "@/server/passkeys";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const input = await json(request, PasskeyAuthenticationSchema);
    const user = await authenticatePasskey(input.ceremonyId, input.credential);
    await createUserSession(user.id, user.authVersion ?? 0);
    return respond({ user: toPublicUser(user) });
  });
}
