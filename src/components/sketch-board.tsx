"use client";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Controller } from "react-hook-form";
import { CustomSelect } from "./custom-select";
import { z } from "zod";
import { useSchemaForm } from "./schema-form";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Circle,
  Copy,
  Eraser,
  MousePointer2,
  MoveUpRight,
  PenLine,
  Plus,
  RectangleHorizontal,
  Redo2,
  RotateCcw,
  RotateCw,
  Trash2,
  Type,
  Undo2,
  ZoomIn,
  ZoomOut,
  type LucideIcon,
} from "lucide-react";
import { SketchObjectSchema } from "@/lib/board-tools";
import { useI18n } from "./locale-context";
import { useTheme } from "./theme-context";
import { useConfirmation } from "./confirmation";
import { Modal, ModalFooter } from "./ui";
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type SketchState,
  type SketchObject,
} from "@/lib/board-tools";
import {
  contentBounds,
  drawSketch,
  handleAnchor,
  hitSketchObject,
  paintSelection,
  resizeByPointer,
  resizeHandles,
  rotateByDegrees,
  rotateByPointer,
  scaleObject,
  toWorld,
  type SketchHandle,
} from "@/lib/sketch";
import type { TranslationKey } from "@/lib/i18n/messages";
export type SketchHistory = { past: SketchState[]; future: SketchState[] };
const modes: {
  value: SketchObject["type"] | "select";
  label: TranslationKey;
  icon: LucideIcon;
  group: "draw" | "edit" | "shape";
}[] = [
  { value: "pen", label: "Pen", icon: PenLine, group: "draw" },
  { value: "eraser", label: "Eraser", icon: Eraser, group: "draw" },
  {
    value: "select",
    label: "Select and move",
    icon: MousePointer2,
    group: "edit",
  },
  { value: "text", label: "Text label", icon: Type, group: "edit" },
  { value: "arrow", label: "Arrow", icon: MoveUpRight, group: "shape" },
  {
    value: "rectangle",
    label: "Rectangle",
    icon: RectangleHorizontal,
    group: "shape",
  },
  { value: "circle", label: "Circle", icon: Circle, group: "shape" },
];
const TOOLBAR_ICON_SIZE = 18;
const handleLabels: Record<SketchHandle, TranslationKey> = {
  nw: "Resize top left",
  n: "Resize top",
  ne: "Resize top right",
  e: "Resize right",
  se: "Resize bottom right",
  s: "Resize bottom",
  sw: "Resize bottom left",
  w: "Resize left",
  rotate: "Rotate",
};
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
  const { theme } = useTheme();
  const confirm = useConfirmation();
  const helpId = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<SketchObject["type"] | "select">("pen");
  const settings = useSchemaForm(
    z.object({
      color: SketchObjectSchema.shape.color,
      width: SketchObjectSchema.shape.width,
    }),
    { color: "#655dcc", width: 4 },
  );
  const [color] = settings.state("color");
  const [width] = settings.state("width");
  const [textLabelDialog, setTextLabelDialog] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [textLabelDraft, setTextLabelDraft] = useState("");
  const [selected, setSelected] = useState<string>();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState<SketchObject | null>(null);
  const selectedObject = state.objects.find((object) => object.id === selected);
  const gesture = useRef<{
    object: SketchObject;
    start: { x: number; y: number };
    original?: SketchObject;
    pointerId: number;
    handle?: SketchHandle;
  } | null>(null);
  const commit = (next: SketchState) =>
    onChange(next, {
      past: [...history.past.slice(-19), structuredClone(state)],
      future: [],
    });
  useEffect(() => {
    if (!textLabelDialog) return;
    requestAnimationFrame(() => {
      document.getElementById(`${helpId}-new-text-label`)?.focus();
    });
  }, [textLabelDialog, helpId]);
  useEffect(() => {
    if (!canvas.current) return;
    const shown: SketchState = !live
      ? state
      : {
          kind: "sketch",
          objects: state.objects.some((object) => object.id === live.id)
            ? state.objects.map((object) =>
                object.id === live.id ? live : object,
              )
            : [...state.objects, live],
        };
    drawSketch(canvas.current, shown);
    const overlay =
      mode === "select" && selected
        ? shown.objects.find((object) => object.id === selected)
        : undefined;
    if (overlay) paintSelection(canvas.current, overlay);
  }, [state, live, selected, mode, theme]);
  const canvasPoint = (clientX: number, clientY: number, clamp = true) => {
    const bounds = canvas.current?.getBoundingClientRect();
    if (!bounds?.width || !bounds.height) return { x: 0, y: 0 };
    const x = ((clientX - bounds.left) / bounds.width) * CANVAS_WIDTH;
    const y = ((clientY - bounds.top) / bounds.height) * CANVAS_HEIGHT;
    if (!clamp) return { x, y };
    return {
      x: Math.round(Math.max(0, Math.min(CANVAS_WIDTH, x))),
      y: Math.round(Math.max(0, Math.min(CANVAS_HEIGHT, y))),
    };
  };
  const showContextMenu = (event: MouseEvent<HTMLElement>) => {
    if (disabled) return;
    event.preventDefault();
    const fromKeyboard = event.clientX === 0 && event.clientY === 0;
    const hit = fromKeyboard
      ? undefined
      : [...state.objects]
          .reverse()
          .find((object) =>
            hitSketchObject(object, canvasPoint(event.clientX, event.clientY)),
          );
    const object = hit ?? state.objects.find((item) => item.id === selected);
    if (!object) return;
    if (hit) {
      setSelected(hit.id);
      setMode("select");
    }
    let x = event.clientX;
    let y = event.clientY;
    if (fromKeyboard && canvas.current) {
      const bounds = contentBounds(object);
      const world = toWorld(object, {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      });
      const rect = canvas.current.getBoundingClientRect();
      x = rect.left + (world.x / CANVAS_WIDTH) * rect.width;
      y = rect.top + (world.y / CANVAS_HEIGHT) * rect.height;
    }
    setMenu({ x, y });
  };
  const updateGesture = (point: { x: number; y: number }) => {
    const g = gesture.current;
    if (!g) return;
    if (g.handle === "rotate" && g.original)
      g.object = rotateByPointer(g.original, g.start, point);
    else if (g.handle && g.handle !== "rotate" && g.original)
      g.object = resizeByPointer(g.original, g.handle, point);
    else if (g.original)
      g.object = shift(g.original, point.x - g.start.x, point.y - g.start.y);
    else if (g.object.type === "pen" || g.object.type === "eraser") {
      const last = g.object.points.at(-1)!;
      if (
        Math.hypot(point.x - last.x, point.y - last.y) > 2 &&
        g.object.points.length < 3000
      )
        g.object.points.push(point);
    } else if (g.object.type !== "text") g.object.points = [g.start, point];
    setLive({
      ...g.object,
      points: g.object.points.map((corner) => ({ ...corner })),
    });
  };
  const finish = (e: PointerEvent<Element>) => {
    const g = gesture.current;
    if (!g || g.pointerId !== e.pointerId) return;
    gesture.current = null;
    setLive(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId))
      e.currentTarget.releasePointerCapture(e.pointerId);
    const unchanged =
      g.original &&
      (g.object.rotation ?? 0) === (g.original.rotation ?? 0) &&
      (g.object.scale ?? 1) === (g.original.scale ?? 1) &&
      JSON.stringify(g.object.points) === JSON.stringify(g.original.points);
    if (unchanged) return;
    commit({
      kind: "sketch",
      objects: g.original
        ? state.objects.map((o) => (o.id === g.object.id ? g.object : o))
        : [...state.objects, g.object],
    });
  };
  const cancelGesture = (e: PointerEvent<Element>) => {
    gesture.current = null;
    setLive(null);
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
  const replaceSelected = (object: SketchObject | null) => {
    if (!object || !selected) return;
    commit({
      ...state,
      objects: state.objects.map((item) =>
        item.id === selected ? object : item,
      ),
    });
  };
  const deleteSelected = () => {
    if (!selected) return;
    commit({
      ...state,
      objects: state.objects.filter((object) => object.id !== selected),
    });
    setSelected(undefined);
    setMenu(null);
  };
  const duplicateSelected = () => {
    if (!selectedObject || state.objects.length >= 150) return;
    const objectId = crypto.randomUUID();
    commit({
      ...state,
      objects: [
        ...state.objects,
        { ...shift(selectedObject, 20, 20), id: objectId },
      ],
    });
    setSelected(objectId);
    setMenu(null);
  };
  const recolorSelected = (color: SketchObject["color"]) => {
    if (!selected) return;
    commit({
      ...state,
      objects: state.objects.map((object) =>
        object.id === selected ? { ...object, color } : object,
      ),
    });
    setMenu(null);
  };
  useLayoutEffect(() => {
    const element = menuRef.current;
    if (!menu || !element) return;
    const popover = "popover" in HTMLElement.prototype;
    if (popover) element.showPopover();
    const rect = element.getBoundingClientRect();
    const pad = 8;
    element.style.left = `${Math.max(pad, Math.min(menu.x, window.innerWidth - rect.width - pad))}px`;
    element.style.top = `${Math.max(pad, Math.min(menu.y, window.innerHeight - rect.height - pad))}px`;
    element
      .querySelector<HTMLButtonElement>(
        '[role="menuitem"]:not(:disabled), [role="menuitemradio"]',
      )
      ?.focus();
    const close = () => setMenu(null);
    const outside = (event: globalThis.PointerEvent) => {
      if (element.contains(event.target as Node)) return;
      setMenu(null);
    };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      if (popover && element.matches(":popover-open")) element.hidePopover();
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menu]);
  useEffect(() => {
    if (disabled || !selected || textLabelDialog) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Backspace" && event.key !== "Delete") return;
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.isComposing
      )
        return;
      const target = event.target;
      if (
        target instanceof Element &&
        target.closest(
          "input, textarea, select, [contenteditable='true'], .sketch-context-menu",
        )
      )
        return;
      event.preventDefault();
      deleteSelected();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [disabled, selected, textLabelDialog, state, history]);
  const closeTextLabelDialog = () => {
    setTextLabelDialog(null);
    setTextLabelDraft("");
  };
  const placeTextLabel = () => {
    const text = textLabelDraft.trim();
    if (!text || !textLabelDialog || disabled || state.objects.length >= 150)
      return;
    const objectId = crypto.randomUUID();
    commit({
      ...state,
      objects: [
        ...state.objects,
        {
          id: objectId,
          type: "text",
          color,
          width,
          points: [{ x: textLabelDialog.x, y: textLabelDialog.y }],
          text,
        },
      ],
    });
    setSelected(objectId);
    closeTextLabelDialog();
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
        {(["draw", "edit", "shape"] as const).map((group) => (
          <div key={group} className="sketch-tool-group">
            {modes
              .filter((tool) => tool.group === group)
              .map(({ value, label: toolLabel, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  title={t(toolLabel)}
                  aria-pressed={mode === value}
                  disabled={disabled}
                  onClick={() => setMode(value)}
                >
                  <Icon size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
                  <span className="visually-hidden">{t(toolLabel)}</span>
                </button>
              ))}
          </div>
        ))}
        <div className="sketch-tool-group sketch-stroke-settings">
          <div className="sketch-stroke-color">
            <Controller
              control={settings.control}
              name="color"
              render={({ field }) => (
                <CustomSelect
                  id={`${helpId}-color`}
                  label={t("Color")}
                  compact
                  name={field.name}
                  value={field.value}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  inputRef={field.ref}
                  disabled={disabled}
                  icon={
                    <span
                      className="sketch-color-swatch"
                      aria-hidden="true"
                      style={{ background: field.value }}
                    />
                  }
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
          <label className="sketch-stroke-width">
            <span className="visually-hidden">{t("Line width")}</span>
            <input
              type="range"
              min={1}
              max={24}
              aria-label={t("Line width")}
              title={t("Line width")}
              {...settings.register("width", { valueAsNumber: true })}
              disabled={disabled}
            />
          </label>
        </div>
        <div className="sketch-tool-group sketch-history-actions">
          <button
            type="button"
            aria-label={t("Undo")}
            title={t("Undo")}
            disabled={disabled || !history.past.length}
            onClick={() =>
              onChange(history.past.at(-1)!, {
                past: history.past.slice(0, -1),
                future: [state, ...history.future],
              })
            }
          >
            <Undo2 size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("Redo")}
            title={t("Redo")}
            disabled={disabled || !history.future.length}
            onClick={() =>
              onChange(history.future[0], {
                past: [...history.past, state],
                future: history.future.slice(1),
              })
            }
          >
            <Redo2 size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={t("Clear sketch")}
            title={t("Clear sketch")}
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
            <RotateCcw size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
          </button>
        </div>
      </div>
      {mode === "text" && (
        <div className="board-shape-insert">
          <p className="tool-hint">
            {t("Tap the canvas or choose Add label to enter text.")}
          </p>
          <button
            type="button"
            disabled={disabled || state.objects.length >= 150}
            onClick={() => {
              setTextLabelDraft("");
              setTextLabelDialog({ x: 80, y: 80 });
            }}
          >
            <Plus size={16} aria-hidden="true" /> {t("Add label")}
          </button>
        </div>
      )}
      {["arrow", "rectangle", "circle"].includes(mode) && (
        <div className="board-shape-insert">
          <p className="tool-hint">
            {t("Drag on the canvas, or add a shape and move it into place.")}
          </p>
          <button
            type="button"
            disabled={disabled || state.objects.length >= 150}
            onClick={() => {
              const objectId = crypto.randomUUID();
              commit({
                ...state,
                objects: [
                  ...state.objects,
                  {
                    id: objectId,
                    type: mode as "arrow" | "rectangle" | "circle",
                    color,
                    width,
                    points: [
                      { x: 280, y: 220 },
                      { x: 560, y: 400 },
                    ],
                    text: "",
                  },
                ],
              });
              setSelected(objectId);
              setMode("select");
            }}
          >
            <Plus size={16} aria-hidden="true" /> {t("Add shape")}
          </button>
        </div>
      )}
      <div className="sketch-stage" onContextMenu={showContextMenu}>
        <canvas
          ref={canvas}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          tabIndex={disabled ? -1 : 0}
          role="img"
          aria-label={t("Sketch canvas")}
          aria-describedby={helpId}
          data-mode={mode}
          onKeyDown={(e) => {
            if (disabled) return;
            if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
              e.preventDefault();
              if (e.shiftKey && history.future.length)
                onChange(history.future[0], {
                  past: [...history.past, state],
                  future: history.future.slice(1),
                });
              else if (!e.shiftKey && history.past.length)
                onChange(history.past.at(-1)!, {
                  past: history.past.slice(0, -1),
                  future: [state, ...history.future],
                });
              return;
            }
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
            if (disabled || e.button !== 0 || !e.isPrimary || gesture.current)
              return;
            const p = canvasPoint(e.clientX, e.clientY);
            if (mode === "select") {
              const object = [...state.objects]
                .reverse()
                .find((o) => o.type !== "eraser" && hitSketchObject(o, p));
              setSelected(object?.id);
              if (!object) return;
              gesture.current = {
                object: structuredClone(object),
                original: object,
                start: p,
                pointerId: e.pointerId,
              };
            } else if (mode === "text") {
              if (state.objects.length >= 150) return;
              setTextLabelDraft("");
              setTextLabelDialog(p);
            } else {
              if (state.objects.length >= 150) return;
              gesture.current = {
                object: {
                  id: crypto.randomUUID(),
                  type: mode,
                  color,
                  width: mode === "eraser" ? Math.max(12, width) : width,
                  points: ["arrow", "rectangle", "circle"].includes(mode)
                    ? [p, p]
                    : [p],
                  text: "",
                },
                start: p,
                pointerId: e.pointerId,
              };
            }
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            const g = gesture.current;
            if (!g || g.pointerId !== e.pointerId) return;
            updateGesture(
              canvasPoint(e.clientX, e.clientY, !gesture.current?.handle),
            );
          }}
          onPointerUp={finish}
          onPointerCancel={cancelGesture}
          onLostPointerCapture={() => {
            if (gesture.current) {
              gesture.current = null;
              setLive(null);
            }
          }}
        />
        {mode === "select" && selectedObject && (
          <div className="sketch-handles">
            {([...resizeHandles, "rotate"] as const).map((handle) => {
              const target =
                live && live.id === selectedObject.id ? live : selectedObject;
              const anchor = handleAnchor(target, handle);
              return (
                <button
                  key={handle}
                  type="button"
                  className="sketch-handle"
                  data-handle={handle}
                  aria-label={t(handleLabels[handle])}
                  disabled={disabled}
                  style={{
                    left: `${(anchor.x / CANVAS_WIDTH) * 100}%`,
                    top: `${(anchor.y / CANVAS_HEIGHT) * 100}%`,
                  }}
                  onPointerDown={(event) => {
                    if (
                      disabled ||
                      event.button !== 0 ||
                      !event.isPrimary ||
                      gesture.current
                    )
                      return;
                    event.stopPropagation();
                    gesture.current = {
                      object: structuredClone(selectedObject),
                      original: selectedObject,
                      start: canvasPoint(event.clientX, event.clientY),
                      pointerId: event.pointerId,
                      handle,
                    };
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }}
                  onPointerMove={(event) => {
                    if (gesture.current?.pointerId !== event.pointerId) return;
                    updateGesture(
                      canvasPoint(event.clientX, event.clientY, false),
                    );
                  }}
                  onPointerUp={finish}
                  onPointerCancel={cancelGesture}
                />
              );
            })}
          </div>
        )}
      </div>
      <p id={helpId} className="tool-hint">
        {t(
          "Select an object below to move it with arrow keys or delete it. You can also teach with text labels and the other tools.",
        )}
      </p>
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
      {selectedObject && (
        <fieldset className="board-object-inspector">
          <legend className="visually-hidden">{t("Selected object")}</legend>
          {selectedObject.type === "text" && (
            <div className="tool-field">
              <label htmlFor={`${helpId}-edit-label`}>{t("Edit label")}</label>
              <input
                id={`${helpId}-edit-label`}
                type="text"
                value={selectedObject.text}
                disabled={disabled}
                maxLength={200}
                onChange={(event) => {
                  const text = event.currentTarget.value;
                  if (text.trim())
                    commit({
                      ...state,
                      objects: state.objects.map((object) =>
                        object.id === selected ? { ...object, text } : object,
                      ),
                    });
                }}
              />
            </div>
          )}
          <div
            className="sketch-toolbar"
            role="group"
            aria-label={t("Selected object")}
          >
            <div className="sketch-tool-group sketch-stroke-settings">
              <div className="sketch-stroke-color">
                <CustomSelect
                  id={`${helpId}-object-color`}
                  label={t("Object color")}
                  compact
                  value={selectedObject.color}
                  disabled={disabled}
                  icon={
                    <span
                      className="sketch-color-swatch"
                      aria-hidden="true"
                      style={{ background: selectedObject.color }}
                    />
                  }
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
                  onChange={(color) =>
                    recolorSelected(color as SketchObject["color"])
                  }
                />
              </div>
              <label className="sketch-stroke-width">
                <span className="visually-hidden">
                  {t("Object line width")}
                </span>
                <input
                  type="range"
                  min={1}
                  max={24}
                  step={1}
                  value={selectedObject.width}
                  aria-label={t("Object line width")}
                  title={t("Object line width")}
                  disabled={disabled}
                  onChange={(event) => {
                    const width = Number(event.currentTarget.value);
                    commit({
                      ...state,
                      objects: state.objects.map((object) =>
                        object.id === selected ? { ...object, width } : object,
                      ),
                    });
                  }}
                />
              </label>
            </div>
            <div
              className="sketch-tool-group"
              role="group"
              aria-label={t("Position")}
            >
              {(
                [
                  ["Move left", -10, 0, ArrowLeft],
                  ["Move up", 0, -10, ArrowUp],
                  ["Move down", 0, 10, ArrowDown],
                  ["Move right", 10, 0, ArrowRight],
                ] as const
              ).map(([label, x, y, Icon]) => (
                <button
                  key={label}
                  type="button"
                  title={t(label)}
                  aria-label={t(label)}
                  disabled={disabled}
                  onClick={() => moveSelected(x, y)}
                >
                  <Icon size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
                </button>
              ))}
            </div>
            <div
              className="sketch-tool-group"
              role="group"
              aria-label={t("Rotate")}
            >
              <button
                type="button"
                title={t("Rotate left")}
                aria-label={t("Rotate left")}
                disabled={disabled}
                onClick={() =>
                  replaceSelected(rotateByDegrees(selectedObject, -15))
                }
              >
                <RotateCcw size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("Rotate right")}
                aria-label={t("Rotate right")}
                disabled={disabled}
                onClick={() =>
                  replaceSelected(rotateByDegrees(selectedObject, 15))
                }
              >
                <RotateCw size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("Make larger")}
                aria-label={t("Make larger")}
                disabled={disabled || !scaleObject(selectedObject, 1.15)}
                onClick={() =>
                  replaceSelected(scaleObject(selectedObject, 1.15))
                }
              >
                <ZoomIn size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("Make smaller")}
                aria-label={t("Make smaller")}
                disabled={disabled || !scaleObject(selectedObject, 1 / 1.15)}
                onClick={() =>
                  replaceSelected(scaleObject(selectedObject, 1 / 1.15))
                }
              >
                <ZoomOut size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
              </button>
            </div>
            <div className="sketch-tool-group">
              <button
                type="button"
                title={t("Duplicate object")}
                aria-label={t("Duplicate object")}
                disabled={disabled || state.objects.length >= 150}
                onClick={duplicateSelected}
              >
                <Copy size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
              </button>
              <button
                type="button"
                title={t("Delete object")}
                aria-label={t("Delete object")}
                disabled={disabled}
                onClick={deleteSelected}
              >
                <Trash2 size={TOOLBAR_ICON_SIZE} aria-hidden="true" />
              </button>
            </div>
          </div>
        </fieldset>
      )}
      <Modal
        open={textLabelDialog !== null}
        title={t("Text label")}
        className="sketch-label-modal"
        onClose={closeTextLabelDialog}
      >
        <form
          id={`${helpId}-text-label-form`}
          className="sketch-label-form"
          onSubmit={(event) => {
            event.preventDefault();
            placeTextLabel();
          }}
        >
          <div className="tool-field">
            <label htmlFor={`${helpId}-new-text-label`}>
              {t("Text label")}
            </label>
            <input
              id={`${helpId}-new-text-label`}
              type="text"
              value={textLabelDraft}
              maxLength={200}
              onChange={(event) => setTextLabelDraft(event.currentTarget.value)}
              disabled={disabled}
            />
          </div>
        </form>
        <ModalFooter>
          <div className="modal-actions confirmation-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={closeTextLabelDialog}
            >
              {t("Cancel")}
            </button>
            <button
              type="submit"
              form={`${helpId}-text-label-form`}
              className="primary-button"
              disabled={disabled || !textLabelDraft.trim()}
            >
              {t("Add label")}
            </button>
          </div>
        </ModalFooter>
      </Modal>
      {menu &&
        selectedObject &&
        createPortal(
          <div
            ref={menuRef}
            className="sketch-context-menu"
            role="menu"
            aria-label={t("Selected object")}
            popover="manual"
            style={{ left: menu.x, top: menu.y }}
            onContextMenu={(event) => event.preventDefault()}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setMenu(null);
                canvas.current?.focus();
                return;
              }
              if (event.key === "Tab") {
                setMenu(null);
                return;
              }
              const items = [
                ...menuRef.current!.querySelectorAll<HTMLButtonElement>(
                  '[role="menuitem"]:not(:disabled), [role="menuitemradio"]',
                ),
              ];
              const index = items.indexOf(
                document.activeElement as HTMLButtonElement,
              );
              const next =
                event.key === "ArrowDown"
                  ? (index + 1) % items.length
                  : event.key === "ArrowUp"
                    ? (index - 1 + items.length) % items.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? items.length - 1
                        : -1;
              if (next < 0) return;
              event.preventDefault();
              items[next]?.focus();
            }}
          >
            {selectedObject.type === "text" && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setMenu(null);
                  requestAnimationFrame(() =>
                    document.getElementById(`${helpId}-edit-label`)?.focus(),
                  );
                }}
              >
                {t("Edit label")}
              </button>
            )}
            <div
              className="sketch-context-colors"
              role="group"
              aria-label={t("Object color")}
            >
              {colors.map((color) => (
                <button
                  key={color.value}
                  type="button"
                  role="menuitemradio"
                  aria-checked={selectedObject.color === color.value}
                  aria-label={t(color.label)}
                  style={{ background: color.value }}
                  onClick={() => recolorSelected(color.value)}
                />
              ))}
            </div>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                replaceSelected(rotateByDegrees(selectedObject, -15));
                setMenu(null);
              }}
            >
              {t("Rotate left")}
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                replaceSelected(rotateByDegrees(selectedObject, 15));
                setMenu(null);
              }}
            >
              {t("Rotate right")}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!scaleObject(selectedObject, 1.15)}
              onClick={() => {
                replaceSelected(scaleObject(selectedObject, 1.15));
                setMenu(null);
              }}
            >
              {t("Make larger")}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={!scaleObject(selectedObject, 1 / 1.15)}
              onClick={() => {
                replaceSelected(scaleObject(selectedObject, 1 / 1.15));
                setMenu(null);
              }}
            >
              {t("Make smaller")}
            </button>
            <button
              type="button"
              role="menuitem"
              disabled={state.objects.length >= 150}
              onClick={duplicateSelected}
            >
              {t("Duplicate object")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="sketch-context-delete"
              onClick={deleteSelected}
            >
              {t("Delete object")}
            </button>
          </div>,
          canvas.current?.closest("dialog") ?? document.body,
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
