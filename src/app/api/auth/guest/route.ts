import { getAuthenticatedUser, toPublicUser } from "@/server/auth";
import { createGuest } from "@/server/guests";
import { assertOrigin, respond, route } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const user = await getAuthenticatedUser();
    return respond({
      user: user ? toPublicUser(user) : null,
      guest: user ? null : await createGuest(),
    });
  });
}
