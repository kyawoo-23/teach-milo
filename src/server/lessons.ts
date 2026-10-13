import "server-only";
import { z } from "zod";
import {
  BoardSchema,
  Lesson,
  LessonGeneratedSchema,
  Material,
  PrepareSchema,
} from "@/lib/contracts";
import { validateBoardConfiguration, exampleBoard } from "@/lib/boards";
import { validateCalculation } from "@/lib/custom-code";
import { AppError } from "@/lib/errors";
import {
  localizedCnnBoard,
  CNN_CARD,
  localizedCnnTransfer,
} from "@/content/cnn";
import { lessonLanguage } from "@/lib/i18n/locales";
import { PREPARE_PROMPT, languageInstruction } from "@/content/prompts";
import {
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
  const cnn =
    /(?:cnn|convolution|卷积|畳み込み)/i.test(
      input.topic + " " + result.title,
    ) &&
    /(?:weight\s*sharing|权重共享|重み(?:の)?共有)/i.test(
      result.title + " " + input.topic,
    );
  if (cnn) {
    result.knowledge += "\nVetted reference: " + CNN_CARD;
    result.board = localizedCnnBoard(input.teachingLanguage);
    result.transfer = localizedCnnTransfer(input.teachingLanguage);
  } else {
    result.transfer.arithmetic = "none";
    if (result.board.kind === "cnn")
      result.board = exampleBoard(result.title, input.teachingLanguage);
  }
  let boardOutcome = "generated";
  const checkBoard = () => {
    if (result.board.kind === "text" || (result.board.kind === "cnn" && !cnn)) {
      result.board = exampleBoard(result.title, input.teachingLanguage);
      boardOutcome = "fallback";
    }
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
          languageInstruction(input.teachingLanguage) +
          "\nRepair the supplied board to satisfy the constraints. Return only the board schema.",
        { board: result.board, concept: result.title },
        ctx,
      );
      boardOutcome = "repaired";
      checkBoard();
    } catch {
      result.board = exampleBoard(result.title, input.teachingLanguage);
      boardOutcome = "fallback";
    }
  }
  // OCR warnings are surfaced for learner review; unresolved factual concerns remain private grading constraints.
  const lesson: Lesson = {
    ...result,
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
  await database().collection("lessons").doc(id).create(encode(lesson));
  await event(id, `board_prepared_${result.board.kind}_${boardOutcome}`, id);
  return id;
}
