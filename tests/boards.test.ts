import { describe, expect, it } from "vitest";
import {
  BoardSubmissionSchema,
  BoardSchema,
  type Board,
} from "@/lib/contracts";
import {
  emptyTool,
  ToolStateSchema,
  DraftToolStateSchema,
} from "@/lib/board-tools";
import {
  exampleBoard,
  suggestedTool,
  textBoard,
  validateBoardConfiguration,
  validateBoardInputs,
} from "@/lib/boards";
import {
  modelMessages,
  publicMessages,
  validatePng,
} from "@/server/board-media";
import {
  lessonFixture,
  messageFixture,
  sessionFixture,
  replyFixture,
} from "./fixtures";
import {
  normalizeStudentReply,
  validateStudent,
  readyForCheck,
} from "@/lib/controller";
import { pngFixture, sketchFixture } from "./board-fixtures";
import { modelResponseSchema } from "@/server/model-schema";
import { LessonGeneratedSchema } from "@/lib/contracts";
import { z } from "zod";
describe("interactive board contracts", () => {
  it("does not count text found only inside a drawing as cited learner reasoning", () => {
    const lesson = lessonFixture(),
      session = sessionFixture(lesson),
      message = messageFixture("Here is my sketch.");
    message.board = validateBoardInputs(lesson.board, {
      version: 2,
      inputs: {},
      state: sketchFixture,
      png: pngFixture().toString("base64"),
    });
    const reply = replyFixture(message, true);
    const drawingQuote = { messageId: message.id, quote: "Weights are reused" };
    reply.evidence = reply.evidence.map((e) => ({
      ...e,
      citations: [drawingQuote],
    }));
    reply.mechanism = [drawingQuote];
    reply.demonstration = [drawingQuote];
    reply.misconceptionCorrection = [drawingQuote];
    const normalized = normalizeStudentReply(reply, session, lesson, [message]);
    session.ledger = validateStudent(normalized, session, lesson, [message]);
    expect(session.ledger.demonstration).toEqual([]);
    expect(readyForCheck(session, lesson)).toBe(false);
  });
  it("keeps strict runtime limits while removing Gemini decoder upper bounds", () => {
    const response = modelResponseSchema(LessonGeneratedSchema);
    expect(JSON.stringify(response)).not.toContain('"maxItems":');
    expect(response.properties?.objectives).toHaveProperty("minItems", 2);
    expect(
      z.toJSONSchema(LessonGeneratedSchema).properties?.objectives,
    ).toHaveProperty("maxItems", 3);
    const generated = lessonFixture();
    generated.objectives = Array.from(
      { length: 4 },
      () => generated.objectives[0],
    );
    expect(LessonGeneratedSchema.safeParse(generated).success).toBe(false);
  });
  it.each(["concept_map", "matching", "table"] as const)(
    "seeds and validates %s activities",
    (kind) => {
      const board: Board = {
        ...textBoard(),
        kind,
        groups: kind === "table" ? ["Concept", "Example"] : [],
        items: [
          { id: "first", label: "First", detail: "Description one" },
          { id: "second", label: "Second", detail: "Description two" },
        ],
      };
      expect(() =>
        validateBoardConfiguration(BoardSchema.parse(board)),
      ).not.toThrow();
      const state = suggestedTool(board)!;
      expect(
        validateBoardInputs(board, { version: 2, inputs: {}, state }).kind,
      ).toBe(kind);
    },
  );
  it("rejects empty generated activities and inactive calculations", () => {
    for (const kind of [
      "concept_map",
      "matching",
      "table",
      "sequence",
      "classification",
      "comparison",
      "causal",
      "custom",
    ] as const)
      expect(() =>
        validateBoardConfiguration({ ...textBoard(), kind }),
      ).toThrow();
    const board: Board = {
      ...textBoard(),
      kind: "causal",
      controls: [
        { id: "x", label: "X", min: 0, max: 10, step: 1, initial: 1, unit: "" },
      ],
      metrics: [{ id: "y", label: "Y", base: 1, factors: [], unit: "" }],
    };
    expect(() => validateBoardConfiguration(board)).toThrow(
      "adjustable result",
    );
  });
  it("makes a localized example fallback without supplying facts", () => {
    const board = exampleBoard("Literary themes", "ja");
    validateBoardConfiguration(board);
    expect(board.groups).toEqual(["概念", "例", "当てはまる理由"]);
    expect(suggestedTool(board)).toMatchObject({
      kind: "table",
      rows: [{ cells: ["Literary themes", "", ""] }],
    });
  });
  it("preserves legacy arithmetic snapshots", () => {
    expect(
      validateBoardInputs(lessonFixture().board, {
        version: 1,
        inputs: { inputSize: 64 },
      }),
    ).toMatchObject({ verified: true, metrics: { parameters: 224 } });
  });
  it("rejects unknown fields, invalid references and reused IDs", () => {
    expect(
      BoardSubmissionSchema.safeParse({
        version: 2,
        inputs: { x: 4 },
        state: emptyTool("sketch"),
      }).success,
    ).toBe(false);
    expect(
      ToolStateSchema.safeParse({
        kind: "concept_map",
        nodes: [],
        links: [{ id: "edge", from: "a", to: "b", label: "causes" }],
      }).success,
    ).toBe(false);
    expect(
      ToolStateSchema.safeParse({
        kind: "matching",
        pairs: [{ id: "a", term: "A", description: "B" }],
        matches: { a: "unknown" },
      }).success,
    ).toBe(false);
    expect(
      ToolStateSchema.safeParse({
        kind: "table",
        columns: ["A", "B"],
        rows: [{ id: "r", cells: ["A"] }],
      }).success,
    ).toBe(false);
    expect(
      ToolStateSchema.safeParse({
        ...sketchFixture,
        objects: [...sketchFixture.objects, ...sketchFixture.objects],
      }).success,
    ).toBe(false);
    expect(
      ToolStateSchema.safeParse({
        ...sketchFixture,
        objects: [{ ...sketchFixture.objects[0], points: [{ x: -1, y: 30 }] }],
      }).success,
    ).toBe(false);
  });
  it("allows oversized drafts but rejects sharing without deleting them", () => {
    const state = {
      kind: "sketch",
      objects: [...Array(4)].map((_, i) => ({
        id: `stroke${i}`,
        type: "pen",
        color: "#655dcc",
        width: 4,
        text: "",
        points: Array.from({ length: 1500 }, (_, n) => ({
          x: n % 960,
          y: n % 640,
        })),
      })),
    };
    expect(DraftToolStateSchema.safeParse(state).success).toBe(true);
    expect(ToolStateSchema.safeParse(state).success).toBe(false);
  });
  it("requires a nonempty workspace and a sketch preview", () => {
    expect(() =>
      validateBoardInputs(textBoard(), {
        version: 2,
        inputs: {},
        state: emptyTool("table"),
      }),
    ).toThrow("Add something");
    expect(() =>
      validateBoardInputs(textBoard(), {
        version: 2,
        inputs: {},
        state: sketchFixture,
      }),
    ).toThrow("preview is missing");
  });
});
describe("bounded sketch media", () => {
  it("validates PNG bytes, checksums and dimensions", () => {
    const png = pngFixture();
    expect(validatePng(png.toString("base64"))).toEqual(png);
    const corrupt = Buffer.from(png);
    corrupt[44] ^= 1;
    for (const bytes of [
      corrupt,
      png.subarray(0, -1),
      pngFixture(961, 640),
      pngFixture(2, 1),
      Buffer.from("not an image"),
      Buffer.alloc(128 * 1024 + 1),
    ])
      expect(() => validatePng(bytes.toString("base64"))).toThrow();
  });
  it("removes raster data from model JSON and public history", () => {
    const message = {
      ...messageFixture(),
      board: validateBoardInputs(textBoard(), {
        version: 2,
        inputs: {},
        state: sketchFixture,
        png: pngFixture().toString("base64"),
      }),
    };
    const serialized = JSON.stringify(modelMessages([message]));
    expect(serialized).not.toContain('"png"');
    expect(serialized).toContain("Weights are reused");
    const publicMessage = publicMessages("session", [message])[0];
    expect(publicMessage.board).toHaveProperty(
      "imageUrl",
      `/api/sessions/session/messages/${message.id}/board-image`,
    );
    expect(publicMessage.board).not.toHaveProperty("png");
    expect(message.board).toHaveProperty("png");
  });
});
