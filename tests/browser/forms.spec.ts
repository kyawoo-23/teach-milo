import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
const id = "11111111-1111-4111-8111-111111111111";
const notes =
  "Plants use light energy to make sugars from carbon dioxide and water. These sugars store chemical energy.";

async function setup(page: Page, phase = "baseline", signedIn = true) {
  const sent: { path: string; data: any }[] = [];
  const user = { id: "form-learner", name: "Ada", email: "ada@example.test" };
  const state = {
    id,
    revision: 0,
    phase,
    pending: false,
    hintUsed: false,
    challengeUsed: false,
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
    numericFields:
      phase === "transfer"
        ? [
            { id: "small", label: "Parameters at 20 × 20", unit: "" },
            { id: "large", label: "Parameters at 40 × 40", unit: "" },
          ]
        : [],
    transferQuestion: "Explain what changes for larger images.",
    progress: [],
    lesson: {
      id,
      title: "Weight sharing",
      scope: "Explain reuse",
      level: "introductory",
      concerns: [],
      objectives: [],
    },
    board: {
      version: 2,
      title: "Try a value",
      instruction: "Change the input.",
      assumptions: "",
      state: [
        {
          id: "size",
          label: "Size",
          unit: "",
          type: "number",
          initial: 4,
          min: 2,
          max: 10,
          step: 2,
          options: [],
        },
      ],
      derived: [],
      code: "",
      nodes: [
        { id: "main", parentId: "", component: "Stack", props: [], items: [] },
        {
          id: "size_slider",
          parentId: "main",
          component: "Slider",
          props: [{ key: "bind", value: "size" }],
          items: [],
        },
        {
          id: "size_number",
          parentId: "main",
          component: "NumberInput",
          props: [
            { key: "bind", value: "size" },
            { key: "label", value: "Size (Numeric value)" },
          ],
          items: [],
        },
      ],
      suggestedTool: { kind: "none", items: [], columns: [] },
    },
    messages: [
      {
        id: "opening",
        role: "student",
        text: "Could you explain weight reuse?",
        sequence: 0,
        createdAt: new Date().toISOString(),
      },
    ],
  };
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() === "POST")
      sent.push({ path, data: route.request().postDataJSON() });
    if (path === "/api/auth/me")
      return route.fulfill({ json: { user: signedIn ? user : null } });
    if (path === "/api/status")
      return route.fulfill({ json: { configured: true, missing: [] } });
    if (path === "/api/auth/signup") return route.fulfill({ json: { user } });
    if (path === "/api/materials")
      return route.fulfill({
        json: {
          id,
          name: "Pasted notes",
          sources: [{ id: "s1", label: "Notes", text: notes, warnings: [] }],
        },
      });
    if (path === "/api/lessons") return route.fulfill({ json: state.lesson });
    if (path === `/api/sessions/${id}` || path.endsWith("/transfer"))
      return route.fulfill({ json: state });
    return route.fulfill({ json: { ok: true } });
  });
  return sent;
}

