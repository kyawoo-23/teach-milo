import { z } from "zod";

// Nested maxItems can make Gemini's constrained decoder reject otherwise small
// schemas (including lesson boards on Flash-Lite). Keep the response structure
// and minimums; enforce every upper bound with the original Zod schema on return.
export function modelResponseSchema<T>(schema: z.ZodType<T>) {
  const json = z.toJSONSchema(schema, { target: "draft-7" });
  function visit(value: unknown) {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, unknown>;
    if (
      node.type === "array" ||
      (Array.isArray(node.type) && node.type.includes("array"))
    )
      delete node.maxItems;
    Object.values(node).forEach(visit);
  }
  visit(json);
  return json;
}
