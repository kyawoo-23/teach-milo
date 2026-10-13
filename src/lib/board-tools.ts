import { z } from "zod";

export const BOARD_STATE_BYTES = 48 * 1024;
export const BOARD_PNG_BYTES = 128 * 1024;
export const CANVAS_WIDTH = 960;
export const CANVAS_HEIGHT = 640;
const key = z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/);
const label = z.string().max(300);
const point = z
  .object({
    x: z.number().finite().min(0).max(CANVAS_WIDTH),
    y: z.number().finite().min(0).max(CANVAS_HEIGHT),
  })
  .strict();
export const SketchObjectSchema = z
  .object({
    id: key,
    type: z.enum(["pen", "eraser", "arrow", "rectangle", "circle", "text"]),
    color: z.enum(["#24283f", "#655dcc", "#426da9", "#b43b48", "#287b62"]),
    width: z.number().finite().min(1).max(24),
    points: z.array(point).min(1).max(3000),
    text: z.string().max(200),
  })
  .strict();
export const SketchStateSchema = z
  .object({
    kind: z.literal("sketch"),
    objects: z.array(SketchObjectSchema).max(150),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      new Set(s.objects.map((o) => o.id)).size !== s.objects.length ||
      s.objects.some(
        (o) =>
          (["arrow", "rectangle", "circle"].includes(o.type) &&
            o.points.length !== 2) ||
          (o.type === "text" && (o.points.length !== 1 || !o.text.trim())),
      )
    )
      ctx.addIssue({ code: "custom", message: "Invalid drawing objects." });
  });
export const MapStateSchema = z
  .object({
    kind: z.literal("concept_map"),
    nodes: z
      .array(
        z
          .object({ id: key, label, x: point.shape.x, y: point.shape.y })
          .strict(),
      )
      .max(10),
    links: z
      .array(z.object({ id: key, from: key, to: key, label }).strict())
      .max(20),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = new Set(s.nodes.map((n) => n.id));
    if (
      ids.size !== s.nodes.length ||
      new Set(s.links.map((l) => l.id)).size !== s.links.length ||
      s.links.some((l) => !ids.has(l.from) || !ids.has(l.to) || l.from === l.to)
    )
      ctx.addIssue({ code: "custom", message: "Invalid concept connections." });
  });
export const MatchingStateSchema = z
  .object({
    kind: z.literal("matching"),
    pairs: z
      .array(z.object({ id: key, term: label, description: label }).strict())
      .max(10),
    matches: z.record(key, key),
  })
  .strict()
  .superRefine((s, ctx) => {
    const ids = new Set(s.pairs.map((p) => p.id));
    if (
      ids.size !== s.pairs.length ||
      Object.keys(s.matches).length > 10 ||
      Object.entries(s.matches).some(([a, b]) => !ids.has(a) || !ids.has(b)) ||
      new Set(Object.values(s.matches)).size !== Object.values(s.matches).length
    )
      ctx.addIssue({ code: "custom", message: "Invalid matching choices." });
  });
export const TableStateSchema = z
  .object({
    kind: z.literal("table"),
    columns: z.array(z.string().max(60)).min(2).max(5),
    rows: z
      .array(
        z.object({ id: key, cells: z.array(label).min(2).max(5) }).strict(),
      )
      .max(10),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (
      new Set(s.rows.map((r) => r.id)).size !== s.rows.length ||
      s.rows.some((r) => r.cells.length !== s.columns.length)
    )
      ctx.addIssue({ code: "custom", message: "Invalid table cells." });
  });
export const DraftToolStateSchema = z.discriminatedUnion("kind", [
  SketchStateSchema,
  MapStateSchema,
  MatchingStateSchema,
  TableStateSchema,
]);
export const ToolStateSchema = DraftToolStateSchema.refine(
  (s) =>
    new TextEncoder().encode(JSON.stringify(s)).length <= BOARD_STATE_BYTES,
  "Your board is too detailed to share. Simplify it and try again.",
);
export type ToolState = z.infer<typeof ToolStateSchema>;
export type SketchState = z.infer<typeof SketchStateSchema>;
export type SketchObject = z.infer<typeof SketchObjectSchema>;
export type MapState = z.infer<typeof MapStateSchema>;
export type MatchingState = z.infer<typeof MatchingStateSchema>;
export type TableState = z.infer<typeof TableStateSchema>;
export type ToolKind = ToolState["kind"];
export const toolKinds: ToolKind[] = [
  "sketch",
  "concept_map",
  "matching",
  "table",
];
export function emptyTool(kind: ToolKind): ToolState {
  if (kind === "sketch") return { kind, objects: [] };
  if (kind === "concept_map") return { kind, nodes: [], links: [] };
  if (kind === "matching") return { kind, pairs: [], matches: {} };
  return {
    kind,
    columns: ["Concept", "Example", "Why it fits"],
    rows: [{ id: "row1", cells: ["", "", ""] }],
  };
}
