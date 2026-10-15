import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from "@simplewebauthn/server";

const origin = "http://localhost:3000";
const user = {
  id: "passkey-learner",
  name: "Ada",
  email: "ada@example.test",
  hasPassword: true,
};

async function setup(page: Page, signedIn = true) {
  let authenticated = signedIn;
  let registrationChallenge = "";
  let authenticationChallenge = "";
  let stored: WebAuthnCredential | undefined;
  let keyName = "Personal laptop";
  const calls: string[] = [];
  const list = () => ({
    rpId: "localhost",
    userId: Buffer.from(user.id).toString("base64url"),
    name: user.email,
    displayName: user.name,
    passkeys: stored
      ? [{ id: stored.id, name: keyName, createdAt: new Date().toISOString() }]
      : [],
  });
  // Keep explicit-button tests deterministic; conditional support is covered separately.
  await page.addInitScript(() => {
    Object.defineProperty(PublicKeyCredential, "getClientCapabilities", {
      configurable: true,
      value: async () => ({ conditionalGet: false }),
    });
  });
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    calls.push(path);
    if (path === "/api/auth/me")
      return route.fulfill({ json: { user: authenticated ? user : null } });
    if (path === "/api/status")
      return route.fulfill({ json: { configured: true, missing: [] } });
    if (path === "/api/auth/logout") {
      authenticated = false;
      return route.fulfill({ json: { ok: true } });
    }
    if (path === "/api/auth/passkeys") return route.fulfill({ json: list() });
    if (path === "/api/auth/passkeys/registration/options") {
      const options = await generateRegistrationOptions({
        rpName: "Teach Milo",
        rpID: "localhost",
        userName: user.email,
        userID: new TextEncoder().encode(user.id),
        supportedAlgorithmIDs: [-7],
        attestationType: "none",
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
      });
      registrationChallenge = options.challenge;
      return route.fulfill({
        json: { options, ceremonyId: "11111111-1111-4111-8111-111111111111" },
      });
    }
    if (path === "/api/auth/passkeys/registration/verify") {
      const body = route.request().postDataJSON();
      const result = await verifyRegistrationResponse({
        response: body.credential,
        expectedChallenge: registrationChallenge,
        expectedOrigin: origin,
        expectedRPID: "localhost",
        requireUserVerification: true,
      });
      expect(result.verified).toBe(true);
      if (result.verified) stored = result.registrationInfo.credential;
      keyName = body.name;
      return route.fulfill({ json: list() });
    }
    if (path === "/api/auth/passkeys/authentication/options") {
      const options = await generateAuthenticationOptions({
        rpID: "localhost",
        allowCredentials: [],
        userVerification: "required",
      });
      authenticationChallenge = options.challenge;
      return route.fulfill({
        json: { options, ceremonyId: "22222222-2222-4222-8222-222222222222" },
      });
    }
    if (path === "/api/auth/passkeys/authentication/verify") {
      const body = route.request().postDataJSON();
      expect(body.credential.response.userHandle).toBe(
        Buffer.from(user.id).toString("base64url"),
      );
      const result = await verifyAuthenticationResponse({
        response: body.credential,
        expectedChallenge: authenticationChallenge,
        expectedOrigin: origin,
        expectedRPID: "localhost",
        requireUserVerification: true,
        credential: stored!,
      });
      expect(result.verified).toBe(true);
      stored!.counter = result.authenticationInfo.newCounter;
      authenticated = true;
      return route.fulfill({ json: { user } });
    }
    if (path.startsWith("/api/auth/passkeys/")) {
      if (route.request().method() === "DELETE") stored = undefined;
      else keyName = route.request().postDataJSON().name;
      return route.fulfill({ json: list() });
    }
    return route.fulfill({ json: {} });
  });
  await page.goto(origin);
  return calls;
}

async function openSettings(page: Page) {
  await page.getByRole("button", { name: "Open account menu" }).click();
  await page.getByRole("menuitem", { name: "Account settings" }).click();
  await page.getByRole("tab", { name: "Passkeys", exact: true }).click();
}

