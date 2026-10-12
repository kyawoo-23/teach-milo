import { lessonLanguage, type Locale } from "./i18n/locales";
import { translate } from "./i18n/messages";
import {
  Board,
  BoardOutput,
  BoardSnapshot,
  BoardSubmission,
} from "./contracts";
import { convolution } from "./cnn";
import { AppError } from "./errors";

export const textBoard = (language?: Locale): Board => ({
  kind: "text",
  version: 1,
  title: translate(lessonLanguage(language), "Make it concrete"),
  instruction: translate(
    lessonLanguage(language),
    "Teach Milo using a worked example, analogy, or step-by-step demonstration.",
  ),
  assumptions: "",
  controls: [],
  metrics: [],
  items: [],
  groups: [],
  code: "",
});
export function validateBoardConfiguration(board: Board) {
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
  if (board.kind === "classification" && board.groups.length < 2)
    throw new Error("Classification needs groups");
  if (
    ["sequence", "classification", "comparison"].includes(board.kind) &&
    board.items.length < 2
  )
    throw new Error("Board needs items");
}
export function initialBoardInputs(board: Board): BoardSubmission["inputs"] {
  if (board.kind === "cnn") return { inputSize: 32 };
  if (board.kind === "sequence") return { order: board.items.map((i) => i.id) };
  return Object.fromEntries(board.controls.map((c) => [c.id, c.initial]));
}
export function validateBoardInputs(
  board: Board,
  submission: BoardSubmission,
): BoardSnapshot {
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
    Object.keys(inputs).length !== 1 ||
    !board.items.some((i) => i.id === inputs.selected)
  )
    throw new AppError("INVALID_BOARD", "Select a comparison item.");
  return {
    ...submission,
    kind: board.kind,
    verified: false,
    ...(board.kind === "causal"
      ? { metrics: calculateTemplate(board, inputs).metrics }
      : {}),
  };
}
export function calculateTemplate(
  board: Board,
  inputs: BoardSubmission["inputs"],
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
