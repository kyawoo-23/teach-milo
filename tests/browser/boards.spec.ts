import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
import type { Board, BoardNode } from "../../src/lib/contracts";
const id = "11111111-1111-4111-8111-111111111111";
const owner = "board-learner";
const key = `teach-milo-board:${owner}:${id}`;
async function setup(page: Page, failTurn = false, definition?: Board) {
  const state: any = {
    id,
    phase: "teaching",
    revision: 0,
    challengeUsed: false,
    hintUsed: false,
    pending: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    lesson: {
      id: "22222222-2222-4222-8222-222222222222",
      title: "Weight sharing",
      scope: "Explain reuse",
      level: "introductory",
      concerns: [],
      objectives: [
        { id: "o1", label: "Explain reuse" },
        { id: "o2", label: "Apply reuse" },
      ],
    },
    progress: [],
    messages: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        role: "student",
        text: "Could you show me how a filter reuses weights?",
        move: "request_demo",
        sequence: 0,
        createdAt: new Date().toISOString(),
      },
    ],
    board: {
      version: 2,
      title: "One filter",
      instruction: "Compare the image sizes.",
      assumptions: "",
      state: [],
      derived: [],
      code: "",
      nodes: [
        { id: "main", parentId: "", component: "Stack", props: [], items: [] },
        {
          id: "sizes",
          parentId: "main",
          component: "CompareCards",
          props: [],
          items: [
            { id: "small", label: "32 × 32", detail: "" },
            { id: "large", label: "64 × 64", detail: "" },
          ],
        },
      ],
      suggestedTool: { kind: "none", items: [], columns: [] },
    },
  };
  if (definition) state.board = definition;
  const payloads: any[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (data: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(data),
      });
    if (path === "/api/auth/me")
      return reply({
        user: { id: owner, name: "Ada", email: "ada@example.test" },
      });
    if (path === "/api/status") return reply({ configured: true, missing: [] });
    if (path.endsWith("/events")) return reply({ ok: true });
    if (path.endsWith("/turns")) {
      const data = route.request().postDataJSON();
      payloads.push(data);
      if (failTurn && payloads.length === 1)
        return reply(
          { error: { code: "MODEL_FAILURE", message: "Please try again." } },
          502,
        );
      state.revision++;
      state.messages.push(
        {
          id: data.operationId,
          role: "learner",
          text: data.text,
          sequence: 1,
          createdAt: new Date().toISOString(),
          board: {
            ...data.board,
            kind: data.board.state.kind,
            verified: false,
          },
        },
        {
          id: "55555555-5555-4555-8555-555555555555",
          role: "student",
          text: "Why does that stay the same?",
          sequence: 2,
          createdAt: new Date().toISOString(),
        },
      );
      return reply(state);
    }
    if (path === `/api/sessions/${id}`) return reply(state);
    if (path === "/api/sessions") return reply({ sessions: [] });
    return reply({ ok: true });
  });
  await page.goto(`/session/${id}`);
  await expect(page.getByLabel("Your explanation to Milo")).toBeVisible();
  return { state, payloads };
}
async function open(page: Page): Promise<Locator> {
  const button = page
    .getByRole("button", { name: "Open teaching board", exact: true })
    .first();
  if (await page.locator(".board-sidebar").isVisible())
    return page.locator(".board-sidebar .board-workspace");
  await button.click();
  return page.getByRole("dialog").locator(".board-workspace");
}
async function saved(page: Page) {
  return page.evaluate(
    (k) => JSON.parse(localStorage.getItem(k) || "null"),
    key,
  );
}
async function choose(
  page: Page,
  board: Locator,
  control: string,
  option: string,
) {
  await board.getByRole("combobox", { name: control, exact: true }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}
async function chooseTool(page: Page, board: Locator, tool: string) {
  const labels: Record<string, string> = {
    sketch: "Sketch and diagram",
    table: "Comparison table",
    concept_map: "Concept map",
    matching: "Matching pairs",
  };
  await choose(page, board, "Board tool", labels[tool]);
}
async function addConcept(page: Page, board: Locator, name: string) {
  await board.getByRole("button", { name: "Add concept", exact: true }).click();
  const popup = page.getByRole("dialog", { name: "Add concept", exact: true });
  await popup.getByLabel("New concept", { exact: true }).fill(name);
  await popup.getByRole("button", { name: "Add concept", exact: true }).click();
  await expect(popup).not.toBeVisible();
}
async function expectObjectCount(page: Page, board: Locator, count: number) {
  await board
    .getByRole("combobox", { name: "Selected object", exact: true })
    .click();
  await expect(page.getByRole("listbox").getByRole("option")).toHaveCount(
    count,
  );
  await page.keyboard.press("Escape");
}
test("sketch drafts survive switching, closing and reload; snapshots stay frozen and retry", async ({
  page,
}, info) => {
  const { payloads } = await setup(page, true);
  let board = await open(page);
  await chooseTool(page, board, "sketch");
  await board.getByRole("button", { name: "Text label", exact: true }).click();
  await board.getByRole("button", { name: "Add label", exact: true }).click();
  const textLabelDialog = page.getByRole("dialog", { name: "Text label" });
  await textLabelDialog
    .getByLabel("Text label", { exact: true })
    .fill("Same weights at every position");
  await textLabelDialog
    .getByRole("button", { name: "Add label", exact: true })
    .click();
  await choose(page, board, "Color", "Blue");
  await board.getByRole("button", { name: "Pen", exact: true }).click();
  const canvas = board.getByRole("img", { name: "Sketch canvas" });
  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 30, bounds.y + 70);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 100, bounds.y + 100, { steps: 8 });
  await page.mouse.up();
  await expect
    .poll(
      async () => (await saved(page))?.workspace.tools.sketch.objects.length,
    )
    .toBe(2);
  expect((await saved(page))?.workspace.tools.sketch.objects[1].color).toBe(
    "#426da9",
  );
  await expect(board.locator("select")).toHaveCount(0);
  await board.getByRole("button", { name: "Undo", exact: true }).click();
  await expect
    .poll(
      async () => (await saved(page))?.workspace.tools.sketch.objects.length,
    )
    .toBe(1);
  await board.getByRole("button", { name: "Redo", exact: true }).click();
  await page.getByRole("dialog").evaluateAll((elements) =>
    elements.forEach((e) => {
      e.scrollTop = 0;
    }),
  );
  await board.screenshot({ path: info.outputPath("sketch-board.png") });
  await chooseTool(page, board, "table");
  await board
    .getByRole("textbox", { name: "Row 1, Example", exact: true })
    .fill("A filter slides over the image");
  await chooseTool(page, board, "sketch");
  if (await page.getByRole("dialog").isVisible()) {
    await page.keyboard.press("Escape");
    board = await open(page);
  }
  await expectObjectCount(page, board, 3);
  await expect
    .poll(async () => (await saved(page))?.workspace.active)
    .toBe("sketch");
  await page.reload();
  board = await open(page);
  await expect(board.getByLabel("Board tool", { exact: true })).toHaveAttribute(
    "data-value",
    "sketch",
  );
  await expectObjectCount(page, board, 3);
  const firstObject = (await saved(page))!.workspace.tools.sketch.objects[0];
  const objects = board.getByRole("combobox", {
    name: "Selected object",
    exact: true,
  });
  await objects.focus();
  await objects.press("ArrowDown");
  await objects.press("ArrowDown");
  await objects.press("Enter");
  await expect(objects).toHaveAttribute("data-value", firstObject.id);
  await board.getByRole("button", { name: "Move right", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await saved(page))?.workspace.tools.sketch.objects[0].points[0].x,
    )
    .toBe(firstObject.points[0].x + 10);
  await board
    .getByRole("button", { name: "Attach to explanation", exact: true })
    .click();
  const preview = page.locator(".board-attachment img");
  await expect(preview).toBeVisible();
  const src = (await preview.getAttribute("src"))!;
  await writeFile(
    info.outputPath("sketch.png"),
    Buffer.from(src.split(",")[1], "base64"),
  );
  await expect(
    page.getByRole("button", { name: "Send explanation", exact: true }),
  ).toBeDisabled();
  board = await open(page);
  await board.getByRole("button", { name: "Text label", exact: true }).click();
  await board.getByRole("button", { name: "Add label", exact: true }).click();
  const laterLabelDialog = page.getByRole("dialog", { name: "Text label" });
  await laterLabelDialog
    .getByLabel("Text label", { exact: true })
    .fill("A later change");
  await laterLabelDialog
    .getByRole("button", { name: "Add label", exact: true })
    .click();
  if (await page.getByRole("dialog").isVisible())
    await page.keyboard.press("Escape");
  await expect(preview).toHaveAttribute("src", src);
  await page
    .getByLabel("Your explanation to Milo")
    .fill(
      "The same filter weights are reused at each position because moving the filter does not relearn the coefficients.",
    );
  await page
    .getByRole("button", { name: "Send explanation", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Try again", exact: true }),
  ).toBeVisible();
  await expect(preview).toHaveAttribute("src", src);
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(
    page.locator(".message.learner .board-preview img"),
  ).toBeVisible();
  expect(payloads).toHaveLength(2);
  expect(payloads[0]).toEqual(payloads[1]);
  expect(payloads[0].board.state.objects).toHaveLength(2);
  await expect
    .poll(async () => (await saved(page))?.attachment)
    .toBeUndefined();
});

