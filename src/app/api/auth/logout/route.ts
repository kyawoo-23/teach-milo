import { clearUserSession } from "@/server/auth";
import { assertOrigin, respond, route } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    await clearUserSession();
    return respond({ success: true });
  });
}
