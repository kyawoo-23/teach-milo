import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { isIP } from "node:net";
import { cookies } from "next/headers";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type AuthenticationResponseJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/server";
import { decodeClientDataJSON } from "@simplewebauthn/server/helpers";
import type { Transaction } from "firebase-admin/firestore";
import { AppError } from "@/lib/errors";
import type { PasskeyList } from "@/lib/passkey-contracts";
import { AUTH_COOKIE_NAME, hash, type User } from "./auth";
import { database, decode, encode } from "./db";
import { callContext } from "./usage";

const BROWSER_COOKIE = "teachback_passkey";
const CHALLENGE_TTL = 5 * 60_000;
const MAX_PASSKEYS = 20;
type ManagementSession = {
  createdAt: string;
  userId: string;
  expiresAt: string;
  authVersion?: number;
};
type Passkey = {
  id: string;
  userId: string;
  rpId: string;
  publicKey: string;
  counter: number;
  transports?: string[];
  deviceType: string;
  backedUp: boolean;
  name: string;
  createdAt: string;
  lastUsedAt?: string;
};
type Ceremony = {
  challenge: string;
  purpose: "registration" | "authentication";
  browser: string;
  origin: string;
  rpId: string;
  userId?: string;
  session?: string;
  expiresAt: string;
};
const invalid = () =>
  new AppError(
    "PASSKEY_INVALID",
    "Passkey verification failed. Please try again.",
    401,
  );

function requireSameOriginCeremony(clientDataJSON: string) {
  const data = decodeClientDataJSON(clientDataJSON);
  if (data.crossOrigin || data.topOrigin) throw invalid();
}

// Never derive the RP or expected origin from untrusted request/forwarded headers.
export function passkeyConfig() {
  let url: URL;
  try {
    url = new URL(process.env.APP_ORIGIN || "");
  } catch {
    throw new AppError(
      "SETUP_REQUIRED",
      "Set APP_ORIGIN to use passkeys.",
      503,
    );
  }
  if (
    isIP(url.hostname) ||
    url.hostname.includes(":") ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && url.hostname === "localhost"))
  )
    throw new AppError(
      "PASSKEY_ORIGIN",
      "Passkeys need HTTPS or localhost. For local development, set APP_ORIGIN to http://localhost:3000 and open that address.",
      503,
    );
  return { origin: url.origin, rpId: url.hostname };
}
const handle = (userId: string) => Buffer.from(userId).toString("base64url");
const passkeyRef = (id: string) =>
  database().collection("passkeys").doc(hash(id));
const userPasskeys = (userId: string) =>
  database().collection("passkeys").where("userId", "==", userId);

export async function listPasskeys(user: User): Promise<PasskeyList> {
  const { rpId } = passkeyConfig();
  const docs = await userPasskeys(user.id).get();
  return {
    rpId,
    userId: handle(user.id),
    name: user.email,
    displayName: user.name,
    passkeys: docs.docs
      .map((doc) => decode<Passkey>(doc.data()))
      .filter((key) => key.rpId === rpId)
      .map(({ id, name, createdAt, lastUsedAt }) => ({
        id,
        name,
        createdAt,
        ...(lastUsedAt ? { lastUsedAt } : {}),
      })),
  };
}

export async function requireRecentSignIn(user: User) {
  const token = (await cookies()).get(AUTH_COOKIE_NAME)?.value;
  const doc = token
    ? await database().collection("user_sessions").doc(hash(token)).get()
    : null;
  const session = doc?.exists ? decode<ManagementSession>(doc.data()) : null;
  assertRecentSession(user, session);
  return hash(token!);
}

function assertRecentSession(user: User, session: ManagementSession | null) {
  if (
    !session ||
    session.userId !== user.id ||
    (session.authVersion ?? 0) !== (user.authVersion ?? 0) ||
    !(Date.parse(session.expiresAt) > Date.now()) ||
    !(Date.parse(session.createdAt) > Date.now() - 10 * 60_000)
  )
    throw new AppError(
      "PASSKEY_REAUTH",
      "Sign out and sign in again before managing passkeys.",
      401,
    );
}

