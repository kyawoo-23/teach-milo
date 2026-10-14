import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { dictionaries, translate } from "../../src/lib/i18n/messages";
import {
  LOCALE_COOKIE,
  localeNames,
  locales,
  teachingLanguages,
  type Locale,
} from "../../src/lib/i18n/locales";

const sessionId = "11111111-1111-4111-8111-111111111111";
const lessonId = "22222222-2222-4222-8222-222222222222";
const materialId = "33333333-3333-4333-8333-333333333333";
const notes =
  "The same learned filter weights are reused at each spatial position. The input image size changes spatial computation, while a fixed layer has the same parameters.";
async function chooseLanguage(page: Page, label: string, language: Locale) {
  await page.getByRole("combobox", { name: label, exact: true }).click();
  await page
    .getByRole("option", { name: localeNames[language], exact: true })
    .click();
}
async function setup(page: Page) {
  const lesson = {
    id: lessonId,
    title: "权重共享",
    scope: "解释为什么权重保持不变。",
    level: "introductory",
    teachingLanguage: "zh-CN",
    concerns: [],
    objectives: [{ id: "o1", label: "解释权重共享" }],
  };
  const state = {
    id: sessionId,
    phase: "teaching",
    revision: 0,
    challengeUsed: false,
    hintUsed: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    lesson,
    messages: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        role: "student",
        text: "为什么同一个滤波器可以重复使用？",
        sequence: 0,
        createdAt: new Date().toISOString(),
      },
    ],
    progress: [{ id: "o1", label: "解释权重共享", status: "missing" }],
    board: {
      version: 2,
      title: "用例子解释",
      instruction: "请选择一个例子。",
      assumptions: "",
      state: [],
      derived: [],
      code: "",
      nodes: [] as unknown[],
      suggestedTool: { kind: "none", items: [], columns: [] },
    },
    pending: false,
  };
  await page.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    const fulfill = (body: unknown) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (pathname === "/api/auth/me")
      return fulfill({
        user: { id: "locale-learner", name: "Ada", email: "ada@example.test" },
      });
    if (pathname === "/api/status")
      return fulfill({ configured: true, missing: [] });
    if (pathname === "/api/materials")
      return fulfill({
        id: materialId,
        name: "Pasted notes",
        sources: [
          { id: "s1", label: "Pasted notes", text: notes, warnings: [] },
        ],
      });
    if (pathname === "/api/lessons") return fulfill(lesson);
    if (pathname === "/api/sessions" && route.request().method() === "GET")
      return fulfill({ sessions: [] });
    if (pathname.endsWith("/events")) return fulfill({ ok: true });
    return fulfill(state);
  });
  return state;
}
for (const locale of locales) {
  test(`website locale ${locale} renders on the server and persists without losing draft`, async ({
    page,
    context,
  }) => {
    await setup(page);
    await context.addCookies([
      { name: LOCALE_COOKIE, value: locale, url: "http://127.0.0.1:3000" },
    ]);
    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(page).toHaveTitle(
      dictionaries[locale]["TeachBack AI — Learn by teaching"],
    );
    await page
      .getByRole("button", {
        name: translate(locale, "Paste notes"),
        exact: true,
      })
      .click();
    await page.locator("#notes").fill(notes);
    await page.locator("#topic").fill("光");
    await expect(
      page.getByLabel(translate(locale, "What language should Milo use?")),
    ).toHaveAttribute("data-value", locale);
    const next: Locale = locale === "ja" ? "zh-CN" : "ja";
    await chooseLanguage(page, translate(locale, "Website language"), next);
    await expect(page.locator("html")).toHaveAttribute("lang", next);
    await expect(page.locator("#notes")).toHaveText(notes);
    await expect(page.locator("#topic")).toHaveValue("光");
    await expect(
      page.getByLabel(translate(next, "What language should Milo use?")),
    ).toHaveAttribute("data-value", next);
    const cookies = await context.cookies();
    const preference = cookies.find((cookie) => cookie.name === LOCALE_COOKIE)!;
    expect(preference.value).toBe(next);
    expect(preference.expires - Date.now() / 1000).toBeGreaterThan(31500000);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", next);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    expect(results.violations).toEqual([]);
    await expect(page.locator("body")).toHaveJSProperty(
      "scrollWidth",
      await page.locator("body").evaluate((element) => element.clientWidth),
    );
  });
}
test("teaching language stays independent through preparation and classroom UI changes", async ({
  page,
}) => {
  const state = await setup(page);
  await page.goto("/");
  await chooseLanguage(page, "Website language", "ja");
  await chooseLanguage(
    page,
    translate("ja", "What language should Milo use?"),
    "zh-CN",
  );
  await page
    .getByRole("button", { name: translate("ja", "Paste notes"), exact: true })
    .click();
  await page.locator("#notes").fill(notes);
  await page.locator("#topic").fill("光");
  await page
    .getByRole("button", { name: translate("ja", "Prepare my lesson") })
    .click();
  await expect(
    page.getByRole("heading", {
      name: translate("ja", "Does this look right?"),
    }),
  ).toBeVisible();
  await expect(
    page.getByLabel(translate("ja", "What language should Milo use?")),
  ).toHaveAttribute("data-value", "zh-CN");
  const preparation = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/lessons",
  );
  await page
    .getByRole("button", {
      name: translate("ja", "Looks right. Find my lesson"),
    })
    .click();
  expect((await preparation).postDataJSON().teachingLanguage).toBe("zh-CN");
  await expect(
    page.getByText(
      translate("ja", "Teaching language: {language}", {
        language: localeNames["zh-CN"],
      }),
    ),
  ).toBeVisible();
  await expect(
    page.getByLabel(translate("ja", "What language should Milo use?")),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: translate("ja", "Let’s teach Milo") })
    .click();
  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  await expect(
    page.locator(".message-text").filter({ hasText: state.messages[0].text }),
  ).toBeVisible();
  const draft = page.getByLabel(translate("ja", "Your explanation to Milo"));
  await draft.fill("我用自己的话解释。");
  await chooseLanguage(page, translate("ja", "Website language"), "en");
  await expect(page.getByLabel("Your explanation to Milo")).toHaveText(
    "我用自己的话解释。",
  );
  await expect(
    page.locator(".message-text").filter({ hasText: state.messages[0].text }),
  ).toBeVisible();
  await expect(page.getByLabel("What language should Milo use?")).toHaveCount(
    0,
  );
  await page.reload();
  await expect(page.getByLabel("Your explanation to Milo")).toHaveText(
    "我用自己的话解释。",
  );
});

