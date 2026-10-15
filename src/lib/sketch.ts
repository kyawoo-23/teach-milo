import {
  BOARD_PNG_BYTES,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type SketchObject,
  type SketchState,
} from "./board-tools";

export type Point = { x: number; y: number };
export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
export const resizeHandles = [
  "nw",
  "n",
  "ne",
  "e",
  "se",
  "s",
  "sw",
  "w",
] as const;
export type ResizeHandle = (typeof resizeHandles)[number];
export type SketchHandle = ResizeHandle | "rotate";
const FRAME_PAD = 12;
const ROTATE_STEM = 28;
const MIN_SIZE = 16;

export function objectRotation(object: SketchObject) {
  return object.rotation ?? 0;
}
export function objectScale(object: SketchObject) {
  return object.type === "text" ? (object.scale ?? 1) : 1;
}
export function contentBounds(object: SketchObject): Bounds {
  const xs = object.points.map((point) => point.x);
  const ys = object.points.map((point) => point.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  if (object.type === "text") {
    return {
      minX,
      minY,
      maxX: minX + Math.min(600, Math.max(24, object.text.length * 18)),
      maxY: minY + 36,
    };
  }
  return {
    minX,
    minY,
    maxX: Math.max(...xs),
    maxY: Math.max(...ys),
  };
}
export function framedBounds(object: SketchObject): Bounds {
  const bounds = contentBounds(object);
  return {
    minX: bounds.minX - FRAME_PAD,
    minY: bounds.minY - FRAME_PAD,
    maxX: bounds.maxX + FRAME_PAD,
    maxY: bounds.maxY + FRAME_PAD,
  };
}
function centerOf(bounds: Bounds): Point {
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}
export function toWorld(object: SketchObject, point: Point): Point {
  const center = centerOf(contentBounds(object));
  const rotation = (objectRotation(object) * Math.PI) / 180;
  const scale = objectScale(object);
  const dx = (point.x - center.x) * scale;
  const dy = (point.y - center.y) * scale;
  return {
    x: center.x + dx * Math.cos(rotation) - dy * Math.sin(rotation),
    y: center.y + dx * Math.sin(rotation) + dy * Math.cos(rotation),
  };
}
export function toLocal(object: SketchObject, point: Point): Point {
  const center = centerOf(contentBounds(object));
  const rotation = (-objectRotation(object) * Math.PI) / 180;
  const scale = objectScale(object);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  const x = dx * Math.cos(rotation) - dy * Math.sin(rotation);
  const y = dx * Math.sin(rotation) + dy * Math.cos(rotation);
  return { x: center.x + x / scale, y: center.y + y / scale };
}
export function handleAnchor(
  object: SketchObject,
  handle: SketchHandle,
): Point {
  const bounds = framedBounds(object);
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  if (handle === "rotate")
    return toWorld(object, { x: midX, y: bounds.minY - ROTATE_STEM });
  return toWorld(object, {
    x: handle.includes("w")
      ? bounds.minX
      : handle.includes("e")
        ? bounds.maxX
        : midX,
    y: handle.includes("n")
      ? bounds.minY
      : handle.includes("s")
        ? bounds.maxY
        : midY,
  });
}
export function hitSketchObject(object: SketchObject, point: Point) {
  const local = toLocal(object, point);
  const bounds = contentBounds(object);
  const pad = object.type === "text" ? 8 : 15;
  return (
    local.x >= bounds.minX - pad &&
    local.x <= bounds.maxX + pad &&
    local.y >= bounds.minY - pad &&
    local.y <= bounds.maxY + pad
  );
}
export function wrapDegrees(degrees: number) {
  const wrapped = ((((degrees + 180) % 360) + 360) % 360) - 180;
  return Math.round(wrapped * 10) / 10;
}
export function rotateByDegrees(
  object: SketchObject,
  delta: number,
): SketchObject {
  return { ...object, rotation: wrapDegrees(objectRotation(object) + delta) };
}
export function rotateByPointer(
  original: SketchObject,
  start: Point,
  current: Point,
): SketchObject {
  const center = centerOf(contentBounds(original));
  const startAngle = Math.atan2(start.y - center.y, start.x - center.x);
  const currentAngle = Math.atan2(current.y - center.y, current.x - center.x);
  return rotateByDegrees(
    original,
    ((currentAngle - startAngle) * 180) / Math.PI,
  );
}
function pointsFit(points: Point[]) {
  return points.every(
    (point) =>
      point.x >= 0 &&
      point.y >= 0 &&
      point.x <= CANVAS_WIDTH &&
      point.y <= CANVAS_HEIGHT,
  );
}
function roundPoint(point: Point): Point {
  return { x: Math.round(point.x), y: Math.round(point.y) };
}
export function scaleObject(
  object: SketchObject,
  factor: number,
): SketchObject | null {
  if (object.type === "text") {
    const scale = Math.min(4, Math.max(0.25, objectScale(object) * factor));
    const rounded = Math.round(scale * 100) / 100;
    if (rounded === objectScale(object)) return null;
    return { ...object, scale: rounded };
  }
  const bounds = contentBounds(object);
  const center = centerOf(bounds);
  const points = object.points.map((point) =>
    roundPoint({
      x: center.x + (point.x - center.x) * factor,
      y: center.y + (point.y - center.y) * factor,
    }),
  );
  if (
    !pointsFit(points) ||
    points.every(
      (point, index) =>
        point.x === object.points[index]?.x &&
        point.y === object.points[index]?.y,
    )
  )
    return null;
  return { ...object, points };
}
export function resizeByPointer(
  original: SketchObject,
  handle: ResizeHandle,
  pointer: Point,
): SketchObject {
  if (original.type === "text") return resizeText(original, handle, pointer);
  const from = contentBounds(original);
  const frame = framedBounds(original);
  const local = toLocal(original, pointer);
  let { minX, minY, maxX, maxY } = frame;
  if (handle.includes("e")) maxX = local.x;
  if (handle.includes("w")) minX = local.x;
  if (handle.includes("s")) maxY = local.y;
  if (handle.includes("n")) minY = local.y;
  let contentMinX = minX + FRAME_PAD;
  let contentMaxX = maxX - FRAME_PAD;
  let contentMinY = minY + FRAME_PAD;
  let contentMaxY = maxY - FRAME_PAD;
  if (contentMaxX - contentMinX < MIN_SIZE) {
    if (handle.includes("w")) contentMinX = contentMaxX - MIN_SIZE;
    else contentMaxX = contentMinX + MIN_SIZE;
  }
  if (contentMaxY - contentMinY < MIN_SIZE) {
    if (handle.includes("n")) contentMinY = contentMaxY - MIN_SIZE;
    else contentMaxY = contentMinY + MIN_SIZE;
  }
  const width = Math.max(1, from.maxX - from.minX);
  const height = Math.max(1, from.maxY - from.minY);
  const points = original.points.map((point) =>
    roundPoint({
      x:
        contentMinX +
        (from.maxX === from.minX ? 0.5 : (point.x - from.minX) / width) *
          (contentMaxX - contentMinX),
      y:
        contentMinY +
        (from.maxY === from.minY ? 0.5 : (point.y - from.minY) / height) *
          (contentMaxY - contentMinY),
    }),
  );
  if (!pointsFit(points)) return original;
  return { ...original, points };
}
function resizeText(
  original: SketchObject,
  handle: ResizeHandle,
  pointer: Point,
): SketchObject {
  const center = centerOf(contentBounds(original));
  const anchor = handleAnchor(original, handle);
  const before = Math.hypot(anchor.x - center.x, anchor.y - center.y);
  const after = Math.hypot(pointer.x - center.x, pointer.y - center.y);
  if (before < 1) return original;
  const scale = Math.min(
    4,
    Math.max(0.25, objectScale(original) * (after / before)),
  );
  return { ...original, scale: Math.round(scale * 100) / 100 };
}
function withObjectTransform(
  ctx: CanvasRenderingContext2D,
  object: SketchObject,
  draw: () => void,
) {
  const rotation = objectRotation(object);
  const scale = objectScale(object);
  if (rotation === 0 && scale === 1) {
    draw();
    return;
  }
  const center = centerOf(contentBounds(object));
  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.scale(scale, scale);
  ctx.translate(-center.x, -center.y);
  draw();
  ctx.restore();
}
export function paintSelection(
  canvas: HTMLCanvasElement,
  object: SketchObject,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const bounds = framedBounds(object);
  ctx.save();
  ctx.scale(canvas.width / CANVAS_WIDTH, canvas.height / CANVAS_HEIGHT);
  withObjectTransform(ctx, object, () => {
    const midX = (bounds.minX + bounds.maxX) / 2;
    ctx.strokeStyle = "rgba(101, 93, 204, 0.9)";
    ctx.lineWidth = 1.25;
    ctx.setLineDash([]);
    ctx.strokeRect(
      bounds.minX,
      bounds.minY,
      bounds.maxX - bounds.minX,
      bounds.maxY - bounds.minY,
    );
    ctx.strokeStyle = "rgba(101, 93, 204, 0.55)";
    ctx.beginPath();
    ctx.moveTo(midX, bounds.minY);
    ctx.lineTo(midX, bounds.minY - ROTATE_STEM);
    ctx.stroke();
  });
  ctx.restore();
}
const SKETCH_CANVAS_LIGHT = "#ffffff";
const SKETCH_CANVAS_DARK = "#1f1f1f";

function sketchCanvasIsDark(): boolean {
  const theme = document.documentElement.dataset.theme;
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

function sketchCanvasFill(canvas: HTMLCanvasElement): string {
  if (typeof document === "undefined") return SKETCH_CANVAS_LIGHT;
  const probe =
    (canvas.isConnected && canvas) ||
    document.querySelector<HTMLCanvasElement>(".sketch-board canvas") ||
    canvas;
  const fill = getComputedStyle(probe).backgroundColor;
  if (fill && fill !== "rgba(0, 0, 0, 0)") return fill;
  return sketchCanvasIsDark() ? SKETCH_CANVAS_DARK : SKETCH_CANVAS_LIGHT;
}

export function drawSketch(canvas: HTMLCanvasElement, state: SketchState) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Drawing is unavailable in this browser.");
  const paper = sketchCanvasFill(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(canvas.width / CANVAS_WIDTH, canvas.height / CANVAS_HEIGHT);
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const object of state.objects) {
    const a = object.points[0],
      b = object.points.at(-1)!;
    ctx.strokeStyle = object.type === "eraser" ? paper : object.color;
    ctx.fillStyle = object.color;
    ctx.lineWidth = object.width;
    withObjectTransform(ctx, object, () => {
      ctx.beginPath();
      if (object.type === "text") {
        ctx.font = "32px 'Avenir Next', 'Segoe UI', sans-serif";
        ctx.textBaseline = "top";
        ctx.fillText(object.text, a.x, a.y);
      } else if (object.type === "rectangle")
        ctx.rect(a.x, a.y, b.x - a.x, b.y - a.y);
      else if (object.type === "circle")
        ctx.ellipse(
          (a.x + b.x) / 2,
          (a.y + b.y) / 2,
          Math.max(1, Math.abs(b.x - a.x) / 2),
          Math.max(1, Math.abs(b.y - a.y) / 2),
          0,
          0,
          Math.PI * 2,
        );
      else {
        ctx.moveTo(a.x, a.y);
        for (const p of object.points) ctx.lineTo(p.x, p.y);
        if (object.points.length === 1) ctx.lineTo(a.x + 0.1, a.y + 0.1);
        if (object.type === "arrow") {
          const angle = Math.atan2(b.y - a.y, b.x - a.x),
            length = 18 + object.width;
          ctx.moveTo(
            b.x - length * Math.cos(angle - 0.5),
            b.y - length * Math.sin(angle - 0.5),
          );
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(
            b.x - length * Math.cos(angle + 0.5),
            b.y - length * Math.sin(angle + 0.5),
          );
        }
      }
      ctx.stroke();
    });
  }
  ctx.restore();
}
export async function sketchPng(state: SketchState): Promise<string> {
  const canvas = document.createElement("canvas");
  for (const width of [CANVAS_WIDTH, 768, 576, 480]) {
    canvas.width = width;
    canvas.height = (width * CANVAS_HEIGHT) / CANVAS_WIDTH;
    drawSketch(canvas, state);
    const png = canvas.toDataURL("image/png").split(",")[1];
    if (Math.floor((png.length * 3) / 4) <= BOARD_PNG_BYTES) return png;
  }
  throw new Error(
    "Your board is too detailed to share. Simplify it and try again.",
  );
}
