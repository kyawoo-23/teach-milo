import { test, expect, Page } from "@playwright/test";
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
const board = {
  kind: "cnn",
  version: 1,
  title: "One filter. Many positions.",
  instruction:
    "Compare the two image sizes. Tell Milo what changes and what stays the same.",
  assumptions:
    "Valid convolution · stride 1 · 3×3 kernel · 3 input channels · 8 filters · biases enabled",
  controls: [],
  metrics: [],
  items: [],
  groups: [],
  code: "",
};
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
        board: data.board && { ...data.board, kind: "cnn", verified: true },
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
        state.numericalCheck = true;
        state.transferQuestion =
          "A valid stride-1 convolution has 5×5 kernels, 2 input channels, and 4 output filters, with biases. Compare inputs of 20×20×2 and 40×40×2. How many learned parameters are there in each case, and what changes when the image grows? Explain why.";
      } else if (data.action === "continue") state.phase = "teaching";
      else state.hintUsed = true;
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
  await teachingBoard.getByRole("button", { name: "64 × 64" }).click();
  await expect(
    teachingBoard.getByText("830,304", { exact: true }),
  ).toBeVisible();
  await checkpoint();
  await teachingBoard
    .getByRole("button", { name: "Use this to explain it" })
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
      name: "Here’s what your explanations showed.",
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
          { type: "calculate", channel, requestId, code, inputs: { size: 5 } },
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
  expect(results.good.result.metrics.area).toBe(25);
  expect(results.stuck.error).toBe("Calculation timed out");
  expect(results.storage.error).toBeTruthy();
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
  await expect(page.getByLabel("Your explanation to Milo")).toHaveValue(
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
  state.numericalCheck = true;
  state.transferQuestion =
    "Explain how a larger image changes computation with a fixed set of weights.";
  await page.goto(`/session/${sessionId}/transfer`);
  await page.getByLabel("Parameters at 20 × 20").fill("204");
  await page.getByLabel("Parameters at 40 × 40").fill("204");
  await page
    .getByLabel("Explain your thinking")
    .fill("The same filter is applied at more locations.");
  await page.reload();
  await expect(page.getByLabel("Explain your thinking")).toHaveValue(
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
