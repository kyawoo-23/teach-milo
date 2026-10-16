"use client";

import { useEffect, useRef, useState } from "react";

export function useClassroomFullscreen(enabled: boolean) {
  const [focused, setFocused] = useState(false);
  const ownsFullscreen = useRef(false);
  const pending = useRef(false);

  useEffect(() => {
    if (!enabled) {
      setFocused(false);
      return;
    }
    function onFullscreenChange() {
      if (ownsFullscreen.current && !document.fullscreenElement) {
        ownsFullscreen.current = false;
        setFocused(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        !document.fullscreenElement &&
        !document.querySelector("dialog[open]")
      )
        setFocused(false);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      document.removeEventListener("keydown", onKeyDown);
      if (ownsFullscreen.current) {
        ownsFullscreen.current = false;
        if (document.fullscreenElement === document.documentElement)
          void document.exitFullscreen().catch(() => {});
      }
    };
  }, [enabled]);

  async function toggle() {
    if (pending.current) return;
    pending.current = true;
    try {
      if (focused) {
        if (
          ownsFullscreen.current &&
          document.fullscreenElement === document.documentElement
        )
          await document.exitFullscreen();
        setFocused(false);
      } else {
        setFocused(true);
        if (document.fullscreenEnabled && !document.fullscreenElement) {
          // Fullscreen the document so portaled board dialogs remain visible.
          ownsFullscreen.current = true;
          await document.documentElement.requestFullscreen();
        }
      }
    } catch {
      // Embedded browsers can deny fullscreen; keep the in-page focus layout.
      if (!document.fullscreenElement) ownsFullscreen.current = false;
    } finally {
      pending.current = false;
    }
  }

  return { focused: enabled && focused, toggle };
}
