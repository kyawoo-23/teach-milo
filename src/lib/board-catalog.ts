import type { Board, BoardItem, BoardNode, BoardState } from "./contracts";
import { validateCalculation } from "./custom-code";

export const BOARD_LIMITS = { nodes: 40, state: 8, derived: 8, depth: 4 };

type PropKind =
  | { kind: "text"; max?: number }
  | { kind: "template" }
  | { kind: "number"; min?: number; max?: number; integer?: boolean }
  | { kind: "boolean" }
  | { kind: "enum"; values: readonly string[] }
  | { kind: "list"; min: number; max: number }
  | { kind: "state"; types: readonly BoardState["type"][] }
  | { kind: "value" }
  | { kind: "derived" }
  | { kind: "amount" };
type PropSpec = PropKind & { description: string; required?: boolean };
type CatalogEntry = {
  group: "layout" | "content" | "input" | "display" | "composite";
  description: string;
  props: Record<string, PropSpec>;
  children?: boolean;
  items?: { min: number; description: string };
  interactive?: boolean;
};

const label: PropSpec = {
  kind: "text",
  max: 80,
  description: "short label; defaults to the bound value's label",
};

export const boardCatalog = {
  Stack: {
    group: "layout",
    description: "Vertical layout container.",
    props: {},
    children: true,
  },
  Row: {
    group: "layout",
    description: "Horizontal layout that wraps on narrow screens.",
    props: {},
    children: true,
  },
  Card: {
    group: "layout",
    description: "Bordered group of related components.",
    props: { title: { kind: "text", max: 80, description: "card title" } },
    children: true,
  },
  Heading: {
    group: "content",
    description: "Section heading.",
    props: {
      text: { kind: "text", max: 100, description: "heading", required: true },
    },
  },
  Text: {
    group: "content",
    description:
      "Short paragraph. Insert live values with {id} using state or derived ids.",
    props: {
      text: { kind: "template", description: "paragraph", required: true },
    },
  },
  Callout: {
    group: "content",
    description: "Highlighted note, assumption or prompt for the learner.",
    props: {
      text: { kind: "text", max: 300, description: "note", required: true },
      tone: {
        kind: "enum",
        values: ["info", "tip", "caution"],
        description: "info (default), tip or caution",
      },
    },
  },
  Slider: {
    group: "input",
    interactive: true,
    description: "Range slider for a number state.",
    props: {
      bind: {
        kind: "state",
        types: ["number"],
        description: "number state id",
        required: true,
      },
      label,
    },
  },
  NumberInput: {
    group: "input",
    interactive: true,
    description: "Exact numeric entry for a number state.",
    props: {
      bind: {
        kind: "state",
        types: ["number"],
        description: "number state id",
        required: true,
      },
      label,
    },
  },
  Toggle: {
    group: "input",
    interactive: true,
    description: "On/off switch for a boolean state.",
    props: {
      bind: {
        kind: "state",
        types: ["boolean"],
        description: "boolean state id",
        required: true,
      },
      label,
    },
  },
  Select: {
    group: "input",
    interactive: true,
    description: "Choice between the options of a choice state.",
    props: {
      bind: {
        kind: "state",
        types: ["choice"],
        description: "choice state id",
        required: true,
      },
      label,
    },
  },
  Metric: {
    group: "display",
    description: "Labelled live value with its unit.",
    props: {
      value: {
        kind: "value",
        description: "state or derived id",
        required: true,
      },
      label,
      digits: {
        kind: "number",
        min: 0,
        max: 6,
        integer: true,
        description: "maximum decimal places, default 3",
      },
    },
  },
  Bar: {
    group: "display",
    description: "Horizontal bar showing a value against a maximum.",
    props: {
      value: {
        kind: "value",
        description: "state or derived id",
        required: true,
      },
      max: {
        kind: "amount",
        description: "number or state/derived id for the full bar",
        required: true,
      },
      label,
    },
  },
  Grid: {
    group: "display",
    description:
      "Grid of cells (up to 24 × 24) with an optional highlighted window, for images and kernels, matrices, seats or areas.",
    props: {
      rows: {
        kind: "amount",
        description: "number or state/derived id",
        required: true,
      },
      cols: {
        kind: "amount",
        description: "number or state/derived id",
        required: true,
      },
      windowRows: { kind: "amount", description: "highlighted window height" },
      windowCols: { kind: "amount", description: "highlighted window width" },
      windowRow: {
        kind: "amount",
        description: "window top row, starting at 0",
      },
      windowCol: {
        kind: "amount",
        description: "window left column, starting at 0",
      },
      label: { kind: "text", max: 80, description: "caption" },
    },
  },
  LineChart: {
    group: "display",
    description:
      "Plots a derived value while one number state sweeps its range; other state keeps its current value.",
    props: {
      x: {
        kind: "state",
        types: ["number"],
        description: "number state id for the horizontal axis",
        required: true,
      },
      y: { kind: "derived", description: "derived id", required: true },
      label: { kind: "text", max: 80, description: "caption" },
    },
  },
  SortableList: {
    group: "composite",
    interactive: true,
    description: "Learner orders steps or events.",
    props: { label: { kind: "text", max: 80, description: "caption" } },
    items: { min: 2, description: "steps in a starting order" },
  },
  Buckets: {
    group: "composite",
    interactive: true,
    description: "Learner sorts items into groups.",
    props: {
      groups: {
        kind: "list",
        min: 2,
        max: 5,
        description: "group names separated by |",
        required: true,
      },
      label: { kind: "text", max: 80, description: "caption" },
    },
    items: { min: 2, description: "items to classify" },
  },
  CompareCards: {
    group: "composite",
    interactive: true,
    description: "Side-by-side cases; the learner selects one to discuss.",
    props: { label: { kind: "text", max: 80, description: "caption" } },
    items: { min: 2, description: "cases with a short detail" },
  },
} satisfies Record<string, CatalogEntry>;
export type ComponentName = keyof typeof boardCatalog;

