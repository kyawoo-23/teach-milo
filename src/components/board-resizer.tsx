"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "./locale-context";

const STORAGE_KEY = "teachback-board-width";
const MIN_BOARD = 280;
const MIN_CHAT = 420;
const KEY_STEP = 24;

// Sits between the conversation and the board in the classroom grid. It writes the
// board's track size straight onto the grid so dragging re-renders only this handle,
// not the whole session. The CSS clamp keeps the chat usable if the window shrinks.
export function BoardResizer() {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  // The learner's chosen width; null keeps the stylesheet's default.
  const [width, setWidth] = useState<number | null>(null);
  // The board's rendered width and the largest it may grow to, for keyboard and ARIA.
  const [current, setCurrent] = useState(MIN_BOARD);
  const [max, setMax] = useState(MIN_BOARD);

  useEffect(() => {
    try {
      const saved = Number(localStorage.getItem(STORAGE_KEY));
      if (saved >= MIN_BOARD) setWidth(saved);
    } catch {}
  }, []);

  useEffect(() => {
    const grid = ref.current?.parentElement;
    if (!grid) return;
    if (width === null) grid.style.removeProperty("--board-track");
    else
      grid.style.setProperty(
        "--board-track",
        `clamp(${MIN_BOARD}px, ${width}px, calc(100% - ${MIN_CHAT}px))`,
      );
    try {
      if (width === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, String(width));
    } catch {}
  }, [width]);

  useEffect(() => {
    const handle = ref.current;
    const grid = handle?.parentElement;
    const board = handle?.nextElementSibling;
    if (!handle || !grid || !board) return;
    const measure = () => {
      setCurrent(Math.round(board.getBoundingClientRect().width));
      setMax(
        Math.max(MIN_BOARD, grid.clientWidth - MIN_CHAT - handle.offsetWidth),
      );
    };
    const observer = new ResizeObserver(measure);
    observer.observe(grid);
    observer.observe(board);
    return () => observer.disconnect();
  }, []);

  const resize = (next: number) =>
    setWidth(Math.round(Math.min(max, Math.max(MIN_BOARD, next))));

  return (
    <div
      ref={ref}
      className="board-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={t("Resize teaching board")}
      aria-valuemin={MIN_BOARD}
      aria-valuemax={max}
      aria-valuenow={Math.min(current, max)}
      tabIndex={0}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
        const grid = e.currentTarget.parentElement!.getBoundingClientRect();
        resize(grid.right - e.clientX - e.currentTarget.offsetWidth / 2);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={() => setWidth(null)}
      onKeyDown={(e) => {
        // Step from the requested width; the measured one lags a frame behind.
        const from = Math.min(width ?? current, max);
        // The board is on the right, so moving the divider left widens it.
        const next = {
          ArrowLeft: from + KEY_STEP,
          ArrowRight: from - KEY_STEP,
          Home: MIN_BOARD,
          End: max,
        }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        resize(next);
      }}
    />
  );
}
