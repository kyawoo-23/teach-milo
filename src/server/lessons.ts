import "server-only";
import { z } from "zod";
import {
  Board,
  BoardGenerated,
  BoardGeneratedSchema,
  Lesson,
  LessonGeneratedSchema,
  Material,
  PrepareSchema,
} from "@/lib/contracts";
import { exampleBoard } from "@/lib/boards";
import { compileBoard } from "@/lib/board-catalog";
import { AppError } from "@/lib/errors";
import { lessonLanguage, type TeachingLanguage } from "@/lib/i18n/locales";
import { verifyNumericTransfer } from "./calculation";
import { PREPARE_PROMPT, languageInstruction } from "@/content/prompts";
import {
  assertGuestWritable,
  assertOwned,
  database,
  decode,
  encode,
  expiresAt,
  readOwned,
} from "./db";
import { gemini, Model } from "./model";
import { CallContext, event } from "./usage";

// English keeps the canonical pre-i18n payload so retries from older clients
// still match saved operations. Non-English choices participate in the hash.
export function prepareOperationPayload(input: z.infer<typeof PrepareSchema>) {
  const { teachingLanguage, ...legacy } = input;
  return teachingLanguage === "en"
    ? { type: "prepare", ...legacy }
    : { type: "prepare", ...input };
}

export async function prepareLesson(
  id: string,
  request: z.input<typeof PrepareSchema>,
  ctx: CallContext,
  model: Model = gemini,
) {
  const input = PrepareSchema.parse(request);
  const existing = await database().collection("lessons").doc(id).get();
  if (existing.exists) {
    const saved = decode<Lesson>(existing.data());
    assertOwned(saved, ctx.ownerId);
    if (lessonLanguage(saved.teachingLanguage) !== input.teachingLanguage)
      throw new AppError(
        "OPERATION_CONFLICT",
        "This request ID was used for different content.",
        409,
      );
    return id;
  }
  const material = await readOwned<Material>(
    "materials",
    input.materialId,
    ctx.ownerId,
  );
  if (
    input.sources.reduce((n, s) => n + s.text.length, 0) > 50_000 ||
    input.sources.every((s) => s.text.trim().length < 30)
  )
    throw new AppError(
      "INVALID_MATERIAL",
      "Provide at least a paragraph, up to 50,000 characters.",
    );
  if (
    new Set(input.sources.map((s) => s.id)).size !== input.sources.length ||
    input.sources.some((s) => !material.sources.some((o) => o.id === s.id))
  )
    throw new AppError(
      "INVALID_SOURCE",
      "Review the extracted source sections before continuing.",
    );
  const result = await model.generate(
    LessonGeneratedSchema,
    PREPARE_PROMPT + languageInstruction(input.teachingLanguage),
    {
      topic: input.topic,
      level: input.level,
      sources: input.sources,
      teachingLanguage: input.teachingLanguage,
    },
    ctx,
  );
  if (
    new Set(result.objectives.map((o) => o.id)).size !==
      result.objectives.length ||
    result.objectives.some((o) =>
      o.sourceIds.some((id) => !input.sources.some((s) => s.id === id)),
    )
  )
    throw new AppError(
      "MODEL_FAILURE",
      "The lesson could not be linked to your material. Please retry.",
      502,
    );
  const numeric = await verifyNumericTransfer(result.transfer.numeric);
  const { board, outcome: boardOutcome } = await prepareBoard(
    result.board,
    result.title,
    input.teachingLanguage,
    ctx,
    model,
  );
  // OCR warnings are surfaced for learner review; unresolved factual concerns remain private grading constraints.
  const lesson: Lesson = {
    ...result,
    transfer: { ...result.transfer, numeric: numeric.numeric },
    board,
    id,
    ownerId: ctx.ownerId,
    materialId: material.id,
    level: input.level,
    teachingLanguage: input.teachingLanguage,
    sources: input.sources,
    confirmed: false,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt(),
  };
  await database().runTransaction(async (tx) => {
    await assertGuestWritable(tx, ctx.ownerId);
    tx.create(database().collection("lessons").doc(id), encode(lesson));
  });
  await Promise.all([
    event(id, `board_prepared_${boardOutcome}`, id),
    ...(numeric.outcome === "none"
      ? []
      : [event(id, `transfer_numeric_${numeric.outcome}`, id)]),
  ]);
  return id;
}

// Fatal compile problems get one repair call with the diagnostics; a board that
// still fails becomes the example table so lesson prep never blocks on the board.
async function prepareBoard(
  generated: BoardGenerated,
  title: string,
  language: TeachingLanguage,
  ctx: CallContext,
  model: Model,
): Promise<{ board: Board; outcome: "generated" | "repaired" | "fallback" }> {
  const first = compileBoard({ ...generated, version: 2 });
  if (!first.fatal) return { board: first.board, outcome: "generated" };
  const second = await model
    .generate(
      BoardGeneratedSchema,
      PREPARE_PROMPT +
        languageInstruction(language) +
        "\nRepair the supplied board to satisfy the constraints and fix every diagnostic. Return only the board schema.",
      { board: generated, diagnostics: first.diagnostics, concept: title },
      ctx,
    )
    .then(
      (repaired) => compileBoard({ ...repaired, version: 2 }),
      () => undefined,
    );
  return second && !second.fatal
    ? { board: second.board, outcome: "repaired" }
    : { board: exampleBoard(title, language), outcome: "fallback" };
}
