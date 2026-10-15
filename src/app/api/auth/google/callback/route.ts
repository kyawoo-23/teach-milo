import {
  createUser,
  finishSignIn,
  exchangeGoogleOAuthCode,
  findUserByEmail,
  User,
} from "@/server/auth";
import { database, encode } from "@/server/db";
import { consumeGoogleState } from "@/server/guests";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = process.env.APP_ORIGIN || url.origin;
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const stateRaw = url.searchParams.get("state");

  let returnTo = "/";

  const failRedirect = (message: string) => {
    const target = new URL(returnTo, origin);
    target.searchParams.set("authError", message);
    return Response.redirect(target.toString(), 302);
  };

  try {
    returnTo = await consumeGoogleState(stateRaw);
  } catch {
    return failRedirect("Google sign-in expired. Please try again.");
  }
  if (error || !code) {
    return failRedirect(
      error
        ? `Google sign-in was cancelled (${error}).`
        : "Missing authorization code.",
    );
  }

  try {
    const googleProfile = await exchangeGoogleOAuthCode(code, origin);
    let user = await findUserByEmail(googleProfile.email);

    if (user) {
      // Link Google ID or avatar if not yet set
      const updates: Partial<User> = {};
      if (!user.googleId) updates.googleId = googleProfile.sub;
      if (!user.avatarUrl && googleProfile.avatarUrl)
        updates.avatarUrl = googleProfile.avatarUrl;
      if (Object.keys(updates).length > 0) {
        updates.updatedAt = new Date().toISOString();
        await database()
          .collection("users")
          .doc(user.id)
          .update(encode(updates));
        user = { ...user, ...updates };
      }
    } else {
      user = await createUser({
        email: googleProfile.email,
        name: googleProfile.name,
        googleId: googleProfile.sub,
        avatarUrl: googleProfile.avatarUrl,
      });
    }

    await finishSignIn(user);

    const successTarget = new URL(returnTo, origin);
    successTarget.searchParams.set("signed-in", "1");
    return Response.redirect(successTarget.toString(), 302);
  } catch (e) {
    console.error("Google callback error", e);
    return failRedirect(
      e instanceof Error ? e.message : "Authentication with Google failed.",
    );
  }
}
