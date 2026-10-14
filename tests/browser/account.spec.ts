import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

async function setup(page: Page, hasPassword = true) {
  let user = {
    id: "account-learner",
    name: "Ada",
    email: "ada@example.test",
    hasPassword,
  };
  const sent: { path: string; data: Record<string, string> }[] = [];
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== "GET") {
      const data = route.request().postDataJSON();
      sent.push({ path, data });
      if (path === "/api/auth/profile") {
        user = { ...user, name: data.name };
        return route.fulfill({ json: { user } });
      }
      if (path === "/api/auth/password") {
        if (data.currentPassword !== "old-password")
          return route.fulfill({
            status: 400,
            json: {
              error: {
                code: "INVALID_PASSWORD",
                message: "Your current password is incorrect.",
              },
            },
          });
        return route.fulfill({ json: { ok: true } });
      }
    }
    if (path === "/api/auth/me") return route.fulfill({ json: { user } });
    if (path === "/api/auth/passkeys")
      return route.fulfill({
        json: {
          passkeys: [],
          rpId: "localhost",
          userId: "YWRh",
          name: user.email,
          displayName: user.name,
        },
      });
    if (path === "/api/status")
      return route.fulfill({ json: { configured: true, missing: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Account settings" }).click();
  return sent;
}

test("password sign-in shows a toast only after success", async ({ page }) => {
  let fail = true;
  await page.route("**/api/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === "/api/auth/me") return route.fulfill({ json: { user: null } });
    if (path === "/api/status")
      return route.fulfill({ json: { configured: true, missing: [] } });
    if (path === "/api/auth/login")
      return route.fulfill(
        fail
          ? {
              status: 401,
              json: {
                error: { message: "Something went wrong. Please retry." },
              },
            }
          : {
              json: {
                user: {
                  id: "account-learner",
                  name: "Ada",
                  email: "ada@example.test",
                  hasPassword: true,
                },
              },
            },
      );
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Sign In to TeachBack" });
  await dialog.getByLabel("Email Address").fill("ada@example.test");
  await dialog.getByLabel("Password", { exact: true }).fill("valid-password");
  await dialog
    .locator("form")
    .getByRole("button", { name: "Sign In", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(page.locator(".notification-toast")).toHaveCount(0);
  fail = false;
  await dialog
    .locator("form")
    .getByRole("button", { name: "Sign In", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".notification-toast").getByRole("status"),
  ).toHaveText("You’re signed in.");
  await page.getByRole("button", { name: "Close notification" }).click();
  await expect(page.locator(".notification-toast")).toHaveCount(0);
});

test("Google sign-in return shows one toast after confirming the user", async ({
  page,
}) => {
  await setup(page);
  await expect(page.locator(".notification-toast")).toHaveCount(0);
  await page.goto("/?signed-in=1&source=google");
  await expect(
    page.locator(".notification-toast").getByRole("status"),
  ).toHaveText("You’re signed in.");
  await expect(page).toHaveURL("/?source=google");
  await page.reload();
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toBeVisible();
  await expect(page.locator(".notification-toast")).toHaveCount(0);
});

test("logout returns to home with a toast and preserves sign-in on failure", async ({
  page,
}) => {
  await setup(page);
  await page.getByRole("button", { name: "Close dialog" }).click();
  const sessionId = "11111111-1111-4111-8111-111111111111";
  await page.route(`**/api/sessions/${sessionId}`, (route) =>
    route.fulfill({
      status: 404,
      json: { error: { code: "NOT_FOUND", message: "Session not found." } },
    }),
  );
  await page.goto(`/session/${sessionId}`);
  let failLogout = true;
  await page.route("**/api/auth/logout", (route) =>
    route.fulfill(
      failLogout
        ? {
            status: 500,
            json: { error: { message: "Something went wrong. Please retry." } },
          }
        : { json: { ok: true } },
    ),
  );
  const signOut = async () => {
    await page.getByRole("button", { name: "Open account menu" }).click();
    await page.getByRole("menuitem", { name: "Log out" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
  };
  await signOut();
  await expect(
    page.locator(".notification-toast").getByRole("alert"),
  ).toHaveText("Something went wrong. Please retry.");
  await expect(page).toHaveURL(new RegExp(`/session/${sessionId}$`));
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close notification" }).click();
  await expect(page.locator(".notification-toast")).toHaveCount(0);
  failLogout = false;
  await signOut();
  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("dialog", { name: "Sign In to TeachBack" }),
  ).toHaveCount(0);
  await expect(
    page.locator(".notification-toast").getByRole("status"),
  ).toHaveText("You’re signed out.");
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Sign In", exact: true }).first(),
  ).toBeVisible();
  expect(
    (await new AxeBuilder({ page }).include(".notification-toast").analyze())
      .violations,
  ).toEqual([]);
  await page.screenshot({
    path: `/tmp/teachback-logout-${test.info().project.name}.png`,
  });
  await expect(page.locator(".notification-toast")).toHaveCount(0, {
    timeout: 8000,
  });
});

test("account settings save a name, lock email, validate and update password", async ({
  page,
}) => {
  const sent = await setup(page);
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(
    dialog.getByRole("tab", { name: "Profile", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(
    dialog.getByLabel("Current password", { exact: true }),
  ).toBeHidden();
  expect(
    (
      await new AxeBuilder({ page })
        .include(".account-settings-modal")
        .analyze()
    ).violations,
  ).toEqual([]);
  await expect(dialog.getByLabel("Email Address")).toHaveAttribute(
    "readonly",
    "",
  );
  await expect(dialog.getByLabel("Email Address")).toHaveValue(
    "ada@example.test",
  );
  await dialog.getByLabel("Display name").fill("Grace");
  await dialog.getByRole("button", { name: "Save profile" }).click();
  await expect(
    dialog.getByRole("status").filter({ hasText: "Profile updated." }),
  ).toBeVisible();
  expect(sent[0]).toEqual({
    path: "/api/auth/profile",
    data: { name: "Grace" },
  });
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toContainText("Grace");
  await dialog
    .getByRole("tab", { name: "Change password", exact: true })
    .click();
  await expect(dialog.getByLabel("Display name")).toBeHidden();
  await dialog
    .getByLabel("Current password", { exact: true })
    .fill("wrong-password");
  await dialog.getByLabel("New password", { exact: true }).fill("new-password");
  await dialog.getByLabel("Confirm Password", { exact: true }).fill("mismatch");
  await dialog.getByRole("button", { name: "Update password" }).click();
  await expect(dialog.getByText("Passwords do not match.")).toBeVisible();
  expect(sent).toHaveLength(1);
  await dialog
    .getByLabel("Confirm Password", { exact: true })
    .fill("new-password");
  await dialog.getByRole("button", { name: "Update password" }).click();
  await expect(
    dialog.getByText("Your current password is incorrect."),
  ).toBeVisible();
  await dialog
    .getByLabel("Current password", { exact: true })
    .fill("old-password");
  await expect(
    dialog.getByRole("button", { name: /^Show password:/ }),
  ).toHaveCount(3);
  await dialog
    .getByRole("button", { name: "Show password: New password", exact: true })
    .click();
  await expect(
    dialog.getByLabel("New password", { exact: true }),
  ).toHaveAttribute("type", "text");
  await expect(
    dialog.getByLabel("Current password", { exact: true }),
  ).toHaveAttribute("type", "password");
  await expect(
    dialog.getByLabel("Confirm Password", { exact: true }),
  ).toHaveAttribute("type", "password");
  await dialog
    .getByRole("button", { name: "Hide password: New password", exact: true })
    .click();
  await expect(
    dialog.getByLabel("New password", { exact: true }),
  ).toHaveAttribute("type", "password");
  await dialog
    .getByRole("button", {
      name: "Show password: Current password",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByLabel("Current password", { exact: true }),
  ).toHaveAttribute("type", "text");
  await dialog
    .getByRole("button", {
      name: "Show password: Confirm Password",
      exact: true,
    })
    .click();
  await expect(
    dialog.getByLabel("Confirm Password", { exact: true }),
  ).toHaveAttribute("type", "text");
  await dialog.screenshot({
    path: `/tmp/teachback-inline-password-${test.info().project.name}.png`,
  });
  await dialog.getByRole("button", { name: "Update password" }).click();
  await expect(dialog.getByText("Password updated.")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /^Show password:/ }),
  ).toHaveCount(3);
  await expect(
    dialog.getByLabel("Current password", { exact: true }),
  ).toHaveValue("");
  await expect(dialog.getByLabel("New password", { exact: true })).toHaveValue(
    "",
  );
  expect(sent.at(-1)).toEqual({
    path: "/api/auth/password",
    data: { currentPassword: "old-password", newPassword: "new-password" },
  });
  expect(
    (
      await new AxeBuilder({ page })
        .include(".account-settings-modal")
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(
    page.getByRole("menuitem", { name: "Account settings" }),
  ).toBeFocused();
  await page.getByRole("menuitem", { name: "Account settings" }).click();
  await expect(page.getByLabel("Display name")).toHaveValue("Grace");
});

test("Google-only accounts can edit their name and see password guidance", async ({
  page,
}) => {
  await setup(page, false);
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  await expect(dialog.getByLabel("Display name")).toBeEditable();
  await dialog
    .getByRole("tab", { name: "Change password", exact: true })
    .click();
  await expect(
    dialog.getByText(
      "Your password is managed by Google. Change it in your Google account.",
    ),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Update password" }),
  ).toHaveCount(0);
  await dialog.getByRole("tab", { name: "Profile", exact: true }).click();
  await expect(dialog.getByLabel("Display name")).toBeEditable();
});

test("settings tabs support keyboard navigation and preserve form drafts", async ({
  page,
}) => {
  await setup(page);
  const dialog = page.getByRole("dialog", { name: "Account settings" });
  const profileTab = dialog.getByRole("tab", { name: "Profile", exact: true });
  const passwordTab = dialog.getByRole("tab", {
    name: "Change password",
    exact: true,
  });
  const passkeysTab = dialog.getByRole("tab", {
    name: "Passkeys",
    exact: true,
  });
  await dialog.getByLabel("Display name").fill("Grace draft");
  await profileTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(passwordTab).toBeFocused();
  await expect(passwordTab).toHaveAttribute("aria-selected", "true");
  await dialog
    .getByLabel("New password", { exact: true })
    .fill("draft-password");
  await passwordTab.focus();
  await page.keyboard.press("ArrowRight");
  await expect(passkeysTab).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(profileTab).toBeFocused();
  await expect(dialog.getByLabel("Display name")).toHaveValue("Grace draft");
  await page.keyboard.press("End");
  await expect(passkeysTab).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(passwordTab).toBeFocused();
  await expect(dialog.getByLabel("New password", { exact: true })).toHaveValue(
    "draft-password",
  );
  await page.keyboard.press("Home");
  await expect(profileTab).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(passkeysTab).toBeFocused();
});
