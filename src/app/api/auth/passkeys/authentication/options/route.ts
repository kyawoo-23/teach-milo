import { assertOrigin, respond, route } from "@/server/http";
import { authenticationOptions } from "@/server/passkeys";

export const runtime = "nodejs";
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    return respond(await authenticationOptions(request));
  });
}
