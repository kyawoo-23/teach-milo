"use client";

export class ApiError extends Error {
  constructor(
    message: string,
    public code = "ERROR",
  ) {
    super(message);
  }
}

type Options = { signal?: AbortSignal; priority?: RequestPriority };
type Read = {
  promise: Promise<unknown>;
  controller: AbortController;
  subscribers: number;
  settled: boolean;
};
// Share only pending browser reads. Resolved responses and authenticated data
// never live in a global result cache; every mutation starts a new read epoch.
const reads = new Map<string, Read>();

async function request(
  url: string,
  body: unknown,
  method: string,
  options: Options,
) {
  const response = await fetch(url, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    signal: options.signal,
    priority: options.priority,
    headers:
      body === undefined || body instanceof FormData
        ? undefined
        : { "Content-Type": "application/json" },
    body:
      body instanceof FormData
        ? body
        : body === undefined
          ? undefined
          : JSON.stringify(body),
  });
  let result;
  try {
    result = await response.json();
  } catch {
    options.signal?.throwIfAborted();
    throw new ApiError("The connection was interrupted. Please retry.");
  }
  if (!response.ok)
    throw new ApiError(
      result.error?.message || "Something went wrong. Please retry.",
      result.error?.code,
    );
  return result;
}

function subscribe<T>(
  key: string,
  read: Read,
  signal?: AbortSignal,
): Promise<T> {
  read.subscribers++;
  return new Promise<T>((resolve, reject) => {
    let done = false;
    const cleanup = () => {
      done = true;
      signal?.removeEventListener("abort", abort);
      read.subscribers--;
      // Effect teardown/setup in React Strict Mode can resubscribe immediately.
      // Abort only when no consumer remains after that synchronous work.
      queueMicrotask(() => {
        if (!read.settled && read.subscribers === 0) {
          if (reads.get(key) === read) reads.delete(key);
          read.controller.abort();
        }
      });
    };
    const abort = () => {
      if (done) return;
      cleanup();
      reject(
        signal?.reason ?? new DOMException("Request aborted", "AbortError"),
      );
    };
    signal?.addEventListener("abort", abort, { once: true });
    read.promise.then(
      (value) => {
        if (done) return;
        cleanup();
        resolve(value as T);
      },
      (error) => {
        if (done) return;
        cleanup();
        reject(error);
      },
    );
  });
}

export function api<T>(
  url: string,
  body?: unknown,
  method = "POST",
  options: Options = {},
): Promise<T> {
  if (options.signal?.aborted) return Promise.reject(options.signal.reason);
  const effectiveMethod =
    body === undefined && method === "POST" ? "GET" : method;
  if (effectiveMethod !== "GET") {
    reads.clear();
    return request(url, body, effectiveMethod, options).finally(() =>
      reads.clear(),
    );
  }
  const key = JSON.stringify([url, options.priority ?? "auto"]);
  let read = reads.get(key);
  if (!read) {
    const controller = new AbortController();
    const timer = setTimeout(
      () =>
        controller.abort(
          new ApiError(
            "This request timed out. Please retry.",
            "REQUEST_TIMEOUT",
          ),
        ),
      30_000,
    );
    const entry: Read = {
      controller,
      subscribers: 0,
      settled: false,
      promise: Promise.resolve(),
    };
    entry.promise = request(url, undefined, "GET", {
      ...options,
      signal: controller.signal,
    }).finally(() => {
      clearTimeout(timer);
      entry.settled = true;
      if (reads.get(key) === entry) reads.delete(key);
    });
    read = entry;
    reads.set(key, entry);
  }
  return subscribe<T>(key, read, options.signal);
}
