import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { deleteApp, initializeApp } from "firebase-admin/app";
import { getFirestore, Query, Timestamp } from "firebase-admin/firestore";
import { afterAll, describe, expect, it, vi } from "vitest";
import { GET as sessionHistory } from "@/app/api/sessions/route";
import { getAuthenticatedUser } from "@/server/auth";
import { database, encode, readOwned } from "@/server/db";
import {
  createSession,
  publicSession,
  readMessages,
  readMessagePage,
  sessionUpdate,
  sessionAction,
  submitTransfer,
  submitTurn,
} from "@/server/sessions";
import { sessionOperation } from "@/server/operations";
import { readBoardImage } from "@/server/board-media";
import { pngFixture, sketchFixture } from "./board-fixtures";
import { prepareLesson } from "@/server/lessons";
import { translate } from "@/lib/i18n/messages";
import { exampleBoard } from "@/lib/boards";
import type { Lesson } from "@/lib/contracts";
import { saveMaterial } from "@/server/materials";
import { extractCachedUpload } from "@/server/materials";
import {
  extractionCacheId,
  withExtractionCache,
} from "@/server/extraction-cache";
import { OCR_PROMPT } from "@/content/prompts";
import { PDFDocument } from "pdf-lib";
import { reserveModelCall } from "@/server/usage";
import type { Model } from "@/server/model";
import type { Message, Session, SessionHistoryPage } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import {
  boardFixture,
  ctx,
  lessonFixture,
  messageFixture,
  replyFixture,
  reportFixture,
  sessionFixture,
} from "./fixtures";

vi.mock("@/server/auth", () => ({ getAuthenticatedUser: vi.fn() }));

