import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function policyFor(environment: "development" | "production") {
  vi.stubEnv("NODE_ENV", environment);
  vi.resetModules();
  const { default: config } = await import("../next.config");
  const rules = await config.headers!();
  const rule = rules.find((rule) => rule.source === "/:path*")!;
  const header = rule.headers.find(
    (header) => header.key === "Content-Security-Policy",
  )!;
  return new Map(
    header.value.split(";").map((directive) => {
      const [name, ...sources] = directive.trim().split(/\s+/);
      return [name, sources];
    }),
  );
}

describe("Starter CSP", () => {
  it("restricts production resources while preserving hydration and board workers", async () => {
    const policy = await policyFor("production");
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("style-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("font-src")).toEqual(["'self'"]);
    expect(policy.get("img-src")).toEqual([
      "'self'",
      "data:",
      "blob:",
      "https:",
    ]);
    expect(policy.get("frame-src")).toEqual(["'self'"]);
    expect(policy.get("worker-src")).toEqual(["'self'", "blob:"]);
    for (const directive of ["object-src", "base-uri", "frame-ancestors"])
      expect(policy.get(directive)).toEqual(["'none'"]);
    expect(policy.get("form-action")).toEqual(["'self'"]);
  });

  it("adds debugging eval and hot reload sockets only in development", async () => {
    const dev = await policyFor("development");
    const prod = await policyFor("production");
    expect(dev.get("script-src")).toEqual([
      ...prod.get("script-src")!,
      "'unsafe-eval'",
    ]);
    expect(dev.get("connect-src")).toEqual(["'self'", "ws:", "wss:"]);
    dev.delete("script-src");
    dev.delete("connect-src");
    prod.delete("script-src");
    prod.delete("connect-src");
    expect(dev).toEqual(prod);
  });
});
