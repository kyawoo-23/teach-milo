import { beforeEach, describe, expect, it, vi } from "vitest";
import { database, encode, readOwned } from "@/server/db";
import {
  createSession,
  publicSession,
  readMessagePage,
  sessionUpdate,
} from "@/server/sessions";
import { prepareLesson } from "@/server/lessons";
import { AppError } from "@/lib/errors";
import type { Lesson, Session } from "@/lib/contracts";
import type { Model } from "@/server/model";
import {
  ctx,
  lessonFixture,
  messageFixture,
  replyFixture,
  sessionFixture,
} from "./fixtures";

vi.mock("@/server/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/db")>()),
  database: vi.fn(),
  readOwned: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function mockDatabase() {
  const query = {
    orderBy: vi.fn().mockReturnThis(),
    startAfter: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    get: vi.fn().mockResolvedValue({ docs: [] }),
  };
  const document = {
    get: vi.fn(),
    update: vi.fn().mockResolvedValue(undefined),
    collection: vi.fn().mockReturnValue(query),
  };
  const collection = { doc: vi.fn().mockReturnValue(document) };
  const tx = { get: vi.fn(), update: vi.fn() };
  const f = {
    collection: vi.fn().mockReturnValue(collection),
    batch: vi.fn(),
    runTransaction: vi.fn(async (work) => work(tx)),
  };
  vi.mocked(database).mockReturnValue(
    f as unknown as ReturnType<typeof database>,
  );
  return { f, document, query, tx };
}

beforeEach(() => vi.resetAllMocks());

describe("Session read scheduling", () => {
  it("authorizes the session first, then overlaps lesson and message reads", async () => {
    const { query } = mockDatabase();
    const lesson = lessonFixture();
    const session = sessionFixture(lesson);
    const message = messageFixture();
    const sessionRead = deferred<Session>();
    const lessonRead = deferred<Lesson>();
    const lessonStarted = deferred<void>();
    const messagesRead = deferred<{ docs: { data: () => object }[] }>();
    vi.mocked(readOwned)
      .mockReturnValueOnce(sessionRead.promise)
      .mockImplementationOnce(() => {
        lessonStarted.resolve();
        return lessonRead.promise;
      });
    query.get.mockReturnValue(messagesRead.promise);
    const pending = publicSession(session.id, ctx.ownerId);
    try {
      expect(readOwned).toHaveBeenCalledTimes(1);
      expect(query.get).not.toHaveBeenCalled();
      sessionRead.resolve(session);
      await lessonStarted.promise;
      // Both reads have started while the lesson is still unresolved.
      expect(query.get).toHaveBeenCalledTimes(1);
      expect(readOwned).toHaveBeenNthCalledWith(
        2,
        "lessons",
        lesson.id,
        ctx.ownerId,
      );
      lessonRead.resolve(lesson);
      messagesRead.resolve({ docs: [{ data: () => encode(message) }] });
      expect((await pending).messages).toEqual([message]);
    } finally {
      sessionRead.resolve(session);
      lessonRead.resolve(lesson);
      messagesRead.resolve({ docs: [] });
      await pending.catch(() => {});
    }
  });

  it("does not query teaching messages during transfer", async () => {
    const { query } = mockDatabase();
    const lesson = lessonFixture();
    const session = { ...sessionFixture(lesson), phase: "transfer" as const };
    vi.mocked(readOwned)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(lesson);
    const result = await publicSession(session.id, ctx.ownerId);
    expect(query.get).not.toHaveBeenCalled();
    expect(result.messages).toEqual([]);
    expect(result.board).toBeUndefined();
    expect(result.transferQuestion).toBe(lesson.transfer.question);
  });

  it("includes a history cursor only when an earlier completed message exists", async () => {
    const { query } = mockDatabase();
    const lesson = lessonFixture();
    const session = { ...sessionFixture(lesson), phase: "report" as const };
    const messages = Array.from({ length: 31 }, (_, index) => ({
      ...messageFixture(),
      id: `message-${index}`,
      sequence: index + 19,
    }));
    query.get.mockResolvedValue({
      docs: [...messages]
        .reverse()
        .map((message) => ({ data: () => encode(message) })),
    });
    vi.mocked(readOwned)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(lesson);
    const result = await publicSession(session.id, ctx.ownerId);
    expect(result.messages).toEqual(messages.slice(1));
    expect(result.nextCursor).toBe(20);
    expect(result.board).toBeUndefined();
  });

  it("omits the history cursor when completed history fits on one page", async () => {
    mockDatabase();
    const lesson = lessonFixture();
    const session = { ...sessionFixture(lesson), phase: "report" as const };
    vi.mocked(readOwned)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(lesson);
    expect(
      (await publicSession(session.id, ctx.ownerId)).nextCursor,
    ).toBeUndefined();
  });

  it("starts no dependent reads when session authorization fails", async () => {
    const { query } = mockDatabase();
    const error = new AppError("NOT_FOUND", "Unavailable", 404);
    vi.mocked(readOwned).mockRejectedValueOnce(error);
    await expect(publicSession("missing", ctx.ownerId)).rejects.toBe(error);
    expect(readOwned).toHaveBeenCalledTimes(1);
    expect(query.get).not.toHaveBeenCalled();
  });

  it.each(["lesson", "messages"])(
    "propagates a failed %s read without returning a partial session",
    async (failure) => {
      const { document, query } = mockDatabase();
      const lesson = lessonFixture();
      const session = sessionFixture(lesson);
      const error = new AppError("NOT_FOUND", "Unavailable", 404);
      vi.mocked(readOwned).mockResolvedValueOnce(session);
      if (failure === "lesson")
        vi.mocked(readOwned).mockRejectedValueOnce(error);
      else {
        vi.mocked(readOwned).mockResolvedValueOnce(lesson);
        query.get.mockRejectedValueOnce(error);
      }
      await expect(publicSession(session.id, ctx.ownerId)).rejects.toBe(error);
      expect(document.update).not.toHaveBeenCalled();
    },
  );

  it("still promotes supported teaching evidence before returning the session", async () => {
    const { tx } = mockDatabase();
    const lesson = lessonFixture();
    const session = sessionFixture(lesson);
    session.ledger = replyFixture(messageFixture(), true);
    tx.get.mockResolvedValue({ exists: true, data: () => encode(session) });
    vi.mocked(readOwned)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(lesson);
    const result = await publicSession(session.id, ctx.ownerId);
    expect(result.phase).toBe("ready_for_check");
    expect(result.revision).toBe(session.revision + 1);
    expect(tx.update).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        phase: "ready_for_check",
        revision: result.revision,
      }),
    );
  });
});

