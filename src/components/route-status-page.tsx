import type { ReactNode } from "react";
import { NavHeader } from "./nav-header";

export function RouteStatusPage({
  icon,
  title,
  description,
  actions,
}: {
  icon?: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className="home-shell">
      <NavHeader />
      <main tabIndex={-1} id="main" className="route-status-page">
        <section
          className="route-status-card"
          aria-labelledby="route-status-title"
        >
          {icon ? (
            <div className="route-status-icon" aria-hidden="true">{icon}</div>
          ) : null}
          <h1 id="route-status-title">{title}</h1>
          <p>{description}</p>
          {actions ? <div className="route-status-actions">{actions}</div> : null}
        </section>
      </main>
    </div>
  );
}
