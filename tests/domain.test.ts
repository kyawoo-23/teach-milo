import { describe, expect, it } from "vitest";
import { convolution } from "@/lib/cnn";
import { finalizeReport } from "@/lib/assessment";
import { allowedMoves, readyForCheck, validateStudent } from "@/lib/controller";
import { validateBoardInputs } from "@/lib/boards";
import { validateCalculation } from "@/lib/custom-code";
import { StudentReplySchema, LessonGeneratedSchema } from "@/lib/contracts";
import { z } from "zod";
import {
  lessonFixture,
  messageFixture,
  replyFixture,
  reportFixture,
  sessionFixture,
} from "./fixtures";

describe("deterministic boards and arithmetic", () => {
  it("keeps weights fixed while spatial work grows", () => {
    expect(convolution(32)).toEqual({
      outputSize: 30,
      weights: 216,
      parameters: 224,
      multiplications: 194400,
    });
    expect(convolution(64)).toEqual({
      outputSize: 62,
      weights: 216,
      parameters: 224,
      multiplications: 830304,
    });
  });
  it("verifies unseen CNN arithmetic", () => {
    expect(convolution(20, 5, 2, 4)).toEqual({
      outputSize: 16,
      weights: 200,
      parameters: 204,
      multiplications: 51200,
    });
    expect(convolution(40, 5, 2, 4)).toEqual({
      outputSize: 36,
      weights: 200,
      parameters: 204,
      multiplications: 259200,
    });
  });
  it("rejects invalid snapshots and derives its own metrics", () => {
    const lesson = lessonFixture();
    expect(() =>
      validateBoardInputs(lesson.board, {
        version: 1,
        inputs: { inputSize: 99 },
      }),
    ).toThrow();
    expect(
      validateBoardInputs(lesson.board, {
        version: 1,
        inputs: { inputSize: 64 },
      }).metrics?.parameters,
    ).toBe(224);
  });
});
describe("server-owned readiness", () => {
  it("requires an interpreted demonstration and complete objective evidence", () => {
    const l = lessonFixture();
    const s = sessionFixture(l);
    const m = messageFixture();
    s.ledger = validateStudent(replyFixture(m, true), s, l, [m]);
    expect(readyForCheck(s, l)).toBe(true);
    s.ledger.demonstration = [];
    expect(readyForCheck(s, l)).toBe(false);
  });
  it("has no turn-count trigger and never forces transfer", () => {
    const l = lessonFixture();
    const s = sessionFixture(l);
    s.nextSequence = 4000;
    expect(readyForCheck(s, l)).toBe(false);
  });
  it("allows only one scripted misconception and respects corrections", () => {
    const l = lessonFixture();
    const s = sessionFixture(l);
    const m = messageFixture();
    s.ledger = validateStudent(replyFixture(m), s, l, [m]);
    expect(allowedMoves(s)).toContain("surface_misconception");
    s.challengeUsed = true;
    expect(allowedMoves(s)).not.toContain("surface_misconception");
    const reply = replyFixture(m);
    reply.move = "surface_misconception";
    expect(() => validateStudent(reply, s, l, [m])).toThrow();
  });
  it("rejects invented citations, multiple questions, and invalid moves", () => {
    const l = lessonFixture();
    const s = sessionFixture(l);
    const m = messageFixture();
    const r = replyFixture(m);
    r.evidence[0].citations[0].quote = "I said something else";
    expect(() => validateStudent(r, s, l, [m])).toThrow();
    const q = replyFixture(m);
    q.studentMessage = "Why? How?";
    expect(() => validateStudent(q, s, l, [m])).toThrow();
    expect(
      StudentReplySchema.safeParse({ ...q, move: "declare_mastery" }).success,
    ).toBe(false);
  });
  it("does not use uncertainty as readiness", () => {
    const l = lessonFixture();
    l.concerns = ["Source contradiction"];
    const s = sessionFixture(l);
    const m = messageFixture();
    s.ledger = validateStudent(replyFixture(m, true), s, l, [m]);
    expect(readyForCheck(s, l)).toBe(false);
  });
});
describe("evidence-based assessment", () => {
  it("only gives a full total for fully evidenced dimensions", () => {
    const l = lessonFixture();
    const m = messageFixture();
    const t = {
      ...messageFixture(
        "There are 204 parameters in both cases because the same kernel coefficients are reused.",
      ),
      kind: "transfer" as const,
    };
    const r = finalizeReport(reportFixture(m, t), l, [m, t], false, {
      small: 204,
      large: 204,
    });
    expect(r.total).toBe(10);
    expect(r.overallLabel).toBe("strong_evidence");
  });
  it("keeps skipped transfer unscored", () => {
    const l = lessonFixture();
    const m = messageFixture();
    const r = finalizeReport(reportFixture(m), l, [m], true);
    expect(r.total).toBeNull();
    expect(r.scores.transfer.status).toBe("insufficient_evidence");
    expect(r.transferCorrect).toBeNull();
  });
  it("does not accept a teaching citation for transfer", () => {
    const l = lessonFixture();
    const m = messageFixture();
    const r = finalizeReport(reportFixture(m, m), l, [m], false, {
      small: 204,
      large: 204,
    });
    expect(r.scores.transfer.score).toBeNull();
  });
  it("caps incorrect verified arithmetic and flags size-dependent counts", () => {
    const l = lessonFixture();
    const m = messageFixture();
    const t = {
      ...messageFixture("A bigger image learns twice as many parameters."),
      kind: "transfer" as const,
    };
    const r = finalizeReport(reportFixture(m, t), l, [m, t], false, {
      small: 204,
      large: 408,
    });
    expect(r.scores.transfer.score).toBe(1);
    expect(r.criticalMisconception).toBe(true);
    expect(r.overallLabel).not.toBe("strong_evidence");
  });
  it("withholds factual scores for unresolved source concerns", () => {
    const l = lessonFixture();
    l.concerns = ["The supplied formula appears incorrect."];
    const m = messageFixture();
    const r = finalizeReport(reportFixture(m), l, [m], true);
    expect(r.scores.accuracy.score).toBeNull();
    expect(r.scores.accuracy.status).toBe("uncertain");
  });
});
describe("calculation language", () => {
  it("accepts bounded arithmetic and conditions", () => {
    expect(() =>
      validateCalculation(
        "function calculate(inputs) { const n = Math.max(inputs.size, 1); return {metrics:{area:n*n}}; }",
        ["size"],
        ["area"],
      ),
    ).not.toThrow();
  });
  it.each([
    "function calculate(inputs){return fetch('https://example.com');}",
    "function calculate(inputs){while(true){} return {metrics:{area:1}};}",
    "function calculate(inputs){return {metrics:{area:inputs.constructor.constructor('return 1')()}};}",
    "function calculate(inputs){return {metrics:{area:globalThis.localStorage.length}};}",
    "function calculate(inputs){return {metrics:{area:calculate(inputs)}};}",
    "function calculate(inputs){return {metrics:{area:Math['pow'](2,3)}};}",
  ])("rejects unrestricted capabilities: %s", (code) => {
    expect(() => validateCalculation(code, ["size"], ["area"])).toThrow();
  });
  it("exports usable JSON schemas for structured model responses", () => {
    expect(z.toJSONSchema(LessonGeneratedSchema).type).toBe("object");
    expect(z.toJSONSchema(StudentReplySchema).type).toBe("object");
  });
});
