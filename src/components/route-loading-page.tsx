"use client";

import { Milo } from "./milo";
import { NavHeader } from "./nav-header";
import { Spinner } from "./ui";

export function RouteLoadingPage({ label = "Loading" }: { label?: string }) {
  return (
    <div className="home-shell">
      <NavHeader />
      <main tabIndex={-1} id="main" className="loading-page">
        <Milo size={96} thinking />
        <Spinner label={label} />
      </main>
    </div>
  );
}