async function expanded(page: Page) {
  let board = await open(page);
  if (!(await page.getByRole("dialog").isVisible())) {
    await board.getByRole("button", { name: "Expand" }).click();
    board = page.getByRole("dialog").locator(".board-workspace");
  }
  return board;
}

test("tables adapt to available width, focus new fields and keep row data while reordering", async ({
  page,
}, info) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "table");
  await board
    .getByRole("textbox", { name: "Row 1, Concept", exact: true })
    .fill("First idea");
  await board.getByRole("button", { name: "Add row", exact: true }).click();
  const newCell = board.getByRole("textbox", {
    name: "Row 2, Concept",
    exact: true,
  });
  await expect(newCell).toBeFocused();
  await newCell.fill("Second idea");
  await board
    .getByRole("button", { name: "Move Row 2 up", exact: true })
    .click();
  await expect(
    board.getByRole("textbox", { name: "Row 1, Concept", exact: true }),
  ).toHaveValue("Second idea");
  const handle = board.getByRole("button", {
    name: "Drag Row 1 to reorder, or use arrow keys",
    exact: true,
  });
  await handle.focus();
  await handle.press("ArrowDown");
  await expect(
    board.getByRole("textbox", { name: "Row 1, Concept", exact: true }),
  ).toHaveValue("First idea");
  await board.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(
    board.getByRole("textbox", { name: "Column 4", exact: true }),
  ).toBeFocused();
  await board.getByRole("button", { name: "Add column", exact: true }).click();
  const fifthColumn = board.getByRole("textbox", {
    name: "Column 5",
    exact: true,
  });
  await expect(fifthColumn).toBeFocused();
  await expect(fifthColumn).toHaveJSProperty("selectionStart", 0);
  await fifthColumn.fill("Difference");
  await board.getByText("Rename or remove columns", { exact: true }).click();
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect
      .poll(() =>
        board
          .locator("tbody td")
          .first()
          .evaluate((cell) => getComputedStyle(cell).display),
      )
      .toBe(width <= 768 ? "block" : "table-cell");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const field = board.getByRole("textbox", {
      name: "Row 1, Concept",
      exact: true,
    });
    await field.scrollIntoViewIfNeeded();
    const bounds = (await field.boundingBox())!;
    expect(bounds.width).toBeGreaterThan(90);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
    const scroll = board.locator(".board-table-scroll");
    expect(
      await scroll.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const tableBounds = (await scroll.boundingBox())!;
    for (const control of await board
      .locator(".board-row-controls button")
      .all()) {
      const controlBounds = (await control.boundingBox())!;
      expect(controlBounds.width).toBe(32);
      expect(controlBounds.height).toBe(32);
      expect(controlBounds.x).toBeGreaterThanOrEqual(tableBounds.x);
      expect(controlBounds.x + controlBounds.width).toBeLessThanOrEqual(
        tableBounds.x + tableBounds.width + 1,
      );
    }
    const rowToggle = board.getByRole("button", { name: "Row 1", exact: true });
    await expect(rowToggle).toHaveCSS("border-top-width", "0px");
    await rowToggle.focus();
    await rowToggle.press("Enter");
    await expect(rowToggle).toHaveAttribute("aria-expanded", "false");
    await expect(field).toBeHidden();
    await expect(
      board.getByRole("textbox", { name: "Row 2, Concept", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`table-collapsed-${width}.png`),
    });
    await rowToggle.press("Enter");
    await expect(rowToggle).toHaveAttribute("aria-expanded", "true");
    await expect(field).toHaveValue("First idea");
    await page.screenshot({ path: info.outputPath(`table-${width}.png`) });
  }
  await board.getByRole("button", { name: "Row 1", exact: true }).click();
  await board
    .getByRole("button", { name: "Move Row 1 down", exact: true })
    .click();
  await expect(
    board.getByRole("button", { name: "Row 2", exact: true }),
  ).toHaveAttribute("aria-expanded", "false");
  await board.getByRole("button", { name: "Row 2", exact: true }).click();
  await expect(
    board.getByRole("textbox", { name: "Row 2, Concept", exact: true }),
  ).toHaveValue("First idea");
  await board
    .getByRole("button", { name: "Move Row 2 up", exact: true })
    .click();
  await expect
    .poll(
      async () => (await saved(page))?.workspace.tools.table.rows[0].cells[0],
    )
    .toBe("First idea");
  expect(
    (await new AxeBuilder({ page }).include(".board-expanded-modal").analyze())
      .violations,
  ).toEqual([]);
});

