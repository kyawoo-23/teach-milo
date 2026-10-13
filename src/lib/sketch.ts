import {
  BOARD_PNG_BYTES,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  type SketchState,
} from "./board-tools";

export function drawSketch(canvas: HTMLCanvasElement, state: SketchState) {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Drawing is unavailable in this browser.");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.scale(canvas.width / CANVAS_WIDTH, canvas.height / CANVAS_HEIGHT);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const object of state.objects) {
    const a = object.points[0],
      b = object.points.at(-1)!;
    ctx.strokeStyle = object.type === "eraser" ? "#fff" : object.color;
    ctx.fillStyle = object.color;
    ctx.lineWidth = object.width;
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
  }
  ctx.restore();
}
export function sketchPng(state: SketchState): string {
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
