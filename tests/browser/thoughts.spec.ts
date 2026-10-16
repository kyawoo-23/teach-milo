import { test, expect } from "@playwright/test";
import type { Message } from "../../src/lib/contracts";
import { publicLesson } from "../../src/lib/contracts";
import { finalizeReport } from "../../src/lib/assessment";
import { translateTeaching } from "../../src/lib/i18n/messages";
import { lessonFixture, messageFixture, reportFixture } from "../fixtures";

const id = "11111111-1111-4111-8111-111111111111";
const reason =
  "時間が変わっても速さが同じなら、何が変わるのか気になっているんだ。";

for (const phase of ["teaching", "report"] as const) {
  test(`${phase}: Milo's thought is collapsed, keyboard accessible, and excluded from copy`, async ({
    page,
    context,
  }, testInfo) => {
    const lesson = lessonFixture();
    lesson.teachingLanguage = "ja";
    const learner = { ...messageFixture(), sequence: 3 };
    const messages: Message[] = [
      {
        ...messageFixture("An older reply without a thought."),
        role: "student",
        sequence: 0,
      },
      {
        ...messageFixture("Hi! Can you teach me?"),
        role: "student",
        sequence: 1,
        thought: {
          emotion: "curious",
          reason: translateTeaching(
            "ja",
            "I'm curious to hear how you explain this.",
          ),
        },
      },
      {
        ...messageFixture(
          "I wonder why changing the time changes the distance.",
        ),
        role: "student",
        sequence: 2,
        thought: {
          emotion: "puzzled",
          reason: "I wonder why changing the time changes the distance!",
        },
      },
      learner,
      {
        ...messageFixture("Can you walk me through a small example?"),
        role: "student",
        sequence: 4,
        thought: { emotion: "curious", reason },
      },
    ];
    const state = {
      id,
      phase,
      revision: 0,
      pending: false,
      hintUsed: false,
      challengeUsed: false,
      expiresAt: lesson.expiresAt,
      lesson: publicLesson(lesson),
      board: lesson.board,
      messages,
      progress: lesson.objectives.map(({ id, label }) => ({
        id,
        label,
        status: "partial",
      })),
      ...(phase === "report"
        ? {
            report: finalizeReport(
              reportFixture(learner),
              lesson,
              [learner],
              true,
            ),
          }
        : {}),
    };
    await context.addCookies([
      { name: "teachback-locale", value: "en", url: "http://127.0.0.1:3000" },
    ]);
    await page.route("**/api/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path === "/api/auth/me")
        return route.fulfill({
          json: {
            user: { id: "learner", name: "Ada", email: "ada@example.test" },
          },
        });
      if (path === "/api/status")
        return route.fulfill({ json: { configured: true, missing: [] } });
      if (path === `/api/sessions/${id}`) return route.fulfill({ json: state });
      return route.fulfill({ json: { ok: true, sessions: [] } });
    });
    await page.goto(`/session/${id}${phase === "report" ? "/report" : ""}`);
    if (phase === "report")
      await page.getByRole("tab", { name: "Chat", exact: true }).click();
    const milo = page.locator(".message.student").last();
    const thought = milo.locator("details.message-thought");
    await expect(thought).toHaveCount(1);
    await expect(thought).not.toHaveAttribute("open");
    await expect(thought.locator("p")).toBeHidden();
    await expect(thought.locator("summary")).toHaveText("Curious");
    await expect(thought.locator("summary")).toHaveAccessibleName(
      "Milo’s thought: Curious",
    );
    await expect(page.locator(".message-thought")).toHaveCount(1);
    await expect(page.locator(".message.learner details")).toHaveCount(0);
    await expect(
      page.locator(".message.student").first().locator("details"),
    ).toHaveCount(0);
    const footerLayout = await milo
      .locator(".message-footer")
      .evaluate((footer) => {
        const summary = footer
          .querySelector("summary")!
          .getBoundingClientRect();
        const copy = footer.querySelector("button")!.getBoundingClientRect();
        const bubble = footer.querySelector("details")!.getBoundingClientRect();
        return { height: summary.height, alignment: bubble.top - copy.top };
      });
    expect(footerLayout.height).toBeGreaterThanOrEqual(32);
    expect(footerLayout.alignment).toBe(0);
    await page.screenshot({
      path: testInfo.outputPath("thought-collapsed.png"),
      fullPage: true,
    });
    await thought.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(thought).toHaveAttribute("open", "");
    await expect(thought.locator("p")).toHaveText(reason);
    await expect(thought.locator("p")).toHaveAttribute("lang", "ja");
    await expect(thought.locator("p")).toBeInViewport({ ratio: 1 });
    if (phase === "teaching") {
      await expect
        .poll(async () =>
          thought.locator("p").evaluate((paragraph) => {
            const composer = document.querySelector(".composer")!;
            return (
              paragraph.getBoundingClientRect().bottom -
              composer.getBoundingClientRect().top
            );
          }),
        )
        .toBeLessThanOrEqual(0);
    }
    await page.screenshot({
      path: testInfo.outputPath("thought-expanded.png"),
      fullPage: true,
    });
    // Intercept clipboard writes to verify exactly what the copy control sends.
    await page.evaluate(() => {
      Object.defineProperty(navigator, "clipboard", {
        configurable: true,
        value: {
          writeText: async (text: string) => {
            document.documentElement.dataset.copiedMessage = text;
          },
        },
      });
    });
    await milo.getByRole("button", { name: "Copy Milo’s message" }).click();
    await expect(page.locator("html")).toHaveAttribute(
      "data-copied-message",
      messages.at(-1)!.text,
    );
    await thought.locator("summary").click();
    await expect(thought.locator("p")).toBeHidden();
  });
}