const catalogNode = (
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
const steps = [
  { id: "first", label: "First step", detail: "Start here" },
  { id: "second", label: "Second step", detail: "Continue here" },
  { id: "third", label: "Third step", detail: "Finish here" },
];
const catalogBoard = (): Board => ({
  version: 2,
  title: "Explore the board",
  instruction: "Change the values and explain your choices.",
  assumptions: "",
  state: [
    {
      id: "amount",
      label: "Amount",
      type: "number",
      initial: 5,
      min: 0,
      max: 10,
      step: 1,
      unit: "",
      options: [],
    },
    {
      id: "enabled",
      label: "Enabled",
      type: "boolean",
      initial: 0,
      min: 0,
      max: 1,
      step: 1,
      unit: "",
      options: [],
    },
    {
      id: "choice",
      label: "Choice",
      type: "choice",
      initial: 0,
      min: 0,
      max: 1,
      step: 1,
      unit: "",
      options: ["Option A", "Option B"],
    },
  ],
  derived: [{ id: "result", label: "Result", unit: "" }],
  code: "function calculate(inputs) { return { metrics: { result: inputs.amount * 2 } }; }",
  suggestedTool: { kind: "none", items: [], columns: [] },
  nodes: [
    catalogNode("main", "Stack", {}, ""),
    catalogNode("row", "Row"),
    catalogNode("card", "Card", { title: "Controls" }, "row"),
    catalogNode("heading", "Heading", { text: "Try a value" }, "card"),
    catalogNode("text", "Text", { text: "Current amount: {amount}" }, "card"),
    catalogNode(
      "callout",
      "Callout",
      { text: "Explain what changes.", tone: "tip" },
      "card",
    ),
    catalogNode("slider", "Slider", { bind: "amount" }, "card"),
    catalogNode(
      "number",
      "NumberInput",
      { bind: "amount", label: "Exact amount" },
      "card",
    ),
    catalogNode("toggle", "Toggle", { bind: "enabled" }, "card"),
    catalogNode("select", "Select", { bind: "choice" }, "card"),
    catalogNode("metric", "Metric", { value: "result" }),
    catalogNode("bar", "Bar", { value: "result", max: "20" }),
    catalogNode("grid", "Grid", {
      rows: "3",
      cols: "4",
      label: "Example grid",
    }),
    catalogNode("chart", "LineChart", { x: "amount", y: "result" }),
    catalogNode("steps", "SortableList", { label: "Steps" }, "main", steps),
    catalogNode(
      "groups",
      "Buckets",
      { groups: "Group A|Group B", label: "Choose groups" },
      "main",
      steps,
    ),
    catalogNode(
      "compare",
      "CompareCards",
      { label: "Choose a card" },
      "main",
      steps,
    ),
  ],
});

test("all catalog components fit narrow boards and exact slider entry updates live values", async ({
  page,
}, info) => {
  await setup(page, false, catalogBoard());
  const board = await expanded(page);
  await board
    .getByRole("spinbutton", { name: "Value for Amount", exact: true })
    .fill("8");
  await expect(
    board.getByRole("slider", { name: "Amount", exact: true }),
  ).toHaveValue("8");
  await expect(
    board.getByRole("spinbutton", { name: "Exact amount", exact: true }),
  ).toHaveValue("8");
  await expect(board.locator(".board-metrics dd")).toHaveText("16");
  await board.getByRole("switch", { name: "Enabled Off", exact: true }).click();
  await choose(page, board, "Choice", "Option B");
  await board
    .getByRole("button", { name: "Move First step down", exact: true })
    .click();
  await choose(page, board, "First step", "Group A");
  const card = board
    .locator(".comparison-items")
    .getByRole("button", { name: "Second step Continue here", exact: true });
  await card.click();
  await expect(card).toHaveAttribute("aria-pressed", "true");
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await board.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
  }
  await expect
    .poll(async () => (await saved(page))?.workspace.board.state)
    .toEqual({ amount: 8, enabled: 1, choice: 1 });
  expect(
    (await new AxeBuilder({ page }).include(".board-expanded-modal").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("catalog-board.png") });
});

test("sort handles support touch drag and cancel without changing the saved order", async ({
  page,
}) => {
  const definition = catalogBoard();
  definition.state = [];
  definition.derived = [];
  definition.code = "";
  definition.nodes = [
    catalogNode("main", "Stack", {}, ""),
    catalogNode("steps", "SortableList", { label: "Steps" }, "main", steps),
  ];
  await setup(page, false, definition);
  const board = await expanded(page);
  const list = board.locator(".sequence-items");
  await list.scrollIntoViewIfNeeded();
  const handle = board.getByRole("button", {
    name: "Drag First step to reorder, or use arrow keys",
    exact: true,
  });
  const start = (await handle.boundingBox())!;
  const end = (await list.locator("li").last().boundingBox())!;
  const client = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1 }];
  for (const cancel of [true, false]) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: point(start.x + start.width / 2, start.y + start.height / 2),
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: point(end.x + 30, end.y + end.height / 2),
    });
    await expect(list.locator("[data-drop-target]")).toHaveCount(1);
    await client.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await expect(list.locator("[data-drop-target]")).toHaveCount(0);
    await expect(list.locator("li").first()).toContainText(
      cancel ? "First step" : "Second step",
    );
  }
  await expect
    .poll(async () => (await saved(page))?.workspace.board.composites.steps)
    .toEqual(["second", "third", "first"]);
  await page.reload();
  const restored = await open(page);
  await expect(restored.locator(".sequence-items li").last()).toContainText(
    "First step",
  );
});

