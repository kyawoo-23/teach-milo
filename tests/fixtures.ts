import { randomUUID } from "node:crypto";
import {
  emptyLedger,
  Lesson,
  Message,
  ReportGenerated,
  Session,
  StudentReply,
} from "@/lib/contracts";
import { CNN_BOARD, CNN_CARD, CNN_TRANSFER } from "@/content/cnn";
export const ctx = { ownerId: "test-owner", network: "test-network" };
export function lessonFixture(): Lesson {
  return {
    id: randomUUID(),
    ownerId: ctx.ownerId,
    materialId: randomUUID(),
    title: "CNN weight sharing",
    scope: "Distinguish fixed convolution weights from spatial computation.",
    level: "introductory",
    objectives: [
      {
        id: "o1",
        label: "Explain reused weights",
        criterion: "Weights are reused at spatial positions",
        sourceIds: ["s1"],
      },
      {
        id: "o2",
        label: "Compare image sizes",
        criterion: "Fixed parameters with more operations",
        sourceIds: ["s1"],
      },
    ],
    knowledge: CNN_CARD,
    concerns: [],
    misconception:
      "If the image gets bigger, do I need to learn more copies of the filter?",
    misconceptionCorrection:
      "The same learned weights are reused at more positions.",
    opening:
      "Can you teach me why a bigger image doesn't necessarily need more convolution weights?",
    transfer: CNN_TRANSFER,
    board: CNN_BOARD,
    sources: [{ id: "s1", label: "Notes", text: CNN_CARD, warnings: [] }],
    confirmed: true,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
}
export function sessionFixture(lesson: Lesson): Session {
  return {
    id: randomUUID(),
    ownerId: lesson.ownerId,
    lessonId: lesson.id,
    phase: "teaching",
    revision: 0,
    nextSequence: 1,
    challengeUsed: false,
    hintUsed: false,
    ledger: emptyLedger(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    expiresAt: lesson.expiresAt,
  };
}
export function messageFixture(
  text = "The same weights are reused at every position, so both sizes have 224 parameters while the bigger image takes more multiplications.",
): Message {
  return {
    id: randomUUID(),
    role: "learner",
    text,
    createdAt: new Date().toISOString(),
    sequence: 1,
    kind: "teaching",
  };
}
export function replyFixture(message: Message, complete = false): StudentReply {
  const citation = { messageId: message.id, quote: message.text };
  return {
    studentMessage: complete
      ? "Your example makes the difference clearer to me."
      : "What actually gets reused when the filter moves?",
    move: complete ? "acknowledge" : "probe_mechanism",
    evidence: ["o1", "o2"].map((objectiveId) => ({
      objectiveId,
      understanding: complete ? "supported" : "partial",
      citations: [citation],
    })),
    mechanism: complete ? [citation] : [],
    demonstration: complete ? [citation] : [],
    misconceptionCorrection: complete ? [citation] : [],
    unresolvedError: false,
    unresolvedErrorDetail: "",
    summary: "The learner distinguishes parameters from computation.",
  };
}
export function reportFixture(
  teaching: Message,
  transfer?: Message,
): ReportGenerated {
  const score = (m?: Message) => ({
    score: m ? (2 as const) : null,
    status: m ? ("assessed" as const) : ("insufficient_evidence" as const),
    explanation: m
      ? "The explanation supports this criterion."
      : "No evidence was supplied.",
    citations: m ? [{ messageId: m.id, quote: m.text }] : [],
  });
  return {
    scores: {
      accuracy: score(teaching),
      mechanism: score(teaching),
      evidence: score(teaching),
      misconception: score(teaching),
      transfer: score(transfer),
    },
    criticalMisconception: false,
    strengths: [
      {
        text: "You distinguished reuse from increased computation.",
        citations: [{ messageId: teaching.id, quote: teaching.text }],
      },
    ],
    nextSteps: [
      {
        text: "Try an example with a different number of input channels.",
        citations: [],
      },
    ],
  };
}
