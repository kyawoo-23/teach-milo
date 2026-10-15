import { test, expect, Locator, Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { calculationSandbox } from "../../src/lib/sandbox";

const sessionId = "11111111-1111-4111-8111-111111111111";
const lessonId = "22222222-2222-4222-8222-222222222222";
const materialId = "33333333-3333-4333-8333-333333333333";
const openingId = "44444444-4444-4444-8444-444444444444";
const notes =
  "A convolution filter reuses the same learned weights at every spatial position. Changing image size changes spatial work, not the parameters of the fixed convolution layer. A 3 by 3 kernel with 3 input channels and 8 output filters has 216 weights and 8 biases.";
const lesson = {
  id: lessonId,
  title: "CNN weight sharing",
  scope:
    "Explain why larger images need more computation, while a fixed convolution layer keeps the same weights.",
  level: "introductory",
  concerns: [],
  objectives: [
    { id: "o1", label: "Explain weight reuse" },
    { id: "o2", label: "Compare parameters and computation" },
  ],
};
const sizes = ["32 × 32", "64 × 64"];
const board = {
  version: 2,
  title: "One filter. Many positions.",
  instruction:
    "Compare the two image sizes. Tell Milo what changes and what stays the same.",
  assumptions:
    "Valid convolution · stride 1 · 3×3 kernel · 3 input channels · 8 filters · biases enabled",
  state: [
    {
      id: "size",
      label: "Input size",
      unit: "",
      type: "choice",
      initial: 0,
      min: 0,
      max: 1,
      step: 1,
      options: sizes,
    },
  ],
  derived: [
    { id: "parameters", label: "Learned parameters", unit: "" },
    { id: "multiplications", label: "Multiplications", unit: "" },
  ],
  code: "function calculate(inputs) { const out = 30 + 32 * inputs.size; return { metrics: { parameters: 3 * 3 * 3 * 8 + 8, multiplications: out * out * 216 } }; }",
  nodes: [
    { id: "main", parentId: "", component: "Stack", props: [], items: [] },
    {
      id: "size_select",
      parentId: "main",
      component: "Select",
      props: [{ key: "bind", value: "size" }],
      items: [],
    },
    {
      id: "parameters_metric",
      parentId: "main",
      component: "Metric",
      props: [{ key: "value", value: "parameters" }],
      items: [],
    },
    {
      id: "work_metric",
      parentId: "main",
      component: "Metric",
      props: [{ key: "value", value: "multiplications" }],
      items: [],
    },
  ],
  suggestedTool: { kind: "none", items: [], columns: [] },
};
const sizeSnapshot = (size: number) => ({
  version: 3,
  state: { size },
  composites: {},
  kind: "board",
  verified: true,
  display: [{ label: "Input size", value: sizes[size], unit: "" }],
});
const numericFields = [
  { id: "small", label: "Parameters at 20 × 20", unit: "" },
  { id: "large", label: "Parameters at 40 × 40", unit: "" },
];
async function chooseSize(board: Locator, size: string) {
  await board.getByRole("combobox", { name: "Input size" }).click();
  await board.page().getByRole("option", { name: size, exact: true }).click();
}
async function fixtures(page: Page) {
  const state: any = {
    id: sessionId,
    phase: "baseline",
    revision: 0,
    challengeUsed: false,
    hintUsed: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    lesson,
    board,
    pending: false,
    progress: lesson.objectives.map((o) => ({ ...o, status: "missing" })),
    messages: [
      {
        id: openingId,
        role: "student",
        text: "Can you teach me why a bigger image doesn't necessarily mean more convolution weights?",
        createdAt: new Date().toISOString(),
        sequence: 0,
      },
    ],
  };
  let turns = 0;
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data =
      route.request().method() === "POST"
        ? route.request().postDataJSON()
        : undefined;
    const reply = (body: unknown, status = 200) =>
      route.fulfill({
        status,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/api/status") return reply({ configured: true, missing: [] });
    if (path === "/api/auth/me")
      return reply({
        user: { id: "learner-1", email: "learner@example.test", name: "Ada" },
      });
    if (path === "/api/materials")
      return reply({
        id: materialId,
        name: "Pasted notes",
        sources: [
          { id: "s1", label: "Pasted notes", text: notes, warnings: [] },
        ],
      });
    if (path === "/api/lessons") return reply(lesson);
    if (path === "/api/sessions") return reply(state);
    if (path.endsWith("/events")) return reply({ ok: true });
    if (path.endsWith("/turns")) {
      turns++;
      state.revision++;
      state.phase = turns >= 3 ? "ready_for_check" : "teaching";
      state.challengeUsed = turns >= 2;
      state.messages.push({
        id: data.operationId,
        role: "learner",
        text: data.text,
        board: data.board && sizeSnapshot(data.board.state.size),
        createdAt: new Date().toISOString(),
        sequence: turns * 2 - 1,
        kind: "teaching",
      });
      state.messages.push({
        id: `55555555-5555-4555-8555-55555555555${turns}`,
        role: "student",
        text:
          turns === 1
            ? "What actually gets reused when the filter moves across the image?"
            : turns === 2
              ? "If the image gets bigger, do I need to learn more copies of the filter?"
              : "Your explanation helped me connect the key ideas. Would you like to try a new example on your own?",
        sequence: turns * 2,
        createdAt: new Date().toISOString(),
      });
      state.progress = lesson.objectives.map((o) => ({
        ...o,
        status: turns >= 3 ? "supported" : "partial",
      }));
      return reply(state);
    }
    if (path.endsWith("/actions")) {
      state.revision++;
      if (data.action === "start_transfer") {
        state.phase = "transfer";
        state.numericFields = numericFields;
        state.transferQuestion =
          "A valid stride-1 convolution has 5×5 kernels, 2 input channels, and 4 output filters, with biases. Compare inputs of 20×20×2 and 40×40×2. How many learned parameters are there in each case, and what changes when the image grows? Explain why.";
      } else if (data.action === "continue") state.phase = "teaching";
      else if (data.action === "end") {
        state.phase = "report";
        state.report = {
          scores: {
            accuracy: {
              score: 2,
              status: "assessed",
              explanation: "You explained the idea clearly.",
              citations: [],
            },
            mechanism: {
              score: 2,
              status: "assessed",
              explanation: "You explained the mechanism.",
              citations: [],
            },
            evidence: {
              score: 2,
              status: "assessed",
              explanation: "You used an example.",
              citations: [],
            },
            misconception: {
              score: null,
              status: "insufficient_evidence",
              explanation: "No misconception was raised.",
              citations: [],
            },
            transfer: {
              score: null,
              status: "insufficient_evidence",
              explanation: "The independent check was skipped.",
              citations: [],
            },
          },
          total: 6,
          earnedPoints: 6,
          availablePoints: 6,
          overallLabel: "strong_evidence",
          criticalMisconception: false,
          transferCorrect: null,
          strengths: [{ text: "You taught the core idea.", citations: [] }],
          nextSteps: [
            { text: "Try the idea on a new example.", citations: [] },
          ],
          expectedTransferExplanation:
            "A later example would reuse the same idea.",
        };
      } else state.hintUsed = true;
      return reply({
        ...state,
        ...(state.phase === "transfer"
          ? { board: undefined, messages: [] }
          : {}),
      });
    }
    if (path.endsWith("/transfer")) {
      state.phase = "report";
      state.revision++;
      const answer = {
        id: data.operationId,
        role: "learner",
        text: data.answer,
        kind: "transfer",
        sequence: 7,
        createdAt: new Date().toISOString(),
      };
      state.messages.push(answer);
      const teaching = state.messages
        .filter((m: any) => m.role === "learner" && m.kind === "teaching")
        .at(-1);
      const criterion = (message: any, explanation: string) => ({
        score: 2,
        status: "assessed",
        explanation,
        citations: [{ messageId: message.id, quote: message.text }],
      });
      state.report = {
        scores: {
          accuracy: criterion(
            teaching,
            "You correctly separated learned parameters from spatial computation.",
          ),
          mechanism: criterion(
            teaching,
            "You explained that each spatial application reuses the same coefficients.",
          ),
          evidence: criterion(
            teaching,
            "You interpreted the board's numerical comparison.",
          ),
          misconception: criterion(
            teaching,
            "You corrected the idea that a bigger image requires more learned filter copies.",
          ),
          transfer: criterion(
            answer,
            "You used the new kernel and channel counts to reach 204 parameters in both cases.",
          ),
        },
        total: 10,
        earnedPoints: 10,
        availablePoints: 10,
        overallLabel: "strong_evidence",
        criticalMisconception: false,
        transferCorrect: true,
        strengths: [
          {
            text: "You made the distinction between storing weights and applying them clear.",
            citations: [
              {
                messageId: teaching.id,
                quote: "The same learned weights get reused at more positions.",
              },
            ],
          },
        ],
        nextSteps: [
          {
            text: "Try a case where the number of input channels changes, then compare it with changing image size.",
            citations: [],
          },
        ],
        expectedTransferExplanation:
          "5 × 5 × 2 × 4 = 200 weights, plus 4 biases = 204 parameters in both cases. The same weights are reused at more spatial positions. Output shapes are 16 × 16 × 4 and 36 × 36 × 4; multiplications are 51,200 and 259,200.",
      };
      return reply(state);
    }
    if (path.endsWith("/messages")) {
      const id = new URL(route.request().url()).searchParams.get("messageId");
      return reply({
        messages: state.messages.filter((m: any) => m.id === id),
      });
    }
    return reply({
      ...state,
      ...(state.phase === "transfer" ? { board: undefined, messages: [] } : {}),
    });
  });
  return { state, getTurns: () => turns };
}
test("materials-to-report golden path — scripted walkthrough", async ({
  page,
}, testInfo) => {
  const checkpoint = async () => {
    // Deliberate reading time for the backup recording, never used to synchronize tests.
    if (process.env.RECORD_WALKTHROUGH) await page.waitForTimeout(2500);
  };
  await fixtures(page);
  await page.goto("/");
  await page.evaluate(() => {
    const label = document.createElement("div");
    label.textContent = "Recorded demo · scripted responses";
    label.id = "demo-label";
    Object.assign(label.style, {
      position: "fixed",
      bottom: "8px",
      right: "8px",
      zIndex: "100",
      padding: "7px 12px",
      borderRadius: "8px",
      background: "#29263f",
      color: "white",
      font: "11px sans-serif",
      pointerEvents: "none",
    });
    document.body.append(label);
  });
  await expect(
    page.getByRole("heading", { name: "You know it. Can you teach it?" }),
  ).toBeVisible();
  await page.screenshot({
    path: `artifacts/home-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await checkpoint();
  await page.getByRole("button", { name: "Paste notes" }).click();
  await page.getByLabel("Your learning notes").fill(notes);
  await page
    .getByLabel("What would you like to focus on?")
    .fill("CNN weight sharing");
  await checkpoint();
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  await expect(
    page.getByRole("heading", { name: "Does this look right?" }),
  ).toBeVisible();
  await checkpoint();
  await page
    .getByRole("button", { name: "Looks right. Find my lesson" })
    .click();
  await expect(
    page.getByRole("heading", { name: "CNN weight sharing", exact: true }),
  ).toBeVisible();
  await checkpoint();
  await page.getByRole("button", { name: "Let’s teach Milo" }).click();
  await expect(
    page.getByRole("heading", { name: "Milo’s classroom" }),
  ).toBeVisible();
  await page
    .getByLabel("Your explanation to Milo")
    .fill("Filters reuse weights.");
  await page.getByRole("button", { name: "Send explanation" }).click();
  await expect(
    page
      .getByLabel("Teaching messages")
      .getByText(
        "What actually gets reused when the filter moves across the image?",
      ),
  ).toBeVisible();
  await page
    .getByLabel("Your explanation to Milo")
    .fill(
      "A filter contains learned coefficients. The same filter moves across the image.",
    );
  await page.getByRole("button", { name: "Send explanation" }).click();
  await expect(
    page
      .getByLabel("Teaching messages")
      .getByText(
        "If the image gets bigger, do I need to learn more copies of the filter?",
      ),
  ).toBeVisible();
  await checkpoint();
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open teaching board" }).click();
  const teachingBoard = page.locator(".teaching-board:visible");
  await chooseSize(teachingBoard, "64 × 64");
  await expect(
    teachingBoard.getByText("830304", { exact: true }),
  ).toBeVisible();
  await checkpoint();
  await teachingBoard
    .getByRole("button", { name: "Attach to explanation" })
    .click();
  await page
    .getByLabel("Your explanation to Milo")
    .fill(
      "No extra copies are learned. The same learned weights get reused at more positions. Both image sizes have 224 parameters, while multiplications grow from 194,400 to 830,304.",
    );
  await page.screenshot({
    path: `artifacts/classroom-${testInfo.project.name}.png`,
    fullPage: true,
  });
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  await page.getByRole("button", { name: "Send explanation" }).click();
  const understood = page.getByRole("dialog", { name: "Milo understood." });
  await expect(understood).toBeVisible();
  await understood.getByRole("button", { name: "Keep chatting" }).click();
  await expect(understood).toBeHidden();
  await page
    .getByRole("button", { name: "Take the independent check" })
    .click();
  await expect(
    page.getByRole("heading", { name: "One last challenge. On your own." }),
  ).toBeVisible();
  await expect(page.locator(".teaching-board")).toHaveCount(0);
  await expect(page.getByLabel("Your explanation to Milo")).toHaveCount(0);
  await checkpoint();
  await page.getByLabel("Parameters at 20 × 20").fill("204");
  await page.getByLabel("Parameters at 40 × 40").fill("204");
  await page
    .getByLabel("Explain your thinking")
    .fill(
      "5 × 5 × 2 × 4 + 4 = 204 for both. The same weights are applied at more positions, so computation increases without new parameters.",
    );
  await checkpoint();
  await page.getByRole("button", { name: "See my learning report" }).click();
  await expect(
    page.getByRole("heading", {
      name: "How did your teaching go?",
    }),
  ).toBeVisible();
  await checkpoint();
  await page.getByText("See the expected reasoning").click();
  await expect(page.getByText(/51,200 and 259,200/)).toBeVisible();
  await page.screenshot({
    path: `artifacts/report-${testInfo.project.name}.png`,
    fullPage: true,
  });
  await checkpoint();
  const analysis = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    analysis.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
test("homepage keyboard controls and accessibility", async ({ page }) => {
  await fixtures(page);
  await page.goto("/");
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Skip to content" }),
  ).toBeFocused();
  await page.getByRole("button", { name: "How it works" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  const analysis = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
    .analyze();
  expect(
    analysis.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target),
    })),
  ).toEqual([]);
});
test("worker sandbox returns calculations and terminates a stuck script", async ({
  page,
}) => {
  await page.goto("/");
  const results = await page.evaluate(async (html) => {
    const frame = document.createElement("iframe");
    frame.sandbox.add("allow-scripts");
    document.body.append(frame);
    await new Promise<void>((resolve) => {
      frame.onload = () => resolve();
      frame.srcdoc = html;
    });
    const calculate = (code: string) =>
      new Promise<any>((resolve, reject) => {
        const channel = crypto.randomUUID();
        const requestId = crypto.randomUUID();
        const timer = setTimeout(
          () => reject(new Error("Sandbox did not respond")),
          3000,
        );
        const receive = (e: MessageEvent) => {
          if (e.source !== frame.contentWindow || e.data?.channel !== channel)
            return;
          clearTimeout(timer);
          window.removeEventListener("message", receive);
          resolve(e.data);
        };
        window.addEventListener("message", receive);
        frame.contentWindow!.postMessage(
          {
            type: "calculate",
            channel,
            requestId,
            code,
            batch: [{ size: 5 }, { size: 6 }],
          },
          "*",
        );
      });
    const good = await calculate(
      "function calculate(inputs) { return {metrics:{area:inputs.size*inputs.size}}; }",
    );
    const stuck = await calculate(
      "function calculate(inputs) { while(true){} }",
    );
    const storage = await calculate(
      "function calculate(inputs) { return {metrics:{area:self.localStorage.length}}; }",
    );
    frame.remove();
    return { good, stuck, storage };
  }, calculationSandbox);
  expect(results.good.results.map((r: any) => r.metrics.area)).toEqual([
    25, 36,
  ]);
  expect(results.stuck.error).toBe("Calculation timed out");
  expect(results.storage.error).toBeTruthy();
});

test("understood celebration offers the independent check, a close, or a return to the chat", async ({
  page,
}) => {
  const { state } = await fixtures(page);
  state.phase = "ready_for_check";
  state.progress = lesson.objectives.map((objective) => ({
    ...objective,
    status: "supported",
  }));
  await page.goto(`/session/${sessionId}`);
  const dialog = page.getByRole("dialog", { name: "Milo understood." });
  await expect(dialog).toBeVisible();
  await page.waitForTimeout(350);
  await page.screenshot({ path: "artifacts/understood-desktop.png" });
  await expect(
    dialog.getByRole("button", { name: "Take the independent check" }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close session" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(page.getByLabel("Your explanation to Milo")).toBeEnabled();
  await page.reload();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Keep chatting" }).click();
  await expect(dialog).toBeHidden();
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await dialog.getByRole("button", { name: "Close session" }).click();
  await page
    .getByRole("dialog", { name: "Ready to wrap up?" })
    .getByRole("button", { name: "End and see my feedback" })
    .click();
  await expect(
    page.getByRole("heading", {
      name: "How did your teaching go?",
    }),
  ).toBeVisible();
});
test("failed turn survives refresh and retries the same operation", async ({
  page,
}) => {
  await fixtures(page);
  const operations: string[] = [];
  await page.route("**/api/sessions/*/turns", async (route) => {
    operations.push(route.request().postDataJSON().operationId);
    if (operations.length === 1)
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({
          error: {
            code: "MODEL_FAILURE",
            message: "Temporary model failure. Please retry.",
          },
        }),
      });
    return route.fallback();
  });
  await page.goto(`/session/${sessionId}`);
  await page
    .getByLabel("Your explanation to Milo")
    .fill("Filters reuse weights.");
  await page.getByRole("button", { name: "Send explanation" }).click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary model failure" }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Your explanation to Milo")).toHaveText(
    "Filters reuse weights.",
  );
  await page.getByRole("button", { name: "Send explanation" }).click();
  await expect(
    page
      .getByLabel("Teaching messages")
      .getByText("Filters reuse weights.", { exact: true }),
  ).toHaveCount(1);
  expect(operations).toHaveLength(2);
  expect(operations[0]).toBe(operations[1]);
});
test("independent-check draft survives refresh without reopening aids", async ({
  page,
}) => {
  const { state } = await fixtures(page);
  state.phase = "transfer";
  state.numericFields = numericFields;
  state.transferQuestion =
    "Explain how a larger image changes computation with a fixed set of weights.";
  await page.goto(`/session/${sessionId}/transfer`);
  await page.getByLabel("Parameters at 20 × 20").fill("204");
  await page.getByLabel("Parameters at 40 × 40").fill("204");
  await page
    .getByLabel("Explain your thinking")
    .fill("The same filter is applied at more locations.");
  await page.reload();
  await expect(page.getByLabel("Explain your thinking")).toHaveText(
    "The same filter is applied at more locations.",
  );
  await expect(page.getByLabel("Parameters at 20 × 20")).toHaveValue("204");
  await expect(page.locator(".teaching-board")).toHaveCount(0);
  await expect(page.getByLabel("Teaching messages")).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
});

test("retrying a failed explanation clears the recovered draft", async ({
  page,
}) => {
  await fixtures(page);
  let failed = false;
  await page.route("**/api/sessions/*/turns", async (route) => {
    if (failed) return route.fallback();
    failed = true;
    return route.fulfill({
      status: 502,
      json: {
        error: {
          code: "MODEL_FAILURE",
          message: "Please retry your explanation.",
        },
      },
    });
  });
  await page.goto(`/session/${sessionId}`);
  await page
    .getByLabel("Your explanation to Milo")
    .fill("Filters reuse weights.");
  await page.getByRole("button", { name: "Send explanation" }).click();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "Please retry your explanation." }),
  ).toBeVisible();
  await expect(page.getByLabel("Your explanation to Milo")).toHaveText(
    "Filters reuse weights.",
  );
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByLabel("Your explanation to Milo")).toHaveText("");
  await expect(
    page
      .getByLabel("Teaching messages")
      .getByText("Filters reuse weights.", { exact: true }),
  ).toHaveCount(1);
});

for (const viewport of [
  { width: 320, height: 780 },
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1440, height: 1000 },
  { width: 844, height: 390 },
]) {
  test(`responsive learning flow at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Explicit viewport coverage runs once.",
    );
    await page.setViewportSize(viewport);
    const { state } = await fixtures(page);
    const assertFits = async () => {
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
        "Page should not scroll horizontally",
      ).toBe(true);
      for (const selector of ["header", "main", "dialog[open]"]) {
        const element = page.locator(selector).first();
        if (!(await element.isVisible())) continue;
        const box = await element.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
      }
    };
    const assertAccessible = async () => {
      const result = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze();
      expect(
        result.violations.map((v) => ({
          id: v.id,
          targets: v.nodes.map((n) => n.target),
        })),
      ).toEqual([]);
    };
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "You know it. Can you teach it?" }),
    ).toBeVisible();
    await assertFits();
    await page.getByRole("button", { name: "Paste notes" }).click();
    await page.getByLabel("Your learning notes").fill(notes);
    await page
      .getByLabel("What would you like to focus on?")
      .fill("CNN weight sharing");
    await page.getByRole("button", { name: "Prepare my lesson" }).click();
    await expect(
      page.getByRole("heading", { name: "Does this look right?" }),
    ).toBeVisible();
    await assertFits();
    await page.getByRole("tab", { name: "Edit", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    await expect(
      page.getByRole("tab", { name: "Preview", exact: true }),
    ).toBeFocused();
    await assertFits();
    await assertAccessible();
    await page
      .getByRole("button", { name: "Looks right. Find my lesson" })
      .click();
    await expect(
      page.getByRole("heading", { name: "CNN weight sharing", exact: true }),
    ).toBeVisible();
    await assertFits();
    state.lesson = {
      ...lesson,
      title:
        "A very long lesson title about convolution weight sharing and computational work",
    };
    state.messages[0].text += " https://example.test/" + "a".repeat(200);
    await page.getByRole("button", { name: "Let’s teach Milo" }).click();
    await expect(
      page.getByRole("heading", { name: "Milo’s classroom" }),
    ).toBeVisible();
    await assertFits();
    if (viewport.width <= 960)
      await expect(page.getByLabel("Your explanation to Milo")).toHaveCSS(
        "font-size",
        "16px",
      );
    const end = await page
      .getByRole("button", { name: "End session" })
      .boundingBox();
    const brand = await page.locator(".session-header .brand").boundingBox();
    expect(end!.x).toBeGreaterThanOrEqual(brand!.x + brand!.width);
    if (viewport.width <= 1100) {
      await expect(page.locator(".board-sidebar")).toBeHidden();
      await page.getByRole("button", { name: "Open teaching board" }).click();
    }
    const teachingBoard = page.locator(".teaching-board:visible");
    await chooseSize(teachingBoard, "64 × 64");
    await assertFits();
    await teachingBoard
      .getByRole("button", { name: "Attach to explanation" })
      .click();
    await page
      .getByLabel("Your explanation to Milo")
      .fill("The same learned weights get reused at more positions.");
    await page.getByRole("button", { name: "Send explanation" }).click();
    await expect(
      page
        .getByLabel("Teaching messages")
        .getByText(
          "What actually gets reused when the filter moves across the image?",
        ),
    ).toBeVisible();
    await assertAccessible();
    await page.screenshot({
      path: testInfo.outputPath(`classroom-${viewport.width}.png`),
      fullPage: true,
    });
    await page.getByRole("button", { name: "End session" }).click();
    await page
      .getByRole("button", { name: "Try the independent check" })
      .click();
    await expect(page.getByLabel("Explain your thinking")).toBeVisible();
    await assertFits();
    await page.getByLabel("Parameters at 20 × 20").fill("204");
    await page.getByLabel("Parameters at 40 × 40").fill("204");
    await page
      .getByLabel("Explain your thinking")
      .fill("The same weights are reused at more spatial positions.");
    await page.getByRole("button", { name: "See my learning report" }).click();
    await expect(
      page.getByRole("heading", {
        name: "How did your teaching go?",
      }),
    ).toBeVisible();
    await page.locator(".rp-skills summary").first().click();
    await assertFits();
    await assertAccessible();
    await page.screenshot({
      path: testInfo.outputPath(`report-${viewport.width}.png`),
      fullPage: true,
    });
  });
}

