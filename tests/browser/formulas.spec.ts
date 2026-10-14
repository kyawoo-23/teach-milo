import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { writeFile } from "node:fs/promises";

const id = "11111111-1111-4111-8111-111111111111";
const prose =
  String.raw`Divide using $\frac{x}{2}$, then take \(\sqrt{x}\). Chemistry: $\ce{H2O}$. Prices $5 and $10. Code: \`\[x\]\`.`.replaceAll(
    "\\`",
    "`",
  );
const answer = String.raw`I halve the quantity: $\frac{4}{2}=2$.`;
async function setup(page: Page, phase = "teaching") {
  const requests: any[] = [];
  const message = {
    id: "learner",
    role: "learner",
    kind: "teaching",
    text: answer,
    sequence: 1,
    createdAt: new Date().toISOString(),
  };
  const score = {
    score: 2,
    status: "assessed",
    explanation: prose,
    citations: [{ messageId: message.id, quote: answer }],
  };
  const state: any = {
    id,
    phase,
    revision: 0,
    pending: false,
    hintUsed: false,
    challengeUsed: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    lesson: {
      id,
      title: "Reason about $x^2$",
      scope: prose,
      level: "introductory",
      concerns: [],
      objectives: [{ id: "o1", label: "Explain $x$" }],
    },
    progress: [{ id: "o1", label: "Explain $x$", status: "partial" }],
    messages: [
      {
        id: "opening",
        role: "student",
        text: prose,
        move: "request_demo",
        sequence: 0,
        createdAt: new Date().toISOString(),
      },
      message,
    ],
    nextCursor: 0,
    transferQuestion: prose + "\n\\[\\frac{1}{2}\\]",
    numericFields: [
      { id: "result", label: "Value of $x$", unit: String.raw`$\pu{m/s}$` },
    ],
    board: {
      version: 2,
      title: "Explore $x$",
      instruction: prose,
      assumptions: "$x>0$",
      state: [
        {
          id: "x",
          label: "Input $x$",
          unit: "",
          type: "number",
          initial: 4,
          min: 0,
          max: 10,
          step: 1,
          options: [],
        },
      ],
      derived: [],
      code: "",
      nodes: [
        { id: "root", parentId: "", component: "Stack", props: [], items: [] },
        {
          id: "text",
          parentId: "root",
          component: "Text",
          props: [
            { key: "text", value: String.raw`Current {x}; $\frac{x}{2}$` },
          ],
          items: [],
        },
        {
          id: "number",
          parentId: "root",
          component: "NumberInput",
          props: [{ key: "bind", value: "x" }],
          items: [],
        },
      ],
      suggestedTool: { kind: "none", items: [], columns: [] },
    },
    report:
      phase === "report"
        ? {
            scores: {
              accuracy: score,
              mechanism: score,
              evidence: score,
              misconception: score,
              transfer: score,
            },
            strengths: [{ text: prose, citations: score.citations }],
            nextSteps: [{ text: prose, citations: [] }],
            expectedTransferExplanation: prose,
            total: 10,
            overallLabel: "strong_evidence",
            transferCorrect: true,
            criticalMisconception: false,
          }
        : undefined,
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const reply = (json: any) => route.fulfill({ json });
    if (path === "/api/auth/me")
      return reply({
        user: { id: "formula-learner", name: "Ada", email: "ada@example.test" },
      });
    if (path === "/api/status") return reply({ configured: true, missing: [] });
    if (path.endsWith("/messages")) return reply({ messages: [message] });
    if (path.endsWith("/turns") || path.endsWith("/transfer")) {
      const data = route.request().postDataJSON();
      requests.push(data);
      // Keep the optimistic message visible before returning the persisted copy.
      await new Promise((resolve) => setTimeout(resolve, 250));
      state.revision++;
      state.messages.push({
        ...message,
        id: data.operationId,
        text: data.text ?? data.answer,
        sequence: 2,
        board: data.board,
      });
      return reply(state);
    }
    if (path === `/api/sessions/${id}`) return reply(state);
    return reply({ ok: true, sessions: [] });
  });
  return { requests, state };
}
async function board(page: Page) {
  if (await page.locator(".board-sidebar").isVisible())
    return page.locator(".board-sidebar .board-workspace");
  await page
    .getByRole("button", { name: "Open teaching board", exact: true })
    .first()
    .click();
  return page.getByRole("dialog").locator(".board-workspace");
}