test("concepts and sketch objects can be added, edited and moved by click or keyboard", async ({
  page,
}, info) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "concept_map");
  await addConcept(page, board, "One idea");
  const node = board.getByRole("button", {
    name: "Edit concept One idea",
    exact: true,
  });
  await node.click();
  const popup = page.getByRole("dialog", { name: "Edit concept", exact: true });
  await popup.getByLabel("Concept", { exact: true }).fill("Renamed idea");
  await popup
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await board.getByRole("button", { name: "Move right", exact: true }).click();
  await expect
    .poll(async () => (await saved(page))?.workspace.tools.concept_map.nodes[0])
    .toMatchObject({ label: "Renamed idea", x: 175 });
  await page.screenshot({ path: info.outputPath("concept-board.png") });
  await chooseTool(page, board, "sketch");
  await board.getByRole("button", { name: "Rectangle", exact: true }).click();
  await board.getByRole("button", { name: "Add shape", exact: true }).click();
  await board.getByLabel("Object line width", { exact: true }).fill("10");
  await choose(page, board, "Object color", "Green");
  await board
    .getByRole("button", { name: "Duplicate object", exact: true })
    .click();
  await expect
    .poll(
      async () => (await saved(page))?.workspace.tools.sketch.objects.length,
    )
    .toBe(2);
  await board.getByRole("button", { name: "Text label", exact: true }).click();
  await board.getByRole("button", { name: "Add label", exact: true }).click();
  const originalLabelDialog = page.getByRole("dialog", {
    name: "Text label",
  });
  await originalLabelDialog
    .getByLabel("Text label", { exact: true })
    .fill("Original label");
  await originalLabelDialog
    .getByRole("button", { name: "Add label", exact: true })
    .click();
  await board.getByLabel("Edit label", { exact: true }).fill("Edited label");
  await expect
    .poll(
      async () => (await saved(page))?.workspace.tools.sketch.objects[2]?.text,
    )
    .toBe("Edited label");
  expect((await saved(page))?.workspace.tools.sketch.objects[0]).toMatchObject({
    color: "#287b62",
    width: 10,
  });
  const canvas = board.getByRole("img", { name: "Sketch canvas" });
  await canvas.focus();
  await canvas.press("ControlOrMeta+z");
  await expect(board.getByLabel("Edit label", { exact: true })).toHaveValue(
    "Original label",
  );
  expect(
    (await new AxeBuilder({ page }).include(".board-expanded-modal").analyze())
      .violations,
  ).toEqual([]);
});
test("matching pairs support tap connections and keyboard reconnection", async ({
  page,
}, info) => {
  const definition = catalogBoard();
  definition.state = [];
  definition.derived = [];
  definition.code = "";
  definition.nodes = [catalogNode("main", "Stack", {}, "")];
  definition.suggestedTool = { kind: "matching", columns: [], items: steps };
  await setup(page, false, definition);
  const board = await expanded(page);
  await board.locator(".matching-columns").scrollIntoViewIfNeeded();
  await expect(
    board.getByText("1. Choose a term", { exact: true }),
  ).toBeVisible();
  await expect(
    board.getByText("2. Choose its description", { exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole("button", { name: "Start here", exact: true }),
  ).toBeDisabled();
  for (const button of await board.getByRole("button").all()) {
    if (!(await button.isVisible())) continue;
    const bounds = (await button.boundingBox())!;
    const size = 32;
    expect(bounds.height).toBeGreaterThanOrEqual(size);
    expect(bounds.width).toBeGreaterThanOrEqual(size);
  }
  await expect(board.locator(".board-match-handle")).toHaveCount(0);
  await board.getByRole("button", { name: "First step", exact: true }).click();
  await board.getByRole("button", { name: "Start here", exact: true }).click();
  await expect(
    board.getByText("1 of 3 connected", { exact: true }),
  ).toBeVisible();
  await board.getByRole("button", { name: "Second step", exact: true }).click();
  await expect(
    board.getByText("Choose a description for Second step.", { exact: true }),
  ).toBeVisible();
  await expect(
    board.getByRole("button", { name: "Continue here", exact: true }),
  ).toBeEnabled();
  await board
    .getByRole("button", { name: "Continue here", exact: true })
    .click();
  await expect(
    board.getByText("2 of 3 connected", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        Object.keys(
          (await saved(page))?.workspace.tools.suggested.matches ?? {},
        ).length,
    )
    .toBe(2);
  expect(
    (await new AxeBuilder({ page }).include(".board-expanded-modal").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: info.outputPath("matching-board.png") });
  const secondTerm = board.getByRole("button", {
    name: "Second step",
    exact: true,
  });
  const secondDescription = board.getByRole("button", {
    name: "Continue here",
    exact: true,
  });
  await expect(secondTerm.locator(".matching-pair-number")).toHaveText("2");
  await expect(secondDescription.locator(".matching-pair-number")).toHaveText(
    "2",
  );
  await expect(secondDescription).toHaveAccessibleDescription(
    /Connected to: Second step/,
  );
  // Reconnecting an occupied description moves the connection, including its label.
  await secondTerm.focus();
  await page.keyboard.press("Enter");
  const firstDescription = board.getByRole("button", {
    name: "Start here",
    exact: true,
  });
  await firstDescription.focus();
  await page.keyboard.press("Enter");
  await expect(firstDescription.locator(".matching-pair-number")).toHaveText(
    "2",
  );
  await expect(secondDescription.locator(".matching-pair-number")).toHaveText(
    "—",
  );
  await expect(
    board.getByText("1 of 3 connected", { exact: true }),
  ).toBeVisible();
  await board
    .getByRole("button", { name: "Reset connections", exact: true })
    .click();
  await expect(
    board.getByText("0 of 3 connected", { exact: true }),
  ).toBeVisible();
  await expect(firstDescription).toBeDisabled();
});
test("matching terms and descriptions can be added and deleted independently", async ({
  page,
}, info) => {
  const definition = catalogBoard();
  definition.state = [];
  definition.derived = [];
  definition.code = "";
  definition.nodes = [catalogNode("main", "Stack", {}, "")];
  definition.suggestedTool = { kind: "matching", columns: [], items: steps };
  await setup(page, false, definition);
  let board = await expanded(page);
  await board.getByRole("button", { name: "First step", exact: true }).click();
  await board.getByRole("button", { name: "Start here", exact: true }).click();
  await board.getByRole("button", { name: "Second step", exact: true }).click();
  await board
    .getByRole("button", { name: "Continue here", exact: true })
    .click();
  await board.getByRole("button", { name: "Edit", exact: true }).click();
  await board
    .getByRole("button", { name: "Delete term 1", exact: true })
    .click();
  await expect(
    board.getByRole("button", { name: "Term 1: Second step", exact: true }),
  ).toBeFocused();
  await expect(
    board.getByRole("button", {
      name: "Description 1: Start here",
      exact: true,
    }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await saved(page))?.workspace.tools.suggested.pairs.filter(
          (p: any) => p.term !== undefined,
        ).length,
    )
    .toBe(2);
  let draft = (await saved(page)).workspace.tools.suggested;
  expect(draft.pairs.filter((p: any) => p.term !== undefined)).toHaveLength(2);
  expect(
    draft.pairs.filter((p: any) => p.description !== undefined),
  ).toHaveLength(3);
  expect(Object.keys(draft.matches)).toHaveLength(1);
  await board
    .getByRole("button", { name: "Delete description 2", exact: true })
    .click();
  await expect(
    board.getByRole("button", { name: "Term 1: Second step", exact: true }),
  ).toBeVisible();
  await board.getByRole("button", { name: "Add term", exact: true }).click();
  const term = board.getByRole("textbox", { name: "Term 3", exact: true });
  await expect(term).toBeFocused();
  await term.fill("New term");
  await term.press("Enter");
  await expect
    .poll(async () =>
      (await saved(page))?.workspace.tools.suggested.pairs.some(
        (p: any) => p.term === "New term",
      ),
    )
    .toBe(true);
  draft = (await saved(page)).workspace.tools.suggested;
  expect(
    draft.pairs.filter((p: any) => p.description !== undefined),
  ).toHaveLength(2);
  expect(draft.matches).toEqual({});
  await board
    .getByRole("button", { name: "Add description", exact: true })
    .click();
  const description = board.getByRole("textbox", {
    name: "Description 3",
    exact: true,
  });
  await expect(description).toBeFocused();
  await description.fill("New description");
  await description.press("Enter");
  await expect
    .poll(async () =>
      (await saved(page))?.workspace.tools.suggested.pairs.some(
        (p: any) => p.description === "New description",
      ),
    )
    .toBe(true);
  await page.screenshot({ path: info.outputPath("independent-matching.png") });
  await board.getByRole("button", { name: "Done", exact: true }).click();
  const descriptionOrder = async () =>
    board
      .locator("[data-match-description]")
      .evaluateAll((items) =>
        items.map((item) => item.getAttribute("aria-label")),
      );
  expect(await descriptionOrder()).toEqual([
    "Start here",
    "Finish here",
    "New description",
  ]);
  await board.getByRole("button", { name: "Edit", exact: true }).click();
  await expect(
    board.getByRole("button", {
      name: "Description 3: New description",
      exact: true,
    }),
  ).toBeVisible();
  await board.getByRole("button", { name: "Done", exact: true }).click();
  expect(await descriptionOrder()).toEqual([
    "Start here",
    "Finish here",
    "New description",
  ]);
  await page.reload();
  board = await expanded(page);
  expect(await descriptionOrder()).toEqual([
    "Start here",
    "Finish here",
    "New description",
  ]);
  await board.getByRole("button", { name: "New term", exact: true }).click();
  await board.getByRole("button", { name: "Start here", exact: true }).click();
  await expect(
    board.getByText("1 of 3 connected", { exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        Object.keys(
          (await saved(page))?.workspace.tools.suggested.matches ?? {},
        ).length,
    )
    .toBe(1);
  draft = (await saved(page)).workspace.tools.suggested;
  const newTerm = draft.pairs.find((p: any) => p.term === "New term");
  const preservedDescription = draft.pairs.find(
    (p: any) => p.description === "Start here",
  );
  expect(preservedDescription).not.toHaveProperty("term");
  expect(draft.matches[newTerm.id]).toBe(preservedDescription.id);
  expect(
    draft.pairs.some((p: any) => p.description === "New description"),
  ).toBe(true);
});

test("concept maps, matching and comparison tables work with keyboard controls", async ({
  page,
}) => {
  await setup(page);
  const board = await open(page);
  await chooseTool(page, board, "concept_map");
  for (const name of ["Cause", "Effect"]) {
    await addConcept(page, board, name);
  }
  await board
    .getByRole("button", { name: "Select concept Cause", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await board
    .getByRole("button", { name: "Add relationship", exact: true })
    .click();
  const relationship = page.getByRole("dialog", {
    name: "Add relationship",
    exact: true,
  });
  await choose(page, relationship, "From", "Cause");
  await choose(page, relationship, "To", "Effect");
  await relationship
    .getByLabel("Relationship", { exact: true })
    .fill("leads to");
  await relationship
    .getByRole("button", { name: "Connect concepts", exact: true })
    .click();
  await expect(
    board.getByRole("button", {
      name: "Edit relationship leads to",
      exact: true,
    }),
  ).toBeVisible();
  await chooseTool(page, board, "matching");
  for (let n = 1; n <= 2; n++) {
    await board.getByRole("button", { name: "Add term", exact: true }).click();
    const term = board.getByRole("textbox", { name: `Term ${n}`, exact: true });
    await expect(term).toBeFocused();
    await term.fill(n === 1 ? "Evaporation" : "Condensation");
    await page.keyboard.press("Enter");
    await board
      .getByRole("button", { name: "Add description", exact: true })
      .click();
    await board
      .getByRole("textbox", { name: `Description ${n}`, exact: true })
      .fill(n === 1 ? "Liquid to gas" : "Gas to liquid");
  }
  await board.getByRole("button", { name: "Done", exact: true }).click();
  await board.getByRole("button", { name: "Evaporation", exact: true }).click();
  await board
    .getByRole("button", { name: "Liquid to gas", exact: true })
    .click();
  await expect(
    board.getByText("1 of 2 connected", { exact: true }),
  ).toBeVisible();
  await chooseTool(page, board, "table");
  await board
    .getByRole("textbox", { name: "Row 1, Concept", exact: true })
    .fill("Evaporation");
  await board.getByRole("button", { name: "Add row", exact: true }).click();
  await board.getByRole("button", { name: "Add column", exact: true }).click();
  await expect(
    board.getByRole("textbox", { name: "Column 4", exact: true }),
  ).toBeVisible();
  const results = await new AxeBuilder({ page })
    .include(".board-workspace")
    .analyze();
  expect(results.violations).toEqual([]);
  await board
    .getByRole("button", { name: "Attach to explanation", exact: true })
    .click();
  await expect(
    page.locator(".board-attachment").getByText("Evaporation", { exact: true }),
  ).toBeVisible();
});
test("blocked local storage leaves the workspace usable with a saving notice", async ({
  page,
}) => {
  await page.addInitScript(() =>
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new Error("Storage blocked");
      },
    }),
  );
  await setup(page);
  const board = await open(page);
  await expect(
    board.getByText(
      "Browser saving is unavailable. Keep this page open to preserve your board.",
    ),
  ).toBeVisible();
  await chooseTool(page, board, "table");
  await board
    .getByRole("textbox", { name: "Row 1, Example", exact: true })
    .fill("A useful example");
  await board
    .getByRole("button", { name: "Attach to explanation", exact: true })
    .click();
  await expect(
    page
      .locator(".board-attachment")
      .getByText("A useful example", { exact: true }),
  ).toBeVisible();
});

test("concept-map popups support CRUD, cancel, validation and focus return without scrolling the board", async ({
  page,
}, info) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "concept_map");
  for (const name of ["Cause", "Effect", "Context"])
    await addConcept(page, board, name);
  await board
    .getByRole("button", { name: "Select concept Cause", exact: true })
    .click();
  const boardScroll = await page
    .locator(".board-expanded-modal")
    .evaluate((dialog) => dialog.scrollTop);
  const node = board.getByRole("button", {
    name: "Edit concept Cause",
    exact: true,
  });
  await node.click();
  let popup = page.getByRole("dialog", { name: "Edit concept", exact: true });
  await expect(popup.getByLabel("Concept", { exact: true })).toBeFocused();
  await popup.screenshot({ path: info.outputPath("concept-popup-focus.png") });
  await popup.getByLabel("Concept", { exact: true }).fill("Unsaved idea");
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(node).toBeFocused();
  await node.click();
  await popup.getByLabel("Concept", { exact: true }).fill("Source");
  await popup
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(
    board.getByRole("button", { name: "Edit concept Source", exact: true }),
  ).toBeFocused();
  await board
    .getByRole("button", { name: "Edit concept Source", exact: true })
    .click();
  await popup
    .getByRole("button", { name: "Add relationship", exact: true })
    .click();
  popup = page.getByRole("dialog", { name: "Add relationship", exact: true });
  await expect(
    popup.getByRole("combobox", { name: "From", exact: true }),
  ).toHaveText("Source");
  await popup
    .getByRole("button", { name: "Connect concepts", exact: true })
    .click();
  await expect(
    popup.getByText("Enter a relationship.", { exact: true }),
  ).toBeVisible();
  await choose(page, popup, "To", "Effect");
  await popup.getByLabel("Relationship", { exact: true }).fill("causes");
  await popup
    .getByRole("button", { name: "Connect concepts", exact: true })
    .click();
  await expect(
    board.getByRole("button", {
      name: "Edit relationship causes",
      exact: true,
    }),
  ).toBeVisible();
  await board
    .getByRole("button", { name: "Edit relationship causes", exact: true })
    .click();
  popup = page.getByRole("dialog", { name: "Edit relationship", exact: true });
  await choose(page, popup, "To", "Context");
  await popup.getByLabel("Relationship", { exact: true }).fill("shapes");
  await popup
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect
    .poll(
      async () =>
        (await saved(page))?.workspace.tools.concept_map.links[0]?.label,
    )
    .toBe("shapes");
  await board
    .getByRole("button", { name: "Edit relationship shapes", exact: true })
    .click();
  popup = page.getByRole("dialog", { name: "Edit relationship", exact: true });
  await popup.getByRole("combobox", { name: "From", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(popup).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(popup).not.toBeVisible();
  await expect(
    board.getByRole("button", {
      name: "Edit relationship shapes",
      exact: true,
    }),
  ).toBeFocused();
  expect(
    await page
      .locator(".board-expanded-modal")
      .evaluate((dialog) => dialog.scrollTop),
  ).toBe(boardScroll);
  await board
    .getByRole("button", { name: "Edit relationship shapes", exact: true })
    .click();
  await popup
    .getByRole("button", { name: "Delete relationship shapes", exact: true })
    .click();
  await expect(
    board.getByRole("button", {
      name: "Edit relationship shapes",
      exact: true,
    }),
  ).toHaveCount(0);
  await board
    .getByRole("button", { name: "Add relationship", exact: true })
    .click();
  popup = page.getByRole("dialog", { name: "Add relationship", exact: true });
  await choose(page, popup, "From", "Source");
  await choose(page, popup, "To", "Effect");
  await popup.getByLabel("Relationship", { exact: true }).fill("leads to");
  await popup
    .getByRole("button", { name: "Connect concepts", exact: true })
    .click();
  await board
    .getByRole("button", { name: "Select concept Source", exact: true })
    .click();
  await board
    .getByRole("button", { name: "Edit concept Source", exact: true })
    .click();
  popup = page.getByRole("dialog", { name: "Edit concept", exact: true });
  await expect(
    popup.getByRole("button", {
      name: "Edit relationship leads to",
      exact: true,
    }),
  ).toBeVisible();
  await popup
    .getByRole("button", { name: "Delete concept Source", exact: true })
    .click();
  await expect(
    board.getByRole("button", { name: "Add concept", exact: true }),
  ).toBeFocused();
  await expect
    .poll(async () => (await saved(page))?.workspace.tools.concept_map)
    .toMatchObject({
      nodes: [{ label: "Effect" }, { label: "Context" }],
      links: [],
    });
  await board.getByRole("button", { name: "Add concept", exact: true }).click();
  popup = page.getByRole("dialog", { name: "Add concept", exact: true });
  await popup
    .getByLabel("New concept", { exact: true })
    .fill("Canceled concept");
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    board.getByRole("button", {
      name: "Select concept Canceled concept",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("map-crud.png") });
  await page.reload();
  const restored = await open(page);
  await expect(
    restored.getByRole("button", {
      name: "Select concept Effect",
      exact: true,
    }),
  ).toBeVisible();
});

test("concept map context menu edits, connects, and deletes without closing the board", async ({
  page,
}) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "concept_map");
  await addConcept(page, board, "Cause");
  await addConcept(page, board, "Effect");
  const cause = board.getByRole("button", {
    name: "Select concept Cause",
    exact: true,
  });
  const menu = page.getByRole("menu", { name: "Concept map actions" });
  await cause.click({ button: "right" });
  await expect(
    menu.getByRole("menuitem", { name: "Edit concept Cause", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    menu.getByRole("menuitem", { name: "Add relationship", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Your teaching board" }),
  ).toBeVisible();
  await expect(cause).toBeFocused();
  await cause.dispatchEvent("contextmenu", {
    bubbles: true,
    clientX: 0,
    clientY: 0,
  });
  await expect(
    menu.getByRole("menuitem", { name: "Edit concept Cause", exact: true }),
  ).toBeVisible();
  await menu
    .getByRole("menuitem", { name: "Add relationship", exact: true })
    .click();
  let popup = page.getByRole("dialog", {
    name: "Add relationship",
    exact: true,
  });
  await expect(
    popup.getByRole("combobox", { name: "From", exact: true }),
  ).toHaveText("Cause");
  await choose(page, popup, "To", "Effect");
  await popup.getByLabel("Relationship", { exact: true }).fill("causes");
  await popup
    .getByRole("button", { name: "Connect concepts", exact: true })
    .click();
  const link = board.getByRole("button", {
    name: "Edit relationship causes",
    exact: true,
  });
  await link.click({ button: "right" });
  await menu
    .getByRole("menuitem", { name: "Delete relationship causes", exact: true })
    .click();
  await expect(link).toHaveCount(0);
  await cause.click({ button: "right" });
  await menu
    .getByRole("menuitem", { name: "Delete concept Cause", exact: true })
    .click();
  await expect(cause).toHaveCount(0);
  await expect(
    board.getByRole("button", { name: "Add concept", exact: true }),
  ).toBeFocused();
  await expect
    .poll(async () => (await saved(page))?.workspace.tools.concept_map)
    .toMatchObject({ nodes: [{ label: "Effect" }], links: [] });
  await board.locator("[data-concept-scene]").click({
    button: "right",
    position: { x: 12, y: 12 },
  });
  await menu
    .getByRole("menuitem", { name: "Add concept", exact: true })
    .click();
  popup = page.getByRole("dialog", { name: "Add concept", exact: true });
  await expect(popup.getByLabel("New concept", { exact: true })).toBeFocused();
  await popup.getByLabel("New concept", { exact: true }).fill("Corner");
  await popup.getByRole("button", { name: "Add concept", exact: true }).click();
  await expect
    .poll(async () =>
      (await saved(page))?.workspace.tools.concept_map.nodes.find(
        (node: { label: string }) => node.label === "Corner",
      ),
    )
    .toMatchObject({ x: expect.any(Number), y: expect.any(Number) });
  const corner = (await saved(page)).workspace.tools.concept_map.nodes.find(
    (node: { label: string; x: number; y: number }) => node.label === "Corner",
  );
  expect(corner.x).toBeLessThan(80);
  expect(corner.y).toBeLessThan(80);
  await expect(
    page.getByRole("dialog", { name: "Your teaching board" }),
  ).toBeVisible();
});

test("concept map allows only one direction between two concepts", async ({
  page,
}) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "concept_map");
  for (const name of ["Cause", "Effect"]) await addConcept(page, board, name);
  await board
    .getByRole("button", { name: "Add relationship", exact: true })
    .click();
  let popup = page.getByRole("dialog", {
    name: "Add relationship",
    exact: true,
  });
  await choose(page, popup, "From", "Cause");
  await choose(page, popup, "To", "Effect");
  await popup.getByLabel("Relationship", { exact: true }).fill("causes");
  await popup
    .getByRole("button", { name: "Connect concepts", exact: true })
    .click();
  await expect(
    board.getByRole("button", {
      name: "Edit relationship causes",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    board.getByRole("button", { name: "Add relationship", exact: true }),
  ).toBeDisabled();
  await addConcept(page, board, "Context");
  await board
    .getByRole("button", { name: "Add relationship", exact: true })
    .click();
  popup = page.getByRole("dialog", { name: "Add relationship", exact: true });
  await choose(page, popup, "From", "Cause");
  await popup.getByRole("combobox", { name: "To", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Effect", exact: true }),
  ).toHaveCount(0);
  await page.keyboard.press("Escape");
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await board
    .getByRole("button", { name: "Edit relationship causes", exact: true })
    .click();
  popup = page.getByRole("dialog", { name: "Edit relationship", exact: true });
  await popup.getByRole("combobox", { name: "To", exact: true }).click();
  await expect(
    page.getByRole("option", { name: "Effect", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await expect(popup).not.toBeVisible();
  await expect(
    board.getByRole("button", {
      name: "Edit relationship causes",
      exact: true,
    }),
  ).toHaveCount(1);
});

test("map popup controls align and remain reachable across narrow, tablet and desktop viewports", async ({
  page,
}, info) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "concept_map");
  await addConcept(page, board, "First idea");
  await addConcept(page, board, "Second idea");
  for (const width of [320, 768, 1440]) {
    await page.setViewportSize({ width, height: 700 });
    await board
      .getByRole("button", { name: "Add relationship", exact: true })
      .click();
    const popup = page.getByRole("dialog", {
      name: "Add relationship",
      exact: true,
    });
    await expect(
      popup.getByRole("combobox", { name: "From", exact: true }),
    ).toBeFocused();
    const controls = [
      popup.getByRole("combobox", { name: "From", exact: true }),
      popup.getByRole("combobox", { name: "To", exact: true }),
      popup.getByLabel("Relationship", { exact: true }),
    ];
    const bounds = await Promise.all(
      controls.map((control) => control.boundingBox()),
    );
    for (const rect of bounds) {
      expect(rect!.height).toBeGreaterThanOrEqual(44);
      expect(rect!.x).toBeCloseTo(bounds[0]!.x, 0);
      expect(rect!.width).toBeCloseTo(bounds[0]!.width, 0);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(width);
    }
    // Keyboard focus must remain visible outside each control's border.
    for (const control of controls) {
      await control.press("Tab");
      await page.keyboard.press("Shift+Tab");
      await expect(control).toBeFocused();
      const focus = await control.evaluate((element) => {
        const style = getComputedStyle(element);
        const extent =
          parseFloat(style.outlineWidth) +
          Math.max(0, parseFloat(style.outlineOffset));
        const field = element.getBoundingClientRect();
        const body = element
          .closest("form")!
          .firstElementChild!.getBoundingClientRect();
        return {
          outline: style.outlineStyle,
          left: field.left - extent - body.left,
          right: body.right - field.right - extent,
          top: field.top - extent - body.top,
          bottom: body.bottom - field.bottom - extent,
        };
      });
      expect(focus.outline).not.toBe("none");
      for (const clearance of [
        focus.left,
        focus.right,
        focus.top,
        focus.bottom,
      ])
        expect(clearance).toBeGreaterThanOrEqual(0);
    }
    const submit = popup.getByRole("button", {
      name: "Connect concepts",
      exact: true,
    });
    const submitBounds = (await submit.boundingBox())!;
    expect(submitBounds.y + submitBounds.height).toBeLessThanOrEqual(700);
    expect(
      await popup.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      (await new AxeBuilder({ page }).include("dialog[open]").analyze())
        .violations,
    ).toEqual([]);
    await page.screenshot({
      path: info.outputPath(`relationship-popup-${width}.png`),
    });
    await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  }
  await page.setViewportSize({ width: 320, height: 480 });
  await board
    .getByRole("button", { name: "Add relationship", exact: true })
    .click();
  const popup = page.getByRole("dialog", {
    name: "Add relationship",
    exact: true,
  });
  const submit = (await popup
    .getByRole("button", { name: "Connect concepts", exact: true })
    .boundingBox())!;
  expect(submit.y + submit.height).toBeLessThanOrEqual(480);
});

test("touch dragging a concept moves it without opening a popup and cancellation restores its position", async ({
  page,
}) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "concept_map");
  await addConcept(page, board, "An idea");
  const node = board.getByRole("button", {
    name: "Select concept An idea",
    exact: true,
  });
  await expect(node).toHaveCSS("touch-action", "none");
  const scene = board
    .getByRole("img", { name: "Concept relationships", exact: true })
    .locator("..");
  const client = await page.context().newCDPSession(page);
  for (const cancel of [true, false]) {
    const start = (await node.boundingBox())!;
    const map = (await scene.boundingBox())!;
    await client.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: start.x + start.width / 2, y: start.y + start.height / 2, id: 1 },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: cancel ? start.x + start.width / 2 + 30 : map.x,
          y: start.y + start.height / 2 + 30,
          id: 1,
        },
      ],
    });
    await client.send("Input.dispatchTouchEvent", {
      type: cancel ? "touchCancel" : "touchEnd",
      touchPoints: [],
    });
    await expect(
      page.getByRole("dialog", { name: "Edit concept", exact: true }),
    ).toHaveCount(0);
    if (cancel)
      await expect
        .poll(
          async () =>
            (await saved(page))?.workspace.tools.concept_map.nodes[0]?.x,
        )
        .toBe(160);
    else {
      await expect
        .poll(
          async () =>
            (await saved(page))?.workspace.tools.concept_map.nodes[0]?.x,
        )
        .toBeLessThan(155);
      await expect
        .poll(async () => (await node.boundingBox())!.x - map.x)
        .toBeCloseTo(7, 0);
    }
  }
});

test("concept selection shows live position controls below the map and clears on click-away or Escape", async ({
  page,
}, info) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "concept_map");
  await addConcept(page, board, "First idea");
  await addConcept(page, board, "Second idea");
  const first = board.getByRole("button", {
    name: "Select concept First idea",
    exact: true,
  });
  const second = board.getByRole("button", {
    name: "Select concept Second idea",
    exact: true,
  });
  const controls = board.getByRole("group", {
    name: "Selected concept",
    exact: true,
  });
  await expect(second).toHaveAttribute("aria-pressed", "true");
  await first.click();
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(second).toHaveAttribute("aria-pressed", "false");
  await expect(controls.getByText("First idea", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Edit concept", exact: true }),
  ).toHaveCount(0);
  const mapBounds = (await board
    .getByRole("img", { name: "Concept relationships", exact: true })
    .boundingBox())!;
  expect((await controls.boundingBox())!.y).toBeGreaterThanOrEqual(
    mapBounds.y + mapBounds.height,
  );
  await controls
    .getByRole("button", { name: "Move right", exact: true })
    .click();
  await expect
    .poll(
      async () => (await saved(page))?.workspace.tools.concept_map.nodes[0]?.x,
    )
    .toBe(175);
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await controls
    .getByRole("button", { name: "Edit concept First idea", exact: true })
    .click();
  const popup = page.getByRole("dialog", { name: "Edit concept", exact: true });
  await expect(
    popup.getByRole("button", { name: "Move right", exact: true }),
  ).toHaveCount(0);
  await expect(
    popup.getByRole("group", { name: "Position", exact: true }),
  ).toHaveCount(0);
  await popup.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(controls).toBeVisible();
  await page.screenshot({
    path: info.outputPath("selected-concept-controls.png"),
  });
  await page.mouse.click(
    mapBounds.x + mapBounds.width - 12,
    mapBounds.y + mapBounds.height - 12,
  );
  await expect(controls).toHaveCount(0);
  await expect(first).toHaveAttribute("aria-pressed", "false");
  await first.click();
  await page
    .getByRole("dialog", { name: "Your teaching board", exact: true })
    .getByText("Board tool", { exact: true })
    .click();
  await expect(controls).toHaveCount(0);
  await first.click();
  await first.press("Escape");
  await expect(controls).toHaveCount(0);
  await expect(
    page.getByRole("dialog", { name: "Your teaching board", exact: true }),
  ).toBeVisible();
  await expect
    .poll(
      async () => (await saved(page))?.workspace.tools.concept_map.nodes[0]?.x,
    )
    .toBe(175);
  expect(
    (await new AxeBuilder({ page }).include(".board-expanded-modal").analyze())
      .violations,
  ).toEqual([]);
});

