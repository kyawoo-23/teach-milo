import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { database, encode, readOwned } from "@/server/db";
import {
  createSession,
  publicSession,
  readMessages,
  sessionAction,
  submitTransfer,
  submitTurn,
} from "@/server/sessions";
import { sessionOperation } from "@/server/operations";
import { saveMaterial } from "@/server/materials";
import { reserveModelCall } from "@/server/usage";
import type { Model } from "@/server/model";
import type { Message, Session } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { ctx, lessonFixture, replyFixture, reportFixture } from "./fixtures";

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
  afterAll(async () => {
    for (const id of cleanup)
      await database().recursiveDelete(
        database().collection("sessions").doc(id),
      );
    await database().terminate();
  });
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
    expect(JSON.stringify(initial)).not.toContain("204 parameters");
    const op = randomUUID();
    const turn = {
      operationId: op,
      revision: 0,
      text: "The same filter coefficients are reused at every location. Both sizes have 224 parameters; 194,400 and 830,304 multiplications show that spatial work grows.",
      board: { version: 1 as const, inputs: { inputSize: 64 } },
    };
    await submitTurn(id, turn, ctx, model);
    await submitTurn(id, turn, ctx, model);
    expect(studentCalls).toBe(1);
    expect((await readMessages(id)).length).toBe(3);
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
    expect(check.transferQuestion).toContain("5×5");
    const transfer = {
      operationId: randomUUID(),
      revision: 2,
      answer:
        "There are 204 parameters for both sizes because the same weights are reused. More output positions require more multiplications.",
      parameters: { small: 204, large: 204 },
      skip: false,
    };
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
});
