import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { getApps, initializeApp } from "firebase-admin/app";
import { getFirestore, Timestamp } from "firebase-admin/firestore";
import { lessonFixture } from "../fixtures";
import { publicLesson } from "../../src/lib/contracts";

// Guest/auth/material/session endpoints run against the actual local server.
// Only lesson generation is scripted, with its result persisted in the emulator.
test.skip(
  !process.env.FIRESTORE_EMULATOR_HOST,
  "Requires the local Firestore emulator",
);
function db() {
  const app =
    getApps().find((a) => a.name === "guest-browser-tests") ??
    initializeApp({ projectId: "demo-teachback" }, "guest-browser-tests");
  return getFirestore(app);
}
async function startLesson(page: Page, upload = false) {
  await page.route("**/api/lessons", async (route) => {
    const input = route.request().postDataJSON();
    const material = await db()
      .collection("materials")
      .doc(input.materialId)
      .get();
    const lesson = {
      ...lessonFixture(),
      id: input.operationId,
      ownerId: material.get("ownerId"),
      materialId: input.materialId,
      sources: input.sources,
      teachingLanguage: input.teachingLanguage,
    };
    await db()
      .collection("lessons")
      .doc(lesson.id)
      .create({
        ...lesson,
        expiresAt: Timestamp.fromDate(new Date(lesson.expiresAt)),
      });
    await route.fulfill({ json: publicLesson(lesson), status: 201 });
  });
  await page.goto("/");
  const notes =
    "At constant speed, distance equals speed multiplied by time. Doubling the time doubles the distance.";
  if (upload)
    await page.locator('input[type="file"]').setInputFiles({
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from(notes),
    });
  else {
    await page.getByRole("button", { name: "Paste notes" }).click();
    await page.getByLabel("Your learning notes").fill(notes);
  }
  await page
    .getByLabel("What would you like to focus on?")
    .fill("Distance and time");
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  await expect(
    page.getByRole("heading", { name: "Does this look right?" }),
  ).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Sign In to Teach Milo" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Looks right. Find my lesson" })
    .click();
  await page.getByRole("button", { name: "Let’s teach Milo" }).click();
  await expect(
    page.getByRole("heading", { name: "Milo’s classroom" }),
  ).toBeVisible();
  return page.url().split("/session/")[1].split("/")[0];
}

for (const upload of [false, true]) {
  test(`real guest ${upload ? "upload" : "notes"} flow resumes, isolates browsers, and supports history/deletion`, async ({
    page,
    context,
    browser,
  }) => {
    const id = await startLesson(page, upload);
    const cookies = await context.cookies();
    expect(cookies.find((c) => c.name === "teachback_guest")).toMatchObject({
      httpOnly: true,
      sameSite: "Lax",
    });
    const before = await (await context.request.get("/api/auth/me")).json();
    expect(before.user).toBeNull();
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Milo’s classroom" }),
    ).toBeVisible();
    expect(
      (await (await context.request.get("/api/auth/me")).json()).guest,
    ).toEqual(before.guest);
    const other = await browser.newContext();
    expect(
      (
        await other.request.get(`http://127.0.0.1:3000/api/sessions/${id}`)
      ).status(),
    ).toBe(401);
    await other.request.post("http://127.0.0.1:3000/api/auth/guest", {
      data: {},
      headers: { Origin: "http://127.0.0.1:3000" },
    });
    expect(
      (
        await other.request.get(
          `http://127.0.0.1:3000/api/sessions/${id}/messages`,
        )
      ).status(),
    ).toBe(404);
    await other.close();
    await page
      .getByRole("button", { name: "My Sessions", exact: true })
      .click();
    const history = page.getByRole("dialog", { name: "My Learning Sessions" });
    await expect(history.locator(".session-card-link")).toHaveCount(1);
    await history.getByRole("button", { name: /Session details:/ }).click();
    await history.getByRole("button", { name: /Delete session/ }).click();
    await page
      .getByRole("alertdialog", { name: "Delete this session?" })
      .getByRole("button", { name: "Delete session", exact: true })
      .click();
    await expect(history.locator(".session-card-link")).toHaveCount(0);
  });
}