test.describe("browser language preferences", () => {
  test.use({ locale: "ja-JP" });
  test("browser preferences select the initial site language", async ({
    page,
  }) => {
    await setup(page);
    const response = await page.goto("/");
    expect(response!.request().headers()["accept-language"]).toContain("ja");
    expect(await response!.text()).toContain('<html lang="ja"');
    await expect(page.locator("html")).toHaveAttribute("lang", "ja");
    await expect(
      page.getByLabel(translate("ja", "Website language")),
    ).toHaveAttribute("data-value", "ja");
  });
});

test("the selected teaching language survives a sign-in redirect", async ({
  page,
}) => {
  await setup(page);
  let signedIn = false;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        user: signedIn
          ? { id: "locale-learner", name: "Ada", email: "ada@example.test" }
          : null,
      }),
    }),
  );
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Sign In", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Paste notes", exact: true }).click();
  await page.locator("#notes").fill(notes);
  await page.locator("#topic").fill("光");
  await chooseLanguage(page, "What language should Milo use?", "ja");
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  await expect(
    page.getByRole("dialog", { name: "Sign In to TeachBack" }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () =>
        JSON.parse(sessionStorage.getItem("teachback:material-draft")!)
          .teachingLanguage,
    ),
  ).toBe("ja");
  signedIn = true;
  await page.goto("/?signed-in=1");
  await expect(
    page.getByRole("heading", { name: "Does this look right?" }),
  ).toBeVisible();
  await expect(
    page.getByLabel("What language should Milo use?"),
  ).toHaveAttribute("data-value", "ja");
  const preparation = page.waitForRequest(
    (request) => new URL(request.url()).pathname === "/api/lessons",
  );
  await page
    .getByRole("button", { name: "Looks right. Find my lesson" })
    .click();
  expect((await preparation).postDataJSON().teachingLanguage).toBe("ja");
});

