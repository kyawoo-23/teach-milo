import { test, expect, type Page, type Locator } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";
const id = "11111111-1111-4111-8111-111111111111";
const owner = "board-learner";
const key = `teachback-board:${owner}:${id}`;
async function setup(page: Page, failTurn = false) {
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
  await board
    .getByLabel("Text label", { exact: true })
    .fill("Same weights at every position");
  await board.getByRole("button", { name: "Add label", exact: true }).click();
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
  await board.getByLabel("Text label", { exact: true }).fill("A later change");
  await board.getByRole("button", { name: "Add label", exact: true }).click();
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
test("concept maps, matching and comparison tables work with keyboard controls", async ({
  page,
}) => {
  await setup(page);
  const board = await open(page);
  await chooseTool(page, board, "concept_map");
  for (const name of ["Cause", "Effect"]) {
    await board.getByLabel("New concept", { exact: true }).fill(name);
    await board
      .getByRole("button", { name: "Add concept", exact: true })
      .click();
  }
  await board
    .getByRole("button", { name: "Move concept Cause", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  await choose(page, board, "From", "Cause");
  await choose(page, board, "To", "Effect");
  await board.getByLabel("Relationship", { exact: true }).fill("leads to");
  await board
    .getByRole("button", { name: "Connect concepts", exact: true })
    .click();
  await expect(
    board.getByRole("button", {
      name: "Delete relationship leads to",
      exact: true,
    }),
  ).toBeVisible();
  await chooseTool(page, board, "matching");
  for (let n = 1; n <= 2; n++) {
    await board.getByRole("button", { name: "Add pair", exact: true }).click();
    await board
      .getByLabel(`Term ${n}`, { exact: true })
      .fill(n === 1 ? "Evaporation" : "Condensation");
    await board
      .getByLabel(`Description ${n}`, { exact: true })
      .fill(n === 1 ? "Liquid to gas" : "Gas to liquid");
  }
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
