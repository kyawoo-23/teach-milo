import "server-only";
import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { cookies } from "next/headers";
import { AppError } from "@/lib/errors";
import { database, decode, encode } from "./db";

export const hash = (s: string) => createHash("sha256").update(s).digest("hex");

export type User = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
  passwordHash?: string;
  passwordSalt?: string;
  googleId?: string;
  createdAt: string;
  updatedAt: string;
};

export type UserPublic = {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string;
};

export const AUTH_COOKIE_NAME = "teachback_auth";
const SESSION_EXPIRY_DAYS = 30;

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = randomBytes(16).toString("hex");
  const hashed = scryptSync(password, salt, 64).toString("hex");
  return { hash: hashed, salt };
}

export function verifyPassword(
  password: string,
  expectedHash: string,
  salt: string,
): boolean {
  try {
    const hashed = scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHash, "hex");
    if (hashed.length !== expected.length) return false;
    return timingSafeEqual(hashed, expected);
  } catch {
    return false;
  }
}

export function toPublicUser(user: User): UserPublic {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl,
  };
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  const snap = await database()
    .collection("users")
    .where("email", "==", normalized)
    .limit(1)
    .get();
  if (snap.empty) return null;
  return decode<User>(snap.docs[0].data());
}

export async function findUserById(id: string): Promise<User | null> {
  const doc = await database().collection("users").doc(id).get();
  if (!doc.exists) return null;
  return decode<User>(doc.data());
}

export async function createUser(params: {
  email: string;
  name: string;
  password?: string;
  googleId?: string;
  avatarUrl?: string;
}): Promise<User> {
  const normalized = params.email.trim().toLowerCase();
  const existing = await findUserByEmail(normalized);
  if (existing) {
    throw new AppError(
      "ACCOUNT_EXISTS",
      "An account with this email already exists.",
      409,
    );
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  let passwordHash: string | undefined;
  let passwordSalt: string | undefined;
  if (params.password) {
    const p = hashPassword(params.password);
    passwordHash = p.hash;
    passwordSalt = p.salt;
  }
  const user: User = {
    id,
    email: normalized,
    name: params.name.trim() || normalized.split("@")[0],
    ...(params.avatarUrl ? { avatarUrl: params.avatarUrl } : {}),
    ...(passwordHash ? { passwordHash, passwordSalt } : {}),
    ...(params.googleId ? { googleId: params.googleId } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await database().collection("users").doc(id).set(encode(user));
  return user;
}

export async function createUserSession(userId: string): Promise<string> {
  const jar = await cookies();
  const secret = randomBytes(32).toString("base64url");
  const id = hash(secret);
  const expiryDate = new Date(Date.now() + SESSION_EXPIRY_DAYS * 86_400_000);
  const expiry = expiryDate.toISOString();
  await database()
    .collection("user_sessions")
    .doc(id)
    .set(
      encode({
        id,
        userId,
        createdAt: new Date().toISOString(),
        expiresAt: expiry,
      }),
    );

  jar.set(AUTH_COOKIE_NAME, secret, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiryDate,
  });
  return secret;
}

export async function getAuthenticatedUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE_NAME)?.value;
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;

  const id = hash(token);
  const doc = await database().collection("user_sessions").doc(id).get();
  if (!doc.exists) return null;

  const session = decode<{ userId: string; expiresAt: string }>(doc.data());
  if (new Date(session.expiresAt).getTime() <= Date.now()) return null;

  return findUserById(session.userId);
}

export async function clearUserSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(AUTH_COOKIE_NAME)?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) {
    const id = hash(token);
    try {
      await database().collection("user_sessions").doc(id).delete();
    } catch {
      /* Continue clearing cookie even if session doc is missing */
    }
  }
  jar.delete(AUTH_COOKIE_NAME);
}

export function getGoogleOAuthUrl(origin: string, state: string): string {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    throw new AppError(
      "SETUP_REQUIRED",
      "Google Sign-In is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.",
      503,
    );
  }
  const redirectUri = `${origin}/api/auth/google/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export async function exchangeGoogleOAuthCode(
  code: string,
  origin: string,
): Promise<{ email: string; name: string; avatarUrl?: string; sub: string }> {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new AppError(
      "SETUP_REQUIRED",
      "Google Sign-In is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.local.",
      503,
    );
  }
  const redirectUri = `${origin}/api/auth/google/callback`;

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!tokenRes.ok) {
    const errText = await tokenRes.text();
    console.error("Google token exchange failed", errText);
    throw new AppError(
      "AUTH_FAILED",
      "Google authentication failed. Please try again.",
      401,
    );
  }

  const tokens = await tokenRes.json();
  const userRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });

  if (!userRes.ok) {
    throw new AppError(
      "AUTH_FAILED",
      "Could not fetch user profile from Google.",
      401,
    );
  }

  const profile = await userRes.json();
  if (!profile.email) {
    throw new AppError(
      "AUTH_FAILED",
      "No email provided by Google account.",
      400,
    );
  }

  return {
    email: profile.email,
    name: profile.name || profile.email.split("@")[0],
    avatarUrl: profile.picture,
    sub: profile.sub,
  };
}
