import { test, expect } from "@playwright/test";
import { calculationSandbox } from "../../src/lib/sandbox";

test("CSP preserves hydration, inline styles, and the isolated calculator", async ({
  page,
}) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (/content security policy/i.test(message.text()))
      violations.push(message.text());
  });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: null } }),
  );
  await page.route("**/api/status", (route) =>
    route.fulfill({ json: { configured: true, missing: [] } }),
  );
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toContain(
    "object-src 'none'",
  );
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");

  const result = await page.evaluate((srcDoc) => {
    const marker = document.createElement("div");
    marker.style.width = "37px";
    document.body.append(marker);
    const width = getComputedStyle(marker).width;
    marker.remove();
    return new Promise<{ width: string; metrics: unknown }>(
      (resolve, reject) => {
        const frame = document.createElement("iframe");
        frame.sandbox.add("allow-scripts");
        const channel = crypto.randomUUID();
        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Sandbox calculation did not respond"));
        }, 10000);
        const cleanup = () => {
          clearTimeout(timer);
          window.removeEventListener("message", receive);
          frame.remove();
        };
        const receive = (event: MessageEvent) => {
          if (
            event.source !== frame.contentWindow ||
            event.data?.channel !== channel
          )
            return;
          cleanup();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve({ width, metrics: event.data.results[0].metrics });
        };
        window.addEventListener("message", receive);
        frame.onload = () =>
          frame.contentWindow!.postMessage(
            {
              type: "calculate",
              channel,
              requestId: "csp-test",
              code: "function calculate(inputs) { return { metrics: { doubled: inputs.amount * 2 } }; }",
              batch: [{ amount: 8 }],
            },
            "*",
          );
        frame.srcdoc = srcDoc;
        document.body.append(frame);
      },
    );
  }, calculationSandbox);
  expect(result).toEqual({ width: "37px", metrics: { doubled: 16 } });
  expect(violations).toEqual([]);
});
