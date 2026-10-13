"use client";
import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { Controller } from "react-hook-form";
import { CustomSelect } from "./custom-select";
import { z } from "zod";
import { BoardTextField, useSchemaForm } from "./schema-form";
import { SketchObjectSchema } from "@/lib/board-tools";
import { useI18n } from "./locale-context";
import { useConfirmation } from "./confirmation";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type SketchState,
  type SketchObject,
} from "@/lib/board-tools";
import { drawSketch } from "@/lib/sketch";
import type { TranslationKey } from "@/lib/i18n/messages";
export type SketchHistory = { past: SketchState[]; future: SketchState[] };
const modes: {
  value: SketchObject["type"] | "select";
  label: TranslationKey;
}[] = [
  { value: "pen", label: "Pen" },
  { value: "eraser", label: "Eraser" },
  { value: "select", label: "Select and move" },
  { value: "text", label: "Text label" },
  { value: "arrow", label: "Arrow" },
  { value: "rectangle", label: "Rectangle" },
  { value: "circle", label: "Circle" },
];
const colors: { value: SketchObject["color"]; label: TranslationKey }[] = [
  { value: "#24283f", label: "Ink" },
  { value: "#655dcc", label: "Purple" },
  { value: "#426da9", label: "Blue" },
  { value: "#b43b48", label: "Red" },
  { value: "#287b62", label: "Green" },
];
export function SketchBoard({
  state,
  history,
  onChange,
  disabled,
}: {
  state: SketchState;
  history: SketchHistory;
  onChange: (s: SketchState, h: SketchHistory) => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  const confirm = useConfirmation();
  const helpId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<SketchObject["type"] | "select">("pen");
  const settings = useSchemaForm(
    z.object({
      color: SketchObjectSchema.shape.color,
      width: SketchObjectSchema.shape.width,
      label: SketchObjectSchema.shape.text,
    }),
    { color: "#655dcc", width: 4, label: "" },
  );
  const [color] = settings.state("color");
  const [width] = settings.state("width");
  const [label, setLabel] = settings.state("label");
  const [selected, setSelected] = useState<string>();
  const gesture = useRef<{
    object: SketchObject;
    start: { x: number; y: number };
    original?: SketchObject;
    pointerId: number;
  } | null>(null);
  const commit = (next: SketchState) =>
    onChange(next, {
      past: [...history.past.slice(-19), structuredClone(state)],
      future: [],
    });
  useEffect(() => {
    if (canvas.current) drawSketch(canvas.current, state);
  }, [state]);
  const position = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.round(
        Math.max(
          0,
          Math.min(
            CANVAS_WIDTH,
            ((e.clientX - r.left) / r.width) * CANVAS_WIDTH,
          ),
        ),
      ),
      y: Math.round(
        Math.max(
          0,
          Math.min(
            CANVAS_HEIGHT,
            ((e.clientY - r.top) / r.height) * CANVAS_HEIGHT,
          ),
        ),
      ),
    };
  };
  const renderGesture = () => {
    const g = gesture.current;
    if (!canvas.current || !g) return;
    drawSketch(canvas.current, {
      kind: "sketch",
      objects: g.original
        ? state.objects.map((o) => (o.id === g.object.id ? g.object : o))
        : [...state.objects, g.object],
    });
  };
  const finish = (e: PointerEvent<HTMLCanvasElement>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    commit({
      kind: "sketch",
      objects: g.original
        ? state.objects.map((o) => (o.id === g.object.id ? g.object : o))
        : [...state.objects, g.object],
    });
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const moveSelected = (dx: number, dy: number) => {
    const object = state.objects.find((o) => o.id === selected);
    if (!object) return;
    const shifted = shift(object, dx, dy);
    commit({
      ...state,
      objects: state.objects.map((o) => (o.id === selected ? shifted : o)),
    });
  };
  return (
    <div className="sketch-board">
      <p className="tool-hint">
        {t("Draw a diagram, add labels, then explain it to Milo.")}
      </p>
      <div
        className="sketch-toolbar"
        role="group"
        aria-label={t("Drawing tools")}
      >
        {modes.map((m) => (
          <button
            key={m.value}
            type="button"
            aria-pressed={mode === m.value}
            disabled={disabled}
            onClick={() => setMode(m.value)}
          >
            {t(m.label)}
          </button>
        ))}
      </div>
      <div className="sketch-settings">
        <div className="tool-field">
          <label htmlFor={`${helpId}-color`}>{t("Color")}</label>
          <Controller
            control={settings.control}
            name="color"
            render={({ field }) => (
              <CustomSelect
                id={`${helpId}-color`}
                label={t("Color")}
                name={field.name}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                inputRef={field.ref}
                disabled={disabled}
                options={colors.map((color) => ({
                  value: color.value,
                  label: t(color.label),
                  icon: (
                    <span
                      aria-hidden="true"
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: "50%",
                        background: color.value,
                      }}
                    />
                  ),
                }))}
              />
            )}
          />
        </div>
        <label>
          {t("Line width")}
          <input
            type="range"
            min={1}
            max={24}
            {...settings.register("width", { valueAsNumber: true })}
            disabled={disabled}
          />
        </label>
      </div>
      {mode === "text" && (
        <>
          <label className="tool-field">
            {t("Text label")}
            <BoardTextField
              value={label}
              maxLength={200}
              onChange={setLabel}
              placeholder={t("Type a label, then tap the canvas")}
              disabled={disabled}
            />
          </label>
          <button
            type="button"
            disabled={disabled || !label.trim() || state.objects.length >= 150}
            onClick={() =>
              commit({
                ...state,
                objects: [
                  ...state.objects,
                  {
                    id: crypto.randomUUID(),
                    type: "text",
                    color,
                    width,
                    points: [{ x: 80, y: 80 }],
                    text: label.trim(),
                  },
                ],
              })
            }
          >
            {t("Add label")}
          </button>
        </>
      )}
      <canvas
        ref={canvas}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        tabIndex={disabled ? -1 : 0}
        role="img"
        aria-label={t("Sketch canvas")}
        aria-describedby={helpId}
        onKeyDown={(e) => {
          if (disabled) return;
          const d: Record<string, [number, number]> = {
            ArrowLeft: [-10, 0],
            ArrowRight: [10, 0],
            ArrowUp: [0, -10],
            ArrowDown: [0, 10],
          };
          if (d[e.key] && selected) {
            e.preventDefault();
            moveSelected(...d[e.key]);
          }
        }}
        onPointerDown={(e) => {
          if (disabled || e.button !== 0 || gesture.current) return;
          const p = position(e);
          if (mode === "select") {
            const object = [...state.objects]
              .reverse()
              .find((o) => o.type !== "eraser" && hit(o, p));
            setSelected(object?.id);
            if (!object) return;
            gesture.current = {
              object: structuredClone(object),
              original: object,
              start: p,
              pointerId: e.pointerId,
            };
          } else {
            if (
              state.objects.length >= 150 ||
              (mode === "text" && !label.trim())
            )
              return;
            gesture.current = {
              object: {
                id: crypto.randomUUID(),
                type: mode,
                color,
                width: mode === "eraser" ? Math.max(12, width) : width,
                points: ["arrow", "rectangle", "circle"].includes(mode)
                  ? [p, p]
                  : [p],
                text: mode === "text" ? label : "",
              },
              start: p,
              pointerId: e.pointerId,
            };
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          renderGesture();
        }}
        onPointerMove={(e) => {
          const g = gesture.current;
          if (!g || g.pointerId !== e.pointerId) return;
          const p = position(e);
          if (g.original)
            g.object = shift(g.original, p.x - g.start.x, p.y - g.start.y);
          else if (g.object.type === "pen" || g.object.type === "eraser") {
            const last = g.object.points.at(-1)!;
            if (
              Math.hypot(p.x - last.x, p.y - last.y) > 2 &&
              g.object.points.length < 3000
            )
              g.object.points.push(p);
          } else if (g.object.type !== "text") g.object.points = [g.start, p];
          renderGesture();
        }}
        onPointerUp={finish}
        onPointerCancel={(e) => {
          gesture.current = null;
          if (canvas.current) drawSketch(canvas.current, state);
          if (e.currentTarget.hasPointerCapture(e.pointerId))
            e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onLostPointerCapture={() => {
          if (gesture.current) {
            gesture.current = null;
            if (canvas.current) drawSketch(canvas.current, state);
          }
        }}
      />
      <p id={helpId} className="tool-hint">
        {t(
          "Select an object below to move it with arrow keys or delete it. You can also teach with text labels and the other tools.",
        )}
      </p>
      <div className="tool-actions">
        <button
          type="button"
          disabled={disabled || !history.past.length}
          onClick={() =>
            onChange(history.past.at(-1)!, {
              past: history.past.slice(0, -1),
              future: [state, ...history.future],
            })
          }
        >
          {t("Undo")}
        </button>
        <button
          type="button"
          disabled={disabled || !history.future.length}
          onClick={() =>
            onChange(history.future[0], {
              past: [...history.past, state],
              future: history.future.slice(1),
            })
          }
        >
          {t("Redo")}
        </button>
        <button
          type="button"
          disabled={disabled || !state.objects.length}
          onClick={async () => {
            if (
              await confirm({
                title: "Clear sketch?",
                description:
                  "Your drawing will be cleared. You can undo this action.",
                confirmLabel: "Clear sketch",
                destructive: true,
              })
            )
              commit({ kind: "sketch", objects: [] });
          }}
        >
          {t("Clear sketch")}
        </button>
      </div>
      {state.objects.length > 0 && (
        <div className="tool-field">
          <label htmlFor={`${helpId}-object`}>{t("Selected object")}</label>
          <CustomSelect
            id={`${helpId}-object`}
            label={t("Selected object")}
            value={selected ?? ""}
            disabled={disabled}
            onChange={setSelected}
            placeholder={t("Choose an object")}
            options={[
              { value: "", label: t("Choose an object") },
              ...state.objects.map((object, index) => ({
                value: object.id,
                label: `${index + 1}. ${object.text || t(modes.find((mode) => mode.value === object.type)!.label)}`,
              })),
            ]}
          />
        </div>
      )}
      {selected && (
        <div className="tool-actions">
          {[
            ["Move left", -10, 0],
            ["Move right", 10, 0],
            ["Move up", 0, -10],
            ["Move down", 0, 10],
          ].map(([l, x, y]) => (
            <button
              key={l}
              type="button"
              disabled={disabled}
              onClick={() => moveSelected(Number(x), Number(y))}
            >
              {t(l as TranslationKey)}
            </button>
          ))}
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              commit({
                ...state,
                objects: state.objects.filter((o) => o.id !== selected),
              });
              setSelected(undefined);
            }}
          >
            {t("Delete object")}
          </button>
        </div>
      )}
    </div>
  );
}
function shift(o: SketchObject, dx: number, dy: number): SketchObject {
  dx = Math.max(
    -Math.min(...o.points.map((p) => p.x)),
    Math.min(CANVAS_WIDTH - Math.max(...o.points.map((p) => p.x)), dx),
  );
  dy = Math.max(
    -Math.min(...o.points.map((p) => p.y)),
    Math.min(CANVAS_HEIGHT - Math.max(...o.points.map((p) => p.y)), dy),
  );
  return { ...o, points: o.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}
function hit(o: SketchObject, p: { x: number; y: number }) {
  const xs = o.points.map((p) => p.x),
    ys = o.points.map((p) => p.y);
  return (
    p.x >= Math.min(...xs) - 15 &&
    p.x <= Math.max(...xs) + (o.type === "text" ? o.text.length * 20 : 15) &&
    p.y >= Math.min(...ys) - 15 &&
    p.y <= Math.max(...ys) + (o.type === "text" ? 40 : 15)
  );
}
