"use client";

import { useRef, useState } from "react";
import { ArrowDown, ArrowUp, GripVertical } from "lucide-react";
import { useI18n } from "./locale-context";

// Only the handle captures gestures; the rest of each row remains scrollable.
export function BoardReorderControls({
  itemId,
  label,
  index,
  count,
  disabled,
  onMove,
}: {
  itemId: string;
  label: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (index: number) => void;
}) {
  const { t } = useI18n();
  const [announcement, setAnnouncement] = useState("");
  const drag = useRef<{
    pointer: number;
    x: number;
    y: number;
    target: number;
    list: HTMLElement;
    row: HTMLElement;
    over?: HTMLElement;
  } | null>(null);
  const move = (next: number) => {
    if (disabled || next === index || next < 0 || next >= count) return;
    onMove(next);
    setAnnouncement(
      t("{item} moved to position {position} of {total}.", {
        item: label,
        position: next + 1,
        total: count,
      }),
    );
  };
  const clear = () => {
    const current = drag.current;
    if (!current) return;
    delete current.row.dataset.dragging;
    if (current.over) delete current.over.dataset.dropTarget;
    drag.current = null;
  };
  return (
    <div className="sketch-toolbar board-reorder-controls">
      <div className="sketch-tool-group">
        <button
        type="button"
        className="board-drag-handle"
        aria-label={t("Drag {item} to reorder, or use arrow keys", {
          item: label,
        })}
        disabled={disabled || count < 2}
        onKeyDown={(event) => {
          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
            event.preventDefault();
            move(index + (event.key === "ArrowUp" ? -1 : 1));
          }
        }}
        onPointerDown={(event) => {
          if (
            disabled ||
            event.button !== 0 ||
            !event.isPrimary ||
            drag.current
          )
            return;
          const row = event.currentTarget.closest<HTMLElement>(
            "[data-reorder-item]",
          );
          const list = row?.closest<HTMLElement>("[data-reorder-list]");
          if (!row || !list || row.dataset.reorderItem !== itemId) return;
          drag.current = {
            pointer: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            target: index,
            list,
            row,
          };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          if (
            Math.hypot(event.clientX - current.x, event.clientY - current.y) < 5
          )
            return;
          current.row.dataset.dragging = "true";
          const over = document
            .elementsFromPoint(event.clientX, event.clientY)
            .map((element) =>
              element.closest<HTMLElement>("[data-reorder-item]"),
            )
            .find(
              (element) =>
                element?.closest("[data-reorder-list]") === current.list,
            );
          if (current.over) delete current.over.dataset.dropTarget;
          current.over = over ?? undefined;
          current.target = over ? Number(over.dataset.reorderIndex) : index;
          if (over) over.dataset.dropTarget = "true";
          // Keep long lists reachable in both the sidebar and expanded dialog.
          let scroll: HTMLElement | null = current.list;
          while (
            scroll &&
            !(
              scroll.scrollHeight > scroll.clientHeight &&
              /auto|scroll/.test(getComputedStyle(scroll).overflowY)
            )
          ) {
            scroll = scroll.parentElement;
          }
          if (scroll) {
            const bounds = scroll.getBoundingClientRect();
            if (event.clientY < bounds.top + 40) scroll.scrollBy(0, -12);
            else if (event.clientY > bounds.bottom - 40) scroll.scrollBy(0, 12);
          }
        }}
        onPointerUp={(event) => {
          const current = drag.current;
          if (!current || current.pointer !== event.pointerId) return;
          const target = current.target;
          clear();
          if (event.currentTarget.hasPointerCapture(event.pointerId))
            event.currentTarget.releasePointerCapture(event.pointerId);
          move(target);
        }}
        onPointerCancel={clear}
        onLostPointerCapture={clear}
      >
        <GripVertical size={18} aria-hidden="true" />
      </button>
      <button
        type="button"
        title={t("Move {item} up", { item: label })}
        aria-label={t("Move {item} up", { item: label })}
        disabled={disabled || index === 0}
        onClick={() => move(index - 1)}
      >
        <ArrowUp size={16} aria-hidden="true" />
      </button>
      <button
        type="button"
        title={t("Move {item} down", { item: label })}
        aria-label={t("Move {item} down", { item: label })}
        disabled={disabled || index === count - 1}
        onClick={() => move(index + 1)}
      >
        <ArrowDown size={16} aria-hidden="true" />
      </button>
      </div>
      <span className="visually-hidden" role="status">
        {announcement}
      </span>
    </div>
  );
}
