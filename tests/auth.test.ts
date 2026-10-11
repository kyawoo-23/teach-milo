import { describe, expect, it } from "vitest";
import {
  LoginSchema,
  SignupSchema,
  SessionSummarySchema,
} from "@/lib/contracts";
import {
  hashPassword,
  toPublicUser,
  verifyPassword,
  User,
} from "@/server/auth";

describe("Authentication utilities and contracts", () => {
  it("hashes and verifies passwords correctly", () => {
    const password = "superSecretPassword123!";
    const { hash, salt } = hashPassword(password);

    expect(hash).toBeDefined();
    expect(salt).toBeDefined();
    expect(hash.length).toBe(128); // 64 bytes hex
    expect(salt.length).toBe(32); // 16 bytes hex

    expect(verifyPassword(password, hash, salt)).toBe(true);
    expect(verifyPassword("wrongPassword", hash, salt)).toBe(false);
    expect(verifyPassword("", hash, salt)).toBe(false);
  });

  it("handles corrupt password hashes safely without throwing", () => {
    const { salt } = hashPassword("test");
    expect(verifyPassword("test", "not-a-valid-hex", salt)).toBe(false);
    expect(verifyPassword("test", "1234", salt)).toBe(false);
  });

  it("converts User to UserPublic without leaking password credentials", () => {
    const user: User = {
      id: "u-123",
      email: "marie@curie.org",
      name: "Marie Curie",
      passwordHash: "secret-hash",
      passwordSalt: "secret-salt",
      googleId: "google-123",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const publicUser = toPublicUser(user);
    expect(publicUser).toEqual({
      id: "u-123",
      email: "marie@curie.org",
      name: "Marie Curie",
    });
    expect(
      (publicUser as Record<string, unknown>).passwordHash,
    ).toBeUndefined();
    expect(
      (publicUser as Record<string, unknown>).passwordSalt,
    ).toBeUndefined();
  });

  it("validates SignupSchema requirements", () => {
    const valid = SignupSchema.safeParse({
      email: "learner@teachback.ai",
      password: "password123",
      name: "Curious Learner",
    });
    expect(valid.success).toBe(true);

    const invalidEmail = SignupSchema.safeParse({
      email: "not-an-email",
      password: "password123",
      name: "Curious Learner",
    });
    expect(invalidEmail.success).toBe(false);

    const shortPassword = SignupSchema.safeParse({
      email: "learner@teachback.ai",
      password: "short",
      name: "Curious Learner",
    });
    expect(shortPassword.success).toBe(false);

    const emptyName = SignupSchema.safeParse({
      email: "learner@teachback.ai",
      password: "password123",
      name: "   ",
    });
    expect(emptyName.success).toBe(false);
  });

  it("validates LoginSchema requirements", () => {
    const valid = LoginSchema.safeParse({
      email: "user@teachback.ai",
      password: "anyPassword",
    });
    expect(valid.success).toBe(true);

    const emptyPassword = LoginSchema.safeParse({
      email: "user@teachback.ai",
      password: "",
    });
    expect(emptyPassword.success).toBe(false);
  });

  it("validates SessionSummarySchema", () => {
    const summary = {
      id: "123e4567-e89b-12d3-a456-426614174000",
      title: "Convolutional Neural Networks",
      scope: "Understand weight sharing and filters",
      level: "introductory",
      phase: "teaching",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      expiresAt: new Date().toISOString(),
      progress: [
        { id: "o1", label: "Filter reuse", status: "supported" },
        { id: "o2", label: "Spatial bounds", status: "missing" },
      ],
    };
    const parsed = SessionSummarySchema.safeParse(summary);
    expect(parsed.success).toBe(true);
  });
});

const emulatorEnabled = !!process.env.FIRESTORE_EMULATOR_HOST;
describe.skipIf(!emulatorEnabled)("Auth Firestore persistence", () => {
  it("creates user, finds user by email, and prevents duplicate registration", async () => {
    const { createUser, findUserByEmail, findUserById } =
      await import("@/server/auth");
    const testEmail = `test-${Date.now()}@teachback.ai`;

    const user = await createUser({
      email: testEmail,
      name: "Test User",
      password: "securePassword123",
    });

    expect(user.id).toBeDefined();
    expect(user.email).toBe(testEmail);
    expect(user.passwordHash).toBeDefined();

    const foundByEmail = await findUserByEmail(testEmail);
    expect(foundByEmail?.id).toBe(user.id);

    const foundById = await findUserById(user.id);
    expect(foundById?.email).toBe(testEmail);

    await expect(
      createUser({
        email: testEmail,
        name: "Duplicate User",
        password: "anotherPassword",
      }),
    ).rejects.toThrow("already exists");
  });
});