// Recheck authorization in the same transaction as the mutation: signing out
// or changing the password while a device prompt is open revokes enrollment.
async function checkManagementSession(
  tx: Transaction,
  user: User,
  sessionId: string,
) {
  const f = database();
  const [account, session] = await tx.getAll(
    f.collection("users").doc(user.id),
    f.collection("user_sessions").doc(sessionId),
  );
  if (!account.exists) throw invalid();
  assertRecentSession(
    decode<User>(account.data()),
    session.exists ? decode<ManagementSession>(session.data()) : null,
  );
}

async function saveCeremony(
  request: Request,
  data: Pick<Ceremony, "challenge" | "purpose"> & { user?: User },
) {
  const config = passkeyConfig();
  const session = data.user ? await requireRecentSignIn(data.user) : undefined;
  const jar = await cookies();
  const existing = jar.get(BROWSER_COOKIE)?.value;
  const browser =
    existing && /^[A-Za-z0-9_-]{43}$/.test(existing)
      ? existing
      : randomBytes(32).toString("base64url");
  const ceremonyId = randomUUID();
  const expiresAt = new Date(Date.now() + CHALLENGE_TTL).toISOString();
  const f = database();
  const { network } = callContext(data.user?.id || "passkey", request);
  const bucket = f
    .collection("usage")
    .doc(`passkey-${network}-${Math.floor(Date.now() / CHALLENGE_TTL)}`);
  await f.runTransaction(async (tx) => {
    const usage = await tx.get(bucket);
    const count = Number(usage.data()?.count || 0);
    if (count >= 100)
      throw new AppError(
        "PASSKEY_LIMIT",
        "Too many passkey attempts. Please try again in a few minutes.",
        429,
        300,
      );
    tx.set(bucket, encode({ count: count + 1, expiresAt }));
    tx.create(
      f.collection("passkey_challenges").doc(ceremonyId),
      encode({
        ...config,
        challenge: data.challenge,
        purpose: data.purpose,
        browser: hash(browser),
        ...(data.user ? { userId: data.user.id, session } : {}),
        expiresAt,
      }),
    );
  });
  jar.set(BROWSER_COOKIE, browser, {
    httpOnly: true,
    secure: config.origin.startsWith("https:"),
    sameSite: "strict",
    path: "/",
    maxAge: 600,
  });
  return ceremonyId;
}

async function consumeCeremony(
  id: string,
  purpose: Ceremony["purpose"],
  user?: User,
) {
  const browser = (await cookies()).get(BROWSER_COOKIE)?.value;
  const session = user ? await requireRecentSignIn(user) : undefined;
  const config = passkeyConfig();
  const f = database();
  const ref = f.collection("passkey_challenges").doc(id);
  return f.runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    const data = doc.exists ? decode<Ceremony>(doc.data()) : null;
    if (
      !data ||
      !browser ||
      data.browser !== hash(browser) ||
      data.purpose !== purpose ||
      data.origin !== config.origin ||
      data.rpId !== config.rpId ||
      data.userId !== user?.id ||
      data.session !== session ||
      !(Date.parse(data.expiresAt) > Date.now())
    )
      throw invalid();
    // Commit consumption before cryptographic verification, including failed attempts.
    tx.delete(ref);
    return data;
  });
}

export async function registrationOptions(request: Request, user: User) {
  const { rpId } = passkeyConfig();
  await requireRecentSignIn(user);
  const { passkeys } = await listPasskeys(user);
  if (passkeys.length >= MAX_PASSKEYS)
    throw new AppError(
      "PASSKEY_LIMIT",
      "Remove a passkey before adding another.",
      400,
    );
  const options = await generateRegistrationOptions({
    rpName: "Teach Milo",
    rpID: rpId,
    userID: new TextEncoder().encode(user.id),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: passkeys.map((key) => ({ id: key.id })),
  });
  return {
    options,
    ceremonyId: await saveCeremony(request, {
      challenge: options.challenge,
      purpose: "registration",
      user,
    }),
  };
}

