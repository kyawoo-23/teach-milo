import {
  createHash,
  generateKeyPairSync,
  randomBytes,
  sign,
} from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { isoCBOR } from "@simplewebauthn/server/helpers";
import { hash, getAuthenticatedUser } from "@/server/auth";
import { passkeyConfig } from "@/server/passkeys";
import { POST as registrationOptions } from "@/app/api/auth/passkeys/registration/options/route";
import { POST as registrationVerify } from "@/app/api/auth/passkeys/registration/verify/route";
import { POST as authenticationOptions } from "@/app/api/auth/passkeys/authentication/options/route";
import { POST as authenticationVerify } from "@/app/api/auth/passkeys/authentication/verify/route";
import { GET as list } from "@/app/api/auth/passkeys/route";
import {
  DELETE as remove,
  PATCH as rename,
} from "@/app/api/auth/passkeys/[id]/route";

const store = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  cookies: new Map<string, string>(),
  cookieOptions: new Map<string, Record<string, unknown>>(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      store.cookies.has(name) ? { value: store.cookies.get(name) } : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      store.cookies.set(name, value);
      store.cookieOptions.set(name, options);
    },
  }),
}));
vi.mock("@/server/db", () => {
  type Ref = {
    key: string;
    collection?: string;
    field?: string;
    value?: unknown;
  };
  const snapshot = (key: string) => ({
    exists: store.docs.has(key),
    data: () => structuredClone(store.docs.get(key)),
  });
  const read = (ref: Ref) => {
    if (!ref.collection) return snapshot(ref.key);
    const docs = [...store.docs.entries()]
      .filter(
        ([key, value]) =>
          key.startsWith(ref.collection + "/") &&
          value[ref.field!] === ref.value,
      )
      .map(([key]) => snapshot(key));
    return { docs, size: docs.length, empty: !docs.length };
  };
  const doc = (key: string) => ({
    key,
    get: async () => snapshot(key),
    set: async (value: Record<string, unknown>) => {
      store.docs.set(key, structuredClone(value));
    },
  });
  // Serialize transactions so concurrent verification sees committed consumption.
  let tail = Promise.resolve();
  return {
    encode: (value: unknown) => value,
    decode: (value: unknown) => value,
    database: () => ({
      collection: (collection: string) => ({
        doc: (id: string) => doc(`${collection}/${id}`),
        where: (field: string, _op: string, value: unknown) => ({
          collection,
          field,
          value,
          get: async () => read({ key: "", collection, field, value }),
        }),
      }),
      runTransaction: (fn: (tx: unknown) => Promise<unknown>) => {
        const result = tail.then(async () => {
          const writes: (() => void)[] = [];
          const result = await fn({
            get: async (ref: Ref) => read(ref),
            getAll: async (...refs: Ref[]) => refs.map(read),
            set: (ref: Ref, value: Record<string, unknown>) =>
              writes.push(() =>
                store.docs.set(ref.key, structuredClone(value)),
              ),
            create: (ref: Ref, value: Record<string, unknown>) =>
              writes.push(() => {
                if (store.docs.has(ref.key)) throw new Error("already exists");
                store.docs.set(ref.key, structuredClone(value));
              }),
            update: (ref: Ref, value: Record<string, unknown>) =>
              writes.push(() =>
                store.docs.set(ref.key, {
                  ...store.docs.get(ref.key),
                  ...value,
                }),
              ),
            delete: (ref: Ref) => writes.push(() => store.docs.delete(ref.key)),
          });
          writes.forEach((write) => write());
          return result;
        });
        tail = result.then(
          () => {},
          () => {},
        );
        return result;
      },
    }),
  };
});

const origin = "https://teachback.example";
const userId = "ada";
const b64 = (value: Uint8Array | string) =>
  Buffer.from(value).toString("base64url");
