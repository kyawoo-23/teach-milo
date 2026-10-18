import { createHash, randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Timestamp } from "firebase-admin/firestore";
import { database, encode, readOwned } from "@/server/db";
import {
  claimGuest,
  consumeGoogleState,
  createGoogleState,
  createGuest,
  getGuest,
  guestClaimState,
  GUEST_COOKIE_NAME,
} from "@/server/guests";
import {
  AUTH_COOKIE_NAME,
  createUser,
  createUserSession,
  getAuthenticatedUser,
} from "@/server/auth";
import { requireLearningOwnerId, requireUserId } from "@/server/http";
import { ownerOperation, sessionOperation } from "@/server/operations";
import { saveMaterial } from "@/server/materials";
import { reserveModelCall } from "@/server/usage";
import {
  lessonFixture,
  sessionFixture,
  replyFixture,
  reportFixture,
} from "./fixtures";
import type { Message } from "@/lib/contracts";
import type { Model } from "@/server/model";
import {
  createSession,
  publicSession,
  submitTurn,
  sessionAction,
  submitTransfer,
} from "@/server/sessions";
import { GET as me } from "@/app/api/auth/me/route";
import { POST as guestEndpoint } from "@/app/api/auth/guest/route";
import { POST as claimEndpoint } from "@/app/api/auth/guest/claim/route";
import { POST as signup } from "@/app/api/auth/signup/route";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { PATCH as profile } from "@/app/api/auth/profile/route";
import { GET as googleCallback } from "@/app/api/auth/google/callback/route";
import * as auth from "@/server/auth";