test("custom language menus support keyboard selection, cancellation and typeahead", async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.goto("/");
  const language = page.getByRole("combobox", {
    name: "What language should Milo use?",
    exact: true,
  });
  await language.focus();
  await language.press("ArrowDown");
  await expect(language).toBeFocused();
  await expect(language).toHaveAttribute("aria-expanded", "true");
  await expect(
    page.getByRole("option", { name: "English", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await language.press("ArrowDown");
  await expect(language).toHaveAttribute(
    "aria-activedescendant",
    (await page
      .getByRole("option", { name: "简体中文", exact: true })
      .getAttribute("id")) as string,
  );
  await language.press("Escape");
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await expect(language).toHaveAttribute("data-value", "en");
  await expect(language).toBeFocused();
  await language.press("End");
  await language.press("Enter");
  await expect(language).toHaveAttribute(
    "data-value",
    teachingLanguages.at(-1)!,
  );
  await language.press("Home");
  await language.press("Tab");
  await expect(language).toHaveAttribute("data-value", "en");
  await expect(language).not.toBeFocused();
  await language.focus();
  await language.press("j");
  await language.press("Enter");
  await expect(language).toHaveAttribute("data-value", "ja");
  await language.click();
  await page.screenshot({
    path: testInfo.outputPath("teaching-language-menu.png"),
  });
  const results = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa"])
    .analyze();
  expect(results.violations).toEqual([]);
  await page
    .getByRole("heading", {
      name: "You know it. Can you teach it?",
      exact: true,
    })
    .click();
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("custom menus fit a narrow screen and work without the Popover API", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.addInitScript(() => {
    delete (HTMLElement.prototype as { popover?: string }).popover;
  });
  await setup(page);
  await page.goto("/");
  await page
    .getByRole("combobox", { name: "Website language", exact: true })
    .click();
  const menu = page.getByRole("listbox", {
    name: "Website language",
    exact: true,
  });
  await page.screenshot({
    path: testInfo.outputPath("website-language-menu.png"),
  });
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  await page.getByRole("option", { name: "日本語", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "ja");
  await expect(page.getByRole("listbox")).toHaveCount(0);
});

test("classification menus select groups in the teaching board and its mobile dialog", async ({
  page,
}, testInfo) => {
  const state = await setup(page);
  Object.assign(state.board, {
    title: "Sort the examples",
    instruction: "Choose the matching group.",
    nodes: [
      { id: "main", parentId: "", component: "Stack", props: [], items: [] },
      {
        id: "sort",
        parentId: "main",
        component: "Buckets",
        props: [{ key: "groups", value: "Parameters|Computation" }],
        items: [
          { id: "a", label: "Shared weights", detail: "One filter is reused." },
          { id: "b", label: "Image width", detail: "The image size changes." },
        ],
      },
    ],
  });
  await page.goto(`/session/${sessionId}`);
  const mobile = testInfo.project.name === "mobile";
  if (mobile)
    await page.getByRole("button", { name: "Open teaching board" }).click();
  const board = page.locator(".teaching-board:visible");
  const group = board.getByRole("combobox", {
    name: "Shared weights",
    exact: true,
  });
  await group.click();
  await expect(
    page.getByRole("listbox", { name: "Shared weights" }),
  ).toBeVisible();
  if (mobile) {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Your teaching board" }),
    ).toBeVisible();
    await expect(group).toBeFocused();
    await group.click();
  }
  await page.getByRole("option", { name: "Parameters", exact: true }).click();
  await expect(group).toHaveAttribute("data-value", "Parameters");
  await expect(group).toBeFocused();
  await board
    .getByRole("combobox", { name: "Image width", exact: true })
    .click();
  await page.getByRole("option", { name: "Computation", exact: true }).click();
  await board.getByRole("button", { name: "Attach to explanation" }).click();
  await expect(page.locator(".attachment-chip")).toBeVisible();
});