test("real signup transfers the open guest session and browser draft without changing its URL", async ({
  page,
  context,
}) => {
  const id = await startLesson(page);
  const originalUrl = page.url();
  const guest = (await (await context.request.get("/api/auth/me")).json())
    .guest;
  const ref = db().collection("sessions").doc(id);
  const expiry = (await ref.get()).get("expiresAt").toMillis();
  await page.evaluate(
    ({ ownerId, id }) => {
      // A second session's unsent workspace exercises namespace migration while
      // the visible workspace continues to be saved by its own React hook.
      localStorage.setItem(
        `teachback-board:${ownerId}:${id}-draft`,
        JSON.stringify({ marker: "keep me" }),
      );
    },
    { ownerId: guest.id, id },
  );
  await page.getByRole("button", { name: "Guest mode", exact: true }).click();
  await page
    .getByRole("button", { name: "Create Account", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Create Teach Milo Account",
  });
  await dialog.getByLabel("Your Name").fill("Hackathon Judge");
  await dialog.getByLabel("Email Address").fill(`${randomUUID()}@judge.test`);
  await dialog
    .getByLabel("Password", { exact: true })
    .fill("securePassword123");
  await dialog
    .getByLabel("Confirm Password", { exact: true })
    .fill("securePassword123");
  await dialog
    .locator("form")
    .getByRole("button", { name: "Create Account", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Milo’s classroom" }),
  ).toBeVisible();
  await expect(page.locator(".user-profile-trigger")).toContainText(
    "Hackathon Judge",
  );
  expect(page.url()).toBe(originalUrl);
  const identity = await (await context.request.get("/api/auth/me")).json();
  expect(identity.guest).toBeNull();
  expect((await ref.get()).get("ownerId")).toBe(identity.user.id);
  expect((await ref.get()).get("expiresAt").toMillis()).toBe(expiry);
  expect(
    await page.evaluate(
      ({ ownerId, id }) =>
        localStorage.getItem(`teachback-board:${ownerId}:${id}-draft`),
      { ownerId: identity.user.id, id },
    ),
  ).toContain("keep me");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Milo’s classroom" }),
  ).toBeVisible();
});

test("blocked cookies stop material processing and missing guest cookies explain recovery", async ({
  page,
  context,
}) => {
  let materials = 0;
  await page.route("**/api/materials", async (route) => {
    materials++;
    await route.continue();
  });
  await page.route("**/api/auth/guest", async (route) => {
    const response = await route.fetch();
    await context.clearCookies();
    await route.fulfill({
      response,
      headers: { "content-type": "application/json" },
    });
    await context.clearCookies();
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Paste notes" }).click();
  await page
    .getByLabel("Your learning notes")
    .fill(
      "Distance equals speed multiplied by time when the speed stays constant.",
    );
  await page.getByLabel("What would you like to focus on?").fill("Distance");
  await page.getByRole("button", { name: "Prepare my lesson" }).click();
  await expect(page.locator(".error-notice")).toContainText("Allow cookies");
  expect(materials).toBe(0);
  await page.goto(`/session/${randomUUID()}`);
  await expect(page.locator(".error-notice")).toContainText(
    "browser access expired or is unavailable",
  );
  await expect(
    page.getByRole("link", { name: "Start a new lesson" }),
  ).toBeVisible();
});

test("a new guest can prepare identical notes after the previous browser identity signs out", async ({
  page,
  context,
}) => {
  const materialIds: string[] = [];
  for (let i = 0; i < 2; i++) {
    await page.goto("/");
    await page.getByRole("button", { name: "Paste notes" }).click();
    await page
      .getByLabel("Your learning notes")
      .fill(
        "Distance equals speed multiplied by time when the speed remains constant.",
      );
    await page.getByLabel("What would you like to focus on?").fill("Distance");
    const response = page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/materials") && r.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Prepare my lesson" }).click();
    const result = await (await response).json();
    expect(result.id).toBeTruthy();
    materialIds.push(result.id);
    await expect(
      page.getByRole("heading", { name: "Does this look right?" }),
    ).toBeVisible();
    await context.request.post("/api/auth/logout", {
      data: {},
      headers: { Origin: "http://127.0.0.1:3000" },
    });
  }
  expect(materialIds[1]).not.toBe(materialIds[0]);
});