export type PropValue = string | number | boolean | string[];
export type CompiledNode = {
  id: string;
  component: ComponentName;
  props: Record<string, PropValue>;
  items: BoardItem[];
  children: CompiledNode[];
};
export type CompiledBoard = {
  board: Board;
  tree: CompiledNode[];
  diagnostics: string[];
  fatal: boolean;
  interactive: boolean;
};

const itemId = /^[a-zA-Z0-9_-]{1,40}$/;
const isComponent = (name: string): name is ComponentName =>
  Object.hasOwn(boardCatalog, name);
export const catalogEntry = (name: ComponentName): CatalogEntry =>
  boardCatalog[name];

function validState(
  s: BoardState,
  diagnostics: string[],
): BoardState | undefined {
  if (!s.label.trim()) {
    diagnostics.push(`state ${s.id}: label is empty`);
    return;
  }
  if (s.type === "boolean") {
    if (s.initial !== 0 && s.initial !== 1)
      diagnostics.push(`state ${s.id}: boolean initial must be 0 or 1`);
    return {
      ...s,
      initial: s.initial ? 1 : 0,
      min: 0,
      max: 1,
      step: 1,
      options: [],
    };
  }
  if (s.type === "choice") {
    const options = s.options.map((o) => o.trim());
    if (
      options.length < 2 ||
      options.some((o) => !o) ||
      new Set(options).size !== options.length
    ) {
      diagnostics.push(`state ${s.id}: choice needs 2–8 distinct options`);
      return;
    }
    const initial =
      Number.isInteger(s.initial) &&
      s.initial >= 0 &&
      s.initial < options.length
        ? s.initial
        : 0;
    if (initial !== s.initial)
      diagnostics.push(`state ${s.id}: choice initial must be an option index`);
    return { ...s, options, initial, min: 0, max: options.length - 1, step: 1 };
  }
  if (
    ![s.min, s.max, s.step, s.initial].every(Number.isFinite) ||
    !(s.min < s.max) ||
    s.initial < s.min ||
    s.initial > s.max ||
    !(s.step > 0) ||
    s.step > s.max - s.min
  ) {
    diagnostics.push(
      `state ${s.id}: needs min < max, initial within range and 0 < step <= max - min`,
    );
    return;
  }
  return { ...s, options: [] };
}

