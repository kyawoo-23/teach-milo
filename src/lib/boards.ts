import { type TeachingLanguage } from "./i18n/locales";
import { translateTeaching } from "./i18n/messages";
import {
  Board,
  BoardDisplay,
  BoardSnapshot,
  BoardStateSubmission,
  BoardSubmission,
  Lesson,
} from "./contracts";
import { emptyTool, type ToolState } from "./board-tools";
import { type CompiledBoard, type CompiledNode } from "./board-catalog";
import { AppError } from "./errors";

export type BoardValues = Pick<BoardStateSubmission, "state" | "composites">;

export const exampleBoard = (
  title: string,
  language?: TeachingLanguage,
): Board => ({
  version: 2,
  title,
  instruction: translateTeaching(
    language,
    "Add an example and explain why it fits the concept.",
  ),
  assumptions: "",
  state: [],
  derived: [],
  code: "",
  nodes: [],
  suggestedTool: {
    kind: "table",
    columns: [
      translateTeaching(language, "Concept"),
      translateTeaching(language, "Example"),
      translateTeaching(language, "Why it fits"),
    ],
    items: [{ id: "example", label: title, detail: "" }],
  },
});
// Boards stored before catalog composition have no version 2 and are not migrated.
export const lessonBoard = (
  lesson: Pick<Lesson, "board" | "title" | "teachingLanguage">,
): Board =>
  (lesson.board as { version?: unknown } | undefined)?.version === 2
    ? lesson.board
    : exampleBoard(lesson.title, lesson.teachingLanguage);

export function suggestedTool(board: Board): ToolState | undefined {
  const { kind, items, columns } = board.suggestedTool;
  if (kind === "sketch") return emptyTool("sketch");
  if (kind === "concept_map")
    return {
      kind: "concept_map",
      nodes: items.map((i, n) => ({
        id: i.id,
        label: i.label,
        x: 160 + (n % 3) * 300,
        y: 100 + Math.floor(n / 3) * 140,
      })),
      links: [],
    };
  if (kind === "matching")
    return {
      kind: "matching",
      pairs: items.map((i) => ({
        id: i.id,
        term: i.label,
        description: i.detail,
      })),
      matches: {},
    };
  if (kind === "table")
    return {
      kind: "table",
      columns,
      rows: items.map((i) => ({
        id: i.id,
        cells: columns.map((_, n) => (n === 0 ? i.label : "")),
      })),
    };
}

export function boardNodes(tree: CompiledNode[]): CompiledNode[] {
  return tree.flatMap((n) => [n, ...boardNodes(n.children)]);
}
const composites = (compiled: CompiledBoard) =>
  boardNodes(compiled.tree).filter((n) =>
    ["SortableList", "Buckets", "CompareCards"].includes(n.component),
  );

export function initialBoardValues(
  board: Board,
  compiled: CompiledBoard,
): BoardValues {
  return {
    state: Object.fromEntries(board.state.map((s) => [s.id, s.initial])),
    composites: Object.fromEntries(
      composites(compiled)
        .filter((n) => n.component === "SortableList")
        .map((n) => [n.id, n.items.map((i) => i.id)]),
    ),
  };
}

