import { describe, expect, it } from "vitest";
import type { Board, BoardNode } from "@/lib/contracts";
import {
  BOARD_LIMITS,
  boardCatalog,
  catalogPrompt,
  compileBoard,
} from "@/lib/board-catalog";
import { boardDisplay } from "@/lib/boards";
import {
  runCalculation,
  verifyBoardSubmission,
  verifyNumericTransfer,
} from "@/server/calculation";
import { boardFixture, DISTANCE_CODE, numericFixture } from "./fixtures";

const node = (
  id: string,
  component: string,
  props: Record<string, string> = {},
  parentId = "main",
  items: BoardNode["items"] = [],
): BoardNode => ({
  id,
  parentId,
  component,
  props: Object.entries(props).map(([key, value]) => ({ key, value })),
  items,
});
const withNodes = (nodes: BoardNode[], board = boardFixture()): Board => ({
  ...board,
  nodes: [node("main", "Stack", {}, ""), ...nodes],
});

describe("board catalog", () => {
  it("generates the prompt section from every registered component", () => {
    const prompt = catalogPrompt();
    expect(Object.keys(boardCatalog)).toHaveLength(17);
    for (const name of Object.keys(boardCatalog))
      expect(prompt).toContain(`- ${name}`);
    expect(prompt).toContain("calculate(inputs)");
    expect(prompt).not.toMatch(/cnn|convolution/i);
  });
  it("compiles a valid board into a render tree without diagnostics", () => {
    const compiled = compileBoard(boardFixture());
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.fatal).toBe(false);
    expect(compiled.interactive).toBe(true);
    expect(compiled.tree).toHaveLength(1);
    expect(compiled.tree[0].children.map((n) => n.component)).toEqual([
      "Slider",
      "Slider",
      "Metric",
      "SortableList",
    ]);
    expect(compiled.tree[0].children[0].props).toEqual({ bind: "speed" });
  });
  it("drops unknown components, props and bindings with diagnostics", () => {
    const compiled = compileBoard(
      withNodes([
        node("slider", "Slider", { bind: "speed", colour: "red" }),
        node("bad", "Chart3D", { value: "distance" }),
        node("child", "Metric", { value: "distance" }, "bad"),
        node("metric", "Metric", { value: "missing" }),
        node("toggle", "Toggle", { bind: "speed" }),
        node("text", "Text", { text: "Speed is {speed} and {nope}" }),
      ]),
    );
    expect(compiled.fatal).toBe(false);
    expect(compiled.board.nodes.map((n) => n.id)).toEqual([
      "main",
      "slider",
      "text",
    ]);
    expect(compiled.board.nodes[1].props).toEqual([
      { key: "bind", value: "speed" },
    ]);
    expect(compiled.diagnostics.join("\n")).toMatch(/unknown prop colour/);
    expect(compiled.diagnostics.join("\n")).toMatch(
      /unknown component Chart3D/,
    );
    expect(compiled.diagnostics.join("\n")).toMatch(/child: parent bad/);
    expect(compiled.diagnostics.join("\n")).toMatch(/Metric requires value/);
    expect(compiled.diagnostics.join("\n")).toMatch(/Toggle requires bind/);
    expect(
      compiled.tree[0].children.find((n) => n.id === "text")?.props.text,
    ).toBe("Speed is {speed} and {nope}");
  });
  it("keeps formula braces and code in board text during compilation", () => {
    const text = String.raw`Speed {speed}: $\frac{x}{2}$ and \(\sqrt{x}\).`;
    const compiled = compileBoard(
      withNodes([
        node("text", "Text", { text }),
        node("slider", "Slider", { bind: "speed" }),
      ]),
    );
    expect(compiled.diagnostics).toEqual([]);
    expect(compiled.tree[0].children[0].props.text).toBe(text);
  });
  it("enforces nesting depth, cycles and children only in layouts", () => {
    const compiled = compileBoard(
      withNodes([
        node("a", "Card"),
        node("b", "Row", {}, "a"),
        node("c", "Stack", {}, "b"),
        node("d", "Metric", { value: "distance" }, "c"),
        node("loop1", "Stack", {}, "loop2"),
        node("loop2", "Stack", {}, "loop1"),
        node("leaf", "Slider", { bind: "speed" }),
        node("inside", "Metric", { value: "distance" }, "leaf"),
      ]),
    );
    const text = compiled.diagnostics.join("\n");
    expect(text).toMatch(/node d: nesting is deeper than 4/);
    expect(text).toMatch(/loop1: parent loop2 is missing, cyclic/);
    expect(text).toMatch(/inside: parent leaf \(Slider\) cannot contain/);
    expect(compiled.board.nodes.map((n) => n.id)).not.toContain("d");
  });
  it("normalizes state and rejects invalid ranges", () => {
    const board = boardFixture();
    board.state.push(
      {
        id: "lights",
        label: "Lights",
        unit: "",
        type: "boolean",
        initial: 3,
        min: 0,
        max: 0,
        step: 0,
        options: [],
      },
      {
        id: "mode",
        label: "Mode",
        unit: "",
        type: "choice",
        initial: 9,
        min: 0,
        max: 0,
        step: 0,
        options: ["Walk", "Cycle"],
      },
      {
        id: "broken",
        label: "Broken",
        unit: "",
        type: "number",
        initial: 5,
        min: 10,
        max: 0,
        step: 1,
        options: [],
      },
    );
    const compiled = compileBoard(board);
    expect(compiled.board.state.find((s) => s.id === "lights")).toMatchObject({
      initial: 1,
      min: 0,
      max: 1,
      step: 1,
    });
    expect(compiled.board.state.find((s) => s.id === "mode")).toMatchObject({
      initial: 0,
      max: 1,
    });
    expect(compiled.board.state.some((s) => s.id === "broken")).toBe(false);
    expect(compiled.fatal).toBe(false);
  });
  it("is fatal when the calculation is invalid or nothing is interactive", () => {
    expect(
      compileBoard({ ...boardFixture(), code: "while(true){}" }).fatal,
    ).toBe(true);
    expect(
      compileBoard({
        ...boardFixture(),
        code: "function calculate(inputs) { return { metrics: { distance: inputs.mass } }; }",
      }).fatal,
    ).toBe(true);
    const passive = withNodes([node("m", "Metric", { value: "distance" })]);
    expect(compileBoard(passive).fatal).toBe(true);
    expect(
      compileBoard({
        ...passive,
        suggestedTool: {
          kind: "concept_map",
          columns: [],
          items: [
            { id: "a", label: "Speed", detail: "" },
            { id: "b", label: "Time", detail: "" },
          ],
        },
      }).fatal,
    ).toBe(false);
  });
  it("caps nodes and state at the documented limits", () => {
    const many = Array.from({ length: 60 }, (_, n) =>
      node(`m${n}`, "Metric", { value: "distance" }),
    );
    const compiled = compileBoard(
      withNodes([node("s", "Slider", { bind: "speed" }), ...many]),
    );
    expect(compiled.board.nodes.length).toBeLessThanOrEqual(BOARD_LIMITS.nodes);
  });
  it("validates composite items and groups", () => {
    const compiled = compileBoard(
      withNodes([
        node("sort", "SortableList", {}, "main", [
          { id: "only", label: "Only", detail: "" },
        ]),
        node("buckets", "Buckets", { groups: "Fast|Slow" }, "main", [
          { id: "car", label: "Car", detail: "" },
          { id: "snail", label: "Snail", detail: "" },
        ]),
        node("dup", "Buckets", { groups: "Fast|Fast" }, "main", [
          { id: "a", label: "A", detail: "" },
          { id: "b", label: "B", detail: "" },
        ]),
      ]),
    );
    expect(compiled.board.nodes.map((n) => n.id)).toEqual(["main", "buckets"]);
    expect(compiled.tree[0].children[0].props.groups).toEqual(["Fast", "Slow"]);
  });
});