const browser = vi.hoisted(() => ({
  cookies: new Map<string, string>(),
  options: new Map<string, Record<string, unknown>>(),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      browser.cookies.has(name)
        ? { value: browser.cookies.get(name) }
        : undefined,
    set: (name: string, value: string, options: Record<string, unknown>) => {
      browser.cookies.set(name, value);
      browser.options.set(name, options);
    },
    delete: (name: string) => browser.cookies.delete(name),
  }),
}));
const origin = "http://127.0.0.1:3000";
const request = (path: string, body: object = {}) =>
  new Request(`${origin}${path}`, {
    method: "POST",
    headers: { origin, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const account = () =>
  createUser({
    email: `${randomUUID()}@guest.test`,
    name: "Judge",
    password: "securePassword123",
  });
const sources = [
  {
    id: "s1",
    label: "Notes",
    text: "At constant speed, distance equals speed multiplied by time.",
    warnings: [],
  },
];

describe.skipIf(!process.env.FIRESTORE_EMULATOR_HOST)(
  "Guest cookie access and transfer",
  () => {
    beforeEach(() => {
      browser.cookies.clear();
      browser.options.clear();
      vi.stubEnv("APP_ORIGIN", origin);
    });

    it("keeps reads side-effect free, requires origin, and reuses the opaque seven-day cookie", async () => {
      expect(await (await me()).json()).toEqual({ user: null, guest: null });
      expect(
        (
          await guestEndpoint(
            new Request(`${origin}/api/auth/guest`, { method: "POST" }),
          )
        ).status,
      ).toBe(403);
      const res = await guestEndpoint(request("/api/auth/guest"));
      const { guest } = await res.json();
      expect(guest.id).toMatch(/^guest_[a-f0-9]{64}$/);
      const token = browser.cookies.get(GUEST_COOKIE_NAME)!;
      const expiry = Date.parse(guest.expiresAt);
      expect(expiry - Date.now()).toBeGreaterThan(6.99 * 86_400_000);
      expect(browser.options.get(GUEST_COOKIE_NAME)).toMatchObject({
        httpOnly: true,
        sameSite: "lax",
        path: "/",
      });
      expect(
        JSON.stringify(
          (await database().collection("guests").doc(guest.id).get()).data(),
        ),
      ).not.toContain(token);
      expect(await createGuest()).toEqual(guest);
      expect(browser.cookies.get(GUEST_COOKIE_NAME)).toBe(token);
      expect(await requireLearningOwnerId()).toBe(guest.id);
      await expect(requireUserId()).rejects.toMatchObject({ status: 401 });
      expect(
        (await profile(request("/api/auth/profile", { name: "Judge" }))).status,
      ).toBe(401);
    });

    it("isolates browser owners and rejects expired or forged credentials", async () => {
      const guest = await createGuest();
      const token = browser.cookies.get(GUEST_COOKIE_NAME)!;
      const id = randomUUID();
      await saveMaterial(id, guest.id, "Notes", sources);
      browser.cookies.clear();
      const other = await createGuest();
      await expect(readOwned("materials", id, other.id)).rejects.toMatchObject({
        status: 404,
      });
      browser.cookies.set(GUEST_COOKIE_NAME, "tampered");
      expect(await getGuest()).toBeNull();
      await expect(requireLearningOwnerId()).rejects.toMatchObject({
        code: "GUEST_ACCESS_REQUIRED",
      });
      browser.cookies.set(GUEST_COOKIE_NAME, token);
      await database()
        .collection("guests")
        .doc(guest.id)
        .update({ expiresAt: Timestamp.fromMillis(0) });
      expect(await getGuest()).toBeNull();
      await expect(
        saveMaterial(randomUUID(), guest.id, "Notes", sources),
      ).rejects.toMatchObject({ code: "GUEST_CHANGED" });
      expect((await createGuest()).id).not.toBe(guest.id);
    });

    it("completes a real guest teaching, board, independent-check, and report lifecycle with a scripted model", async () => {
      const guest = await createGuest();
      const lesson = { ...lessonFixture(), ownerId: guest.id };
      await database().collection("lessons").doc(lesson.id).set(encode(lesson));
      const context = { ownerId: guest.id, network: randomUUID() };
      const model: Model = {
        async generate(schema, _system, data) {
          const input = data as {
            messages: Message[];
            transferAnswer?: Message;
            skipped?: boolean;
          };
          return schema.parse(
            "skipped" in input
              ? reportFixture(
                  input.messages.find(
                    (m) => m.role === "learner" && m.kind === "teaching",
                  )!,
                  input.transferAnswer,
                )
              : replyFixture(input.messages.at(-1)!, true),
          );
        },
      };
      const id = await createSession(randomUUID(), lesson.id, guest.id);
      const turn = {
        operationId: randomUUID(),
        revision: 0,
        text: "Distance is speed times time, so at 20 m/s for 10 s the board shows 200 m; doubling either one doubles the distance.",
        board: { version: 3 as const, state: { speed: 20 }, composites: {} },
      };
      await submitTurn(id, turn, context, model);
      await submitTurn(id, turn, context, model);
      expect((await publicSession(id, guest.id)).phase).toBe("ready_for_check");
      await sessionAction(
        id,
        { operationId: randomUUID(), revision: 1, action: "start_transfer" },
        context,
        model,
      );
      const check = await publicSession(id, guest.id);
      expect(check.board).toBeUndefined();
      expect(check.messages).toEqual([]);
      await submitTransfer(
        id,
        {
          operationId: randomUUID(),
          revision: 2,
          answer:
            "6 × 25 = 150 m; doubling the time doubles the distance because speed stays constant.",
          answers: { distance: 150 },
          skip: false,
        },
        context,
        model,
      );
      const report = await publicSession(id, guest.id);
      expect(report.phase).toBe("report");
      expect(report.report?.total).toBe(10);
      expect(report.messages.filter((m) => m.role === "learner")).toHaveLength(
        2,
      );
    });

    it("resumes bounded transfers, preserves child records and expiry, and deduplicates retries", async () => {
      const guest = await createGuest();
      const token = browser.cookies.get(GUEST_COOKIE_NAME)!;
      const user = await account();
      const materialId = randomUUID();
      const payload = { type: "paste", text: sources[0].text };
      await ownerOperation(guest.id, materialId, payload, () =>
        saveMaterial(materialId, guest.id, "Notes", sources),
      );
      const materialRef = database().collection("materials").doc(materialId);
      const original = (await materialRef.get()).data()!;
      const lesson = {
        ...lessonFixture(),
        id: randomUUID(),
        ownerId: guest.id,
        materialId,
      };
      const session = {
        ...sessionFixture(lesson),
        id: randomUUID(),
        ownerId: guest.id,
        lessonId: lesson.id,
      };
      await database().collection("lessons").doc(lesson.id).set(encode(lesson));
      const sessionRef = database().collection("sessions").doc(session.id);
      await sessionRef.set(encode(session));
      await sessionRef
        .collection("messages")
        .doc("saved")
        .set({ text: "Keep this conversation" });
      await sessionRef
        .collection("operations")
        .doc("saved")
        .set({ pendingAnswer: "Keep this answer" });
      const batch = database().batch();
      for (let i = 0; i < 55; i++)
        batch.set(database().collection("materials").doc(randomUUID()), {
          ...original,
          ownerId: guest.id,
        });
      await batch.commit();
      const date = new Date().toISOString().slice(0, 10);
      await database()
        .collection("usage")
        .doc(`${date}-guest-${guest.id}`)
        .set({ count: 7 });
      await database()
        .collection("usage")
        .doc(`${date}-guest-${user.id}`)
        .set({ count: 4 });
      await createUserSession(user.id);
      expect(await getGuest()).toBeNull();
      await expect(requireLearningOwnerId()).rejects.toMatchObject({
        code: "GUEST_SYNC_PENDING",
      });
      expect((await guestClaimState(user.id))?.status).toBe("pending");
      const first = await claimGuest(user.id);
      expect(first.status).toBe("pending");
      expect(
        (
          await database()
            .collection("materials")
            .where("ownerId", "==", guest.id)
            .get()
        ).size,
      ).toBe(6);
      // Simulate a reload and repeat sign-in before resuming migration.
      await createUserSession(user.id);
      for (let i = 0; i < 10; i++) {
        if ((await claimGuest(user.id)).status === "complete") break;
      }
      expect(await requireLearningOwnerId()).toBe(user.id);
      expect((await materialRef.get()).get("ownerId")).toBe(user.id);
      expect((await materialRef.get()).get("expiresAt").toMillis()).toBe(
        original.expiresAt.toMillis(),
      );
      expect((await sessionRef.get()).get("ownerId")).toBe(user.id);
      expect(
        (await sessionRef.collection("messages").doc("saved").get()).get(
          "text",
        ),
      ).toBe("Keep this conversation");
      expect(
        (await sessionRef.collection("operations").doc("saved").get()).get(
          "pendingAnswer",
        ),
      ).toBe("Keep this answer");
      expect(
        (
          await database()
            .collection("usage")
            .doc(`${date}-guest-${user.id}`)
            .get()
        ).get("count"),
      ).toBe(11);
      const work = vi.fn();
      expect(await ownerOperation(user.id, materialId, payload, work)).toBe(
        materialId,
      );
      expect(work).not.toHaveBeenCalled();
      expect(browser.cookies.has(GUEST_COOKIE_NAME)).toBe(false);
      browser.cookies.clear();
      browser.cookies.set(GUEST_COOKIE_NAME, token);
      expect(await getGuest()).toBeNull();
      await expect(createGuest()).rejects.toMatchObject({
        code: "GUEST_CHANGED",
      });
      await expect(claimGuest((await account()).id)).rejects.toMatchObject({
        code: "GUEST_CHANGED",
      });
    });

    it("fences an in-flight generation and its failure cleanup without losing saved pending input", async () => {
      const guest = await createGuest();
      const user = await account();
      const session = {
        ...sessionFixture(lessonFixture()),
        id: randomUUID(),
        ownerId: guest.id,
      };
      const ref = database().collection("sessions").doc(session.id);
      await ref.set(encode(session));
      let release!: () => void;
      let entered!: () => void;
      const started = new Promise<void>((resolve) => {
        entered = resolve;
      });
      const hold = new Promise<void>((resolve) => {
        release = resolve;
      });
      const opId = randomUUID();
      const pending = sessionOperation(
        guest.id,
        session.id,
        opId,
        session.revision,
        {},
        async (snapshot) => {
          await ref
            .collection("operations")
            .doc(opId)
            .update({ pendingTurn: { text: "My unsent explanation" } });
          entered();
          await hold;
          return { session: { ...snapshot, phase: "teaching" } };
        },
      );
      const failed = expect(pending).rejects.toMatchObject({
        code: "GUEST_CHANGED",
      });
      await started;
      await createUserSession(user.id);
      for (let i = 0; i < 5; i++)
        if ((await claimGuest(user.id)).status === "complete") break;
      release();
      await failed;
      expect((await ref.get()).get("ownerId")).toBe(user.id);
      expect((await ref.get()).get("activeOperation")).toBeUndefined();
      expect(
        (await ref.collection("operations").doc(opId).get()).get(
          "pendingTurn.text",
        ),
      ).toBe("My unsent explanation");
      await expect(
        reserveModelCall({ ownerId: guest.id, network: "guest-test" }),
      ).rejects.toMatchObject({ code: "GUEST_CHANGED" });
    });

    it("binds work only after successful signup/login and starts a fresh guest after logout", async () => {
      const guest = await createGuest();
      const email = `${randomUUID()}@guest.test`;
      const signedUp = await signup(
        request("/api/auth/signup", {
          email,
          name: "Judge",
          password: "securePassword123",
        }),
      );
      expect(signedUp.status).toBe(201);
      const user = (await signedUp.json()).user;
      expect(
        (await database().collection("guests").doc(guest.id).get()).get(
          "claimedBy",
        ),
      ).toBe(user.id);
      await logout(request("/api/auth/logout"));
      expect(await getAuthenticatedUser()).toBeNull();
      const next = await createGuest();
      expect(next.id).not.toBe(guest.id);
      expect(
        (
          await login(
            request("/api/auth/login", { email, password: "incorrect" }),
          )
        ).status,
      ).toBe(401);
      expect(await getGuest()).toEqual(next);
      expect(
        (await claimEndpoint(request("/api/auth/guest/claim"))).status,
      ).toBe(401);
      expect(
        (
          await login(
            request("/api/auth/login", {
              email,
              password: "securePassword123",
            }),
          )
        ).status,
      ).toBe(200);
      expect(
        (await database().collection("guests").doc(next.id).get()).get(
          "claimedBy",
        ),
      ).toBe(user.id);
      expect(browser.cookies.has(AUTH_COOKIE_NAME)).toBe(true);
    });

    it("requires browser-bound, unexpired, single-use OAuth state tied to the guest identity", async () => {
      await createGuest();
      const state = await createGoogleState("/session/example");
      expect(await consumeGoogleState(state)).toBe("/session/example");
      await expect(consumeGoogleState(state)).rejects.toMatchObject({
        status: 401,
      });
      const another = await createGoogleState("/");
      browser.cookies.delete("teach-milo_google_state");
      await expect(consumeGoogleState(another)).rejects.toMatchObject({
        status: 401,
      });
      const expired = await createGoogleState("/");
      await database()
        .collection("user_sessions")
        .doc(`oauth_${createHash("sha256").update(expired).digest("hex")}`)
        .update({ expiresAt: Timestamp.fromMillis(0) });
      await expect(consumeGoogleState(expired)).rejects.toMatchObject({
        status: 401,
      });
      const changedGuest = await createGoogleState("/");
      browser.cookies.delete(GUEST_COOKIE_NAME);
      await expect(consumeGoogleState(changedGuest)).rejects.toMatchObject({
        status: 401,
      });
    });

    it("transfers through a verified Google callback and leaves guest work available on cancellation", async () => {
      const guest = await createGuest();
      const user = await account();
      const materialId = randomUUID();
      await saveMaterial(materialId, guest.id, "Notes", sources);
      const cancelledState = await createGoogleState("/");
      const cancelled = await googleCallback(
        new Request(
          `${origin}/api/auth/google/callback?error=access_denied&state=${cancelledState}`,
        ),
      );
      expect(cancelled.status).toBe(302);
      expect(await getGuest()).toEqual(guest);
      const exchange = vi
        .spyOn(auth, "exchangeGoogleOAuthCode")
        .mockResolvedValue({
          email: user.email,
          name: user.name,
          sub: "google-test-id",
        });
      try {
        const state = await createGoogleState("/session/return-here");
        const response = await googleCallback(
          new Request(
            `${origin}/api/auth/google/callback?code=scripted&state=${state}`,
          ),
        );
        expect(response.headers.get("location")).toBe(
          `${origin}/session/return-here?signed-in=1`,
        );
        expect((await getAuthenticatedUser())?.id).toBe(user.id);
        expect((await guestClaimState(user.id))?.status).toBe("pending");
        for (let i = 0; i < 5; i++)
          if ((await claimGuest(user.id)).status === "complete") break;
        expect(
          (await readOwned("materials", materialId, user.id)).ownerId,
        ).toBe(user.id);
      } finally {
        exchange.mockRestore();
      }
    });
  },
);