test("signup shows field errors, focuses invalid input and excludes confirmation from the request", async ({
  page,
}) => {
  const sent = await setup(page, "baseline", false);
  await page.goto("/?authError=Please%20sign%20in");
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Create Account", exact: true })
    .first()
    .click();
  await dialog
    .locator("form")
    .getByRole("button", { name: "Create Account", exact: true })
    .click();
  await expect(dialog.getByLabel("Your Name")).toBeFocused();
  await expect(dialog.getByLabel("Your Name")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await dialog.getByLabel("Your Name").fill("Ada");
  await dialog.getByLabel("Email Address").fill("ada@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("valid-password");
  await dialog
    .getByLabel("Confirm Password", { exact: true })
    .fill("different-password");
  await dialog
    .locator("form")
    .getByRole("button", { name: "Create Account", exact: true })
    .click();
  await expect(
    dialog.getByText("Passwords do not match.", { exact: true }),
  ).toBeVisible();
  expect(
    sent.filter((request) => request.path === "/api/auth/signup"),
  ).toHaveLength(0);
  expect(
    (await new AxeBuilder({ page }).include('[role="dialog"]').analyze())
      .violations,
  ).toEqual([]);
  await dialog
    .getByLabel("Confirm Password", { exact: true })
    .fill("valid-password");
  await dialog
    .locator("form")
    .getByRole("button", { name: "Create Account", exact: true })
    .click();
  await expect
    .poll(
      () =>
        sent.filter((request) => request.path === "/api/auth/signup").length,
    )
    .toBe(1);
  expect(
    sent.find((request) => request.path === "/api/auth/signup")!.data,
  ).toEqual({
    name: "Ada",
    email: "ada@example.test",
    password: "valid-password",
  });
});

test("material and extraction validation block bad submissions and recover after corrections", async ({
  page,
}) => {
  const sent = await setup(page);
  await page.goto("/");
  await page.getByRole("button", { name: "Paste notes", exact: true }).click();
  await page.getByLabel("Your learning notes").fill("Too short");
  await page.getByLabel("What would you like to focus on?").fill(" ");
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  await expect(
    page.getByText("Enter at least 30 characters.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByLabel("What would you like to focus on?"),
  ).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByLabel("Your learning notes")).toBeFocused();
  expect(
    sent.filter((request) => request.path === "/api/materials"),
  ).toHaveLength(0);
  await page.getByLabel("Your learning notes").fill(notes);
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  await expect(
    page.getByLabel("What would you like to focus on?"),
  ).toBeFocused();
  await page
    .getByLabel("What would you like to focus on?")
    .fill("Photosynthesis");
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  await expect(
    page.getByRole("heading", { name: "Does this look right?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Preview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page.locator("#source-0").fill(" ");
  await page
    .getByRole("button", { name: "Looks right. Find my lesson" })
    .click();
  await expect(
    page.getByText("Include at least one passage of 30 characters."),
  ).toBeVisible();
  expect(
    sent.filter((request) => request.path === "/api/lessons"),
  ).toHaveLength(0);
  await page.locator("#source-0").fill(notes);
  await page
    .getByRole("button", { name: "Looks right. Find my lesson" })
    .click();
  await expect
    .poll(
      () => sent.filter((request) => request.path === "/api/lessons").length,
    )
    .toBe(1);
});

test("extraction pages preserve edits and open the page with a validation error", async ({
  page,
}) => {
  const sent = await setup(page);
  await page.route("**/api/materials", (route) =>
    route.fulfill({
      json: {
        id,
        name: "Learning material.pptx",
        sources: [1, 2, 3].map((number) => ({
          id: `s${number}`,
          label: `Slide ${number}`,
          text:
            number === 2
              ? Array(30).fill(notes).join("\n\n")
              : `${notes} Page ${number}.`,
          warnings: number === 2 ? ["Check the formula on this page."] : [],
        })),
      },
    }),
  );
  await page.goto("/");
  await page.locator("input[type=file]").setInputFiles({
    name: "Learning material.pptx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    buffer: Buffer.from("Mocked presentation upload"),
  });
  await page
    .getByLabel("What would you like to focus on?")
    .fill("Photosynthesis");
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  const previous = page.getByRole("button", { name: "Previous", exact: true });
  const next = page.getByRole("button", { name: "Next", exact: true });
  await expect(
    page.getByRole("status").filter({ hasText: "Page 1 of 3" }),
  ).toBeVisible();
  await expect(previous).toBeDisabled();
  await expect(page.locator(".source-section")).toHaveCount(1);
  await next.scrollIntoViewIfNeeded();
  const paginationBounds = async () =>
    Promise.all([previous.boundingBox(), next.boundingBox()]);
  const initialBounds = await paginationBounds();
  await next.click();
  await expect(page.getByText("Check the formula on this page.")).toBeVisible();
  await expect.poll(paginationBounds).toEqual(initialBounds);
  await expect
    .poll(() =>
      page
        .locator(".source-section")
        .evaluate((element) => element.scrollHeight > element.clientHeight),
    )
    .toBe(true);
  await previous.click();
  await expect(page.getByText("Page 1 of 3", { exact: true })).toBeVisible();
  await expect.poll(paginationBounds).toEqual(initialBounds);
  await expect(
    page.getByRole("tab", { name: "Preview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page.locator("#source-0").fill(" ");
  await next.click();
  await expect(page.getByText("Check the formula on this page.")).toBeVisible();
  await expect(
    page.getByRole("tab", { name: "Preview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page.locator("#source-1").fill(" ");
  await next.click();
  await expect(next).toBeDisabled();
  await expect(page.getByText("Check the formula on this page.")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("tab", { name: "Preview", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await page.getByRole("tab", { name: "Edit", exact: true }).click();
  await page.locator("#source-2").fill(" ");
  await previous.click();
  await expect(page.locator("#source-1")).toHaveValue(" ");
  await next.click();
  await page
    .getByRole("button", { name: "Looks right. Find my lesson" })
    .click();
  await expect(page.locator("#source-0")).toBeFocused();
  await expect(
    page.getByText("Include at least one passage of 30 characters."),
  ).toBeVisible();
  const corrected = `${notes} Corrected text.`;
  await page.locator("#source-0").fill(corrected);
  await next.click();
  await page
    .getByRole("button", { name: "Looks right. Find my lesson" })
    .click();
  await expect
    .poll(
      () => sent.filter((request) => request.path === "/api/lessons").length,
    )
    .toBe(1);
  expect(
    sent
      .find((request) => request.path === "/api/lessons")!
      .data.sources.map((source: { text: string }) => source.text),
  ).toEqual([corrected, " ", " "]);
});

test("independent check requires each numeric field, preserves answers and permits explicit skipping", async ({
  page,
}) => {
  const sent = await setup(page, "transfer");
  await page.goto(`/session/${id}/transfer`);
  await page.getByRole("button", { name: "See my learning report" }).click();
  await expect(page.getByText("Enter a number.")).toHaveCount(2);
  expect(
    sent.filter((request) => request.path.endsWith("/transfer")),
  ).toHaveLength(0);
  await page.getByLabel("Parameters at 40 × 40").fill("0");
  await page
    .getByLabel("Explain your thinking")
    .fill("The filter keeps its learned weights.");
  await page.getByRole("button", { name: "See my learning report" }).click();
  expect(
    sent.filter((request) => request.path.endsWith("/transfer")),
  ).toHaveLength(0);
  await expect(page.getByText("Enter a number.")).toHaveCount(1);
  await page.getByLabel("Parameters at 20 × 20").fill("1.5");
  await page.getByRole("button", { name: "See my learning report" }).click();
  await expect
    .poll(
      () => sent.filter((request) => request.path.endsWith("/transfer")).length,
    )
    .toBe(1);
  expect(
    sent.find((request) => request.path.endsWith("/transfer"))!.data,
  ).toMatchObject({
    answer: "The filter keeps its learned weights.",
    answers: { small: 1.5, large: 0 },
    skip: false,
  });
  await page.getByLabel("Parameters at 20 × 20").fill("");
  await page.getByRole("button", { name: "Skip this check" }).click();
  await expect
    .poll(
      () => sent.filter((request) => request.path.endsWith("/transfer")).length,
    )
    .toBe(2);
  expect(
    sent.filter((request) => request.path.endsWith("/transfer"))[1].data,
  ).toMatchObject({ answer: "", skip: true });
});

test("numeric board entry retains invalid edits without changing the shared activity", async ({
  page,
}, testInfo) => {
  await setup(page, "teaching");
  await page.goto(`/session/${id}`);
  if (testInfo.project.name === "mobile")
    await page.getByRole("button", { name: "Open teaching board" }).click();
  const number = page.getByRole("spinbutton", { name: "Size (Numeric value)" });
  await expect(number).toHaveValue("4");
  await number.fill("5");
  await number.press("Tab");
  await expect(number).toHaveAttribute("aria-invalid", "true");
  await expect(
    page.getByRole("slider", { name: "Size", exact: true }),
  ).toHaveValue("4");
  await number.fill("6");
  await number.press("Tab");
  await expect(number).toHaveAttribute("aria-invalid", "false");
  await expect(
    page.getByRole("slider", { name: "Size", exact: true }),
  ).toHaveValue("6");
});