test("small-screen account and history dialogs remain accessible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const { state } = await fixtures(page);
  let signedIn = false;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: signedIn
          ? {
              id: "learner-1",
              name: "Ada with a very long display name",
              email: "ada@example.test",
            }
          : null,
      },
    }),
  );
  await page.route("**/api/sessions", (route) =>
    route.fulfill({
      json: {
        sessions: [
          {
            ...state,
            title: "LongSessionTitle".repeat(15),
            scope: "LongSource".repeat(20),
            level: "introductory",
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
        ],
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await page
    .getByRole("button", { name: "Create Account", exact: true })
    .first()
    .click();
  await expect(page.getByLabel("Your Name")).toBeVisible();
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await expect(page.getByLabel("Email Address")).toHaveCSS("font-size", "16px");
  const bounds = (await dialog.boundingBox())!;
  await page.mouse.click(bounds.x + 3, bounds.y + 3);
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Sign In", exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole("button", { name: "My Sessions", exact: true }),
  ).toHaveCount(0);
  signedIn = true;
  await page.reload();
  await page.getByRole("button", { name: "My Sessions", exact: true }).click();
  await expect(dialog.locator(".session-card-link")).toBeVisible();
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await expect(
    page.getByRole("button", { name: "My Sessions", exact: true }),
  ).toBeFocused();
});

test("session history keeps long titles and actions readable at narrow and wide sizes", async ({
  page,
}, testInfo) => {
  const { state } = await fixtures(page);
  const titles = [
    "Understanding how ideas connect",
    "Explaining and comparing examples with a longer lesson title",
    "Reviewing the evidence in my explanations",
    "Applying what I learned to a new example",
  ];
  await page.route("**/api/sessions", (route) =>
    route.fulfill({
      json: {
        sessions: titles.map((title, index) => ({
          ...state,
          id: `design-${index}`,
          title,
          phase: index < 2 ? "baseline" : "report",
          scope: "Compare the ideas and explain why each example fits.",
          level: "introductory",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })),
      },
    }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "My Sessions", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "My Learning Sessions" });
  await expect(dialog.locator(".session-card")).toHaveCount(4);
  await expect(
    dialog.getByRole("link", { name: "Resume", exact: true }),
  ).toHaveCount(2);
  await expect(
    dialog.getByRole("link", { name: "View report", exact: true }),
  ).toHaveCount(2);
  await expect(dialog.locator(".session-card-summary time")).toHaveCount(4);
  for (const width of [375, 768, 1440]) {
    await page.setViewportSize({ width, height: 950 });
    expect(
      await dialog.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    const bounds = (await dialog.boundingBox())!;
    for (const link of await dialog
      .locator(".session-card-link, .resume-indicator")
      .all()) {
      const rect = (await link.boundingBox())!;
      expect(rect.x).toBeGreaterThanOrEqual(bounds.x);
      expect(rect.x + rect.width).toBeLessThanOrEqual(bounds.x + bounds.width);
    }
    await page.screenshot({
      path: testInfo.outputPath(`sessions-${width}.png`),
    });
  }
  const toggle = dialog.getByRole("button", {
    name: `Session details: ${titles[1]}`,
    exact: true,
  });
  await toggle.focus();
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(
    dialog.getByRole("button", {
      name: `Delete session: ${titles[1]}`,
      exact: true,
    }),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".session-history-modal").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("sessions-expanded.png") });
  await toggle.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
});

test("session history appends pages, retries in place, and preserves deletion", async ({
  page,
}, testInfo) => {
  const { state } = await fixtures(page);
  const summary = (id: string) => ({
    ...state,
    id,
    title: `Lesson ${id}`,
    scope: lesson.scope,
    level: lesson.level,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  let attempts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sessions*", async (route) => {
    const cursor = new URL(route.request().url()).searchParams.get("cursor");
    if (!cursor)
      return route.fulfill({
        json: { sessions: [summary("A"), summary("B")], nextCursor: "page2" },
      });
    expect(cursor).toBe("page2");
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: { message: "History temporarily unavailable" } },
      });
    await gate;
    return route.fulfill({
      json: { sessions: [summary("A"), summary("B"), summary("C")] },
    });
  });
  await page.route("**/api/sessions/B", (route) =>
    route.fulfill({ json: { ok: true } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "My Sessions", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.locator(".session-card")).toHaveCount(2);
  await dialog
    .getByRole("button", { name: "Session details: Lesson B" })
    .click();
  await dialog
    .getByRole("button", { name: "Delete session: Lesson B" })
    .click();
  const confirmation = page.getByRole("alertdialog", {
    name: "Delete this session?",
  });
  await expect(
    confirmation.getByRole("button", { name: "Keep session" }),
  ).toBeFocused();
  await confirmation.getByRole("button", { name: "Keep session" }).click();
  await expect(dialog.locator(".session-card")).toHaveCount(2);
  await dialog
    .getByRole("button", { name: "Delete session: Lesson B" })
    .click();
  await confirmation
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  await expect(confirmation).toBeHidden();
  await expect(dialog.locator(".session-card")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "History temporarily unavailable",
  );
  await expect(dialog.locator(".session-card")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Try again" }).click();
  try {
    await expect(
      dialog.getByRole("button", { name: "Loading more sessions…" }),
    ).toBeDisabled();
    await expect(dialog.getByRole("link", { name: "Lesson A" })).toBeVisible();
    expect(attempts).toBe(2);
  } finally {
    release();
  }
  await expect(dialog.locator(".session-card")).toHaveCount(2);
  await expect(dialog.getByRole("status")).toHaveText("2 sessions shown");
  await expect(
    dialog.getByRole("button", { name: "Load more", exact: true }),
  ).toHaveCount(0);
  expect(
    (
      await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("history-pages.png") });
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "My Sessions", exact: true }).click();
  await expect(dialog.getByRole("link", { name: "Lesson B" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Lesson C" })).toHaveCount(0);
});

test("session history ignores stale pages after reopening and handles empty history", async ({
  page,
}) => {
  const { state } = await fixtures(page);
  let firstLoads = 0;
  let cancelled = false;
  page.on("requestfailed", (request) => {
    if (request.url().includes("cursor=page2")) cancelled = true;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/sessions*", async (route) => {
    if (new URL(route.request().url()).searchParams.has("cursor")) {
      await gate;
      return route.fulfill({
        json: {
          sessions: [
            {
              ...state,
              id: "stale",
              title: "Stale lesson",
              level: lesson.level,
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            },
          ],
        },
      });
    }
    firstLoads++;
    return route.fulfill({
      json:
        firstLoads === 1
          ? {
              sessions: [
                {
                  ...state,
                  title: lesson.title,
                  level: lesson.level,
                  createdAt: new Date().toISOString(),
                  updatedAt: new Date().toISOString(),
                },
              ],
              nextCursor: "page2",
            }
          : { sessions: [] },
    });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "My Sessions", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("button", { name: "Load more", exact: true }).click();
  await expect(
    dialog.getByRole("button", { name: "Loading more sessions…" }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "My Sessions", exact: true }).click();
  await expect(
    dialog.getByRole("heading", { name: "No sessions found" }),
  ).toBeVisible();
  release();
  await expect.poll(() => cancelled).toBe(true);
  await expect(dialog.getByRole("link", { name: "Stale lesson" })).toHaveCount(
    0,
  );
  await expect(
    dialog.getByRole("heading", { name: "No sessions found" }),
  ).toBeVisible();
});

test("Milo greetings support keyboard and restart cleanly", async ({
  page,
}) => {
  const { state } = await fixtures(page);
  state.messages.push({
    ...state.messages[0],
    id: "66666666-6666-4666-8666-666666666666",
    sequence: 1,
  });
  await page.goto("/");
  const greet = page.getByRole("button", { name: "Say hello to Milo" });
  const milo = greet.locator("svg");
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  await greet.focus();
  await page.keyboard.press("Enter");
  await expect(milo).toHaveAttribute("data-milo-state", "greeting");
  await page.keyboard.press("Space");
  await expect
    .poll(() =>
      milo.evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    )
    .toBe(4);
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  await page.goto(`/session/${sessionId}`);
  const gradientIds = await page
    .locator(".message-avatar .milo linearGradient")
    .evaluateAll((nodes) => nodes.map((node) => node.id));
  expect(gradientIds).toHaveLength(2);
  expect(new Set(gradientIds).size).toBe(2);
  expect(
    await page
      .locator(".message-avatar .milo")
      .evaluateAll((nodes) =>
        nodes.flatMap((node) => node.getAnimations({ subtree: true })),
      ),
  ).toHaveLength(0);
});

test("Milo follows typing, thinking, failed turns and new replies without reacting to history", async ({
  page,
}) => {
  const { state } = await fixtures(page);
  state.nextCursor = 0;
  await page.route("**/api/sessions/*/messages?before=*", (route) =>
    route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        messages: [
          {
            ...state.messages[0],
            id: "66666666-6666-4666-8666-666666666666",
            sequence: -1,
          },
        ],
      }),
    }),
  );
  let release: (() => void) | undefined;
  let first = true;
  await page.route("**/api/sessions/*/turns", async (route) => {
    if (!first) return route.fallback();
    first = false;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({
        error: {
          code: "MODEL_FAILURE",
          message: "Temporary model failure. Please retry.",
        },
      }),
    });
  });
  await page.goto(`/session/${sessionId}`);
  const milo = page.locator(".conversation-heading .milo");
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  await page.getByRole("button", { name: "Load earlier messages" }).click();
  await expect(page.locator(".message.student")).toHaveCount(2);
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  const explanation = page.getByLabel("Your explanation to Milo");
  await explanation.fill("Weights are reused.");
  await expect(milo).toHaveAttribute("data-milo-state", "listening");
  // A typing pause must not interrupt listening and restart the animation.
  await page.waitForTimeout(2200);
  await expect(milo).toHaveAttribute("data-milo-state", "listening");
  await explanation.press("End");
  await explanation.press("Space");
  await expect(milo).toHaveAttribute("data-milo-state", "listening");
  await explanation.blur();
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  await explanation.focus();
  await expect(milo).toHaveAttribute("data-milo-state", "listening");
  await explanation.fill("");
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  await explanation.fill("The same weights are reused.");
  await page.getByRole("button", { name: "Send explanation" }).click();
  await expect(milo).toHaveAttribute("data-milo-state", "thinking");
  await expect(
    page.locator(".conversation-heading .milo-greet"),
  ).toHaveAttribute("aria-disabled", "true");
  await expect.poll(() => Boolean(release)).toBe(true);
  release!();
  await expect(
    page.getByRole("alert").filter({ hasText: "Temporary model failure" }),
  ).toBeVisible();
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  await expect(explanation).toHaveText("The same weights are reused.");
  await page.getByRole("button", { name: "Send explanation" }).click();
  await expect(milo).toHaveAttribute("data-milo-state", "reply");
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  await page.reload();
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
});

