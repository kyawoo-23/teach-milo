import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const unregister = vi.fn();
const getRegistration = vi.fn();
const reload = vi.fn();
let workers: {
  controller: object | null;
  getRegistration: typeof getRegistration;
};
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  unregister.mockResolvedValue(true);
  getRegistration.mockResolvedValue({ unregister });
  workers = {
    controller: { scriptURL: "http://localhost:3000/sw.js" },
    getRegistration,
  };
  vi.stubGlobal("navigator", { serviceWorker: workers });
  vi.stubGlobal("window", {
    location: { hostname: "localhost", href: "http://localhost:3000/", reload },
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("local authentication initialization", () => {
  it("unregisters a stale worker and reloads before reading a potentially cached session", async () => {
    const { prepareLocalAuth } = await import("@/lib/local-auth");
    expect(await prepareLocalAuth()).toBe(false);
    expect(getRegistration).toHaveBeenCalledWith("http://localhost:3000/");
    expect(unregister).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });
  it("shares cleanup across React effect teardown and setup", async () => {
    const { prepareLocalAuth } = await import("@/lib/local-auth");
    expect(await Promise.all([prepareLocalAuth(), prepareLocalAuth()])).toEqual(
      [false, false],
    );
    expect(unregister).toHaveBeenCalledOnce();
    expect(reload).toHaveBeenCalledOnce();
  });
  it("continues normally when no worker controls the page", async () => {
    workers.controller = null;
    getRegistration.mockResolvedValue(undefined);
    const { prepareLocalAuth } = await import("@/lib/local-auth");
    expect(await prepareLocalAuth()).toBe(true);
    expect(unregister).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });
  it("cleans a dormant registration without reloading an uncontrolled page", async () => {
    workers.controller = null;
    const { prepareLocalAuth } = await import("@/lib/local-auth");
    expect(await prepareLocalAuth()).toBe(true);
    expect(unregister).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled();
  });
  it.each(["production", "test"])(
    "leaves service workers alone in %s",
    async (environment) => {
      vi.stubEnv("NODE_ENV", environment);
      const { prepareLocalAuth } = await import("@/lib/local-auth");
      expect(await prepareLocalAuth()).toBe(true);
      expect(getRegistration).not.toHaveBeenCalled();
    },
  );
  it("leaves non-local origins alone", async () => {
    vi.stubGlobal("window", { location: { hostname: "teachback.example" } });
    const { prepareLocalAuth } = await import("@/lib/local-auth");
    expect(await prepareLocalAuth()).toBe(true);
    expect(getRegistration).not.toHaveBeenCalled();
  });
  it("falls back to the normal session lookup if service workers are unavailable or restricted", async () => {
    getRegistration.mockRejectedValue(new Error("Storage restricted"));
    const { prepareLocalAuth } = await import("@/lib/local-auth");
    expect(await prepareLocalAuth()).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });
});