export function validateBoardValues(
  board: Board,
  compiled: CompiledBoard,
  submission: BoardStateSubmission,
): BoardValues {
  const reset = () =>
    new AppError(
      "INVALID_BOARD",
      "The board inputs have changed. Reset the board.",
    );
  if (!compiled.interactive) throw reset();
  if (
    Object.keys(submission.state).some(
      (id) => !board.state.some((s) => s.id === id),
    )
  )
    throw reset();
  const state: Record<string, number> = {};
  for (const s of board.state) {
    const value = submission.state[s.id] ?? s.initial;
    if (
      value < s.min ||
      value > s.max ||
      (s.type !== "number" && !Number.isInteger(value))
    )
      throw new AppError(
        "INVALID_BOARD",
        "A board control is outside its allowed range.",
      );
    state[s.id] = value;
  }
  const nodes = composites(compiled);
  if (
    Object.keys(submission.composites).some(
      (id) => !nodes.some((n) => n.id === id),
    )
  )
    throw reset();
  const values: BoardValues["composites"] = {};
  for (const node of nodes) {
    const value = submission.composites[node.id];
    const ids = node.items.map((i) => i.id);
    if (node.component === "SortableList") {
      const order = value ?? ids;
      if (
        !Array.isArray(order) ||
        order.length !== ids.length ||
        new Set(order).size !== order.length ||
        order.some((id) => !ids.includes(id))
      )
        throw new AppError("INVALID_BOARD", "Include each step exactly once.");
      values[node.id] = order;
    } else if (node.component === "Buckets") {
      if (value === undefined) continue;
      const groups = node.props.groups as string[];
      if (
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.entries(value).some(
          ([id, group]) => !ids.includes(id) || !groups.includes(group),
        )
      )
        throw new AppError(
          "INVALID_BOARD",
          "Choose a listed group for each item.",
        );
      values[node.id] = value;
    } else if (value !== undefined) {
      if (typeof value !== "string" || !ids.includes(value))
        throw new AppError("INVALID_BOARD", "Select a comparison item.");
      values[node.id] = value;
    }
  }
  return { state, composites: values };
}

export function validateWorkspaceSubmission(
  submission: Extract<BoardSubmission, { version: 2 }>,
): BoardSnapshot {
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
      state.pairs.some(
        (p) =>
          (p.term !== undefined && !p.term.trim()) ||
          (p.description !== undefined && !p.description.trim()),
      )) ||
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

export function formatBoardNumber(value: number, digits = 3): string {
  if (!Number.isFinite(value)) return "—";
  return Math.abs(value) >= 1e15
    ? value.toExponential(3)
    : String(Number(value.toFixed(digits)));
}

export function formatBoardValue(
  board: Board,
  id: string,
  values: BoardValues,
  metrics: Record<string, number>,
  language?: TeachingLanguage,
  digits?: number,
): string {
  const s = board.state.find((x) => x.id === id);
  if (s?.type === "boolean")
    return translateTeaching(language, values.state[id] ? "On" : "Off");
  if (s?.type === "choice") return s.options[values.state[id]] ?? "";
  const value = s ? values.state[id] : metrics[id];
  return value === undefined ? "—" : formatBoardNumber(value, digits);
}

// Milo and the evaluator see only these labelled values, never node structure.
export function boardDisplay(
  board: Board,
  compiled: CompiledBoard,
  values: BoardValues,
  metrics: Record<string, number>,
  language?: TeachingLanguage,
): BoardDisplay {
  const display: BoardDisplay = [
    ...board.state.map((s) => ({
      label: s.label,
      value: formatBoardValue(board, s.id, values, metrics, language),
      ...(s.unit && s.type === "number" ? { unit: s.unit } : {}),
    })),
    ...board.derived
      .filter((d) => metrics[d.id] !== undefined)
      .map((d) => ({
        label: d.label,
        value: formatBoardNumber(metrics[d.id]),
        ...(d.unit ? { unit: d.unit } : {}),
      })),
  ];
  for (const node of composites(compiled)) {
    const value = values.composites[node.id];
    const label = (id: string) =>
      node.items.find((i) => i.id === id)?.label ?? id;
    const caption = node.props.label as string | undefined;
    if (node.component === "SortableList" && Array.isArray(value))
      display.push({
        label: caption ?? translateTeaching(language, "Sequence"),
        value: value.map(label).join(" → "),
      });
    else if (node.component === "Buckets" && value && typeof value === "object")
      for (const [id, group] of Object.entries(value))
        display.push({ label: label(id), value: group });
    else if (node.component === "CompareCards" && typeof value === "string")
      display.push({
        label: caption ?? translateTeaching(language, "Selected item"),
        value: label(value),
      });
  }
  return display;
}