export async function registerPasskey(
  user: User,
  ceremonyId: string,
  response: RegistrationResponseJSON,
  name: string,
) {
  const ceremony = await consumeCeremony(ceremonyId, "registration", user);
  let result;
  try {
    requireSameOriginCeremony(response.response.clientDataJSON);
    result = await verifyRegistrationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.origin,
      expectedRPID: ceremony.rpId,
      requireUserVerification: true,
      requireUserPresence: true,
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const info = result.registrationInfo;
  const key: Passkey = {
    id: info.credential.id,
    userId: user.id,
    rpId: ceremony.rpId,
    publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
    counter: info.credential.counter,
    transports: info.credential.transports,
    deviceType: info.credentialDeviceType,
    backedUp: info.credentialBackedUp,
    name,
    createdAt: new Date().toISOString(),
  };
  const f = database();
  await f.runTransaction(async (tx) => {
    const [existing, keys] = await Promise.all([
      tx.get(passkeyRef(key.id)),
      tx.get(userPasskeys(user.id)),
    ]);
    await checkManagementSession(tx, user, ceremony.session!);
    if (existing.exists)
      throw new AppError(
        "PASSKEY_EXISTS",
        "This passkey is already registered.",
        409,
      );
    if (keys.size >= MAX_PASSKEYS)
      throw new AppError(
        "PASSKEY_LIMIT",
        "Remove a passkey before adding another.",
        400,
      );
    tx.create(passkeyRef(key.id), encode(key));
  });
}

export async function authenticationOptions(request: Request) {
  const { rpId } = passkeyConfig();
  const options = await generateAuthenticationOptions({
    rpID: rpId,
    allowCredentials: [],
    userVerification: "required",
  });
  return {
    options,
    ceremonyId: await saveCeremony(request, {
      challenge: options.challenge,
      purpose: "authentication",
    }),
  };
}

export async function authenticatePasskey(
  ceremonyId: string,
  response: AuthenticationResponseJSON,
): Promise<User> {
  const ceremony = await consumeCeremony(ceremonyId, "authentication");
  const ref = passkeyRef(response.id);
  const doc = await ref.get();
  if (!doc.exists)
    throw new AppError(
      "PASSKEY_NOT_FOUND",
      "This passkey is no longer registered. Use another sign-in method.",
      404,
    );
  const key = decode<Passkey>(doc.data());
  if (
    key.id !== response.id ||
    key.rpId !== ceremony.rpId ||
    response.response.userHandle !== handle(key.userId)
  )
    throw invalid();
  let result;
  try {
    requireSameOriginCeremony(response.response.clientDataJSON);
    result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: ceremony.challenge,
      expectedOrigin: ceremony.origin,
      expectedRPID: ceremony.rpId,
      requireUserVerification: true,
      credential: {
        id: key.id,
        publicKey: new Uint8Array(Buffer.from(key.publicKey, "base64url")),
        counter: key.counter,
        transports: key.transports,
      },
    });
  } catch {
    throw invalid();
  }
  if (!result.verified) throw invalid();
  const f = database();
  return f.runTransaction(async (tx) => {
    const [current, account] = await tx.getAll(
      ref,
      f.collection("users").doc(key.userId),
    );
    const stored = current.exists ? decode<Passkey>(current.data()) : null;
    if (
      !stored ||
      !account.exists ||
      stored.counter !== key.counter ||
      stored.publicKey !== key.publicKey ||
      stored.userId !== key.userId
    )
      throw invalid();
    tx.update(ref, {
      counter: result.authenticationInfo.newCounter,
      backedUp: result.authenticationInfo.credentialBackedUp,
      lastUsedAt: new Date().toISOString(),
    });
    return decode<User>(account.data());
  });
}

export async function changePasskey(user: User, id: string, name?: string) {
  const session = await requireRecentSignIn(user);
  const { rpId } = passkeyConfig();
  const ref = passkeyRef(id);
  await database().runTransaction(async (tx) => {
    const doc = await tx.get(ref);
    await checkManagementSession(tx, user, session);
    const key = doc.exists ? decode<Passkey>(doc.data()) : null;
    if (!key || key.id !== id || key.userId !== user.id || key.rpId !== rpId)
      throw new AppError("NOT_FOUND", "Passkey not found.", 404);
    if (name === undefined) tx.delete(ref);
    else tx.update(ref, { name });
  });
}
