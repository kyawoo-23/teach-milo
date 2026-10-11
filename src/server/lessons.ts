import "server-only";
import { z } from "zod";
import {
  BoardSchema,
  Lesson,
  LessonGeneratedSchema,
  Material,
  PrepareSchema,
} from "@/lib/contracts";
import { validateBoardConfiguration, textBoard } from "@/lib/boards";
import { validateCalculation } from "@/lib/custom-code";
import { AppError } from "@/lib/errors";
import { CNN_BOARD, CNN_CARD, CNN_TRANSFER } from "@/content/cnn";
import { PREPARE_PROMPT } from "@/content/prompts";
import {
  assertOwned,
  database,
  decode,
  encode,
  expiresAt,
  readOwned,
} from "./db";
import { gemini, Model } from "./model";
import { CallContext } from "./usage";

export async function prepareLesson(
  id: string,
  input: z.infer<typeof PrepareSchema>,
  ctx: CallContext,
  model: Model = gemini,
) {
  const existing = await database().collection("lessons").doc(id).get();
  if (existing.exists) {
    assertOwned(decode<Lesson>(existing.data()), ctx.ownerId);
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
    PREPARE_PROMPT,
    { topic: input.topic, level: input.level, sources: input.sources },
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
  const cnn =
    /(?:cnn|convolution)/i.test(input.topic + " " + result.title) &&
    /weight\s*sharing/i.test(result.title + " " + input.topic);
  if (cnn) {
    result.knowledge += "\nVetted reference: " + CNN_CARD;
    result.board = CNN_BOARD;
    result.transfer = CNN_TRANSFER;
  } else {
    result.transfer.arithmetic = "none";
    if (result.board.kind === "cnn") result.board = textBoard();
  }
  const checkBoard = () => {
    validateBoardConfiguration(result.board);
    if (result.board.kind === "custom")
      validateCalculation(
        result.board.code,
        result.board.controls.map((c) => c.id),
        result.board.metrics.map((m) => m.id),
      );
  };
  try {
    checkBoard();
  } catch {
    try {
      result.board = await model.generate(
        BoardSchema,
        PREPARE_PROMPT +
          "\nRepair the supplied board to satisfy the constraints. Return only the board schema.",
        { board: result.board, concept: result.title },
        ctx,
      );
      checkBoard();
    } catch {
      result.board = textBoard();
    }
  }
  // OCR warnings are surfaced for learner review; unresolved factual concerns remain private grading constraints.
  const lesson: Lesson = {
    ...result,
    id,
    ownerId: ctx.ownerId,
    materialId: material.id,
    level: input.level,
    sources: input.sources,
    confirmed: false,
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt(),
  };
  await database().collection("lessons").doc(id).create(encode(lesson));
  return id;
}