test("Milo respects reduced motion and pauses outside the viewport or hidden tab", async ({
  page,
}) => {
  const { state } = await fixtures(page);
  state.pending = true;
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`/session/${sessionId}`);
  const milo = page.locator(".conversation-heading .milo");
  await expect(milo).toHaveAttribute("data-milo-state", "thinking");
  await expect
    .poll(() =>
      milo.evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
  await expect(milo.locator('[data-milo-part="eyes"]')).toHaveCSS(
    "transform",
    "matrix(1, 0, 0, 1, 0, -2)",
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await expect
    .poll(() =>
      milo.evaluate(
        (svg) =>
          svg
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(4);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() =>
      milo.evaluate((svg) =>
        svg
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "paused"),
      ),
    )
    .toBe(true);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      value: false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect
    .poll(() =>
      milo.evaluate(
        (svg) =>
          svg
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(4);
  await milo.evaluate((svg) => {
    svg.style.position = "fixed";
    svg.style.top = "-200px";
  });
  await expect
    .poll(() =>
      milo.evaluate((svg) =>
        svg
          .getAnimations({ subtree: true })
          .every((animation) => animation.playState === "paused"),
      ),
    )
    .toBe(true);
  await milo.evaluate((svg) => {
    svg.style.position = "";
    svg.style.top = "";
  });
  await expect
    .poll(() =>
      milo.evaluate(
        (svg) =>
          svg
            .getAnimations({ subtree: true })
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBe(4);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() =>
      milo.evaluate((svg) => svg.getAnimations({ subtree: true }).length),
    )
    .toBe(0);
});

test("Milo celebrates each dialog opening and thanks the learner on the report", async ({
  page,
}) => {
  const { state } = await fixtures(page);
  state.phase = "ready_for_check";
  await page.goto(`/session/${sessionId}`);
  const dialog = page.getByRole("dialog", { name: "Milo understood." });
  const milo = dialog.locator(".milo");
  await expect(milo).toHaveAttribute("data-milo-state", "celebration");
  await expect(milo).toHaveAttribute("data-milo-state", "idle");
  await dialog.getByRole("button", { name: "Keep chatting" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.locator(".understood-panel .milo")).toHaveCount(0);
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(milo).toHaveAttribute("data-milo-state", "celebration");
  await dialog.getByRole("button", { name: "Close session" }).click();
  await page
    .getByRole("dialog", { name: "Ready to wrap up?" })
    .getByRole("button", { name: "End and see my feedback" })
    .click();
  await expect(page.locator(".report-milo .milo")).toHaveAttribute(
    "data-milo-state",
    "reply",
  );
  await expect(page.locator(".report-milo .milo")).toHaveAttribute(
    "data-milo-state",
    "idle",
  );
});

async function completedSessionFixture(page: Page) {
  const { state } = await fixtures(page);
  await page.goto("/");
  await page.evaluate(async (id) => {
    await fetch(`/api/sessions/${id}/actions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "end" }),
    });
  }, sessionId);
  return state;
}

test("completed chat preserves paginated history, retries, and supports keyboard tabs", async ({
  page,
}, testInfo) => {
  const state = await completedSessionFixture(page);
  const message = (sequence: number) => ({
    id: `history-${sequence}`,
    role: sequence % 2 ? "learner" : "student",
    text: `Saved explanation ${sequence}`,
    sequence,
    createdAt: new Date().toISOString(),
    kind: sequence === 58 ? "hint" : sequence === 59 ? "transfer" : "teaching",
    ...(sequence === 57
      ? {
          board: sizeSnapshot(1),
        }
      : {}),
  });
  state.messages = Array.from({ length: 30 }, (_, index) =>
    message(index + 30),
  );
  state.nextCursor = 30;
  let attempts = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/sessions/${sessionId}/messages?before=*`,
    async (route) => {
      const before = new URL(route.request().url()).searchParams.get("before");
      if (before === "0") return route.fulfill({ json: { messages: [] } });
      expect(before).toBe("30");
      attempts++;
      if (attempts === 1)
        return route.fulfill({
          status: 503,
          json: { error: { message: "History temporarily unavailable" } },
        });
      await gate;
      return route.fulfill({
        json: {
          messages: [
            ...Array.from({ length: 30 }, (_, index) => message(index)),
            message(30),
          ],
          nextCursor: 0,
        },
      });
    },
  );
  await page.goto(`/session/${sessionId}/report`);
  const report = page.getByRole("tab", { name: "Report", exact: true });
  const chat = page.getByRole("tab", { name: "Chat", exact: true });
  await expect(report).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "How did your teaching go?" }),
  ).toBeVisible();
  await report.focus();
  await page.keyboard.press("ArrowRight");
  await expect(chat).toBeFocused();
  await expect(chat).toHaveAttribute("aria-selected", "true");
  const transcript = page.getByRole("region", { name: "Saved conversation" });
  await expect(transcript.getByText(/Session ended/)).toBeVisible();
  await expect(
    transcript.getByText("You've reached the end of this conversation."),
  ).toBeVisible();
  await expect(transcript.getByText("A little nudge")).toBeVisible();
  await expect(transcript.getByText("Independent-check answer")).toBeVisible();
  await expect(transcript.getByText("Demonstration shared")).toBeVisible();
  await expect(
    transcript.locator(".board-preview").getByText("64 × 64"),
  ).toBeVisible();
  await expect(transcript.locator(".message.student")).toHaveCount(15);
  await expect(transcript.locator(".message.learner")).toHaveCount(15);
  await expect(
    transcript.getByRole("button", { name: "Copy Milo’s message" }),
  ).toHaveCount(15);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "End session", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Open teaching board" }),
  ).toHaveCount(0);
  await transcript
    .getByRole("button", { name: "Load earlier messages" })
    .click();
  await expect(transcript.getByRole("alert")).toContainText(
    "History temporarily unavailable",
  );
  await expect(transcript.locator(".message")).toHaveCount(30);
  await transcript.getByRole("button", { name: "Try again" }).click();
  try {
    await expect(
      transcript.getByRole("button", { name: "Loading earlier messages…" }),
    ).toBeDisabled();
  } finally {
    release();
  }
  await expect(transcript.locator(".message")).toHaveCount(60);
  expect(attempts).toBe(2);
  expect(await transcript.locator(".message-text").allTextContents()).toEqual(
    Array.from({ length: 60 }, (_, index) => `Saved explanation ${index}`),
  );
  await report.click();
  await expect(
    page.getByRole("heading", { name: "How did your teaching go?" }),
  ).toBeVisible();
  await report.press("End");
  await expect(chat).toBeFocused();
  await expect(transcript.locator(".message")).toHaveCount(60);
  await transcript
    .getByRole("button", { name: "Load earlier messages" })
    .click();
  await expect(
    transcript.getByRole("button", { name: "Load earlier messages" }),
  ).toHaveCount(0);
  await expect(transcript.locator(".message")).toHaveCount(60);
  const accessibility = await new AxeBuilder({ page })
    .include(".completed-session")
    .analyze();
  expect(accessibility.violations).toEqual([]);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const savedMessages = page.getByRole("region", { name: "Saved messages" });
  const completedMain = page.locator(".completed-session");
  await expect(savedMessages.locator(".message-bubble").first()).toHaveCSS(
    "font-size",
    "16px",
  );
  expect(
    await page.evaluate(
      () => document.scrollingElement!.scrollHeight <= innerHeight,
    ),
  ).toBe(true);
  await completedMain.hover();
  await page.mouse.wheel(0, 10000);
  await expect
    .poll(() => completedMain.evaluate((el) => el.scrollTop))
    .toBeGreaterThan(0);
  expect(await page.evaluate(() => scrollY)).toBe(0);
  await page.screenshot({ path: testInfo.outputPath("completed-chat.png") });
  await page.reload();
  await expect(report).toHaveAttribute("aria-selected", "true");
});

test("completed chat handles empty history and resets for another session", async ({
  page,
}) => {
  const state = await completedSessionFixture(page);
  state.messages = [];
  await page.goto(`/session/${sessionId}/report`);
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(
    page.getByText("No saved messages in this session."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Load earlier messages" }),
  ).toHaveCount(0);
  const nextId = "66666666-6666-4666-8666-666666666666";
  await page.route(`**/api/sessions/${nextId}`, (route) =>
    route.fulfill({ json: { ...state, id: nextId } }),
  );
  await page.evaluate((id) => {
    const link = document.createElement("a");
    link.href = `/session/${id}/report`;
    link.textContent = "Open another completed session";
    document.querySelector(".session-header")!.append(link);
  }, nextId);
  await page
    .getByRole("link", { name: "Open another completed session" })
    .click();
  await expect(
    page.getByRole("tab", { name: "Report", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", { name: "How did your teaching go?" }),
  ).toBeVisible();
});

for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
  { width: 615, height: 887 },
  { width: 1024, height: 768 },
  { width: 1440, height: 900 },
  { width: 844, height: 390 },
]) {
  test(`classroom keeps chat readable and scrolls only the thread at ${viewport.width} × ${viewport.height}`, async ({
    page,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop",
      "Explicit viewports run once.",
    );
    await page.setViewportSize(viewport);
    const { state } = await fixtures(page);
    state.phase = "ready_for_check";
    state.messages = Array.from({ length: 24 }, (_, index) => ({
      id: `scroll-${index}`,
      role: index % 2 ? "learner" : "student",
      text: `Explanation ${index}. The same filter weights are reused at every spatial position. A larger input changes the amount of computation while keeping learned parameters fixed.`,
      sequence: index,
      kind: "teaching",
      createdAt: new Date().toISOString(),
    }));
    await page.addInitScript(
      (id) => sessionStorage.setItem(`understood-dismissed:${id}`, "1"),
      sessionId,
    );
    await page.goto(`/session/${sessionId}`);
    await expect(
      page.getByRole("heading", { name: "Milo’s classroom" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("classroom-layout.png"),
    });
    const thread = page.getByRole("region", { name: "Teaching messages" });
    const box = await thread.boundingBox();
    expect(
      box!.height,
      "Messages should receive at least 40% of the viewport",
    ).toBeGreaterThan(viewport.height * 0.4);
    await expect(page.locator(".classroom .message-bubble").first()).toHaveCSS(
      "font-size",
      "16px",
    );
    await page
      .getByLabel("Your explanation to Milo")
      .fill("I can still type while reading the conversation.");
    await expect
      .poll(() =>
        page.evaluate(() => ({
          top: window.scrollY,
          height: document.scrollingElement!.scrollHeight,
          client: document.scrollingElement!.clientHeight,
        })),
      )
      .toEqual({ top: 0, height: viewport.height, client: viewport.height });
    await thread.hover();
    await page.mouse.wheel(0, -10000);
    await expect.poll(() => thread.evaluate((el) => el.scrollTop)).toBe(0);
    const headerBefore = await page.locator(".session-header").boundingBox();
    await page.mouse.wheel(0, -10000);
    expect(await page.evaluate(() => scrollY)).toBe(0);
    expect((await page.locator(".session-header").boundingBox())!.y).toBe(
      headerBefore!.y,
    );
    await page.mouse.wheel(0, 10000);
    await expect
      .poll(() => thread.evaluate((el) => el.scrollTop))
      .toBeGreaterThan(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const composer = await page.locator(".composer-area").boundingBox();
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(
      viewport.height + 1,
    );
    await page
      .getByRole("button", { name: "End session", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Ready to wrap up?" }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Keep teaching", exact: true })
      .last()
      .click();
    await expect(
      page.getByRole("dialog", { name: "Ready to wrap up?" }),
    ).toBeHidden();
    expect(await page.evaluate(() => scrollY)).toBe(0);
  });
}

test("mobile classroom details expand with keyboard and give space back to chat", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop",
    "Explicit viewports run once.",
  );
  await page.setViewportSize({ width: 661, height: 887 });
  await fixtures(page);
  await page.goto(`/session/${sessionId}`);
  const toggle = page.getByRole("button", {
    name: "Milo’s classroom",
    exact: true,
  });
  const objectives = page.getByRole("region", {
    name: "Learning objective progress",
  });
  const thread = page.getByRole("region", { name: "Teaching messages" });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(objectives).toBeHidden();
  await expect(page.locator("#classroom-introduction")).toBeHidden();
  const collapsed = (await thread.boundingBox())!.height;
  await toggle.focus();
  await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(objectives).toBeVisible();
  await expect(page.locator("#classroom-introduction")).toBeVisible();
  await expect
    .poll(async () => (await thread.boundingBox())!.height)
    .toBeLessThan(collapsed - 40);
  await page.keyboard.press("Space");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect
    .poll(async () => (await thread.boundingBox())!.height)
    .toBe(collapsed);
  await page
    .getByRole("button", { name: "Open teaching board", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Your teaching board" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  for (const width of [320, 661, 844]) {
    await page.setViewportSize({ width, height: 887 });
    await expect(toggle).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(() => document.scrollingElement!.scrollHeight),
    ).toBe(887);
  }
  await page.screenshot({
    path: testInfo.outputPath("collapsed-classroom.png"),
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(toggle).toBeHidden();
  await expect(objectives).toBeVisible();
  await expect(page.locator("#classroom-introduction")).toBeVisible();
});

test("confirmation modals cancel safely, restore focus, and confirm sign out", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  let logouts = 0;
  const nativeDialogs: string[] = [];
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.type());
    await dialog.dismiss();
  });
  await page.route("**/api/auth/logout", (route) => {
    logouts++;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/");
  const accountMenu = page.getByRole("button", {
    name: "Open account menu",
    exact: true,
  });
  const signOut = page.getByRole("menuitem", { name: "Log out", exact: true });
  const openSignOut = async () => {
    if (!(await signOut.isVisible())) await accountMenu.click();
  };
  const modal = page.getByRole("alertdialog", { name: "Sign out?" });
  await openSignOut();
  await signOut.click();
  await expect(modal).toBeVisible();
  const cancel = modal.getByRole("button", { name: "Stay signed in" });
  await expect(cancel).toBeFocused();
  expect(logouts).toBe(0);
  expect(
    (await new AxeBuilder({ page }).include(".confirmation-modal").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: testInfo.outputPath("sign-out-confirmation.png"),
  });
  await cancel.press("Tab");
  await expect(
    modal.getByRole("button", { name: "Sign out", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(cancel).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(modal).toBeHidden();
  await expect(signOut).toBeFocused();
  expect(logouts).toBe(0);
  await openSignOut();
  await signOut.click();
  await modal.getByRole("button", { name: "Close dialog" }).click();
  await openSignOut();
  await expect(signOut).toBeVisible();
  expect(logouts).toBe(0);
  await openSignOut();
  await signOut.click();
  await page.mouse.click(1, 1);
  await expect(modal).toBeHidden();
  expect(logouts).toBe(0);
  await openSignOut();
  await signOut.click();
  await modal.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Sign In", exact: true }),
  ).toBeVisible();
  expect(logouts).toBe(1);
  expect(nativeDialogs).toEqual([]);
});

test("confirmation modals guard board resets, snapshot replacement and removal", async ({
  page,
}, testInfo) => {
  await fixtures(page);
  await page.goto(`/session/${sessionId}`);
  const openBoard = async () => {
    if (testInfo.project.name === "mobile")
      await page.getByRole("button", { name: "Open teaching board" }).click();
    return page.locator(".teaching-board:visible");
  };
  let teachingBoard = await openBoard();
  const size = () =>
    teachingBoard.getByRole("combobox", { name: "Input size" });
  await chooseSize(teachingBoard, "64 × 64");
  await teachingBoard
    .getByRole("button", { name: "Reset board", exact: true })
    .click();
  const reset = page.getByRole("alertdialog", { name: "Reset this board?" });
  await reset.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(size()).toHaveAttribute("data-value", "1");
  await teachingBoard
    .getByRole("button", { name: "Reset board", exact: true })
    .click();
  await reset.getByRole("button", { name: "Reset board", exact: true }).click();
  await expect(size()).toHaveAttribute("data-value", "0");
  await teachingBoard
    .getByRole("button", { name: "Attach to explanation" })
    .click();
  await expect(page.locator(".attachment-chip")).toBeVisible();
  teachingBoard = await openBoard();
  await chooseSize(teachingBoard, "64 × 64");
  await teachingBoard
    .getByRole("button", { name: "Attach to explanation" })
    .click();
  const replace = page.getByRole("alertdialog", {
    name: "Replace board snapshot?",
  });
  await replace.getByRole("button", { name: "Cancel", exact: true }).click();
  await teachingBoard
    .getByRole("button", { name: "Attach to explanation" })
    .click();
  await replace
    .getByRole("button", { name: "Replace snapshot", exact: true })
    .click();
  await page.getByRole("button", { name: "Remove board snapshot" }).click();
  const remove = page.getByRole("alertdialog", {
    name: "Remove board snapshot?",
  });
  await remove.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.locator(".attachment-chip")).toBeVisible();
  await page.getByRole("button", { name: "Remove board snapshot" }).click();
  await remove
    .getByRole("button", { name: "Remove snapshot", exact: true })
    .click();
  await expect(page.locator(".attachment-chip")).toHaveCount(0);
});

test("confirmation modals guard file removal, replacement and changing reviewed material", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto("/");
  const fileInput = page.locator("#material-file");
  const first = {
    name: "first.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(notes),
  };
  const second = {
    name: "second.txt",
    mimeType: "text/plain",
    buffer: Buffer.from(notes),
  };
  await fileInput.setInputFiles(first);
  await expect(page.getByText("first.txt", { exact: true })).toBeVisible();
  await fileInput.setInputFiles(second);
  const replace = page.getByRole("alertdialog", {
    name: "Replace selected file?",
  });
  await replace.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("first.txt", { exact: true })).toBeVisible();
  await fileInput.setInputFiles(second);
  await replace
    .getByRole("button", { name: "Replace file", exact: true })
    .click();
  await expect(page.getByText("second.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose another file" }).click();
  const remove = page.getByRole("alertdialog", {
    name: "Remove selected file?",
  });
  await remove.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("second.txt", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Choose another file" }).click();
  await remove
    .getByRole("button", { name: "Remove file", exact: true })
    .click();
  await expect(page.getByText("second.txt", { exact: true })).toHaveCount(0);
  await fileInput.setInputFiles(first);
  await page.getByRole("button", { name: "Paste notes" }).click();
  await page.getByLabel("Your learning notes").fill(notes);
  await page
    .getByLabel("What would you like to focus on?")
    .fill("CNN weight sharing");
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  await page.getByRole("button", { name: "Change material" }).click();
  const change = page.getByRole("alertdialog", { name: "Change material?" });
  await change.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Does this look right?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Change material" }).click();
  await change
    .getByRole("button", { name: "Change material", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What are we learning?" }),
  ).toBeVisible();
});

test("confirmation modals guard unsent explanations during a session transition", async ({
  page,
}) => {
  await fixtures(page);
  await page.goto(`/session/${sessionId}`);
  const draft = page.getByLabel("Your explanation to Milo");
  await draft.fill("I want to keep this unsent explanation.");
  await page.getByRole("button", { name: "End session", exact: true }).click();
  const wrapUp = page.getByRole("dialog", { name: "Ready to wrap up?" });
  await wrapUp
    .getByRole("button", { name: "Try the independent check" })
    .click();
  const discard = page.getByRole("alertdialog", {
    name: "Discard unsent explanation?",
  });
  await discard.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(wrapUp).toBeVisible();
  await wrapUp
    .getByRole("button", { name: "Keep teaching", exact: true })
    .click();
  await expect(draft).toHaveText("I want to keep this unsent explanation.");
  await page.getByRole("button", { name: "End session", exact: true }).click();
  await wrapUp
    .getByRole("button", { name: "Try the independent check" })
    .click();
  await discard
    .getByRole("button", { name: "Discard and continue", exact: true })
    .click();
  await expect(page.getByLabel("Explain your thinking")).toBeVisible();
});

for (const phase of ["teaching", "transfer"] as const) {
  test(`fetching retains report pagination after completing ${phase}`, async ({
    page,
  }) => {
    const state = await completedSessionFixture(page);
    const message = (sequence: number) => ({
      id: `transition-${sequence}`,
      role: sequence % 2 ? "learner" : "student",
      text: `Transition explanation ${sequence}`,
      sequence,
      createdAt: new Date().toISOString(),
      kind: "teaching",
    });
    const completed = {
      ...state,
      revision: 2,
      nextCursor: 31,
      messages: Array.from({ length: 30 }, (_, index) => message(index + 31)),
    };
    state.phase = phase;
    state.messages =
      phase === "transfer"
        ? []
        : Array.from({ length: 30 }, (_, index) => message(index + 30));
    state.nextCursor = phase === "transfer" ? undefined : 30;
    state.transferQuestion = "Explain a fresh example.";
    state.numericFields = [];
    await page.route(
      `**/api/sessions/${sessionId}/${phase === "transfer" ? "transfer" : "actions"}`,
      (route) => route.fulfill({ json: completed }),
    );
    let cursor: string | null = null;
    await page.route(
      `**/api/sessions/${sessionId}/messages?before=*`,
      (route) => {
        cursor = new URL(route.request().url()).searchParams.get("before");
        return route.fulfill({ json: { messages: [message(30)] } });
      },
    );
    await page.goto(
      `/session/${sessionId}${phase === "transfer" ? "/transfer" : ""}`,
    );
    if (phase === "transfer") {
      await page
        .getByLabel("Explain your thinking")
        .fill("The same weights are reused.");
      await page
        .getByRole("button", { name: "See my learning report" })
        .click();
    } else {
      await page
        .getByRole("button", { name: "End session", exact: true })
        .click();
      await page
        .getByRole("button", { name: "End and see my feedback" })
        .click();
    }
    await page.getByRole("tab", { name: "Chat", exact: true }).click();
    await page.getByRole("button", { name: "Load earlier messages" }).click();
    await expect(
      page.getByText("Transition explanation 30", { exact: true }),
    ).toBeVisible();
    expect(cursor).toBe("31");
  });
}

test("fetching waits for auth and shares initial session reads", async ({
  page,
}) => {
  await fixtures(page);
  const requests: string[] = [];
  page.on("request", (request) => {
    const path = new URL(request.url()).pathname;
    if (path === "/api/auth/me" || path === `/api/sessions/${sessionId}`)
      requests.push(path);
  });
  await page.goto(`/session/${sessionId}`);
  await expect(
    page.getByRole("heading", { name: "Milo’s classroom" }),
  ).toBeVisible();
  expect(requests.filter((path) => path === "/api/auth/me")).toHaveLength(1);
  expect(
    requests.filter((path) => path === `/api/sessions/${sessionId}`),
  ).toHaveLength(1);
});

test("fetching polls revisions without overlapping and applies a fresh completed operation", async ({
  page,
}) => {
  await page.clock.install();
  const { state } = await fixtures(page);
  state.revision = 3;
  state.pending = true;
  let polls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `**/api/sessions/${sessionId}?sinceRevision=*`,
    async (route) => {
      expect(
        new URL(route.request().url()).searchParams.get("sinceRevision"),
      ).toBe("3");
      polls++;
      if (polls === 1) {
        await gate;
        return route.fulfill({
          json: { unchanged: true, revision: 3, pending: true },
        });
      }
      return route.fulfill({ json: state });
    },
  );
  await page.goto(`/session/${sessionId}`);
  await expect(
    page.getByRole("heading", { name: "Milo’s classroom" }),
  ).toBeVisible();
  await page.clock.fastForward(4000);
  await expect.poll(() => polls).toBe(1);
  await page.clock.fastForward(8000);
  expect(polls).toBe(1);
  const response = page.waitForResponse((response) =>
    new URL(response.url()).searchParams.has("sinceRevision"),
  );
  release();
  await response;
  await page.clock.runFor(100);
  state.pending = false;
  state.revision = 4;
  state.messages.push({
    id: "new-reply",
    role: "student",
    text: "The background operation finished with a new reply.",
    sequence: 1,
    createdAt: new Date().toISOString(),
    kind: "teaching",
  });
  await page.clock.fastForward(4000);
  await expect(
    page
      .getByRole("region", { name: "Teaching messages" })
      .getByText("The background operation finished with a new reply.", {
        exact: true,
      }),
  ).toBeVisible();
  expect(polls).toBe(2);
  await page.clock.fastForward(12000);
  expect(polls).toBe(2);
});

test("fetching pauses pending session polls while hidden", async ({ page }) => {
  await page.clock.install();
  const { state } = await fixtures(page);
  state.pending = true;
  let polls = 0;
  await page.route(`**/api/sessions/${sessionId}?sinceRevision=*`, (route) => {
    polls++;
    return route.fulfill({
      json: { unchanged: true, revision: 0, pending: true },
    });
  });
  await page.goto(`/session/${sessionId}`);
  await expect(
    page.getByRole("heading", { name: "Milo’s classroom" }),
  ).toBeVisible();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => true,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.fastForward(12000);
  expect(polls).toBe(0);
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await expect.poll(() => polls).toBe(1);
});

test("fetching cannot replace a new login with a delayed old auth response", async ({
  page,
}) => {
  await fixtures(page);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/auth/me", async (route) => {
    await gate;
    await route.fulfill({ json: { user: null } });
  });
  await page.route("**/api/auth/login", (route) =>
    route.fulfill({
      json: {
        user: { id: "new-owner", name: "New owner", email: "new@example.test" },
      },
    }),
  );
  await page.goto("/?authError=Please%20sign%20in");
  const dialog = page.getByRole("dialog", { name: "Sign In to Teach Milo" });
  await dialog.getByLabel("Email Address").fill("new@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("valid-password");
  await dialog
    .locator("form")
    .getByRole("button", { name: "Sign In", exact: true })
    .click();
  await expect(page.locator(".user-display-name")).toHaveText("New owner");
  await dialog.getByRole("button", { name: "Close dialog" }).click();
  release();
  await page.getByRole("button", { name: "How it works" }).click();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await expect(page.locator(".user-display-name")).toHaveText("New owner");
});