test("concepts reach every map edge without clipping at narrow and wide sizes", async ({
  page,
}, info) => {
  await setup(page);
  const board = await expanded(page);
  await chooseTool(page, board, "concept_map");
  await addConcept(page, board, "Short");
  await addConcept(page, board, "A much longer concept with several words");
  const scene = board
    .getByRole("img", { name: "Concept relationships", exact: true })
    .locator("..");
  const controls = board.getByRole("group", {
    name: "Selected concept",
    exact: true,
  });
  const edges = [
    ["left", "ArrowRight", "Move left"],
    ["right", "ArrowLeft", "Move right"],
    ["top", "ArrowDown", "Move up"],
    ["bottom", "ArrowUp", "Move down"],
  ] as const;
  for (const width of [910, 320, 1440]) {
    await page.setViewportSize({ width, height: 887 });
    for (const name of ["Short", "A much longer concept with several words"]) {
      const node = board.getByRole("button", {
        name: `Select concept ${name}`,
        exact: true,
      });
      // Separate concepts that were both moved to the same corner before resize.
      for (let step = 0; step < 12; step++) await node.press("ArrowUp");
      for (const [edge, awayKey, returnButton] of edges) {
        await node.scrollIntoViewIfNeeded();
        const map = (await scene.boundingBox())!;
        const box = (await node.boundingBox())!;
        const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
        await page.mouse.move(start.x, start.y);
        await page.mouse.down();
        await page.mouse.move(
          edge === "left"
            ? map.x
            : edge === "right"
              ? map.x + map.width
              : start.x,
          edge === "top"
            ? map.y
            : edge === "bottom"
              ? map.y + map.height
              : start.y,
          { steps: 5 },
        );
        await page.mouse.up();
        const gap = async () => {
          const map = (await scene.boundingBox())!;
          const box = (await node.boundingBox())!;
          return {
            left: box.x - map.x,
            right: map.x + map.width - box.x - box.width,
            top: box.y - map.y,
            bottom: map.y + map.height - box.y - box.height,
          };
        };
        await expect.poll(async () => (await gap())[edge]).toBeCloseTo(7, 0);
        for (const distance of Object.values(await gap()))
          expect(distance).toBeGreaterThanOrEqual(6);
        if (width === 910 && name === "Short" && edge === "left")
          await page.screenshot({
            path: info.outputPath("map-left-boundary.png"),
          });
        const button = controls.getByRole("button", {
          name: returnButton,
          exact: true,
        });
        await expect(button).toBeDisabled();
        await node.press(awayKey);
        await expect(button).toBeEnabled();
        await button.click();
        await expect.poll(async () => (await gap())[edge]).toBeCloseTo(7, 0);
        await expect(button).toBeDisabled();
      }
    }
    await page.screenshot({
      path: info.outputPath(`map-boundary-${width}.png`),
    });
  }
  await page.reload();
  const restored = await expanded(page);
  await expect(
    restored.getByRole("button", { name: "Select concept Short", exact: true }),
  ).toBeVisible();
  const restoredNode = restored.getByRole("button", {
    name: "Select concept A much longer concept with several words",
    exact: true,
  });
  const restoredScene = restored
    .getByRole("img", { name: "Concept relationships", exact: true })
    .locator("..");
  await expect
    .poll(async () => {
      const node = (await restoredNode.boundingBox())!;
      const map = (await restoredScene.boundingBox())!;
      return map.y + map.height - node.y - node.height;
    })
    .toBeCloseTo(7, 0);
});
