import { test, expect } from "@playwright/test";
import { publicLesson } from "../../src/lib/contracts";
import { lessonFixture, messageFixture } from "../fixtures";

const id = "11111111-1111-4111-8111-111111111111";

test.beforeEach(async ({ page, context }) => {
  const lesson = lessonFixture();
  await context.addCookies([
    { name: "teach-milo-locale", value: "en", url: "http://127.0.0.1:3000" },
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
    if (path === `/api/sessions/${id}`)
      return route.fulfill({
        json: {
          id,
          phase: "teaching",
          revision: 0,
          pending: false,
          hintUsed: false,
          challengeUsed: false,
          expiresAt: lesson.expiresAt,
          lesson: publicLesson(lesson),
          board: lesson.board,
          messages: [
            { ...messageFixture("Can you teach me?"), role: "student" },
          ],
          progress: lesson.objectives.map(({ id, label }) => ({
            id,
            label,
            status: "partial",
          })),
        },
      });
    return route.fulfill({ json: { ok: true, sessions: [] } });
  });
});

test("fullscreen fills the classroom and follows browser exit", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "Native desktop fullscreen");
  await page.goto(`/session/${id}`);
  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect(page.locator(".session-header")).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  await expect(page.getByLabel("Conversation with Milo")).toBeVisible();
  await expect(page.locator(".board-sidebar")).toBeVisible();
  const dimensions = await page.locator(".classroom").boundingBox();
  expect(dimensions?.y).toBe(0);
  expect(dimensions?.width).toBe(page.viewportSize()!.width);
  await page.getByRole("button", { name: "Exit fullscreen" }).click();
  await expect(page.locator(".session-header")).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(false);
  await page.getByRole("button", { name: "Enter fullscreen" }).click();
  await expect
    .poll(() => page.evaluate(() => !!document.fullscreenElement))
    .toBe(true);
  // A browser-owned exit (Esc, switching tabs) must reset the UI too.
  await page.evaluate(() => document.exitFullscreen());
  await expect(page.locator(".session-header")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Enter fullscreen" }),
  ).toBeVisible();
});

for (const support of ["unavailable", "denied"] as const) {
  test(`${support} fullscreen keeps a usable focus layout and preserves the draft`, async ({
    page,
  }) => {
    await page.addInitScript((support) => {
      Object.defineProperty(document, "fullscreenEnabled", {
        configurable: true,
        value: support === "denied",
      });
      if (support === "denied")
        Element.prototype.requestFullscreen = () =>
          Promise.reject(new TypeError("Fullscreen denied"));
    }, support);
    await page.goto(`/session/${id}`);
    const composer = page.getByRole("textbox", {
      name: "Your explanation to Milo",
    });
    await composer.fill("Keep my explanation while I focus.");
    await page.getByRole("button", { name: "Enter fullscreen" }).click();
    await expect(page.locator(".session-header")).toBeHidden();
    await expect(composer).toHaveText("Keep my explanation while I focus.");
    await expect(
      page.getByRole("button", { name: "Exit fullscreen" }),
    ).toBeInViewport();
    // The board's portaled dialog still works, and its Esc leaves focus mode on.
    if (await page.locator(".board-sidebar").isVisible())
      await page.getByRole("button", { name: "Expand", exact: true }).click();
    else
      await page
        .getByRole("button", { name: "Open teaching board" })
        .first()
        .click();
    await expect(
      page.getByRole("dialog", { name: "Your teaching board" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("dialog", { name: "Your teaching board" }),
    ).toBeHidden();
    await expect(page.locator(".session-header")).toBeHidden();
    await page.keyboard.press("Escape");
    await expect(page.locator(".session-header")).toBeVisible();
    await expect(composer).toHaveText("Keep my explanation while I focus.");
  });
}