test("native WebAuthn enrollment, rename, email-free login and removal with a virtual authenticator", async ({
  page,
  context,
}) => {
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
  const calls = await setup(page);
  await openSettings(page);
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
  await page
    .getByLabel("Passkey name", { exact: true })
    .fill("Personal laptop");
  await page.getByRole("button", { name: "Add passkey", exact: true }).click();
  await expect(page.getByText("Passkey added.", { exact: true })).toBeVisible();
  const edit = page.getByRole("button", {
    name: "Rename passkey Personal laptop",
  });
  const rename = page.getByRole("textbox", {
    name: "Rename passkey Personal laptop",
  });
  await expect(rename).toHaveCount(0);
  await edit.click();
  await expect(rename).toBeFocused();
  await rename.fill("Discard this draft");
  await rename.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Account settings" }),
  ).toBeVisible();
  await expect(edit).toBeFocused();
  await edit.click();
  await expect(rename).toHaveValue("Personal laptop");
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(edit).toBeFocused();
  await edit.click();
  await rename.fill("Travel laptop");
  await page.getByRole("dialog", { name: "Account settings" }).screenshot({
    path: `/tmp/teachback-passkey-edit-${test.info().project.name}.png`,
  });
  // A failed rename must preserve the draft and leave the editor available.
  await page.route("**/api/auth/passkeys/*", async (route) => {
    if (route.request().method() !== "PATCH") return route.fallback();
    await page.unroute("**/api/auth/passkeys/*");
    return route.fulfill({
      status: 500,
      json: { error: { message: "Please retry." } },
    });
  });
  await page.getByRole("button", { name: "Save passkey name" }).click();
  await expect(
    page.getByRole("dialog", { name: "Account settings" }).getByRole("alert"),
  ).toContainText("Please retry.");
  await expect(rename).toHaveValue("Travel laptop");
  await page.getByRole("button", { name: "Save passkey name" }).click();
  await expect(page.getByText("Passkey renamed.")).toBeVisible();
  await expect(rename).toHaveCount(0);
  await expect(page.getByText("Travel laptop", { exact: true })).toBeVisible();
  await page
    .getByRole("dialog", { name: "Account settings" })
    .screenshot({ path: "/tmp/teachback-passkey-settings.png" });
  expect(
    (
      await new AxeBuilder({ page })
        .include(".account-settings-modal")
        .analyze()
    ).violations,
  ).toEqual([]);
  await page.keyboard.press("Escape");
  await page.getByRole("menuitem", { name: "Log out" }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page
    .getByRole("button", { name: "Sign In", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Sign In to Teach Milo" });
  await expect(dialog.getByLabel("Email Address")).toHaveAttribute(
    "autocomplete",
    "username webauthn",
  );
  await dialog.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(dialog).toHaveCount(0);
  await expect(
    page.locator(".notification-toast").getByRole("status"),
  ).toHaveText("You’re signed in.");
  await expect(
    page.getByRole("button", { name: "Open account menu" }),
  ).toContainText("Ada");
  expect(calls).toContain("/api/auth/passkeys/authentication/verify");
  await openSettings(page);
  await page
    .getByRole("button", { name: "Remove passkey Travel laptop" })
    .click();
  await page
    .getByRole("button", { name: "Remove passkey", exact: true })
    .click();
  await expect(page.getByText("No passkeys yet.")).toBeVisible();
  await expect(page.getByText("Passkey removed.")).toBeVisible();
});

test("cancelling a passkey prompt leaves password login available", async ({
  page,
}) => {
  await setup(page, false);
  await page.evaluate(() => {
    navigator.credentials.get = async () => {
      throw new DOMException("Cancelled", "NotAllowedError");
    };
  });
  await page
    .getByRole("button", { name: "Sign In", exact: true })
    .first()
    .click();
  const dialog = page.getByRole("dialog", { name: "Sign In to Teach Milo" });
  await dialog.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect(dialog.getByRole("alert")).toContainText(
    "Passkey sign-in was cancelled.",
  );
  await expect(dialog.getByLabel("Email Address")).toBeEditable();
  await expect(dialog.getByLabel("Password", { exact: true })).toBeEditable();
});

test("conditional autofill is aborted before an explicit prompt and when the modal closes", async ({
  page,
}) => {
  await setup(page, false);
  await page.evaluate(() => {
    Object.defineProperty(PublicKeyCredential, "getClientCapabilities", {
      configurable: true,
      value: async () => ({ conditionalGet: true }),
    });
    const events: string[] = [];
    Object.assign(window, { passkeyEvents: events });
    navigator.credentials.get = async (options) => {
      if (options?.mediation === "conditional") {
        events.push("conditional");
        return new Promise((_resolve, reject) =>
          options.signal?.addEventListener(
            "abort",
            () => {
              events.push("aborted");
              reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
          ),
        );
      }
      events.push("explicit");
      throw new DOMException("Cancelled", "NotAllowedError");
    };
  });
  await page
    .getByRole("button", { name: "Sign In", exact: true })
    .first()
    .click();
  const events = () =>
    page.evaluate(
      () => (window as unknown as { passkeyEvents: string[] }).passkeyEvents,
    );
  await expect.poll(events).toEqual(["conditional"]);
  await page.getByRole("button", { name: "Sign in with a passkey" }).click();
  await expect
    .poll(events)
    .toEqual(["conditional", "aborted", "explicit", "conditional"]);
  await page.keyboard.press("Escape");
  await expect
    .poll(events)
    .toEqual(["conditional", "aborted", "explicit", "conditional", "aborted"]);
});
