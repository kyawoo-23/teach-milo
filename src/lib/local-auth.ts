"use client";

let preparation: Promise<boolean> | undefined;

// TeachBack does not install a service worker. Other apps using the same local
// origin can leave one behind that caches /api/auth/me despite Cache-Control.
// Unregister only the worker for this page; keep cookies and stored data intact.
export function prepareLocalAuth(): Promise<boolean> {
  if (
    process.env.NODE_ENV !== "development" ||
    typeof window === "undefined" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname) ||
    !("serviceWorker" in navigator)
  )
    return Promise.resolve(true);

  return (preparation ??= (async () => {
    const workers = navigator.serviceWorker;
    const controlled = !!workers.controller;
    const registration = await workers.getRegistration(window.location.href);
    if (registration) await registration.unregister();
    if (controlled) {
      // Unregistering does not release the current page from the old worker.
      window.location.reload();
      return false;
    }
    return true;
  })().catch(() => true));
}
