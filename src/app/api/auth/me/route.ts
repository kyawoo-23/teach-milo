import { getAuthenticatedUser, toPublicUser } from "@/server/auth";
import { respond, route } from "@/server/http";
import { getGuest, guestClaimState } from "@/server/guests";

export const runtime = "nodejs";

export async function GET() {
  return route(async () => {
    const user = await getAuthenticatedUser();
    return respond({
      user: user ? toPublicUser(user) : null,
      guest: user ? null : await getGuest(),
      ...(user ? { claim: await guestClaimState(user.id) } : {}),
    });
  });
}