describe.each(["sessions", "lessons"])("Existing %s retries", (collection) => {
  function setupRetry() {
    const mocks = mockDatabase();
    const lesson = lessonFixture();
    const session = sessionFixture(lesson);
    const record = collection === "sessions" ? session : lesson;
    mocks.document.get.mockResolvedValue({
      exists: true,
      data: () => encode(record),
    });
    const generate = vi.fn();
    const model: Model = { generate };
    const retry = () =>
      collection === "sessions"
        ? createSession(session.id, lesson.id, ctx.ownerId)
        : prepareLesson(
            lesson.id,
            {
              operationId: lesson.id,
              materialId: lesson.materialId,
              topic: lesson.title,
              level: lesson.level,
              sources: lesson.sources,
            },
            ctx,
            model,
          );
    return { ...mocks, record, retry, generate };
  }

  it("uses one target-document read and does not generate or write again", async () => {
    const { document, f, record, retry, generate } = setupRetry();
    await expect(retry()).resolves.toBe(record.id);
    expect(document.get).toHaveBeenCalledTimes(1);
    expect(readOwned).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(f.batch).not.toHaveBeenCalled();
    expect(document.update).not.toHaveBeenCalled();
  });

  it.each([
    ["wrong owner", "NOT_FOUND"],
    ["expired", "EXPIRED"],
  ])("rejects a %s record from the first snapshot", async (scenario, code) => {
    const { document, record, retry, generate } = setupRetry();
    if (scenario === "wrong owner") record.ownerId = "another-owner";
    else record.expiresAt = new Date(0).toISOString();
    await expect(retry()).rejects.toMatchObject({ code });
    expect(document.get).toHaveBeenCalledTimes(1);
    expect(readOwned).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

it("preserves conflicting lesson detection on a session retry", async () => {
  const { document } = mockDatabase();
  const lesson = lessonFixture();
  const session = sessionFixture(lesson);
  document.get.mockResolvedValue({ exists: true, data: () => encode(session) });
  await expect(
    createSession(session.id, "different-lesson", ctx.ownerId),
  ).rejects.toMatchObject({
    code: "OPERATION_CONFLICT",
  });
  expect(document.get).toHaveBeenCalledTimes(1);
  expect(readOwned).not.toHaveBeenCalled();
});

it("rejects a session retry that asks for a different start mode", async () => {
  const { document } = mockDatabase();
  const lesson = lessonFixture();
  const session = { ...sessionFixture(lesson), mode: "teach" as const };
  document.get.mockResolvedValue({ exists: true, data: () => encode(session) });
  await expect(
    createSession(session.id, lesson.id, ctx.ownerId, "correct"),
  ).rejects.toMatchObject({ code: "OPERATION_CONFLICT" });
  await expect(
    createSession(session.id, lesson.id, ctx.ownerId, "teach"),
  ).resolves.toBe(session.id);
});

describe("Bounded session reads", () => {
  it("checks an unchanged revision with one owned read and no lesson or message query", async () => {
    const { query } = mockDatabase();
    const session = {
      ...sessionFixture(lessonFixture()),
      activeOperation: {
        id: "operation",
        token: "token",
        until: Date.now() + 30000,
      },
    };
    vi.mocked(readOwned).mockResolvedValue(session);
    expect(
      await sessionUpdate(session.id, ctx.ownerId, session.revision),
    ).toEqual({ unchanged: true, revision: session.revision, pending: true });
    expect(readOwned).toHaveBeenCalledTimes(1);
    expect(readOwned).toHaveBeenCalledWith(
      "sessions",
      session.id,
      ctx.ownerId,
      ["revision", "activeOperation"],
    );
    expect(query.get).not.toHaveBeenCalled();
  });
  it("reads a full session only when the revision changes", async () => {
    const { query } = mockDatabase();
    const lesson = lessonFixture();
    const session = { ...sessionFixture(lesson), revision: 2 };
    vi.mocked(readOwned)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(lesson);
    const result = await sessionUpdate(session.id, ctx.ownerId, 1);
    expect(result).toMatchObject({ revision: 2, messages: [] });
    expect(readOwned).toHaveBeenCalledTimes(3);
    expect(query.get).toHaveBeenCalledTimes(1);
  });
  it("returns mutation data without repeating owned session or lesson reads", async () => {
    const { query } = mockDatabase();
    const lesson = lessonFixture();
    const session = sessionFixture(lesson);
    await publicSession(session.id, ctx.ownerId, { session, lesson });
    expect(readOwned).not.toHaveBeenCalled();
    expect(query.get).toHaveBeenCalledTimes(1);
  });
  it("does not let a supplied snapshot bypass ownership", async () => {
    const { query } = mockDatabase();
    const lesson = lessonFixture();
    const session = sessionFixture(lesson);
    await expect(
      publicSession(session.id, "other-owner", { session, lesson }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(query.get).not.toHaveBeenCalled();
  });
  it("uses a cursor and stops exactly at a full last message page", async () => {
    const { query } = mockDatabase();
    const messages = Array.from({ length: 30 }, (_, sequence) => ({
      ...messageFixture(),
      sequence,
    }));
    query.get.mockResolvedValue({
      docs: [...messages]
        .reverse()
        .map((message) => ({ data: () => encode(message) })),
    });
    expect(await readMessagePage("session", 30)).toEqual({ messages });
    expect(query.startAfter).toHaveBeenCalledWith(30);
    expect(query.limit).toHaveBeenCalledWith(31);
  });
  it("does not promote a teaching session while a mutation holds its lock", async () => {
    const { f } = mockDatabase();
    const lesson = lessonFixture();
    const session = sessionFixture(lesson);
    session.ledger = replyFixture(messageFixture(), true);
    session.activeOperation = {
      id: "operation",
      token: "token",
      until: Date.now() + 30000,
    };
    vi.mocked(readOwned)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(lesson);
    expect((await publicSession(session.id, ctx.ownerId)).phase).toBe(
      session.phase,
    );
    expect(f.runTransaction).not.toHaveBeenCalled();
  });
  it("does not overwrite an assessment started concurrently with readiness promotion", async () => {
    const { tx } = mockDatabase();
    const lesson = lessonFixture();
    const session = sessionFixture(lesson);
    session.ledger = replyFixture(messageFixture(), true);
    tx.get.mockResolvedValue({
      exists: true,
      data: () =>
        encode({
          ...session,
          phase: "transfer",
          revision: session.revision + 1,
        }),
    });
    vi.mocked(readOwned)
      .mockResolvedValueOnce(session)
      .mockResolvedValueOnce(lesson);
    const result = await publicSession(session.id, ctx.ownerId);
    expect(result.phase).toBe("transfer");
    expect(result.messages).toEqual([]);
    expect(result.board).toBeUndefined();
    expect(tx.update).not.toHaveBeenCalled();
  });
});
