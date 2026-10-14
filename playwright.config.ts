import { defineConfig, devices } from "@playwright/test";
export default defineConfig({
  testDir: "tests/browser",
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "on",
    launchOptions: { slowMo: process.env.RECORD_WALKTHROUGH ? 150 : 0 },
  },
  projects: [
    {
      name: "desktop",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 1440, height: 1000 },
        video: { mode: "on", size: { width: 1440, height: 1000 } },
      },
    },
    {
      name: "mobile",
      use: { ...devices["iPhone 13"], defaultBrowserType: "chromium" },
    },
    ...(process.env.FORMULA_CROSS_BROWSER === "1"
      ? [
          {
            name: "formula-firefox",
            testMatch: "formulas.spec.ts",
            use: { ...devices["Desktop Firefox"] },
          },
          {
            name: "formula-webkit",
            testMatch: "formulas.spec.ts",
            use: { ...devices["Desktop Safari"] },
          },
        ]
      : []),
  ],
  webServer: {
    command: "pnpm dev",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: true,
    timeout: 120000,
  },
});
