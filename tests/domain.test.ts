import { describe, expect, it } from "vitest";
import { finalizeReport } from "@/lib/assessment";
import {
  allowedMoves,
  greetLearner,
  normalizeStudentReply,
  readyForCheck,
  validateStudent,
} from "@/lib/controller";
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

describe("server-owned readiness", () => {
  it("requires an interpreted demonstration and complete objective evidence", () => {
    const l = lessonFixture();
    const s = sessionFixture(l);
    const m = messageFixture();
    s.ledger = validateStudent(replyFixture(m, true), s, l, [m]);
    expect(readyForCheck(s, l)).toBe(true);
    s.ledger.demonstration = [];
    expect(readyForCheck(s, l)).toBe(true);
    s.ledger.mechanism = [];
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
  it("never raises the misconception in teach mode", () => {
    const l = lessonFixture();
    const s = { ...sessionFixture(l), mode: "teach" as const };
    const m = messageFixture();
    s.ledger = validateStudent(replyFixture(m), s, l, [m]);
    expect(allowedMoves(s)).not.toContain("surface_misconception");
  });
  it("requires the opening misconception to be corrected in correct mode", () => {
    const l = lessonFixture();
    const s = { ...sessionFixture(l), mode: "correct" as const };
    s.challengeUsed = true;
    const m = messageFixture();
    s.ledger = validateStudent(replyFixture(m, true), s, l, [m]);
    expect(readyForCheck(s, l)).toBe(true);
    s.ledger.misconceptionCorrection = [];
    expect(readyForCheck(s, l)).toBe(false);
    expect(allowedMoves(s)).not.toContain("surface_misconception");
  });
  it("retains a cited correction across an unrelated follow-up", () => {
    const l = lessonFixture();
    const s = sessionFixture(l);
    const earlier = messageFixture(
      "Twice the speed gives twice the distance, not four times, because distance equals speed times time.",
    );
    s.ledger.misconceptionCorrection = [
      { messageId: earlier.id, quote: earlier.text },
    ];
    const current = messageFixture(
      "For 6 metres per second over 25 seconds, distance is 150 metres.",
    );
    const reply = replyFixture(current, true);
    reply.misconceptionCorrection = [];
    expect(
      normalizeStudentReply(reply, s, l, [earlier, current])
        .misconceptionCorrection,
    ).toEqual(s.ledger.misconceptionCorrection);
    expect(
      normalizeStudentReply({ ...reply, unresolvedError: true }, s, l, [
        earlier,
        current,
      ]).misconceptionCorrection,
    ).toEqual([]);
    expect(
      normalizeStudentReply(reply, s, l, [current]).misconceptionCorrection,
    ).toEqual([]);
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
    const fitted = normalizeStudentReply(
      { ...q, move: "surface_misconception" },
      { ...s, challengeUsed: true },
      l,
      [m],
    );
    expect(fitted.studentMessage).toBe("Why?");
    expect(fitted.move).not.toBe("surface_misconception");
    expect(() =>
      validateStudent(fitted, { ...s, challengeUsed: true }, l, [m]),
    ).not.toThrow();
    expect(
      StudentReplySchema.safeParse({ ...q, move: "declare_mastery" }).success,
    ).toBe(false);
  });
  it("infers demonstration from mechanism when the model omits it", () => {
    const l = lessonFixture();
    const s = sessionFixture(l);
    const m = messageFixture();
    s.ledger = validateStudent(replyFixture(m, true), s, l, [m]);
    s.ledger.demonstration = [];
    expect(readyForCheck(s, l)).toBe(true);
  });
  it("still allows readiness when the lesson has source review notes", () => {
    const l = lessonFixture();
    l.concerns = ["The notes omit one secondary example."];
    const s = sessionFixture(l);
    const m = messageFixture();
    s.ledger = validateStudent(replyFixture(m, true), s, l, [m]);
    expect(readyForCheck(s, l)).toBe(true);
  });
});
describe("Milo's opening greeting", () => {
  it("replaces a greeting addressed to Milo with Hi!", () => {
    expect(
      greetLearner(
        "Hi Milo! I've been reading about DNS attacks. Could you teach me?",
      ),
    ).toBe("Hi! I've been reading about DNS attacks. Could you teach me?");
    expect(greetLearner("Hello there, can you teach me about RAAS?")).toBe(
      "Hi! Can you teach me about RAAS?",
    );
  });
  it("adds Hi! to an opening without a greeting", () => {
    expect(greetLearner("Can you teach me about constant speed?")).toBe(
      "Hi! Can you teach me about constant speed?",
    );
    expect(greetLearner("Highways fascinate me. How do they drain?")).toBe(
      "Hi! Highways fascinate me. How do they drain?",
    );
  });
});

describe("evidence-based assessment", () => {
  it("only gives a full total for fully evidenced dimensions", () => {
    const l = lessonFixture();
    const m = messageFixture();
    const t = {
      ...messageFixture(
        "6 × 25 is 150 m, and twice the time doubles it because distance is proportional to time.",
      ),
      kind: "transfer" as const,
    };
    const r = finalizeReport(reportFixture(m, t), l, [m, t], false, {
      distance: 150.2,
    });
    expect(r.total).toBe(10);
    expect(r.maxTotal).toBe(10);
    expect(r.overallLabel).toBe("strong_evidence");
  });
  it("scores four skills out of 8 when the misconception is excluded", () => {
    const l = lessonFixture();
    const m = messageFixture();
    const t = {
      ...messageFixture(
        "6 × 25 is 150 m, and twice the time doubles it because distance is proportional to time.",
      ),
      kind: "transfer" as const,
    };
    const r = finalizeReport(
      reportFixture(m, t),
      l,
      [m, t],
      false,
      { distance: 150.2 },
      ["misconception"],
    );
    expect(r.maxTotal).toBe(8);
    expect(r.total).toBe(8);
    expect(r.excluded).toEqual(["misconception"]);
    expect(r.scores.misconception.score).toBeNull();
    expect(r.scores.misconception.citations).toEqual([]);
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
      distance: 150,
    });
    expect(r.scores.transfer.score).toBeNull();
  });
  it("caps answers outside the verified tolerance and explains them", () => {
    const l = lessonFixture();
    const m = messageFixture();
    const t = {
      ...messageFixture("Going twice as long means four times as far."),
      kind: "transfer" as const,
    };
    const r = finalizeReport(reportFixture(m, t), l, [m, t], false, {
      distance: 300,
    });
    expect(r.scores.transfer.score).toBe(1);
    expect(r.scores.transfer.explanation).toContain(
      "Distance: you entered 300 m; the expected value is 150 m.",
    );
    expect(r.overallLabel).not.toBe("strong_evidence");
  });
  it("withholds transfer scoring when verified fields are missing", () => {
    const l = lessonFixture();
    const m = messageFixture();
    const t = { ...messageFixture("About 150 m."), kind: "transfer" as const };
    const r = finalizeReport(reportFixture(m, t), l, [m, t], false);
    expect(r.scores.transfer.score).toBeNull();
    expect(r.scores.transfer.status).toBe("insufficient_evidence");
  });
  it("leaves transfer to the model when the lesson has no numeric key", () => {
    const l = lessonFixture();
    l.transfer.numeric = { fields: [], inputs: [], code: "" };
    const m = messageFixture();
    const t = { ...messageFixture("About 150 m."), kind: "transfer" as const };
    expect(
      finalizeReport(reportFixture(m, t), l, [m, t], false).scores.transfer
        .score,
    ).toBe(2);
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
    const lesson = z.toJSONSchema(LessonGeneratedSchema);
    expect(lesson.type).toBe("object");
    const stateMin = (
      lesson.properties as {
        board: {
          properties: { state: { items: { properties: { min: object } } } };
        };
      }
    ).board.properties.state.items.properties.min;
    expect(stateMin).not.toHaveProperty("minimum");
    expect(z.toJSONSchema(StudentReplySchema).type).toBe("object");
  });
});