test("questions, saved messages, board prose and composer render formulas while preserving input", async ({
  page,
}) => {
  const { requests } = await setup(page);
  await page.goto(`/session/${id}`);
  const message = page.locator(".message.student").first();
  await expect(message.locator(".katex")).toHaveCount(3);
  await expect(message).toContainText("Prices $5 and $10");
  await expect(message.locator("code")).toContainText(String.raw`\[x\]`);
  await page
    .getByRole("button", { name: "Load earlier messages", exact: true })
    .click();
  await expect(page.locator(".message.learner .katex")).toHaveCount(1);
  const activity = await board(page);
  await expect(activity.locator(".board-text .katex")).toHaveCount(1);
  await expect(activity.locator(".board-text")).toContainText("Current 4");
  if (await page.getByRole("dialog").isVisible())
    await page.keyboard.press("Escape");
  await expect(page.locator(".composer .md-bar")).toHaveCount(0);
  await page.getByLabel("Your explanation to Milo").fill(answer);
  await page.reload();
  await expect(page.getByLabel("Your explanation to Milo")).toHaveText(answer);
  await page
    .getByLabel("Your explanation to Milo")
    .press("ControlOrMeta+Enter");
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].text).toBe(answer);
  await expect(
    page.locator(".message.learner").last().locator(".katex"),
  ).toHaveCount(1);
  await expect(page.getByLabel("Your explanation to Milo")).toHaveText("");
});

test("independent questions and answer previews support formulas while numeric fields stay numeric", async ({
  page,
}) => {
  const { requests } = await setup(page, "transfer");
  await page.goto(`/session/${id}/transfer`);
  await expect(page.locator(".transfer-question .katex")).toHaveCount(4);
  await expect(page.locator(".transfer-question .katex-display")).toHaveCount(
    1,
  );
  await expect(page.locator("#transfer-result")).toHaveAttribute(
    "type",
    "number",
  );
  await page.locator("#transfer-result").fill("2");
  const thinking = page.getByLabel("Explain your thinking");
  await thinking.fill("I calculate x^2");
  await thinking.evaluate((node) => {
    const text = node.firstChild;
    if (!text) return;
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 1);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    if (node instanceof HTMLElement) node.focus();
  });
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await expect(thinking.locator("strong")).toHaveText("I");
  await thinking.evaluate((node, value) => {
    node.textContent = value;
    node.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }, answer);
  await page.getByRole("button", { name: "See my learning report" }).click();
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toMatchObject({ answer, answers: { result: 2 } });
});

test("reports, evidence quotes, original answers and completed chat share rendering", async ({
  page,
}) => {
  await setup(page, "report");
  await page.goto(`/session/${id}/report`);
  await expect(
    page.locator(".rp-strengths .formula-content .katex"),
  ).toHaveCount(3);
  await page.getByText("See the expected reasoning", { exact: true }).click();
  await expect(page.locator(".expected-explanation .katex")).toHaveCount(3);
  await page.locator(".rp-strengths summary").click();
  await expect(
    page.locator(".rp-strengths .evidence-quote .katex"),
  ).toHaveCount(1);
  await page.locator(".rp-strengths .evidence-quote").click();
  const dialog = page.getByRole("dialog", {
    name: "Your original explanation",
  });
  await expect(dialog.locator(".katex")).toHaveCount(1);
  await page.keyboard.press("Escape");
  await page.getByRole("tab", { name: "Chat", exact: true }).click();
  await expect(
    page.locator(".completed-chat .message.student .katex"),
  ).toHaveCount(3);
});

