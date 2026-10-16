import { randomUUID } from "node:crypto";
import {
  Board,
  emptyLedger,
  Lesson,
  Message,
  NumericTransfer,
  ReportGenerated,
  Session,
  StudentReply,
} from "@/lib/contracts";
export const ctx = { ownerId: "test-owner", network: "test-network" };
export const KNOWLEDGE =
  "At constant speed, distance = speed × time. Doubling the time doubles the distance; doubling the speed also doubles the distance. Units must match: metres per second times seconds gives metres.";
export const DISTANCE_CODE =
  "function calculate(inputs) { return { metrics: { distance: inputs.speed * inputs.time } }; }";
export const boardFixture = (): Board => ({
  version: 2,
  title: "Distance at constant speed",
  instruction: "Change speed and time. Tell Milo what happens to distance.",
  assumptions: "Speed stays constant for the whole trip.",
  state: [
    {
      id: "speed",
      label: "Speed",
      unit: "m/s",
      type: "number",
      initial: 10,
      min: 1,
      max: 30,
      step: 1,
      options: [],
    },
    {
      id: "time",
      label: "Time",
      unit: "s",
      type: "number",
      initial: 10,
      min: 0,
      max: 60,
      step: 5,
      options: [],
    },
  ],
  derived: [{ id: "distance", label: "Distance", unit: "m" }],
  code: DISTANCE_CODE,
  nodes: [
    { id: "main", parentId: "", component: "Stack", props: [], items: [] },
    {
      id: "speed_slider",
      parentId: "main",
      component: "Slider",
      props: [{ key: "bind", value: "speed" }],
      items: [],
    },
    {
      id: "time_slider",
      parentId: "main",
      component: "Slider",
      props: [{ key: "bind", value: "time" }],
      items: [],
    },
    {
      id: "distance_metric",
      parentId: "main",
      component: "Metric",
      props: [{ key: "value", value: "distance" }],
      items: [],
    },
    {
      id: "steps",
      parentId: "main",
      component: "SortableList",
      props: [{ key: "label", value: "Method" }],
      items: [
        { id: "read", label: "Read speed and time", detail: "" },
        { id: "multiply", label: "Multiply them", detail: "" },
        { id: "units", label: "Check the units", detail: "" },
      ],
    },
  ],
  suggestedTool: { kind: "none", items: [], columns: [] },
});
export const numericFixture = (): NumericTransfer => ({
  fields: [
    {
      id: "distance",
      label: "Distance",
      unit: "m",
      expected: 150,
      tolerance: 0.5,
    },
  ],
  inputs: [
    { id: "speed", value: 6 },
    { id: "time", value: 25 },
  ],
  code: DISTANCE_CODE,
});
export function lessonFixture(): Lesson {
  return {
    id: randomUUID(),
    ownerId: ctx.ownerId,
    materialId: randomUUID(),
    title: "Distance at constant speed",
    scope: "Relate distance to speed and time at constant speed.",
    level: "introductory",
    objectives: [
      {
        id: "o1",
        label: "Explain the relationship",
        criterion: "Distance is speed multiplied by time",
        sourceIds: ["s1"],
      },
      {
        id: "o2",
        label: "Predict changes",
        criterion: "Doubling time or speed doubles distance",
        sourceIds: ["s1"],
      },
    ],
    knowledge: KNOWLEDGE,
    concerns: [],
    misconception: "If I go twice as fast, do I cover four times the distance?",
    misconceptionCorrection:
      "At constant speed, distance grows in proportion to speed, so twice as fast covers twice the distance.",
    opening:
      "Can you teach me how distance depends on speed and time when the speed doesn't change?",
    transfer: {
      question:
        "A cyclist rides at a constant 6 m/s for 25 s. How far do they travel, and what would change if they rode for twice as long? Explain why.",
      expected:
        "6 × 25 = 150 m. Riding twice as long at the same speed doubles the distance to 300 m, because distance is proportional to time at constant speed.",
      criteria: ["150 m", "Doubling time doubles distance at constant speed"],
      numeric: numericFixture(),
    },
    board: boardFixture(),
    sources: [{ id: "s1", label: "Notes", text: KNOWLEDGE, warnings: [] }],
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
  text = "Distance is speed times time, so 10 m/s for 10 s covers 100 m, and doubling the time to 20 s doubles the distance to 200 m.",
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
      : "Why does doubling the time double the distance?",
    move: complete ? "acknowledge" : "probe_mechanism",
    emotion: complete ? "encouraged" : "puzzled",
    reason: complete
      ? "Your explanation is helping me connect the ideas."
      : "I'm still wondering why it works that way.",
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
    summary: "The learner relates distance to speed and time.",
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
        text: "You linked distance to both speed and time.",
        citations: [{ messageId: teaching.id, quote: teaching.text }],
      },
    ],
    nextSteps: [
      {
        text: "Try an example where the speed changes partway through.",
        citations: [],
      },
    ],
  };
}
