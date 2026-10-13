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
    if (path === "/api/status")
      return route.fulfill({ json: { configured: true, missing: [] } });
    return route.fulfill({ json: {} });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Account settings" }).click();
  return sent;
}

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
  await dialog.getByRole("button", { name: "Show password" }).click();
  await expect(
    dialog.getByLabel("New password", { exact: true }),
  ).toHaveAttribute("type", "text");
  await dialog.getByRole("button", { name: "Update password" }).click();
  await expect(dialog.getByText("Password updated.")).toBeVisible();
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
  await expect(profileTab).toBeFocused();
  await expect(dialog.getByLabel("Display name")).toHaveValue("Grace draft");
  await page.keyboard.press("End");
  await expect(passwordTab).toBeFocused();
  await expect(dialog.getByLabel("New password", { exact: true })).toHaveValue(
    "draft-password",
  );
  await page.keyboard.press("Home");
  await expect(profileTab).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(passwordTab).toBeFocused();
});
