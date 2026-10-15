"use client";

import { useLayoutEffect, useRef, type ComponentProps } from "react";

/** Keeps one sliding highlight behind the selected button, including unequal tabs. */
export function AnimatedTabs({
  activeKey,
  className,
  children,
  ...props
}: ComponentProps<"div"> & { activeKey: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const container = ref.current;
    if (!container) return;

    const measure = () => {
      const active = container.querySelector<HTMLButtonElement>(
        ':scope > button[aria-selected="true"], :scope > button[aria-pressed="true"]',
      );
      if (!active || !active.offsetWidth) return;
      container.style.setProperty("--tab-x", `${active.offsetLeft}px`);
      container.style.setProperty("--tab-y", `${active.offsetTop}px`);
      container.style.setProperty("--tab-width", `${active.offsetWidth}px`);
      container.style.setProperty("--tab-height", `${active.offsetHeight}px`);
      container.dataset.indicatorReady = "true";
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    for (const button of container.querySelectorAll(":scope > button")) {
      observer.observe(button);
    }
    return () => observer.disconnect();
  }, [activeKey]);

  return (
    <div {...props} ref={ref} className={`animated-tabs ${className ?? ""}`}>
      {children}
    </div>
  );
}