test("sketch text labels stay raw text and survive transforms and image export", async ({
  page,
}, info) => {
  await setup(page);
  await page.goto(`/session/${id}`);
  const activity = await board(page);
  await activity
    .getByRole("combobox", { name: "Board tool", exact: true })
    .click();
  await page
    .getByRole("option", { name: "Sketch and diagram", exact: true })
    .click();
  await activity
    .getByRole("button", { name: "Text label", exact: true })
    .click();
  await activity
    .getByRole("button", { name: "Add label", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Text label", exact: true });
  await expect(dialog.getByRole("tab")).toHaveCount(0);
  await dialog
    .getByLabel("Text label", { exact: true })
    .fill(String.raw`$\frac{1}{2}$`);
  await dialog.getByRole("button", { name: "Add label", exact: true }).click();
  await activity
    .getByRole("button", { name: "Select and move", exact: true })
    .click();
  // The selection follows the raw source, which is wider than a typeset fraction.
  await expect
    .poll(async () => {
      const right = await activity
        .locator('[data-handle="e"]')
        .getAttribute("style");
      return Number(/left: ([\d.]+)%/.exec(right ?? "")?.[1]);
    })
    .toBeGreaterThan(25);
  await activity
    .getByRole("button", { name: "Rotate right", exact: true })
    .first()
    .click();
  await activity
    .getByRole("button", { name: "Make larger", exact: true })
    .first()
    .click();
  await activity
    .getByRole("button", { name: "Attach to explanation", exact: true })
    .click();
  const image = page.locator(".board-attachment img");
  await expect(image).toBeVisible();
  const src = (await image.getAttribute("src"))!;
  const bytes = Buffer.from(src.split(",")[1], "base64");
  expect(bytes.length).toBeGreaterThan(1000);
  expect(bytes.length).toBeLessThanOrEqual(128 * 1024);
  await writeFile(info.outputPath("formula-sketch.png"), bytes);
  const pixels = await image.evaluate(async (img: HTMLImageElement) => {
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    for (let i = 0; i < data.length; i += 4)
      if (data[i] < 200 && data[i + 1] < 200) ink++;
    return ink;
  });
  expect(pixels).toBeGreaterThan(30);
  await expect(activity.getByRole("alert")).toHaveCount(0);
  const violations = await new AxeBuilder({ page })
    .include(".board-workspace")
    .analyze();
  expect(violations.violations).toEqual([]);
});

test("paste notes shows formatting tools on selection and accepts shortcuts", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Paste notes" }).click();
  const notes = page.getByLabel("Your learning notes");
  const stored = page.locator('textarea[name="notes"]');
  async function selectRange(start: number, end: number) {
    await notes.evaluate(
      (node, [from, to]) => {
        const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
        let offset = 0;
        let startNode: Node | null = null;
        let startOffset = 0;
        let endNode: Node | null = null;
        let endOffset = 0;
        let current: Node | null;
        while ((current = walker.nextNode())) {
          const length = current.textContent?.length ?? 0;
          if (!startNode && offset + length >= from) {
            startNode = current;
            startOffset = from - offset;
          }
          if (!endNode && offset + length >= to) {
            endNode = current;
            endOffset = to - offset;
            break;
          }
          offset += length;
        }
        const range = document.createRange();
        range.setStart(startNode!, startOffset);
        range.setEnd(endNode!, endOffset);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        if (node instanceof HTMLElement) node.focus();
      },
      [start, end] as [number, number],
    );
  }
  async function replacePlain(text: string) {
    await notes.evaluate((node, value) => {
      node.textContent = value;
      node.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }, text);
  }
  await replacePlain("photosynthesis stores energy");
  await selectRange(0, 14);
  const bold = page.getByRole("button", { name: "Bold", exact: true });
  await expect(bold).toBeVisible();
  await bold.click();
  await expect(notes.locator("strong")).toHaveText("photosynthesis");
  await expect(notes).not.toContainText("**");
  await expect(stored).toHaveValue("**photosynthesis** stores energy");
  await replacePlain("photosynthesis stores energy");
  await selectRange(15, 21);
  await notes.press("ControlOrMeta+I");
  await expect(notes.locator("em")).toHaveText("stores");
  await expect(stored).toHaveValue("photosynthesis _stores_ energy");
  await replacePlain("photosynthesis stores energy");
  await selectRange(22, 28);
  await notes.press("ControlOrMeta+E");
  await expect(notes.locator("code")).toHaveText("energy");
  await expect(stored).toHaveValue("photosynthesis stores `energy`");
});
