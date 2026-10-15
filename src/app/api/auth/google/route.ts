import { getGoogleOAuthUrl } from "@/server/auth";
import { AppError } from "@/lib/errors";
import { createGoogleState } from "@/server/guests";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const origin = process.env.APP_ORIGIN || url.origin;
    const returnTo = url.searchParams.get("returnTo") || "/";
    // Sanitize returnTo to ensure it's a relative path
    const target = new URL(returnTo, origin);
    const safeReturnTo =
      returnTo.startsWith("/") && target.origin === origin
        ? target.pathname + target.search + target.hash
        : "/";
    const state = await createGoogleState(safeReturnTo);
    const authUrl = getGoogleOAuthUrl(origin, state);
    return Response.redirect(authUrl, 302);
  } catch (e) {
    const message =
      e instanceof AppError
        ? e.message
        : "Google authentication configuration error.";
    const url = new URL(request.url);
    const origin = process.env.APP_ORIGIN || url.origin;
    const target = new URL("/", origin);
    target.searchParams.set("authError", message);
    return Response.redirect(target.toString(), 302);
  }
}