const digest = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest();
const credentialId = randomBytes(32);
const id = b64(credentialId);
const keys = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = keys.publicKey.export({ format: "jwk" });
const cose = isoCBOR.encode(
  new Map<number, number | Uint8Array>([
    [1, 2],
    [3, -7],
    [-1, 1],
    [-2, new Uint8Array(Buffer.from(jwk.x!, "base64url"))],
    [-3, new Uint8Array(Buffer.from(jwk.y!, "base64url"))],
  ]),
);
const request = (path: string, body: unknown = {}, requestOrigin = origin) =>
  new Request(`${origin}/api/auth/passkeys/${path}`, {
    method: "POST",
    headers: { origin: requestOrigin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const context = { params: Promise.resolve({ id }) };

function clientData(type: string, challenge: string, from = origin) {
  return Buffer.from(
    JSON.stringify({ type, challenge, origin: from, crossOrigin: false }),
  );
}
function attestation(challenge: string, flags = 0x45) {
  const client = clientData("webauthn.create", challenge);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(credentialId.length);
  const authData = Buffer.concat([
    digest("teachback.example"),
    Buffer.from([flags]),
    Buffer.alloc(4),
    Buffer.alloc(16),
    length,
    credentialId,
    cose,
  ]);
  return {
    id,
    rawId: id,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: { credProps: { rk: true } },
    response: {
      clientDataJSON: b64(client),
      transports: ["internal"],
      attestationObject: b64(
        isoCBOR.encode(
          new Map<string, string | Uint8Array | Map<string, string>>([
            ["fmt", "none"],
            ["attStmt", new Map()],
            ["authData", authData],
          ]),
        ),
      ),
    },
  };
}
function assertion(
  challenge: string,
  overrides: {
    flags?: number;
    origin?: string;
    rpId?: string;
    counter?: number;
    crossOrigin?: boolean;
  } = {},
) {
  const client = overrides.crossOrigin
    ? Buffer.from(
        JSON.stringify({
          type: "webauthn.get",
          challenge,
          origin,
          crossOrigin: true,
        }),
      )
    : clientData("webauthn.get", challenge, overrides.origin);
  const counter = Buffer.alloc(4);
  counter.writeUInt32BE(overrides.counter ?? 1);
  const authData = Buffer.concat([
    digest(overrides.rpId ?? "teachback.example"),
    Buffer.from([overrides.flags ?? 0x05]),
    counter,
  ]);
  const signature = sign(
    "sha256",
    Buffer.concat([authData, digest(client)]),
    keys.privateKey,
  );
  return {
    id,
    rawId: id,
    type: "public-key",
    authenticatorAttachment: "platform",
    clientExtensionResults: {},
    response: {
      clientDataJSON: b64(client),
      authenticatorData: b64(authData),
      signature: b64(signature),
      userHandle: b64(userId),
    },
  };
}
async function enroll() {
  const response = await registrationOptions(request("registration/options"));
  expect(response.status).toBe(200);
  const { options, ceremonyId } = await response.json();
  const credential = attestation(options.challenge);
  const verified = await registrationVerify(
    request("registration/verify", {
      ceremonyId,
      credential,
      name: "Personal laptop",
    }),
  );
  expect(verified.status).toBe(200);
  return { ceremonyId, options, credential, result: await verified.json() };
}
async function loginOptions() {
  store.cookies.delete("teach-milo_auth");
  const response = await authenticationOptions(
    request("authentication/options"),
  );
  expect(response.status).toBe(200);
  return response.json();
}

beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", origin);
  store.docs.clear();
  store.cookies.clear();
  store.cookieOptions.clear();
  store.cookies.set("teach-milo_auth", "a".repeat(43));
  store.docs.set("users/ada", {
    id: userId,
    email: "ada@example.test",
    name: "Ada",
    googleId: "google-ada",
  });
  store.docs.set(`user_sessions/${hash("a".repeat(43))}`, {
    userId,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  });
});

describe("passkey registration and authentication (real ES256 signatures)", () => {
  it("enrolls a discoverable credential, returns safe metadata, and creates a normal authenticated session", async () => {
    const { options, result } = await enroll();
    expect(options.authenticatorSelection).toMatchObject({
      residentKey: "required",
      requireResidentKey: true,
      userVerification: "required",
    });
    expect(options.rp.id).toBe("teachback.example");
    expect(options.user.id).toBe(b64(userId));
    expect(result.passkeys).toEqual([
      { id, name: "Personal laptop", createdAt: expect.any(String) },
    ]);
    expect(JSON.stringify(result)).not.toContain("publicKey");
    expect(store.cookieOptions.get("teach-milo_passkey")).toMatchObject({
      httpOnly: true,
      sameSite: "strict",
      secure: true,
    });
    const login = await loginOptions();
    expect(login.options.allowCredentials).toEqual([]);
    const response = await authenticationVerify(
      request("authentication/verify", {
        ceremonyId: login.ceremonyId,
        credential: assertion(login.options.challenge),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({
      id: userId,
      hasPassword: false,
    });
    expect((await getAuthenticatedUser())?.id).toBe(userId);
    expect(store.docs.get(`passkeys/${hash(id)}`)).toMatchObject({
      counter: 1,
      lastUsedAt: expect.any(String),
    });
    expect((await (await list()).json()).passkeys[0]).toMatchObject({
      id,
      lastUsedAt: expect.any(String),
    });
  });

  it.each([
    "signature",
    "challenge",
    "origin",
    "rpId",
    "uv",
    "presence",
    "handle",
    "counter",
    "crossOrigin",
  ])("rejects an invalid %s and consumes the challenge", async (failure) => {
    await enroll();
    const login = await loginOptions();
    const credential = assertion(
      failure === "challenge" ? b64("wrong") : login.options.challenge,
      {
        ...(failure === "origin" ? { origin: "https://attacker.example" } : {}),
        ...(failure === "rpId" ? { rpId: "attacker.example" } : {}),
        ...(failure === "uv" ? { flags: 0x01 } : {}),
        ...(failure === "presence" ? { flags: 0x04 } : {}),
        ...(failure === "crossOrigin" ? { crossOrigin: true } : {}),
      },
    );
    if (failure === "signature")
      credential.response.signature = b64(randomBytes(64));
    if (failure === "handle")
      credential.response.userHandle = b64("other-user");
    if (failure === "counter")
      store.docs.get(`passkeys/${hash(id)}`)!.counter = 9;
    const response = await authenticationVerify(
      request("authentication/verify", {
        ceremonyId: login.ceremonyId,
        credential,
      }),
    );
    expect(response.status).toBe(401);
    expect(store.docs.has(`passkey_challenges/${login.ceremonyId}`)).toBe(
      false,
    );
    expect(store.cookies.has("teach-milo_auth")).toBe(false);
    expect(
      (
        await authenticationVerify(
          request("authentication/verify", {
            ceremonyId: login.ceremonyId,
            credential: assertion(login.options.challenge),
          }),
        )
      ).status,
    ).toBe(401);
  });

  it("rejects missing user verification during enrollment", async () => {
    const { options, ceremonyId } = await (
      await registrationOptions(request("registration/options"))
    ).json();
    const response = await registrationVerify(
      request("registration/verify", {
        ceremonyId,
        credential: attestation(options.challenge, 0x41),
        name: "No UV",
      }),
    );
    expect(response.status).toBe(401);
    expect(store.docs.has(`passkeys/${hash(id)}`)).toBe(false);
  });

  it("accepts synced, backed-up passkeys that always report a zero counter", async () => {
    const { options, ceremonyId } = await (
      await registrationOptions(request("registration/options"))
    ).json();
    const response = await registrationVerify(
      request("registration/verify", {
        ceremonyId,
        name: "Synced passkey",
        credential: attestation(options.challenge, 0x5d),
      }),
    );
    expect(response.status).toBe(200);
    for (let i = 0; i < 2; i++) {
      const login = await loginOptions();
      const response = await authenticationVerify(
        request("authentication/verify", {
          ceremonyId: login.ceremonyId,
          credential: assertion(login.options.challenge, {
            counter: 0,
            flags: 0x1d,
          }),
        }),
      );
      expect(response.status).toBe(200);
    }
    expect(store.docs.get(`passkeys/${hash(id)}`)).toMatchObject({
      counter: 0,
      deviceType: "multiDevice",
      backedUp: true,
    });
  });

  it("binds challenges to their browser, purpose, account, session and five-minute lifetime", async () => {
    const { options, ceremonyId } = await (
      await registrationOptions(request("registration/options"))
    ).json();
    const body = {
      ceremonyId,
      credential: attestation(options.challenge),
      name: "Laptop",
    };
    const browser = store.cookies.get("teach-milo_passkey")!;
    store.cookies.set("teach-milo_passkey", "b".repeat(43));
    expect(
      (await registrationVerify(request("registration/verify", body))).status,
    ).toBe(401);
    store.cookies.set("teach-milo_passkey", browser);
    expect(
      (
        await authenticationVerify(
          request("authentication/verify", {
            ceremonyId,
            credential: assertion(options.challenge),
          }),
        )
      ).status,
    ).toBe(401);
    store.docs.get(`passkey_challenges/${ceremonyId}`)!.userId = "another-user";
    expect(
      (await registrationVerify(request("registration/verify", body))).status,
    ).toBe(401);
    store.docs.get(`passkey_challenges/${ceremonyId}`)!.userId = userId;
    store.docs.get(`passkey_challenges/${ceremonyId}`)!.session =
      "different-session";
    expect(
      (await registrationVerify(request("registration/verify", body))).status,
    ).toBe(401);
    store.docs.get(`passkey_challenges/${ceremonyId}`)!.session = hash(
      "a".repeat(43),
    );
    store.docs.get(`passkey_challenges/${ceremonyId}`)!.expiresAt = new Date(
      Date.now() - 1,
    ).toISOString();
    expect(
      (await registrationVerify(request("registration/verify", body))).status,
    ).toBe(401);
  });

  it("allows only one concurrent verification of a challenge", async () => {
    await enroll();
    const login = await loginOptions();
    const body = {
      ceremonyId: login.ceremonyId,
      credential: assertion(login.options.challenge),
    };
    const responses = await Promise.all([
      authenticationVerify(request("authentication/verify", body)),
      authenticationVerify(request("authentication/verify", body)),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
  });

  it("prevents duplicate enrollment and excludes existing passkeys", async () => {
    await enroll();
    const { options, ceremonyId } = await (
      await registrationOptions(request("registration/options"))
    ).json();
    expect(options.excludeCredentials).toContainEqual({
      id,
      type: "public-key",
    });
    expect(
      (
        await registrationVerify(
          request("registration/verify", {
            ceremonyId,
            name: "Duplicate",
            credential: attestation(options.challenge),
          }),
        )
      ).status,
    ).toBe(409);
  });

  it("enforces recent authentication, same-origin requests and ownership for management", async () => {
    await enroll();
    expect(
      (await rename(request(id, { name: "Renamed" }), context)).status,
    ).toBe(200);
    store.docs.get(`passkeys/${hash(id)}`)!.userId = "someone-else";
    expect((await remove(request(id), context)).status).toBe(404);
    store.docs.get(`passkeys/${hash(id)}`)!.userId = userId;
    expect(
      (await remove(request(id, {}, "https://attacker.example"), context))
        .status,
    ).toBe(403);
    store.docs.get(`user_sessions/${hash("a".repeat(43))}`)!.createdAt =
      new Date(Date.now() - 11 * 60_000).toISOString();
    expect(
      (await registrationOptions(request("registration/options"))).status,
    ).toBe(401);
    expect((await remove(request(id), context)).status).toBe(401);
    store.docs.get(`user_sessions/${hash("a".repeat(43))}`)!.createdAt =
      new Date().toISOString();
    expect((await remove(request(id), context)).status).toBe(200);
    const login = await loginOptions();
    expect(
      (
        await authenticationVerify(
          request("authentication/verify", {
            ceremonyId: login.ceremonyId,
            credential: assertion(login.options.challenge),
          }),
        )
      ).status,
    ).toBe(404);
    expect((await list()).status).toBe(401);
    expect(
      (await registrationOptions(request("registration/options"))).status,
    ).toBe(401);
  });

  it("rejects cross-origin option requests, malformed payloads, and exhausted rate limits", async () => {
    expect(
      (
        await authenticationOptions(
          request("authentication/options", {}, "https://attacker.example"),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await authenticationVerify(
          request("authentication/verify", {
            ceremonyId: "bad",
            credential: {},
          }),
        )
      ).status,
    ).toBe(400);
    await authenticationOptions(request("authentication/options"));
    const usage = [...store.docs.entries()].find(([key]) =>
      key.startsWith("usage/passkey-"),
    )!;
    usage[1].count = 100;
    const response = await authenticationOptions(
      request("authentication/options"),
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("300");
  });

  it("requires an explicitly configured HTTPS domain or localhost, never a request-derived RP ID", () => {
    for (const value of ["", "http://127.0.0.1:3000", "http://example.com"]) {
      vi.stubEnv("APP_ORIGIN", value);
      expect(() => passkeyConfig()).toThrow();
    }
    vi.stubEnv("APP_ORIGIN", "http://localhost:3000");
    expect(passkeyConfig()).toEqual({
      origin: "http://localhost:3000",
      rpId: "localhost",
    });
  });
});
