import { beforeEach, describe, expect, it, vi } from "vitest";
import { UpdatePasswordSchema, UpdateProfileSchema } from "@/lib/contracts";
import { PasswordFormSchema } from "@/lib/form-schemas";
import {
  AUTH_COOKIE_NAME,
  createUserSession,
  getAuthenticatedUser,
  hash,
  hashPassword,
  updatePassword,
  verifyPassword,
} from "@/server/auth";
import { PATCH as updateProfile } from "@/app/api/auth/profile/route";
import { POST as changePassword } from "@/app/api/auth/password/route";

const store = vi.hoisted(() => ({
  docs: new Map<string, Record<string, unknown>>(),
  token: "a".repeat(43),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "teachback_auth" && store.token
        ? { value: store.token }
        : undefined,
    set: (_name: string, token: string) => {
      store.token = token;
    },
  }),
}));
vi.mock("@/server/db", () => {
  const snapshot = (key: string) => ({
    exists: store.docs.has(key),
    data: () => structuredClone(store.docs.get(key)),
  });
  const doc = (key: string) => ({
    key,
    get: async () => snapshot(key),
    set: async (value: Record<string, unknown>) => {
      store.docs.set(key, value);
    },
  });
  return {
    encode: (value: unknown) => value,
    decode: (value: unknown) => value,
    database: () => ({
      collection: (collection: string) => ({
        doc: (id: string) => doc(`${collection}/${id}`),
      }),
      runTransaction: async (fn: (tx: unknown) => unknown) => {
        const writes: (() => void)[] = [];
        const result = await fn({
          get: async (ref: { key: string }) => snapshot(ref.key),
          getAll: async (...refs: { key: string }[]) =>
            refs.map((ref) => snapshot(ref.key)),
          update: (ref: { key: string }, value: Record<string, unknown>) =>
            writes.push(() =>
              store.docs.set(ref.key, { ...store.docs.get(ref.key), ...value }),
            ),
        });
        writes.forEach((write) => write());
        return result;
      },
    }),
  };
});

const request = (
  path: string,
  body: unknown,
  origin = "http://127.0.0.1:3000",
) =>
  new Request(`http://127.0.0.1:3000/api/auth/${path}`, {
    method: path === "profile" ? "PATCH" : "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("APP_ORIGIN", "http://127.0.0.1:3000");
  store.docs.clear();
  store.token = "a".repeat(43);
  const password = hashPassword("old-password");
  store.docs.set("users/ada", {
    id: "ada",
    name: "Ada",
    email: "ada@example.test",
    passwordHash: password.hash,
    passwordSalt: password.salt,
  });
  store.docs.set(`user_sessions/${hash(store.token)}`, {
    userId: "ada",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  });
});

describe("account updates", () => {
  it("saves a trimmed name while preserving email and credential fields", async () => {
    const before = { ...store.docs.get("users/ada") };
    const response = await updateProfile(
      request("profile", { name: " Grace " }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).user).toMatchObject({
      name: "Grace",
      email: before.email,
      hasPassword: true,
    });
    expect(store.docs.get("users/ada")).toMatchObject({
      ...before,
      name: "Grace",
    });
  });
  it("rejects email or privileged fields rather than silently applying them", async () => {
    for (const field of ["email", "id", "passwordHash", "googleId"]) {
      const response = await updateProfile(
        request("profile", { name: "Grace", [field]: "changed" }),
      );
      expect(response.status).toBe(400);
    }
    expect(store.docs.get("users/ada")?.name).toBe("Ada");
    expect(UpdateProfileSchema.safeParse({ name: " " }).success).toBe(false);
    expect(
      UpdateProfileSchema.safeParse({ name: "a".repeat(81) }).success,
    ).toBe(false);
  });
  it("requires a signed-in user and same-origin request for both mutations", async () => {
    for (const handler of [updateProfile, changePassword]) {
      const path = handler === updateProfile ? "profile" : "password";
      expect(
        (await handler(request(path, {}, "https://other.test"))).status,
      ).toBe(403);
      store.token = "";
      expect((await handler(request(path, {}))).status).toBe(401);
    }
  });
  it("rejects wrong current passwords and Google-only accounts without changing credentials", async () => {
    const before = { ...store.docs.get("users/ada") };
    const response = await changePassword(
      request("password", {
        currentPassword: "wrong",
        newPassword: "new-password",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_PASSWORD");
    expect(store.docs.get("users/ada")).toEqual(before);
    store.docs.set("users/ada", {
      id: "ada",
      email: before.email,
      name: "Ada",
      googleId: "google",
    });
    await expect(
      updatePassword("ada", "anything", "new-password"),
    ).rejects.toMatchObject({ code: "PASSWORD_MANAGED_BY_GOOGLE" });
  });
  it("changes the hash, invalidates other sessions, and preserves the current session", async () => {
    const otherToken = "b".repeat(43);
    const currentToken = store.token;
    store.docs.set(`user_sessions/${hash(otherToken)}`, {
      ...store.docs.get(`user_sessions/${hash(currentToken)}`),
    });
    const response = await changePassword(
      request("password", {
        currentPassword: "old-password",
        newPassword: "new-password",
      }),
    );
    expect(response.status).toBe(200);
    const user = store.docs.get("users/ada")!;
    expect(
      verifyPassword(
        "new-password",
        String(user.passwordHash),
        String(user.passwordSalt),
      ),
    ).toBe(true);
    expect(
      verifyPassword(
        "old-password",
        String(user.passwordHash),
        String(user.passwordSalt),
      ),
    ).toBe(false);
    expect((await getAuthenticatedUser())?.id).toBe("ada");
    store.token = otherToken;
    expect(await getAuthenticatedUser()).toBeNull();
    await expect(
      updatePassword("ada", "new-password", "another-password"),
    ).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
    await createUserSession("ada", Number(user.authVersion));
    expect((await getAuthenticatedUser())?.id).toBe("ada");
  });
  it("validates password length, confirmation, and a different new password without trimming", () => {
    const input = {
      currentPassword: "old-password",
      newPassword: " password ",
      confirmPassword: " password ",
    };
    expect(PasswordFormSchema.parse(input)).toEqual(input);
    expect(
      PasswordFormSchema.safeParse({ ...input, confirmPassword: "password" })
        .success,
    ).toBe(false);
    expect(
      UpdatePasswordSchema.safeParse({
        currentPassword: "old-password",
        newPassword: "short",
      }).success,
    ).toBe(false);
    expect(
      UpdatePasswordSchema.safeParse({
        currentPassword: "old-password",
        newPassword: "old-password",
      }).success,
    ).toBe(false);
    expect(
      UpdatePasswordSchema.safeParse({
        currentPassword: "old-password",
        newPassword: "a".repeat(1025),
      }).success,
    ).toBe(false);
  });
});