function parseProp(
  spec: PropSpec,
  raw: string,
  states: Map<string, BoardState>,
  derived: Set<string>,
): PropValue | undefined {
  const value = raw.trim();
  const known = (id: string) => states.has(id) || derived.has(id);
  switch (spec.kind) {
    case "text":
      return value && value.length <= (spec.max ?? 300) ? value : undefined;
    case "template": {
      if (!value) return;
      // Unknown braces and LaTeX groups are literal; runtime interpolation
      // replaces only actual state/derived identifiers outside math and code.
      return value;
    }
    case "number": {
      const n = Number(value);
      if (
        !value ||
        !Number.isFinite(n) ||
        (spec.integer && !Number.isInteger(n)) ||
        (spec.min !== undefined && n < spec.min) ||
        (spec.max !== undefined && n > spec.max)
      )
        return;
      return n;
    }
    case "boolean":
      return value === "true" ? true : value === "false" ? false : undefined;
    case "enum":
      return spec.values.includes(value) ? value : undefined;
    case "list": {
      const list = value.split("|").map((v) => v.trim());
      return list.length >= spec.min &&
        list.length <= spec.max &&
        list.every((v) => v && v.length <= 60) &&
        new Set(list).size === list.length
        ? list
        : undefined;
    }
    case "state": {
      const s = states.get(value);
      return s && spec.types.includes(s.type) ? value : undefined;
    }
    case "value":
      return known(value) ? value : undefined;
    case "derived":
      return derived.has(value) ? value : undefined;
    case "amount": {
      if (known(value)) return value;
      const n = Number(value);
      return value && Number.isFinite(n) ? n : undefined;
    }
  }
}

function validTool(
  tool: Board["suggestedTool"],
  diagnostics: string[],
): Board["suggestedTool"] {
  const none = { kind: "none" as const, items: [], columns: [] };
  if (tool.kind === "none" || tool.kind === "sketch")
    return { kind: tool.kind, items: [], columns: [] };
  const items = tool.items.filter((i) => itemId.test(i.id) && i.label.trim());
  if (new Set(items.map((i) => i.id)).size !== items.length) {
    diagnostics.push("suggestedTool: item ids must be unique");
    return none;
  }
  if (tool.kind === "table") {
    const columns = tool.columns.map((c) => c.trim());
    if (
      columns.length < 2 ||
      columns.some((c) => !c) ||
      new Set(columns).size !== columns.length ||
      !items.length
    ) {
      diagnostics.push(
        "suggestedTool table: needs 2–5 distinct columns and at least one row item",
      );
      return none;
    }
    return { kind: "table", items, columns };
  }
  if (
    items.length < 2 ||
    (tool.kind === "matching" && items.some((i) => !i.detail.trim()))
  ) {
    diagnostics.push(
      `suggestedTool ${tool.kind}: needs at least two items${tool.kind === "matching" ? " with descriptions" : ""}`,
    );
    return none;
  }
  return { kind: tool.kind, items, columns: [] };
}

