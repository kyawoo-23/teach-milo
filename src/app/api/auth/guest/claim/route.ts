import { claimGuest } from "@/server/guests";
import { assertOrigin, requireUserId, respond, route } from "@/server/http";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    return respond(await claimGuest(await requireUserId()));
  });
}
