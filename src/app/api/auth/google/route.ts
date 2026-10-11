import { getGoogleOAuthUrl } from "@/server/auth";
import { AppError } from "@/lib/errors";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const origin = process.env.APP_ORIGIN || url.origin;
    const returnTo = url.searchParams.get("returnTo") || "/";
    // Sanitize returnTo to ensure it's a relative path
    const safeReturnTo =
      returnTo.startsWith("/") && !returnTo.startsWith("//") ? returnTo : "/";
    const state = Buffer.from(
      JSON.stringify({ returnTo: safeReturnTo, nonce: Date.now() }),
    ).toString("base64url");
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