// Mirrors a compiler pass: invalid props and nodes are dropped with diagnostics
// so one repair call can fix them, and only fatal problems reject the board.
export function compileBoard(input: Board): CompiledBoard {
  const diagnostics: string[] = [];
  let fatal = false;
  if (!input.title.trim() || !input.instruction.trim()) {
    diagnostics.push("board: title and instruction are required");
    fatal = true;
  }
  const states = new Map<string, BoardState>();
  for (const s of input.state.slice(0, BOARD_LIMITS.state)) {
    if (states.has(s.id)) {
      diagnostics.push(`state ${s.id}: duplicate id`);
      continue;
    }
    const valid = validState(s, diagnostics);
    if (valid) states.set(s.id, valid);
  }
  const derivedList = input.derived
    .slice(0, BOARD_LIMITS.derived)
    .filter((d, i, all) => {
      if (states.has(d.id) || all.findIndex((x) => x.id === d.id) !== i) {
        diagnostics.push(`derived ${d.id}: duplicate id`);
        return false;
      }
      return true;
    });
  const derived = new Set(derivedList.map((d) => d.id));
  let code = "";
  if (derivedList.length) {
    try {
      validateCalculation(input.code, [...states.keys()], [...derived]);
      code = input.code;
    } catch (e) {
      diagnostics.push(`calculate(): ${(e as Error).message}`);
      fatal = true;
    }
  }
  const byId = new Map<string, BoardNode>();
  for (const node of input.nodes.slice(0, BOARD_LIMITS.nodes)) {
    if (!node.id.trim() || byId.has(node.id)) {
      diagnostics.push(`node ${node.id || "(blank)"}: duplicate or empty id`);
      continue;
    }
    if (!isComponent(node.component)) {
      diagnostics.push(
        `node ${node.id}: unknown component ${node.component}; it and its children were dropped`,
      );
      continue;
    }
    byId.set(node.id, node);
  }
  const sanitized = new Map<string, BoardNode>();
  const reached = new Set<string>();
  const compile = (node: BoardNode, depth: number): CompiledNode | null => {
    reached.add(node.id);
    const name = node.component as ComponentName;
    const entry: CatalogEntry = boardCatalog[name];
    const props: Record<string, PropValue> = {};
    const kept: BoardNode["props"] = [];
    for (const { key, value } of node.props) {
      const spec = entry.props[key];
      if (!spec) {
        diagnostics.push(`node ${node.id}: unknown prop ${key} on ${name}`);
        continue;
      }
      if (key in props) continue;
      const parsed = parseProp(spec, value, states, derived);
      if (parsed === undefined) {
        diagnostics.push(
          `node ${node.id}: invalid ${key} "${value}" on ${name} (${spec.description})`,
        );
        continue;
      }
      props[key] = parsed;
      kept.push({ key, value });
    }
    const missing = Object.entries(entry.props)
      .filter(([key, spec]) => spec.required && !(key in props))
      .map(([key]) => key);
    if (missing.length) {
      diagnostics.push(
        `node ${node.id}: ${name} requires ${missing.join(", ")}; it was dropped`,
      );
      return null;
    }
    let items: BoardItem[] = [];
    if (entry.items) {
      items = node.items.filter(
        (i, n, all) =>
          itemId.test(i.id) &&
          i.label.trim() &&
          all.findIndex((x) => x.id === i.id) === n,
      );
      if (items.length < entry.items.min) {
        diagnostics.push(
          `node ${node.id}: ${name} needs at least ${entry.items.min} items with unique ids and labels; it was dropped`,
        );
        return null;
      }
    } else if (node.items.length)
      diagnostics.push(`node ${node.id}: ${name} does not use items`);
    const children: CompiledNode[] = [];
    for (const child of byId.values()) {
      if (child.parentId !== node.id || reached.has(child.id)) continue;
      if (!entry.children) {
        diagnostics.push(
          `node ${child.id}: parent ${node.id} (${name}) cannot contain children`,
        );
        continue;
      }
      if (depth >= BOARD_LIMITS.depth) {
        diagnostics.push(
          `node ${child.id}: nesting is deeper than ${BOARD_LIMITS.depth} levels`,
        );
        continue;
      }
      const compiled = compile(child, depth + 1);
      if (compiled) children.push(compiled);
    }
    sanitized.set(node.id, { ...node, props: kept, items });
    return { id: node.id, component: name, props, items, children };
  };
  const tree: CompiledNode[] = [];
  for (const node of byId.values())
    if (!node.parentId && !reached.has(node.id)) {
      const compiled = compile(node, 1);
      if (compiled) tree.push(compiled);
    }
  for (const node of byId.values())
    if (!reached.has(node.id))
      diagnostics.push(
        `node ${node.id}: parent ${node.parentId} is missing, cyclic or invalid; it was dropped`,
      );
  const suggestedTool = validTool(input.suggestedTool, diagnostics);
  const interactive = [...sanitized.values()].some(
    (n) =>
      (boardCatalog[n.component as ComponentName] as CatalogEntry).interactive,
  );
  if (!interactive && suggestedTool.kind === "none") {
    diagnostics.push(
      "board: include an interactive component or a suggestedTool for the learner",
    );
    fatal = true;
  }
  return {
    board: {
      ...input,
      state: [...states.values()],
      derived: derivedList,
      code,
      nodes: input.nodes
        .map((n) => sanitized.get(n.id))
        .filter((n): n is BoardNode => !!n),
      suggestedTool,
    },
    tree,
    diagnostics,
    fatal,
    interactive,
  };
}