describe("server calculation", () => {
  it("runs validated calculations in an isolated worker", async () => {
    await expect(
      runCalculation(DISTANCE_CODE, { speed: 6, time: 25 }, ["distance"]),
    ).resolves.toEqual({ distance: 150 });
  });
  it("rejects invalid code before running it and non-finite results", async () => {
    await expect(
      runCalculation(
        "function calculate(inputs) { while (true) {} }",
        { x: 1 },
        ["y"],
      ),
    ).rejects.toThrow();
    await expect(
      runCalculation(
        "function calculate(inputs) { return { metrics: { y: inputs.x / 0 } }; }",
        { x: 1 },
        ["y"],
      ),
    ).rejects.toThrow(/non-finite/);
  });
  it("re-runs calculate for board snapshots and builds a flat display", async () => {
    const board = boardFixture();
    const snapshot = await verifyBoardSubmission(board, {
      version: 3,
      state: { speed: 20 },
      composites: { steps: ["multiply", "read", "units"] },
    });
    expect(snapshot).toMatchObject({
      kind: "board",
      verified: true,
      metrics: { distance: 200 },
      state: { speed: 20, time: 10 },
    });
    expect(snapshot.display).toEqual([
      { label: "Speed", value: "20", unit: "m/s" },
      { label: "Time", value: "10", unit: "s" },
      { label: "Distance", value: "200", unit: "m" },
      {
        label: "Method",
        value: "Multiply them → Read speed and time → Check the units",
      },
    ]);
    expect(
      boardDisplay(board, compileBoard(board), snapshot as never, {}).some(
        (d) => d.label === "Distance",
      ),
    ).toBe(false);
  });
  it("keeps a numeric key only when its calculation reproduces it", async () => {
    await expect(
      verifyNumericTransfer(numericFixture()),
    ).resolves.toMatchObject({
      outcome: "verified",
      numeric: { fields: [{ expected: 150 }] },
    });
    const wrong = numericFixture();
    wrong.fields[0].expected = 160;
    await expect(verifyNumericTransfer(wrong)).resolves.toEqual({
      outcome: "dropped",
      numeric: { fields: [], inputs: [], code: "" },
    });
    const broken = numericFixture();
    broken.code = "function calculate(inputs) { return 1; }";
    await expect(verifyNumericTransfer(broken)).resolves.toMatchObject({
      outcome: "dropped",
    });
    await expect(
      verifyNumericTransfer({ fields: [], inputs: [], code: "" }),
    ).resolves.toMatchObject({ outcome: "none" });
  });
});
