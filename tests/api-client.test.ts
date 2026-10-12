import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { api as Api } from "@/lib/api-client";
let api: typeof Api;
const fetchMock = vi.fn<typeof fetch>();
beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
  ({ api } = await import("@/lib/api-client"));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
function deferred() {
  let resolve!: (value: Response) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<Response>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
it("shares simultaneous GETs without caching resolved authenticated data", async () => {
  const pending = deferred();
  fetchMock
    .mockReturnValueOnce(pending.promise)
    .mockResolvedValueOnce(Response.json({ version: 2 }));
  const first = api("/api/session"),
    second = api("/api/session");
  expect(fetchMock).toHaveBeenCalledTimes(1);
  pending.resolve(Response.json({ version: 1 }));
  expect(await Promise.all([first, second])).toEqual([
    { version: 1 },
    { version: 1 },
  ]);
  expect(await api("/api/session")).toEqual({ version: 2 });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(fetchMock.mock.calls[0][1]).toMatchObject({
    cache: "no-store",
    credentials: "same-origin",
  });
});
it("does not share reads across an authentication mutation", async () => {
  const old = deferred();
  fetchMock
    .mockReturnValueOnce(old.promise)
    .mockResolvedValueOnce(Response.json({ ok: true }))
    .mockResolvedValueOnce(Response.json({ user: null }));
  const previous = api("/api/auth/me");
  await api("/api/auth/logout", {});
  expect(await api("/api/auth/me")).toEqual({ user: null });
  expect(fetchMock).toHaveBeenCalledTimes(3);
  old.resolve(Response.json({ user: { id: "old-owner" } }));
  await previous;
});
it("allows one consumer to cancel while another finishes the shared request", async () => {
  const pending = deferred();
  fetchMock.mockReturnValue(pending.promise);
  const controller = new AbortController();
  const first = api("/api/session", undefined, "GET", {
      signal: controller.signal,
    }),
    second = api("/api/session");
  controller.abort();
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
  pending.resolve(Response.json({ ok: true }));
  expect(await second).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
it("aborts the network request when all consumers leave", async () => {
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener("abort", () =>
          reject(options!.signal!.reason),
        ),
      ),
  );
  const controller = new AbortController();
  const request = api("/api/session", undefined, "GET", {
    signal: controller.signal,
  });
  controller.abort();
  await expect(request).rejects.toMatchObject({ name: "AbortError" });
  await Promise.resolve();
  expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(true);
});
it("keeps one request across immediate effect teardown and setup", async () => {
  const pending = deferred();
  fetchMock.mockReturnValue(pending.promise);
  const old = new AbortController();
  const first = api("/api/auth/me", undefined, "GET", { signal: old.signal });
  old.abort();
  const second = api("/api/auth/me");
  await expect(first).rejects.toMatchObject({ name: "AbortError" });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1]!.signal!.aborted).toBe(false);
  pending.resolve(Response.json({ user: null }));
  await second;
});
it("never shares mutations and preserves upload headers", async () => {
  fetchMock.mockImplementation(async () => Response.json({ ok: true }));
  await Promise.all([
    api("/api/session/turns", { text: "one" }),
    api("/api/session/turns", { text: "one" }),
  ]);
  expect(fetchMock).toHaveBeenCalledTimes(2);
  const data = new FormData();
  data.append("text", "notes");
  await api("/api/materials", data);
  expect(fetchMock.mock.calls[2][1]).toMatchObject({
    method: "POST",
    body: data,
  });
  expect(fetchMock.mock.calls[2][1]!.headers).toBeUndefined();
});
it("allows retry after a failed shared read", async () => {
  fetchMock
    .mockRejectedValueOnce(new Error("Disconnected"))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  await expect(api("/api/session")).rejects.toThrow("Disconnected");
  expect(await api("/api/session")).toEqual({ ok: true });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
it("times out stalled reads without timing out long model mutations", async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) =>
        options!.signal!.addEventListener("abort", () =>
          reject(options!.signal!.reason),
        ),
      ),
  );
  const pending = expect(api("/api/session")).rejects.toMatchObject({
    code: "REQUEST_TIMEOUT",
  });
  await vi.advanceTimersByTimeAsync(30000);
  await pending;
});