const describeKind = (spec: PropSpec) => {
  switch (spec.kind) {
    case "state":
      return `${spec.types.join("/")} state id`;
    case "enum":
      return spec.values.join("|");
    default:
      return spec.description;
  }
};

export const CALCULATE_RULES =
  "a single function calculate(inputs) returning {metrics:{id:number}} for every declared id, reading inputs.<id>, using arithmetic, comparisons, local const/let variables, if/else, ternaries and Math.abs/min/max/round/floor/ceil/sqrt/pow/sin/cos/tan/log/exp only. No loops, recursion, strings, arrays, imports, globals, DOM, constructors, dynamic property access, nested functions or network; the code runs in an isolated worker.";

export function catalogPrompt(): string {
  const components = Object.entries(boardCatalog)
    .map(([name, raw]) => {
      const entry: CatalogEntry = raw;
      const props = Object.entries(entry.props)
        .map(
          ([key, spec]) =>
            `${key}${spec.required ? "*" : ""} (${describeKind(spec)})`,
        )
        .join(", ");
      return `- ${name}${entry.interactive ? " [interactive]" : ""}: ${entry.description}${props ? ` Props: ${props}.` : ""}${entry.children ? " Can contain children." : ""}${entry.items ? ` items: ${entry.items.description} (${entry.items.min}–10).` : ""}`;
    })
    .join("\n");
  return `Prepare a useful teaching board for every lesson by composing components from this catalog; never invent components. board.state declares up to ${BOARD_LIMITS.state} learner-controlled variables: number (min < max, initial within range, 0 < step <= max - min), boolean (initial 0 or 1) or choice (2–8 options; initial and value are option indexes). board.derived declares up to ${BOARD_LIMITS.derived} computed values; board.code is empty when there are no derived values, otherwise ${CALCULATE_RULES} board.nodes is a flat list of at most ${BOARD_LIMITS.nodes} components with unique ids; parentId is "" for top level or the id of a component that can contain children, nesting at most ${BOARD_LIMITS.depth} levels. Every prop value is a string: digits for numbers, true/false for booleans, | between list entries, and a state or derived id where a prop refers to a value. Item ids use ASCII letters, digits, underscores or hyphens. Required props are marked *.
Components:
${components}
board.suggestedTool seeds one learner tool: concept_map (items are starting concepts, at least 2), matching (item.label is a term and item.detail its description, at least 2; the app shuffles them), table (columns are 2–5 headings and items are starting row labels; cells start blank), sketch, or none. Use interactive components for quantities, mechanisms and processes; use a suggested tool for conceptual relationships, vocabulary or open examples, optionally alongside a short heading and instruction. Include at least one interactive component unless suggestedTool is set. Keep starting content grounded in the source; board values are illustrative and never assessment answer keys.`;
}
