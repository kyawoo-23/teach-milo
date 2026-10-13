import { type TeachingLanguage } from "./i18n/locales";
import { translateTeaching } from "./i18n/messages";
import {
  Board,
  BoardOutput,
  BoardSnapshot,
  BoardSubmission,
  BoardInputs,
  BoardSubmissionSchema,
} from "./contracts";
import { emptyTool, type ToolState } from "./board-tools";
import { convolution } from "./cnn";
import { AppError } from "./errors";

export const textBoard = (language?: TeachingLanguage): Board => ({
  kind: "text",
  version: 1,
  title: translateTeaching(language, "Make it concrete"),
  instruction: translateTeaching(
    language,
    "Teach Milo using a worked example, analogy, or step-by-step demonstration.",
  ),
  assumptions: "",
  controls: [],
  metrics: [],
  items: [],
  groups: [],
  code: "",
});
export const exampleBoard = (
  title: string,
  language?: TeachingLanguage,
): Board => ({
  ...textBoard(language),
  kind: "table",
  title,
  instruction: translateTeaching(
    language,
    "Add an example and explain why it fits the concept.",
  ),
  groups: [
    translateTeaching(language, "Concept"),
    translateTeaching(language, "Example"),
    translateTeaching(language, "Why it fits"),
  ],
  items: [{ id: "example", label: title, detail: "" }],
});
export function suggestedTool(board: Board): ToolState | undefined {
  if (board.kind === "concept_map")
    return {
      kind: "concept_map",
      nodes: board.items.map((i, n) => ({
        id: i.id,
        label: i.label,
        x: 160 + (n % 3) * 300,
        y: 100 + Math.floor(n / 3) * 140,
      })),
      links: [],
    };
  if (board.kind === "matching")
    return {
      kind: "matching",
      pairs: board.items.map((i) => ({
        id: i.id,
        term: i.label,
        description: i.detail,
      })),
      matches: {},
    };
  if (board.kind === "table")
    return {
      kind: "table",
      columns: board.groups,
      rows: board.items.map((i) => ({
        id: i.id,
        cells: board.groups.map((_, n) => (n === 0 ? i.label : "")),
      })),
    };
  if (board.kind === "text") return emptyTool("table");
}
export function validateBoardConfiguration(board: Board) {
  if (
    !board.title.trim() ||
    !board.instruction.trim() ||
    board.items.some(
      (i) => !/^[a-zA-Z0-9_-]{1,40}$/.test(i.id) || !i.label.trim(),
    ) ||
    board.groups.some((g) => !g.trim())
  )
    throw new Error("Empty board content");
  if (
    new Set(board.controls.map((c) => c.id)).size !== board.controls.length ||
    new Set(board.metrics.map((m) => m.id)).size !== board.metrics.length
  )
    throw new Error("Duplicate board identifiers");
  if (
    new Set(board.items.map((i) => i.id)).size !== board.items.length ||
    new Set(board.groups).size !== board.groups.length
  )
    throw new Error("Duplicate board items or groups");
  for (const c of board.controls)
    if (!(
      c.min < c.max &&
      c.initial >= c.min &&
      c.initial <= c.max &&
      c.step > 0 &&
      c.step <= c.max - c.min
    ))
      throw new Error("Invalid control range");
  for (const m of board.metrics)
    if (
      m.factors.some((f) => !board.controls.some((c) => c.id === f.controlId))
    )
      throw new Error("Unknown control");
  if (board.kind === "custom" && (!board.code || !board.metrics.length))
    throw new Error("Custom board needs calculations and metrics");
  if (
    ["causal", "custom"].includes(board.kind) &&
    (!board.controls.length || !board.metrics.length)
  )
    throw new Error("Calculation board needs controls and metrics");
  if (
    board.kind === "causal" &&
    board.metrics.every((m) => !m.factors.some((f) => f.coefficient !== 0))
  )
    throw new Error("Calculation board needs an adjustable result");
  if (
    board.kind === "table" &&
    (board.groups.length < 2 || !board.items.length)
  )
    throw new Error("Table needs columns and rows");
  if (board.kind === "matching" && board.items.some((i) => !i.detail.trim()))
    throw new Error("Matching needs descriptions");
  if (board.kind === "classification" && board.groups.length < 2)
    throw new Error("Classification needs groups");
  if (
    [
      "sequence",
      "classification",
      "comparison",
      "concept_map",
      "matching",
    ].includes(board.kind) &&
    board.items.length < 2
  )
    throw new Error("Board needs items");
}
export function initialBoardInputs(board: Board): BoardInputs {
  if (board.kind === "cnn") return { inputSize: 32 };
  if (board.kind === "sequence") return { order: board.items.map((i) => i.id) };
  return Object.fromEntries(board.controls.map((c) => [c.id, c.initial]));
}
export function validateBoardInputs(
  board: Board,
  submission: BoardSubmission,
  language?: TeachingLanguage,
): BoardSnapshot {
  submission = BoardSubmissionSchema.parse(submission);
  if (submission.version === 2) {
    const state = submission.state;
    const empty =
      state.kind === "sketch"
        ? !state.objects.length
        : state.kind === "concept_map"
          ? !state.nodes.length
          : state.kind === "matching"
            ? !state.pairs.length
            : !state.rows.some((r) => r.cells.some((c) => c.trim()));
    if (empty)
      throw new AppError(
        "INVALID_BOARD",
        "Add something to your board before attaching it.",
      );
    if (
      (state.kind === "concept_map" &&
        state.nodes.some((n) => !n.label.trim())) ||
      (state.kind === "matching" &&
        state.pairs.some((p) => !p.term.trim() || !p.description.trim())) ||
      (state.kind === "table" && state.columns.some((c) => !c.trim()))
    )
      throw new AppError(
        "INVALID_BOARD",
        "Complete the labels before attaching your board.",
      );
    if (state.kind === "sketch" && !submission.png)
      throw new AppError(
        "INVALID_BOARD",
        "The sketch preview is missing. Attach it again.",
      );
    return { ...submission, kind: state.kind, verified: false };
  }
  const inputs = submission.inputs;
  if (board.kind === "cnn") {
    if (
      Object.keys(inputs).length !== 1 ||
      ![32, 64].includes(inputs.inputSize as number)
    )
      throw new AppError("INVALID_BOARD", "Choose a 32×32 or 64×64 input.");
    return {
      ...submission,
      kind: "cnn",
      display: boardDisplay(board, inputs, language),
      verified: true,
      metrics: convolution(inputs.inputSize as number),
    };
  }
  if (board.kind === "text")
    throw new AppError(
      "INVALID_BOARD",
      "Use a written example for this lesson.",
    );
  if (["causal", "custom"].includes(board.kind)) {
    if (Object.keys(inputs).length !== board.controls.length)
      throw new AppError(
        "INVALID_BOARD",
        "The board inputs have changed. Reset the board.",
      );
    for (const c of board.controls) {
      const n = inputs[c.id];
      if (
        typeof n !== "number" ||
        !Number.isFinite(n) ||
        n < c.min ||
        n > c.max
      )
        throw new AppError(
          "INVALID_BOARD",
          "A board control is outside its allowed range.",
        );
    }
  } else if (board.kind === "sequence") {
    const order = inputs.order;
    if (
      Object.keys(inputs).length !== 1 ||
      !Array.isArray(order) ||
      order.length !== board.items.length ||
      new Set(order).size !== order.length ||
      order.some((id) => !board.items.some((i) => i.id === id))
    )
      throw new AppError("INVALID_BOARD", "Include each step exactly once.");
  } else if (board.kind === "classification") {
    if (
      Object.entries(inputs).some(
        ([id, group]) =>
          !board.items.some((i) => i.id === id) ||
          typeof group !== "string" ||
          !board.groups.includes(group),
      )
    )
      throw new AppError(
        "INVALID_BOARD",
        "Choose a listed group for each item.",
      );
  } else if (
    board.kind !== "comparison" ||
    Object.keys(inputs).length !== 1 ||
    !board.items.some((i) => i.id === inputs.selected)
  )
    throw new AppError("INVALID_BOARD", "Select a comparison item.");
  return {
    ...submission,
    kind: board.kind,
    display: boardDisplay(board, inputs, language),
    verified: false,
    ...(board.kind === "causal"
      ? { metrics: calculateTemplate(board, inputs).metrics }
      : {}),
  };
}
export function calculateTemplate(
  board: Board,
  inputs: BoardInputs,
): BoardOutput {
  return {
    metrics: Object.fromEntries(
      board.metrics.map((m) => [
        m.id,
        m.base +
          m.factors.reduce(
            (sum, f) => sum + Number(inputs[f.controlId] ?? 0) * f.coefficient,
            0,
          ),
      ]),
    ),
  };
}
export function boardDisplay(
  board: Board,
  inputs: BoardInputs,
  language?: TeachingLanguage,
) {
  return Object.entries(inputs).map(([id, value]) => ({
    label:
      id === "inputSize"
        ? translateTeaching(language, "Input image size")
        : id === "order"
          ? translateTeaching(language, "Sequence")
          : id === "selected"
            ? translateTeaching(language, "Selected item")
            : (board.controls.find((c) => c.id === id)?.label ??
              board.items.find((i) => i.id === id)?.label ??
              id),
    value:
      id === "inputSize"
        ? `${value} × ${value}`
        : Array.isArray(value)
          ? value
              .map((v) => board.items.find((i) => i.id === v)?.label ?? v)
              .join(" → ")
          : typeof value === "string"
            ? (board.items.find((i) => i.id === value)?.label ?? value)
            : String(value),
  }));
}
