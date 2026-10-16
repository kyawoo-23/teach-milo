import { describe, expect, it } from "vitest";
import { BoardSubmissionSchema, type Board } from "@/lib/contracts";
import {
  emptyTool,
  ToolStateSchema,
  DraftToolStateSchema,
  uniqueConceptLinks,
  conceptPairsAvailable,
} from "@/lib/board-tools";
import { compileBoard } from "@/lib/board-catalog";
import {
  exampleBoard,
  initialBoardValues,
  lessonBoard,
  suggestedTool,
  validateBoardValues,
  validateWorkspaceSubmission,
  type BoardValues,
} from "@/lib/boards";
import {
  modelMessages,
  publicMessages,
  validatePng,
} from "@/server/board-media";
import {
  boardFixture,
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
const toolBoard = (kind: Board["suggestedTool"]["kind"]): Board => ({
  ...exampleBoard("Seeds"),
  suggestedTool: {
    kind,
    columns: kind === "table" ? ["Concept", "Example"] : [],
    items: [
      { id: "first", label: "First", detail: "Description one" },
      { id: "second", label: "Second", detail: "Description two" },
    ],
  },
});
describe("interactive board contracts", () => {
  it("accepts independent matching sides and legacy paired records", () => {
    const state = ToolStateSchema.parse({
      kind: "matching",
      pairs: [
        {
          id: "legacy",
          term: "Existing term",
          description: "Existing description",
        },
        { id: "term", term: "New term" },
        { id: "description", description: "New description" },
        { id: "extra", description: "Another description" },
      ],
      matches: { term: "legacy", legacy: "description" },
    });
    expect(
      validateWorkspaceSubmission({ version: 2, inputs: {}, state }).state,
    ).toEqual(state);
  });
  it("rejects matching connections to the wrong side or an absent item", () => {
    const state = {
      kind: "matching",
      pairs: [
        { id: "term", term: "A" },
        { id: "description", description: "B" },
      ],
      matches: {},
    };
    for (const matches of [
      { description: "term" },
      { term: "term" },
      { description: "description" },
      { term: "missing" },
    ])
      expect(ToolStateSchema.safeParse({ ...state, matches }).success).toBe(
        false,
      );
    expect(
      ToolStateSchema.safeParse({ ...state, pairs: [{ id: "empty" }] }).success,
    ).toBe(false);
  });
  it("limits each matching side to ten items independently", () => {
    const terms = Array.from({ length: 10 }, (_, i) => ({
      id: `t${i}`,
      term: `Term ${i}`,
    }));
    const descriptions = Array.from({ length: 10 }, (_, i) => ({
      id: `d${i}`,
      description: `Description ${i}`,
    }));
    const state = {
      kind: "matching",
      pairs: [...terms, ...descriptions],
      matches: {},
    };
    expect(ToolStateSchema.safeParse(state).success).toBe(true);
    expect(
      ToolStateSchema.safeParse({
        ...state,
        pairs: [...terms, { id: "extra", term: "Extra" }],
      }).success,
    ).toBe(false);
    expect(
      ToolStateSchema.safeParse({
        ...state,
        pairs: [...descriptions, { id: "extra", description: "Extra" }],
      }).success,
    ).toBe(false);
    expect(() =>
      validateWorkspaceSubmission({
        version: 2,
        inputs: {},
        state: ToolStateSchema.parse({
          ...state,
          pairs: [{ id: "draft", term: "" }],
        }),
      }),
    ).toThrow("Complete the labels");
  });
  it("does not count text found only inside a drawing as cited learner reasoning", () => {
    const lesson = lessonFixture(),
      session = sessionFixture(lesson),
      message = messageFixture("Here is my sketch.");
    message.board = validateWorkspaceSubmission({
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
    const json = JSON.stringify(response);
    expect(json).not.toContain('"maxItems":');
    expect(json).not.toContain('"const"');
    expect(json).not.toMatch(/"(minimum|maximum)":/);
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
    "seeds and validates %s tools",
    (kind) => {
      const board = toolBoard(kind);
      const compiled = compileBoard(board);
      expect(compiled.fatal).toBe(false);
      expect(compiled.board.suggestedTool.kind).toBe(kind);
      const state = suggestedTool(board)!;
      expect(state.kind).toBe(kind);
      expect(
        validateWorkspaceSubmission({ version: 2, inputs: {}, state }).kind,
      ).toBe(kind);
    },
  );
  it("makes a localized example fallback without supplying facts", () => {
    const board = exampleBoard("Literary themes", "ja");
    expect(compileBoard(board).fatal).toBe(false);
    expect(board.suggestedTool.columns).toEqual([
      "概念",
      "例",
      "当てはまる理由",
    ]);
    expect(suggestedTool(board)).toMatchObject({
      kind: "table",
      rows: [{ cells: ["Literary themes", "", ""] }],
    });
  });
  it("replaces boards stored before catalog composition with the example table", () => {
    const lesson = lessonFixture();
    const legacy = {
      ...lesson,
      board: { kind: "cnn", version: 1 } as unknown as Board,
    };
    expect(lessonBoard(legacy)).toEqual(
      exampleBoard(lesson.title, lesson.teachingLanguage),
    );
    expect(lessonBoard(lesson)).toBe(lesson.board);
  });
  it("defaults missing board values and rejects unknown or out-of-range ones", () => {
    const board = boardFixture();
    const compiled = compileBoard(board);
    expect(initialBoardValues(board, compiled)).toEqual({
      state: { speed: 10, time: 10 },
      composites: { steps: ["read", "multiply", "units"] },
    });
    expect(
      validateBoardValues(board, compiled, {
        version: 3,
        state: { speed: 20 },
        composites: {},
      }),
    ).toEqual({
      state: { speed: 20, time: 10 },
      composites: { steps: ["read", "multiply", "units"] },
    });
    const cases: [BoardValues, string][] = [
      [{ state: { speed: 31 }, composites: {} }, "outside its allowed range"],
      [{ state: { distance: 1 }, composites: {} }, "Reset the board"],
      [{ state: {}, composites: { other: "x" } }, "Reset the board"],
      [
        { state: {}, composites: { steps: ["read", "read", "units"] } },
        "exactly once",
      ],
    ];
    for (const [submission, message] of cases)
      expect(() =>
        validateBoardValues(board, compiled, { version: 3, ...submission }),
      ).toThrow(message);
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
      BoardSubmissionSchema.safeParse({
        version: 3,
        state: { speed: 4 },
        composites: {},
        metrics: { distance: 1 },
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
      validateWorkspaceSubmission({
        version: 2,
        inputs: {},
        state: emptyTool("table"),
      }),
    ).toThrow("Add something");
    expect(() =>
      validateWorkspaceSubmission({
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
      board: validateWorkspaceSubmission({
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
  it("sends Milo only labelled values for catalog boards", () => {
    const message = {
      ...messageFixture(),
      board: {
        version: 3 as const,
        state: { speed: 20, time: 10 },
        composites: {},
        kind: "board" as const,
        verified: true,
        metrics: { distance: 200 },
        display: [{ label: "Distance", value: "200", unit: "m" }],
      },
    };
    expect(modelMessages([message])[0].board).toEqual({
      kind: "board",
      verified: true,
      display: [{ label: "Distance", value: "200", unit: "m" }],
    });
  });
  it("keeps one direction between a pair of concepts", () => {
    const links = uniqueConceptLinks([
      { id: "forward", from: "a", to: "b", label: "causes" },
      { id: "reverse", from: "b", to: "a", label: "follows" },
    ]);
    expect(links.map((link) => link.id)).toEqual(["forward"]);
    expect(conceptPairsAvailable([{ id: "a" }, { id: "b" }], links)).toBe(
      false,
    );
    expect(
      conceptPairsAvailable([{ id: "a" }, { id: "b" }, { id: "c" }], links),
    ).toBe(true);
  });
});
