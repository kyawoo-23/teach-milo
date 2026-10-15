import { beforeEach, expect, it, vi } from "vitest";
import { GET } from "@/app/api/sessions/route";
import { getAuthenticatedUser } from "@/server/auth";
import { database } from "@/server/db";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));

vi.mock("@/server/auth", () => ({ getAuthenticatedUser: vi.fn() }));
vi.mock("@/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db")>()),
  database: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAuthenticatedUser).mockResolvedValue({
    id: "owner",
    name: "Ada",
    email: "ada@example.test",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
});

it.each([
  "",
  "not-json",
  "a".repeat(1025),
  Buffer.from(
    JSON.stringify({ updatedAt: "bad", expiresAt: {}, id: "bad" }),
  ).toString("base64url"),
])(
  "rejects an invalid history cursor before reading Firestore (%s)",
  async (cursor) => {
    const response = await GET(
      new Request(
        `http://localhost/api/sessions?cursor=${encodeURIComponent(cursor)}`,
      ),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_CURSOR");
    expect(database).not.toHaveBeenCalled();
  },
);

it("requires authentication for history pages", async () => {
  vi.mocked(getAuthenticatedUser).mockResolvedValue(null);
  const response = await GET(
    new Request("http://localhost/api/sessions?cursor=invalid"),
  );
  expect(response.status).toBe(401);
  expect(database).not.toHaveBeenCalled();
});