const enabled = !!process.env.FIRESTORE_EMULATOR_HOST;
describe.skipIf(!enabled)("Firestore persistence and session lifecycle", () => {
  const cleanup: string[] = [];
  async function setup() {
    const lesson = lessonFixture();
    await database().collection("lessons").doc(lesson.id).set(encode(lesson));
    const id = randomUUID();
    cleanup.push(id);
    await createSession(id, lesson.id, ctx.ownerId);
    return { id, lesson };
  }
  it("resumes validated OCR batches, reuses identical uploads, and isolates owners and expiry", async () => {
    const ownerId = randomUUID();
    const anotherOwner = randomUUID();
    const pdf = await PDFDocument.create();
    const image = await pdf.embedPng(pngFixture());
    for (let i = 0; i < 6; i++)
      pdf.addPage().drawImage(image, { width: 200, height: 200 });
    const bytes = Buffer.from(await pdf.save());
    const configuredModel = process.env.GEMINI_MODEL || "gemini-3.8-flash";
    const ref = database()
      .collection("extraction_cache")
      .doc(extractionCacheId(ownerId, bytes, configuredModel, OCR_PROMPT));
    const otherRef = database()
      .collection("extraction_cache")
      .doc(extractionCacheId(anotherOwner, bytes, configuredModel, OCR_PROMPT));
    let calls = 0;
    const model: Model = {
      async generate(schema, _system, data) {
        calls++;
        if (calls === 2)
          throw new AppError("MODEL_FAILURE", "Interrupted OCR", 502);
        return schema.parse({
          pages: Array.from(
            { length: (data as { pageCount: number }).pageCount },
            (_, index) => ({
              page: index + 1,
              text: "The scanned learning notes explain energy storage and transfer.",
              warnings: [],
            }),
          ),
        });
      },
    };
    const context = { ...ctx, ownerId };
    try {
      await expect(
        extractCachedUpload(bytes, "scan.pdf", context, model),
      ).rejects.toMatchObject({ code: "MODEL_FAILURE" });
      const partial = await ref.get();
      expect(partial.get("sources")).toHaveLength(5);
      expect(partial.get("status")).toBe("partial");
      const expiry = partial.get("expiresAt").toMillis();
      const sources = await extractCachedUpload(
        bytes,
        "scan.pdf",
        context,
        model,
      );
      expect(sources.map((source) => source.id)).toEqual([
        "p1",
        "p2",
        "p3",
        "p4",
        "p5",
        "p6",
      ]);
      expect(calls).toBe(3);
      expect(
        await extractCachedUpload(bytes, "renamed.PDF", context, model),
      ).toEqual(sources);
      expect(calls).toBe(3);
      expect((await ref.get()).get("expiresAt").toMillis()).toBe(expiry);
      await extractCachedUpload(
        bytes,
        "scan.pdf",
        { ...ctx, ownerId: anotherOwner },
        model,
      );
      expect(calls).toBe(5);
      await ref.update({ expiresAt: Timestamp.fromMillis(0) });
      await extractCachedUpload(bytes, "scan.pdf", context, model);
      expect(calls).toBe(7);
      expect((await ref.get()).get("expiresAt").toMillis()).toBeGreaterThan(
        Date.now(),
      );
    } finally {
      await Promise.all([ref.delete(), otherRef.delete()]);
    }
  });
  it("prevents concurrent extraction and rejects checkpoints from replaced leases", async () => {
    const ownerId = randomUUID();
    const key = randomUUID();
    const ref = database().collection("extraction_cache").doc(key);
    const sources = [
      {
        id: "p1",
        label: "Page 1",
        text: "A clear explanation of how energy is stored and transferred.",
        warnings: [],
      },
    ];
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withExtractionCache(ownerId, key, async (progress) => {
      entered();
      await hold;
      await progress.checkpoint(sources);
      return sources;
    });
    // Observe rejection before releasing the lease, avoiding an unhandled promise.
    const failed = expect(first).rejects.toMatchObject({
      code: "STALE_REQUEST",
    });
    try {
      await ready;
      await expect(
        withExtractionCache(ownerId, key, async () => sources),
      ).rejects.toMatchObject({ code: "BUSY" });
      await ref.update({ token: "replacement", status: "running" });
      release();
      await failed;
      expect((await ref.get()).get("status")).toBe("running");
      expect((await ref.get()).get("sources")).toEqual([]);
      await ref.update({ until: 0 });
      expect(
        await withExtractionCache(ownerId, key, async () => sources),
      ).toEqual(sources);
    } finally {
      release();
      await first.catch(() => {});
      await ref.delete();
    }
  });
  it("sends one sketch inline, preserves retries, and protects lightweight image history", async () => {
    const { id } = await setup();
    const input = {
      operationId: randomUUID(),
      revision: 0,
      text: "The same weights are reused at each position because the filter slides without relearning its coefficients.",
      board: {
        version: 2 as const,
        inputs: {},
        state: sketchFixture,
        png: pngFixture().toString("base64"),
      },
    };
    let calls = 0;
    const model: Model = {
      async generate(schema, _system, data, _context, media) {
        calls++;
        expect(media).toEqual([
          {
            mimeType: "image/png",
            data: pngFixture(),
            messageId: input.operationId,
          },
        ]);
        expect(JSON.stringify(data)).not.toContain('"png"');
        const messages = (data as { messages: Message[] }).messages;
        if (calls === 1)
          throw new AppError("MODEL_FAILURE", "Please retry.", 502);
        return schema.parse(replyFixture(messages.at(-1)!));
      },
    };
    await expect(submitTurn(id, input, ctx, model)).rejects.toMatchObject({
      code: "MODEL_FAILURE",
    });
    expect(await readMessages(id)).toHaveLength(1);
    await submitTurn(id, input, ctx, model);
    await submitTurn(id, input, ctx, model);
    expect(calls).toBe(2);
    const history = await publicSession(id, ctx.ownerId);
    const shared = history.messages.find((m) => m.id === input.operationId)!;
    expect(shared.board).not.toHaveProperty("png");
    expect(shared.board).toHaveProperty(
      "imageUrl",
      `/api/sessions/${id}/messages/${input.operationId}/board-image`,
    );
    expect(await readBoardImage(id, input.operationId, ctx.ownerId)).toEqual(
      pngFixture(),
    );
    await expect(
      readBoardImage(id, input.operationId, "another-owner"),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await database()
      .collection("sessions")
      .doc(id)
      .update({ phase: "transfer" });
    await expect(
      readBoardImage(id, input.operationId, ctx.ownerId),
    ).rejects.toMatchObject({ code: "ASSESSMENT_ACTIVE" });
    await database()
      .collection("sessions")
      .doc(id)
      .update({ expiresAt: Timestamp.fromMillis(0) });
    await expect(
      readBoardImage(id, input.operationId, ctx.ownerId),
    ).rejects.toMatchObject({ code: "EXPIRED" });
  });
  afterAll(async () => {
    for (const id of cleanup)
      await database().recursiveDelete(
        database().collection("sessions").doc(id),
      );
    await database().terminate();
  });
  it.each(["zh-CN", "ja"] as const)(
    "persists %s through preparation, hints, chat, transfer, report and history",
    async (locale) => {
      const generated = lessonFixture();
      const materialId = randomUUID();
      const lessonId = randomUUID();
      const id = randomUUID();
      cleanup.push(id);
      await saveMaterial(materialId, ctx.ownerId, "Notes", generated.sources);
      const calls: string[] = [];
      const model: Model = {
        async generate(schema, system, data) {
          expect(system).toContain(
            locale === "ja" ? "Use Japanese" : "Use Simplified Chinese",
          );
          const input = data as {
            teachingLanguage: string;
            messages?: Message[];
            skipped?: boolean;
          };
          expect(input.teachingLanguage).toBe(locale);
          if (!input.messages) {
            calls.push("prepare");
            return schema.parse(generated);
          }
          const teaching = input.messages.find(
            (m) => m.role === "learner" && m.kind === "teaching",
          )!;
          if ("skipped" in input) {
            calls.push("report");
            return schema.parse(
              reportFixture(
                teaching,
                input.messages.find((m) => m.kind === "transfer"),
              ),
            );
          }
          calls.push("student");
          return schema.parse({
            ...replyFixture(teaching, true),
            studentMessage:
              locale === "ja"
                ? "仕組みがわかってきたよ。"
                : "我理解这个机制了。",
          });
        },
      };
      await prepareLesson(
        lessonId,
        {
          operationId: lessonId,
          materialId,
          topic: "Constant speed",
          level: "introductory",
          sources: generated.sources,
          teachingLanguage: locale,
        },
        ctx,
        model,
      );
      const saved = await readOwned<Lesson>("lessons", lessonId, ctx.ownerId);
      expect(saved.teachingLanguage).toBe(locale);
      expect(saved.board).toEqual(boardFixture());
      expect(saved.transfer).toEqual(generated.transfer);
      await createSession(id, lessonId, ctx.ownerId);
      let session = await publicSession(id, ctx.ownerId);
      expect(session.lesson.teachingLanguage).toBe(locale);
      expect(
        session.messages[0].text.startsWith(translate(locale, "Hi!")),
      ).toBe(true);
      await sessionAction(
        id,
        {
          operationId: randomUUID(),
          revision: session.revision,
          action: "hint",
        },
        ctx,
        model,
      );
      session = await publicSession(id, ctx.ownerId);
      expect(session.messages.at(-1)!.text).toBe(
        translate(
          locale,
          "Could you pick one small example, walk me through what happens, and explain why each step follows? Start with the part you feel most sure about.",
        ),
      );
      const text =
        locale === "ja"
          ? "距離は速さと時間のかけ算なので、時間が2倍になると距離も2倍になります。"
          : "距离等于速度乘以时间，所以时间加倍时距离也加倍。";
      await submitTurn(
        id,
        { operationId: randomUUID(), revision: session.revision, text },
        ctx,
        model,
      );
      session = await publicSession(id, ctx.ownerId);
      expect(session.phase).toBe("ready_for_check");
      expect(session.messages.at(-1)!.text).toBe(
        translate(
          locale,
          "Your explanation has helped me connect the key ideas. Would you like to try a new example on your own, or keep teaching me?",
        ),
      );
      await sessionAction(
        id,
        {
          operationId: randomUUID(),
          revision: session.revision,
          action: "start_transfer",
        },
        ctx,
        model,
      );
      session = await publicSession(id, ctx.ownerId);
      expect(session.transferQuestion).toBe(saved.transfer.question);
      await submitTransfer(
        id,
        {
          operationId: randomUUID(),
          revision: session.revision,
          answer: text,
          skip: false,
          answers: { distance: 150 },
        },
        ctx,
        model,
      );
      session = await publicSession(id, ctx.ownerId);
      expect(session.report!.total).toBe(10);
      expect(session.report!.scores.accuracy.citations[0].quote).toBe(text);
      expect(session.report!.expectedTransferExplanation).toBe(
        saved.transfer.expected,
      );
      expect(calls).toEqual(["prepare", "student", "report"]);
      vi.mocked(getAuthenticatedUser).mockResolvedValue({
        id: ctx.ownerId,
        email: "locale@example.test",
        name: "Learner",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
      const history = (await (
        await sessionHistory(new Request("http://127.0.0.1/api/sessions"))
      ).json()) as SessionHistoryPage;
      expect(history.sessions.find((s) => s.id === id)?.teachingLanguage).toBe(
        locale,
      );
      await database().collection("lessons").doc(lessonId).delete();
      await database().collection("materials").doc(materialId).delete();
    },
  );
  it.each(["zh-CN", "ja"] as const)(
    "keeps %s in board repair and fallback",
    async (locale) => {
      const generated = {
        ...lessonFixture(),
        title: "A source-grounded concept",
        board: { ...boardFixture(), code: "invalid" },
      };
      const materialId = randomUUID();
      const id = randomUUID();
      await saveMaterial(materialId, ctx.ownerId, "Notes", generated.sources);
      let calls = 0;
      const model: Model = {
        async generate(schema, system, data) {
          calls++;
          expect(system).toContain(
            locale === "ja" ? "Use Japanese" : "Use Simplified Chinese",
          );
          if (calls === 1) return schema.parse(generated);
          expect(system).toContain("Repair the supplied board");
          expect(
            (data as { diagnostics: string[] }).diagnostics.join("\n"),
          ).toContain("calculate()");
          throw new Error("Repair unavailable");
        },
      };
      await prepareLesson(
        id,
        {
          operationId: id,
          materialId,
          topic: "concept",
          level: "introductory",
          sources: generated.sources,
          teachingLanguage: locale,
        },
        ctx,
        model,
      );
      expect(calls).toBe(2);
      expect(
        (await readOwned<Lesson>("lessons", id, ctx.ownerId)).board,
      ).toEqual(exampleBoard("A source-grounded concept", locale));
      await expect(
        prepareLesson(
          id,
          {
            operationId: id,
            materialId,
            topic: "concept",
            level: "introductory",
            sources: generated.sources,
            teachingLanguage: "en",
          },
          ctx,
          model,
        ),
      ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
      await database().collection("lessons").doc(id).delete();
      await database().collection("materials").doc(materialId).delete();
    },
  );
  it("completes the golden path and protects the unseen task", async () => {
    const { id } = await setup();
    let studentCalls = 0;
    let reportCalls = 0;
    const model: Model = {
      async generate(schema, _system, data) {
        const input = data as { messages: Message[]; skipped?: boolean };
        if ("skipped" in input) {
          reportCalls++;
          return schema.parse(
            reportFixture(
              input.messages.find(
                (m) => m.role === "learner" && m.kind === "teaching",
              )!,
              input.messages.find((m) => m.kind === "transfer"),
            ),
          );
        }
        studentCalls++;
        return schema.parse(replyFixture(input.messages.at(-1)!, true));
      },
    };
    const initial = await publicSession(id, ctx.ownerId);
    expect(initial.phase).toBe("baseline");
    expect(initial.transferQuestion).toBeUndefined();
    expect(JSON.stringify(initial)).not.toContain("misconceptionCorrection");
    expect(JSON.stringify(initial)).not.toContain("6 × 25");
    expect(JSON.stringify(initial)).not.toContain("tolerance");
    const op = randomUUID();
    const turn = {
      operationId: op,
      revision: 0,
      text: "Distance is speed times time, so at 20 m/s for 10 s the board shows 200 m; doubling either one doubles the distance.",
      board: {
        version: 3 as const,
        state: { speed: 20 },
        composites: {},
      },
    };
    await submitTurn(id, turn, ctx, model);
    await submitTurn(id, turn, ctx, model);
    expect(studentCalls).toBe(1);
    const stored = await readMessages(id);
    expect(stored.length).toBe(3);
    expect(stored.find((m) => m.id === op)?.board).toMatchObject({
      kind: "board",
      verified: true,
      metrics: { distance: 200 },
    });
    const ready = await publicSession(id, ctx.ownerId);
    expect(ready.phase).toBe("ready_for_check");
    await sessionAction(
      id,
      { operationId: randomUUID(), revision: 1, action: "start_transfer" },
      ctx,
      model,
    );
    const check = await publicSession(id, ctx.ownerId);
    expect(check.board).toBeUndefined();
    expect(check.messages).toEqual([]);
    expect(check.transferQuestion).toContain("6 m/s");
    expect(check.numericFields).toEqual([
      { id: "distance", label: "Distance", unit: "m" },
    ]);
    const transfer = {
      operationId: randomUUID(),
      revision: 2,
      answer:
        "6 × 25 = 150 m, and riding twice as long doubles it to 300 m because distance is proportional to time.",
      answers: { distance: 150 },
      skip: false,
    };
    await expect(
      submitTransfer(
        id,
        { ...transfer, operationId: randomUUID(), answers: undefined },
        ctx,
        model,
      ),
    ).rejects.toMatchObject({ code: "NUMBERS_REQUIRED" });
    await submitTransfer(id, transfer, ctx, model);
    await submitTransfer(id, transfer, ctx, model);
    expect(reportCalls).toBe(1);
    const final = await publicSession(id, ctx.ownerId);
    expect(final.phase).toBe("report");
    expect(final.report?.total).toBe(10);
    await expect(
      submitTurn(
        id,
        { ...turn, operationId: randomUUID(), revision: 3 },
        ctx,
        model,
      ),
    ).rejects.toMatchObject({ code: "WRONG_PHASE" });
  });
  it("prevents concurrent model calls and stores exactly one committed turn", async () => {
    const { id } = await setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let started!: () => void;
    const entered = new Promise<void>((r) => (started = r));
    let calls = 0;
    const model: Model = {
      async generate(schema, _s, data) {
        calls++;
        started();
        await gate;
        return schema.parse(
          replyFixture((data as { messages: Message[] }).messages.at(-1)!),
        );
      },
    };
    const first = submitTurn(
      id,
      {
        operationId: randomUUID(),
        revision: 0,
        text: "Filters reuse weights.",
      },
      ctx,
      model,
    );
    await entered;
    await expect(
      submitTurn(
        id,
        {
          operationId: randomUUID(),
          revision: 0,
          text: "My second rapid tap.",
        },
        ctx,
        model,
      ),
    ).rejects.toMatchObject({ code: "BUSY" });
    release();
    await first;
    expect(calls).toBe(1);
    expect((await readMessages(id)).length).toBe(3);
  });
  it("retries failed generation without advancing or duplicating the learner", async () => {
    const { id } = await setup();
    const input = {
      operationId: randomUUID(),
      revision: 0,
      text: "Filters reuse weights.",
    };
    let calls = 0;
    const model: Model = {
      async generate(schema, _s, data) {
        if (calls++ === 0)
          throw new AppError("MODEL_FAILURE", "Temporary failure", 502);
        return schema.parse(
          replyFixture((data as { messages: Message[] }).messages.at(-1)!),
        );
      },
    };
    await expect(submitTurn(id, input, ctx, model)).rejects.toThrow(
      "Temporary failure",
    );
    expect((await publicSession(id, ctx.ownerId)).phase).toBe("baseline");
    expect((await readMessages(id)).length).toBe(1);
    await submitTurn(id, input, ctx, model);
    expect((await readMessages(id)).length).toBe(3);
  });
  it("rejects missing ownership, expired sessions, stale revisions, and changed retry payloads", async () => {
    const { id } = await setup();
    await expect(publicSession(id, "another-owner")).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const operationId = randomUUID();
    await sessionAction(id, { operationId, revision: 0, action: "hint" }, ctx);
    await expect(
      sessionAction(id, { operationId, revision: 0, action: "continue" }, ctx),
    ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
    await expect(
      sessionAction(
        id,
        { operationId: randomUUID(), revision: 0, action: "continue" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "STALE_SESSION" });
    await database()
      .collection("sessions")
      .doc(id)
      .update({ expiresAt: new Date(0) });
    await expect(publicSession(id, ctx.ownerId)).rejects.toMatchObject({
      code: "EXPIRED",
    });
  });
  it("recovers an expired lease and refuses a second hint", async () => {
    const { id } = await setup();
    await database()
      .collection("sessions")
      .doc(id)
      .update({
        activeOperation: {
          id: randomUUID(),
          token: randomUUID(),
          until: Date.now() - 1000,
        },
      });
    await sessionAction(
      id,
      { operationId: randomUUID(), revision: 0, action: "hint" },
      ctx,
    );
    await expect(
      sessionAction(
        id,
        { operationId: randomUUID(), revision: 1, action: "hint" },
        ctx,
      ),
    ).rejects.toMatchObject({ code: "HINT_USED" });
  });
  it("supports manual incomplete reports with no fabricated transfer score", async () => {
    const { id } = await setup();
    const model: Model = {
      async generate(schema) {
        const fake = {
          id: randomUUID(),
          role: "learner" as const,
          text: "Not actually in the history",
          createdAt: "",
          sequence: 0,
        };
        return schema.parse(reportFixture(fake));
      },
    };
    await sessionAction(
      id,
      { operationId: randomUUID(), revision: 0, action: "end" },
      ctx,
      model,
    );
    const report = (await publicSession(id, ctx.ownerId)).report!;
    expect(report.total).toBeNull();
    expect(report.availablePoints).toBe(0);
    expect(report.strengths).toEqual([]);
    expect(report.scores.transfer.score).toBeNull();
  });
  it("pauses at a usage limit without mutating session state", async () => {
    const { id } = await setup();
    const context = { ownerId: randomUUID(), network: randomUUID() };
    const before = await readOwned<Session>("sessions", id, ctx.ownerId);
    const old = process.env.MODEL_CALLS_PER_GUEST_DAY;
    process.env.MODEL_CALLS_PER_GUEST_DAY = "1";
    try {
      await reserveModelCall(context);
      await expect(reserveModelCall(context)).rejects.toMatchObject({
        code: "USAGE_LIMIT",
      });
    } finally {
      if (old === undefined) delete process.env.MODEL_CALLS_PER_GUEST_DAY;
      else process.env.MODEL_CALLS_PER_GUEST_DAY = old;
    }
    expect(
      (await readOwned<Session>("sessions", id, ctx.ownerId)).revision,
    ).toBe(before.revision);
  });
  it("cannot overwrite another guest's extracted material by reusing its ID", async () => {
    const id = randomUUID();
    const sources = [
      {
        id: "s1",
        label: "Notes",
        text: "The original learner's material.",
        warnings: [],
      },
    ];
    await saveMaterial(id, ctx.ownerId, "Original", sources);
    try {
      await expect(
        saveMaterial(id, "another-owner", "Replacement", sources),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
      expect(
        (await database().collection("materials").doc(id).get()).data()?.name,
      ).toBe("Original");
    } finally {
      await database().collection("materials").doc(id).delete();
    }
  });
  it("returns only active owned history in newest-first order with existing summaries", async () => {
    const ownerId = randomUUID();
    const lesson = { ...lessonFixture(), ownerId };
    lesson.sources[0].text = "s".repeat(50_000);
    lesson.knowledge = "k".repeat(7_000);
    lesson.board.code = "// unused history payload\n".repeat(400);
    const now = Timestamp.now();
    const older = {
      ...sessionFixture(lesson),
      updatedAt: new Date(now.toMillis() - 60_000).toISOString(),
    };
    older.ledger.evidence = [
      { objectiveId: "o1", understanding: "supported", citations: [] },
    ];
    older.ledger.summary = "summary ".repeat(250);
    older.report = {
      ...reportFixture(messageFixture()),
      total: null,
      availablePoints: 0,
      earnedPoints: 0,
      overallLabel: "incomplete",
      expectedTransferExplanation: "e".repeat(2_000),
      transferCorrect: null,
    };
    const newer = {
      ...sessionFixture(lesson),
      updatedAt: now.toDate().toISOString(),
    };
    // Expiry order deliberately differs from history's updatedAt order.
    older.expiresAt = new Date(now.toMillis() + 120_000).toISOString();
    newer.expiresAt = new Date(now.toMillis() + 60_000).toISOString();
    const expired = {
      ...sessionFixture(lesson),
      expiresAt: new Date(0).toISOString(),
    };
    const expiresNow = {
      ...sessionFixture(lesson),
      expiresAt: now.toDate().toISOString(),
    };
    const otherOwner = { ...sessionFixture(lesson), ownerId: randomUUID() };
    const missingLesson = {
      ...sessionFixture(lesson),
      lessonId: randomUUID(),
      updatedAt: new Date(now.toMillis() - 120_000).toISOString(),
    };
    const sessions = [
      older,
      newer,
      expired,
      expiresNow,
      otherOwner,
      missingLesson,
    ];
    const f = database();
    const lessonRef = f.collection("lessons").doc(lesson.id);
    const refs = sessions.map((s) => f.collection("sessions").doc(s.id));
    const batch = f.batch();
    batch.create(lessonRef, encode(lesson));
    sessions.forEach((s, i) => batch.create(refs[i], encode(s)));
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: ownerId,
      email: "history@example.test",
      name: "History Learner",
      createdAt: now.toDate().toISOString(),
      updatedAt: now.toDate().toISOString(),
    });
    const clock = vi.spyOn(Timestamp, "now").mockReturnValue(now);
    let queryRead: ReturnType<typeof vi.spyOn> | undefined;
    let lessonRead: ReturnType<typeof vi.spyOn> | undefined;
    try {
      await batch.commit();
      const fullSessions = await f.getAll(refs[0], refs[1], refs[5]);
      const fullLessons = await f.getAll(
        lessonRef,
        lessonRef,
        f.collection("lessons").doc(missingLesson.lessonId),
      );
      const snapshotBytes = (rows: unknown[]) =>
        Buffer.byteLength(JSON.stringify(rows));
      const fullBytes = snapshotBytes([
        ...fullSessions.map((d) => d.data()),
        ...fullLessons.map((d) => d.data()),
      ]);
      let projectedSessions: Record<string, unknown>[] = [];
      let projectedLessons: (Record<string, unknown> | undefined)[] = [];
      const originalQueryGet = Query.prototype.get;
      queryRead = vi
        .spyOn(Query.prototype, "get")
        .mockImplementation(async function (this: Query) {
          const docs = await originalQueryGet.call(this);
          projectedSessions = docs.docs.map((d) => d.data());
          return docs;
        });
      const originalGetAll = f.getAll.bind(f);
      const lessonSpy = vi
        .spyOn(f, "getAll")
        .mockImplementation(async (...args) => {
          const docs = await originalGetAll(...args);
          projectedLessons = docs.map((d) => d.data());
          return docs;
        });
      lessonRead = lessonSpy;
      const response = await sessionHistory(
        new Request("http://localhost/api/sessions"),
      );
      expect(response.status).toBe(200);
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      const body = await response.json();
      expect(body.sessions.map((s: { id: string }) => s.id)).toEqual([
        newer.id,
        older.id,
        missingLesson.id,
      ]);
      expect(body.sessions[1]).toEqual({
        id: older.id,
        title: lesson.title,
        scope: lesson.scope,
        level: lesson.level,
        phase: older.phase,
        teachingLanguage: "en",
        createdAt: older.createdAt,
        updatedAt: older.updatedAt,
        expiresAt: older.expiresAt,
        progress: lesson.objectives.map((o, i) => ({
          id: o.id,
          label: o.label,
          status: i === 0 ? "supported" : "missing",
        })),
      });
      expect(body.sessions[2]).toMatchObject({
        title: "Untitled Lesson",
        scope: "",
        level: "introductory",
        progress: [],
      });
      expect(lessonSpy).toHaveBeenCalledTimes(1);
      const lessonArgs = lessonSpy.mock.calls[0];
      expect(lessonArgs.slice(0, -1)).toEqual([
        lessonRef,
        f.collection("lessons").doc(missingLesson.lessonId),
      ]);
      for (const row of projectedSessions) {
        expect(Object.keys(row).sort()).toEqual(
          [
            "id",
            "lessonId",
            "phase",
            "createdAt",
            "updatedAt",
            "expiresAt",
            "ledger",
          ].sort(),
        );
        expect(Object.keys(row.ledger as object)).toEqual(["evidence"]);
      }
      const projectedLesson = projectedLessons.find(
        (row) => row !== undefined,
      )!;
      expect(Object.keys(projectedLesson).sort()).toEqual([
        "level",
        "objectives",
        "scope",
        "title",
      ]);
      const projectedBytes = snapshotBytes([
        ...projectedSessions,
        ...projectedLessons,
      ]);
      expect(projectedBytes).toBeLessThan(fullBytes / 10);
      console.info("History serialized snapshot payload (large fixture)", {
        fullBytes,
        projectedBytes,
        lessonReadsBefore: fullLessons.length,
        lessonReadsAfter: projectedLessons.length,
      });
    } finally {
      queryRead?.mockRestore();
      lessonRead?.mockRestore();
      clock.mockRestore();
      vi.mocked(getAuthenticatedUser).mockReset();
      await Promise.all([lessonRef, ...refs].map((ref) => ref.delete()));
    }
  });
  it("returns empty history when an owner has no active sessions", async () => {
    const lessonRead = vi.spyOn(database(), "getAll");
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: randomUUID(),
      email: "empty@example.test",
      name: "New Learner",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    try {
      const response = await sessionHistory(
        new Request("http://localhost/api/sessions"),
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ sessions: [] });
      expect(lessonRead).not.toHaveBeenCalled();
    } finally {
      lessonRead.mockRestore();
      vi.mocked(getAuthenticatedUser).mockReset();
    }
  });
  it("bounds history pages, resolves timestamp ties, and continues after a deleted cursor document", async () => {
    const ownerId = randomUUID();
    const lesson = { ...lessonFixture(), ownerId };
    const now = Timestamp.now();
    const sessions = Array.from({ length: 45 }, (_, i) => ({
      ...sessionFixture(lesson),
      updatedAt: new Date(
        now.toMillis() - Math.floor(i / 15) * 60_000,
      ).toISOString(),
      expiresAt: new Date(
        now.toMillis() + 120_000 + (i % 2) * 1000,
      ).toISOString(),
    }));
    const expected = [...sessions].sort(
      (a, b) =>
        b.updatedAt.localeCompare(a.updatedAt) ||
        a.expiresAt.localeCompare(b.expiresAt) ||
        a.id.localeCompare(b.id),
    );
    const otherOwner = {
      ...sessionFixture(lesson),
      ownerId: randomUUID(),
      updatedAt: new Date(0).toISOString(),
    };
    const expired = {
      ...sessionFixture(lesson),
      expiresAt: now.toDate().toISOString(),
    };
    const f = database();
    const lessonRef = f.collection("lessons").doc(lesson.id);
    const refs = [...sessions, otherOwner, expired].map((s) =>
      f.collection("sessions").doc(s.id),
    );
    const batch = f.batch();
    batch.create(lessonRef, encode(lesson));
    [...sessions, otherOwner, expired].forEach((s, i) =>
      batch.create(refs[i], encode(s)),
    );
    const user = {
      id: ownerId,
      email: "pages@example.test",
      name: "Pages",
      createdAt: now.toDate().toISOString(),
      updatedAt: now.toDate().toISOString(),
    };
    vi.mocked(getAuthenticatedUser).mockResolvedValue(user);
    const clock = vi.spyOn(Timestamp, "now").mockReturnValue(now);
    const originalGet = Query.prototype.get;
    const sizes: number[] = [];
    const queryRead = vi
      .spyOn(Query.prototype, "get")
      .mockImplementation(async function (this: Query) {
        const snapshot = await originalGet.call(this);
        sizes.push(snapshot.size);
        return snapshot;
      });
    const lessonRead = vi.spyOn(f, "getAll");
    async function page(cursor?: string): Promise<SessionHistoryPage> {
      const response = await sessionHistory(
        new Request(
          `http://localhost/api/sessions${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
        ),
      );
      expect(response.status).toBe(200);
      return response.json();
    }
    try {
      await batch.commit();
      const first = await page();
      expect(first.sessions.map((s) => s.id)).toEqual(
        expected.slice(0, 20).map((s) => s.id),
      );
      expect(first.nextCursor).toEqual(expect.any(String));
      expect(lessonRead.mock.calls[0].slice(0, -1)).toEqual([lessonRef]);
      await f.collection("sessions").doc(first.sessions.at(-1)!.id).delete();
      const second = await page(first.nextCursor);
      const third = await page(second.nextCursor);
      expect(second.sessions).toHaveLength(20);
      expect(third.sessions).toHaveLength(5);
      expect(third.nextCursor).toBeUndefined();
      const all = [...first.sessions, ...second.sessions, ...third.sessions];
      expect(all.map((s) => s.id)).toEqual(expected.map((s) => s.id));
      expect(new Set(all.map((s) => s.id)).size).toBe(45);
      expect(sizes).toEqual([21, 21, 5]);
      expect(lessonRead).toHaveBeenCalledTimes(3);

      // A cursor is a position, never authorization for its original owner.
      vi.mocked(getAuthenticatedUser).mockResolvedValue({
        ...user,
        id: otherOwner.ownerId,
      });
      const foreignCursorPage = await page(first.nextCursor);
      expect(foreignCursorPage.sessions.map((s) => s.id)).toEqual([
        otherOwner.id,
      ]);
      vi.mocked(getAuthenticatedUser).mockResolvedValue(user);
      await Promise.all(
        expected
          .slice(20)
          .map((s) => f.collection("sessions").doc(s.id).delete()),
      );
      const last = await page();
      expect(last.sessions).toHaveLength(19);
      expect(last.nextCursor).toBeUndefined();
    } finally {
      queryRead.mockRestore();
      lessonRead.mockRestore();
      clock.mockRestore();
      vi.mocked(getAuthenticatedUser).mockReset();
      await Promise.all([lessonRef, ...refs].map((ref) => ref.delete()));
    }
  });
  it("rechecks expiry between history pages and omits cursors at the exact page boundary", async () => {
    const ownerId = randomUUID();
    const lesson = { ...lessonFixture(), ownerId };
    const now = Timestamp.now();
    const sessions = Array.from({ length: 21 }, (_, i) => ({
      ...sessionFixture(lesson),
      lessonId: randomUUID(),
      updatedAt: new Date(now.toMillis() - i * 1000).toISOString(),
      expiresAt: new Date(
        now.toMillis() + (i === 20 ? 1000 : 120_000),
      ).toISOString(),
    }));
    const f = database();
    const refs = sessions.map((s) => f.collection("sessions").doc(s.id));
    const batch = f.batch();
    sessions.forEach((s, i) => batch.create(refs[i], encode(s)));
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: ownerId,
      email: "expiry@example.test",
      name: "Expiry",
      createdAt: now.toDate().toISOString(),
      updatedAt: now.toDate().toISOString(),
    });
    const clock = vi.spyOn(Timestamp, "now").mockReturnValue(now);
    const lessonRead = vi.spyOn(f, "getAll");
    try {
      await batch.commit();
      const first = await sessionHistory(
        new Request("http://localhost/api/sessions"),
      );
      expect(first.status).toBe(200);
      const firstPage: SessionHistoryPage = await first.json();
      expect(firstPage.sessions).toHaveLength(20);
      expect(firstPage.nextCursor).toEqual(expect.any(String));
      expect(lessonRead.mock.calls[0].slice(0, -1)).toEqual(
        sessions
          .slice(0, 20)
          .map((s) => f.collection("lessons").doc(s.lessonId)),
      );
      expect(
        firstPage.sessions.every(
          (s) => s.title === "Untitled Lesson" && s.progress.length === 0,
        ),
      ).toBe(true);
      clock.mockReturnValue(Timestamp.fromMillis(now.toMillis() + 1000));
      const next = await sessionHistory(
        new Request(
          `http://localhost/api/sessions?cursor=${firstPage.nextCursor}`,
        ),
      );
      expect(next.status).toBe(200);
      expect(await next.json()).toEqual({ sessions: [] });
      expect(lessonRead).toHaveBeenCalledTimes(1);
      const refreshed = await sessionHistory(
        new Request("http://localhost/api/sessions"),
      );
      expect(refreshed.status).toBe(200);
      const last: SessionHistoryPage = await refreshed.json();
      expect(last.sessions).toHaveLength(20);
      expect(last.nextCursor).toBeUndefined();
    } finally {
      lessonRead.mockRestore();
      clock.mockRestore();
      vi.mocked(getAuthenticatedUser).mockReset();
      await Promise.all(refs.map((ref) => ref.delete()));
    }
  });
  it("paginates messages by sequence without duplicates or skipped messages", async () => {
    const { id } = await setup();
    const ref = database().collection("sessions").doc(id);
    const session = await readOwned<Session>("sessions", id, ctx.ownerId);
    const batch = database().batch();
    for (let sequence = 1; sequence <= 5; sequence++) {
      const message: Message = {
        id: randomUUID(),
        role: "learner",
        text: `Message ${sequence}`,
        sequence,
        createdAt: new Date().toISOString(),
      };
      batch.create(
        ref.collection("messages").doc(message.id),
        encode({ ...message, expiresAt: session.expiresAt }),
      );
    }
    await batch.commit();
    const newest = await readMessages(id, 2);
    expect(newest.map((m) => m.sequence)).toEqual([4, 5]);
    const middle = await readMessages(id, 2, newest[0].sequence);
    expect(middle.map((m) => m.sequence)).toEqual([2, 3]);
    const oldest = await readMessages(id, 2, middle[0].sequence);
    expect(oldest.map((m) => m.sequence)).toEqual([0, 1]);
    expect(await readMessages(id, 2, oldest[0].sequence)).toEqual([]);
  });
  it("cleans expired authentication records across batches and recursively deletes expired sessions", async () => {
    // Run the real CLI against an isolated emulator project, never dev records.
    const projectId = "demo-teachback-cleanup";
    const app = initializeApp({ projectId }, `cleanup-${randomUUID()}`);
    const f = getFirestore(app);
    const user = f.collection("users").doc(randomUUID());
    const active = f.collection("user_sessions").doc(randomUUID());
    const expired = Array.from({ length: 101 }, () =>
      f.collection("user_sessions").doc(randomUUID()),
    );
    const session = f.collection("sessions").doc(randomUUID());
    const message = session.collection("messages").doc(randomUUID());
    const operation = session.collection("operations").doc(randomUUID());
    const expiredExtraction = f
      .collection("extraction_cache")
      .doc(randomUUID());
    const activeExtraction = f.collection("extraction_cache").doc(randomUUID());
    const future = Timestamp.fromMillis(Date.now() + 30 * 86_400_000);
    const batch = f.batch();
    batch.create(user, { id: user.id, email: "cleanup@example.test" });
    batch.create(active, { userId: user.id, expiresAt: future });
    expired.forEach((ref) =>
      batch.create(ref, {
        userId: user.id,
        expiresAt: Timestamp.fromMillis(0),
      }),
    );
    batch.create(session, { expiresAt: Timestamp.fromMillis(0) });
    batch.create(message, { text: "Expired parent", expiresAt: future });
    batch.create(operation, { status: "complete", expiresAt: future });
    batch.create(expiredExtraction, {
      sources: [],
      expiresAt: Timestamp.fromMillis(0),
    });
    batch.create(activeExtraction, { sources: [], expiresAt: future });
    try {
      await batch.commit();
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ["scripts/cleanup.mjs"],
        {
          env: {
            ...process.env,
            GOOGLE_CLOUD_PROJECT: projectId,
            FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST!,
          },
          timeout: 25_000,
        },
      );
      expect(stdout).toContain("user_sessions: removed 101 expired records");
      expect(stdout).toContain("extraction_cache: removed 1 expired records");
      expect((await expiredExtraction.get()).exists).toBe(false);
      expect((await activeExtraction.get()).exists).toBe(true);
      expect(stdout).toMatch(/sessions: removed [1-9]\d* expired records/);
      expect((await f.getAll(...expired)).every((doc) => !doc.exists)).toBe(
        true,
      );
      expect(
        (await f.getAll(session, message, operation)).every(
          (doc) => !doc.exists,
        ),
      ).toBe(true);
      expect((await active.get()).get("expiresAt").toMillis()).toBe(
        future.toMillis(),
      );
      expect((await user.get()).exists).toBe(true);
    } finally {
      await Promise.all(
        [user, active, expiredExtraction, activeExtraction, ...expired].map(
          (ref) => ref.delete(),
        ),
      );
      await f.recursiveDelete(session);
      await f.terminate();
      await deleteApp(app);
    }
  });
  it("serves new history summaries without lesson joins and keeps legacy fallback", async () => {
    const ownerId = randomUUID();
    const lesson = { ...lessonFixture(), ownerId };
    const id = randomUUID();
    const legacy = { ...sessionFixture(lesson), ownerId };
    const f = database();
    const lessonRef = f.collection("lessons").doc(lesson.id);
    const legacyRef = f.collection("sessions").doc(legacy.id);
    cleanup.push(id, legacy.id);
    await lessonRef.create(encode(lesson));
    await createSession(id, lesson.id, ownerId);
    vi.mocked(getAuthenticatedUser).mockResolvedValue({
      id: ownerId,
      email: "summary@example.test",
      name: "Summary learner",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    const joins = vi.spyOn(f, "getAll");
    try {
      const stored = await readOwned<Session>("sessions", id, ownerId);
      expect(stored.lessonSummary?.objectives).toEqual(
        lesson.objectives.map(({ id, label }) => ({ id, label })),
      );
      joins.mockClear();
      const first = await sessionHistory(
        new Request("http://localhost/api/sessions"),
      );
      expect(first.status).toBe(200);
      expect((await first.json()).sessions).toHaveLength(1);
      expect(joins).not.toHaveBeenCalled();
      await legacyRef.create(encode(legacy));
      const second = await sessionHistory(
        new Request("http://localhost/api/sessions"),
      );
      expect((await second.json()).sessions).toHaveLength(2);
      expect(joins).toHaveBeenCalledTimes(1);
      expect(joins.mock.calls[0].slice(0, -1)).toEqual([lessonRef]);
      console.info("History summary read counts", {
        newSessionLessonReads: 0,
        mixedPageLegacyLessonReads: 1,
      });
    } finally {
      joins.mockRestore();
      vi.mocked(getAuthenticatedUser).mockReset();
      await lessonRef.delete();
    }
  });

  it("returns committed mutation snapshots and unchanged polling without duplicating messages", async () => {
    const { id } = await setup();
    const input = {
      operationId: randomUUID(),
      revision: 0,
      action: "hint" as const,
    };
    const snapshot = await sessionAction(id, input, ctx);
    expect(snapshot.session).toEqual(
      await readOwned<Session>("sessions", id, ctx.ownerId),
    );
    const result = await publicSession(id, ctx.ownerId, snapshot);
    expect(result.revision).toBe(1);
    expect(result.messages).toHaveLength(2);
    const duplicate = await sessionAction(id, input, ctx);
    expect(duplicate.session.revision).toBe(1);
    expect(
      (await publicSession(id, ctx.ownerId, duplicate)).messages,
    ).toHaveLength(2);
    expect(await sessionUpdate(id, ctx.ownerId, 1)).toEqual({
      unchanged: true,
      revision: 1,
      pending: false,
    });
    await expect(sessionUpdate(id, "other-owner", 1)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });

  it("uses lookahead to avoid empty terminal message pages", async () => {
    const { id } = await setup();
    const ref = database().collection("sessions").doc(id);
    const batch = database().batch();
    for (let sequence = 1; sequence <= 30; sequence++)
      batch.create(
        ref.collection("messages").doc(randomUUID()),
        encode({
          ...messageFixture(),
          sequence,
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        }),
      );
    await batch.commit();
    const newest = await readMessagePage(id);
    expect(newest.messages).toHaveLength(30);
    expect(newest.nextCursor).toBe(1);
    const oldest = await readMessagePage(id, newest.nextCursor);
    expect(oldest.messages).toHaveLength(1);
    expect(oldest.messages[0].sequence).toBe(0);
    expect(oldest.nextCursor).toBeUndefined();
  });
});
