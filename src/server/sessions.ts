import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  ActionSchema,
  emptyLedger,
  Lesson,
  Message,
  publicLesson,
  ReportGeneratedSchema,
  Session,
  SessionPublic,
  StudentReplySchema,
  TransferSchema,
  TurnSchema,
} from "@/lib/contracts";
import {
  allowedMoves,
  inferLedgerGaps,
  normalizeStudentReply,
  readyForCheck,
  validateStudent,
} from "@/lib/controller";
import { validateBoardInputs } from "@/lib/boards";
import { finalizeReport } from "@/lib/assessment";
import { AppError } from "@/lib/errors";
import { EVALUATE_PROMPT, STUDENT_PROMPT } from "@/content/prompts";
import { database, decode, encode, expiresAt, readOwned } from "./db";
import { gemini, Model } from "./model";
import { sessionOperation } from "./operations";
import { CallContext, event } from "./usage";

export async function createSession(
  id: string,
  lessonId: string,
  ownerId: string,
) {
  const existing = await database().collection("sessions").doc(id).get();
  if (existing.exists) {
    const old = await readOwned<Session>("sessions", id, ownerId);
    if (old.lessonId !== lessonId)
      throw new AppError(
        "OPERATION_CONFLICT",
        "This session request has different content.",
        409,
      );
    return id;
  }
  const lesson = await readOwned<Lesson>("lessons", lessonId, ownerId);
  const now = new Date().toISOString();
  const expiry = expiresAt();
  const session: Session = {
    id,
    ownerId,
    lessonId,
    phase: "baseline",
    revision: 0,
    nextSequence: 1,
    challengeUsed: false,
    hintUsed: false,
    ledger: emptyLedger(),
    createdAt: now,
    updatedAt: now,
    expiresAt: expiry,
  };
  const f = database();
  const batch = f.batch();
  batch.create(f.collection("sessions").doc(id), encode(session));
  batch.update(f.collection("lessons").doc(lessonId), {
    confirmed: true,
    expiresAt: encode({ expiresAt: expiry }).expiresAt,
  });
  const greeting: Message = {
    id: randomUUID(),
    role: "student",
    text: lesson.opening,
    createdAt: now,
    sequence: 0,
    kind: "teaching",
  };
  batch.create(
    f.collection("sessions").doc(id).collection("messages").doc(greeting.id),
    encode({ ...greeting, expiresAt: expiry }),
  );
  await batch.commit();
  await event(id, "session_started", id);
  return id;
}
export async function readMessages(
  id: string,
  limit = 30,
  before?: number,
): Promise<Message[]> {
  let query = database()
    .collection("sessions")
    .doc(id)
    .collection("messages")
    .orderBy("sequence", "desc");
  if (before !== undefined) query = query.where("sequence", "<", before);
  const docs = await query.limit(limit).get();
  return docs.docs.map((d) => decode<Message>(d.data())).reverse();
}
export async function evidenceMessages(
  session: Session,
  recent: Message[],
): Promise<Message[]> {
  const ids = new Set(
    [
      ...session.ledger.evidence.flatMap((e) => e.citations),
      ...session.ledger.mechanism,
      ...session.ledger.demonstration,
      ...session.ledger.misconceptionCorrection,
    ].map((c) => c.messageId),
  );
  const missing = [...ids].filter((id) => !recent.some((m) => m.id === id));
  const docs = missing.length
    ? await database().getAll(
        ...missing.map((id) =>
          database()
            .collection("sessions")
            .doc(session.id)
            .collection("messages")
            .doc(id),
        ),
      )
    : [];
  return [
    ...docs.filter((d) => d.exists).map((d) => decode<Message>(d.data())),
    ...recent,
  ].sort((a, b) => a.sequence - b.sequence);
}
async function maybePromoteReady(
  id: string,
  session: Session,
  lesson: Lesson,
): Promise<Session> {
  const ledger = inferLedgerGaps(session.ledger);
  const candidate = { ...session, ledger };
  if (
    !["baseline", "teaching"].includes(session.phase) ||
    !readyForCheck(candidate, lesson)
  )
    return candidate;
  const updated = {
    ...candidate,
    phase: "ready_for_check" as const,
    revision: session.revision + 1,
    updatedAt: new Date().toISOString(),
  };
  await database().collection("sessions").doc(id).update({
    phase: updated.phase,
    ledger: updated.ledger,
    revision: updated.revision,
    updatedAt: updated.updatedAt,
  });
  return updated;
}
export async function publicSession(
  id: string,
  ownerId: string,
): Promise<SessionPublic> {
  const initial = await readOwned<Session>("sessions", id, ownerId);
  const lesson = await readOwned<Lesson>("lessons", initial.lessonId, ownerId);
  const session = await maybePromoteReady(id, initial, lesson);
  // Once assessment begins, normal session retrieval cannot reopen practice aids.
  const teaching = ["baseline", "teaching", "ready_for_check"].includes(
    session.phase,
  );
  const messages = session.phase === "transfer" ? [] : await readMessages(id);
  return {
    id,
    phase: session.phase,
    revision: session.revision,
    challengeUsed: session.challengeUsed,
    hintUsed: session.hintUsed,
    expiresAt: session.expiresAt,
    lesson: publicLesson(lesson),
    messages,
    ...(messages.length === 30 && teaching
      ? { nextCursor: messages[0].sequence }
      : {}),
    progress: lesson.objectives.map((o) => ({
      id: o.id,
      label: o.label,
      status:
        session.ledger.evidence.find((e) => e.objectiveId === o.id)
          ?.understanding || "missing",
    })),
    ...(teaching ? { board: lesson.board } : {}),
    ...(session.phase === "transfer"
      ? {
          transferQuestion: lesson.transfer.question,
          numericalCheck: lesson.transfer.arithmetic === "cnn",
        }
      : {}),
    ...(session.phase === "report" ? { report: session.report } : {}),
    pending:
      !!session.activeOperation && session.activeOperation.until > Date.now(),
  };
}
export async function submitTurn(
  id: string,
  input: z.infer<typeof TurnSchema>,
  ctx: CallContext,
  model: Model = gemini,
) {
  await sessionOperation(
    ctx.ownerId,
    id,
    input.operationId,
    input.revision,
    input,
    async (session) => {
      if (!["baseline", "teaching", "ready_for_check"].includes(session.phase))
        throw new AppError(
          "WRONG_PHASE",
          "Teaching has ended for this session.",
          409,
        );
      const lesson = await readOwned<Lesson>(
        "lessons",
        session.lessonId,
        ctx.ownerId,
      );
      const learner: Message = {
        id: input.operationId,
        role: "learner",
        text: input.text,
        createdAt: new Date().toISOString(),
        sequence: session.nextSequence,
        kind: "teaching",
        ...(input.board
          ? { board: validateBoardInputs(lesson.board, input.board) }
          : {}),
      };
      await database()
        .collection("sessions")
        .doc(id)
        .collection("operations")
        .doc(input.operationId)
        .update({ pendingTurn: learner });
      const messages = [
        ...(await evidenceMessages(session, await readMessages(id, 12))),
        learner,
      ];
      const response = await model.generate(
        StudentReplySchema,
        STUDENT_PROMPT,
        {
          knowledge: lesson.knowledge,
          objectives: lesson.objectives,
          allowedMoves: allowedMoves(session),
          misconception: !session.challengeUsed
            ? lesson.misconception
            : undefined,
          ledger: session.ledger,
          messages,
        },
        ctx,
      );
      const replyData = normalizeStudentReply(
        response,
        session,
        lesson,
        messages,
      );
      const ledger = inferLedgerGaps(
        validateStudent(replyData, session, lesson, messages),
      );
      const next = {
        ...session,
        ledger,
        challengeUsed:
          session.challengeUsed || replyData.move === "surface_misconception",
        nextSequence: session.nextSequence + 2,
      };
      next.phase = readyForCheck(next, lesson)
        ? "ready_for_check"
        : replyData.move === "redirect" && session.phase === "baseline"
          ? "baseline"
          : "teaching";
      const reply: Message = {
        id: randomUUID(),
        role: "student",
        text:
          replyData.move === "surface_misconception"
            ? lesson.misconception
            : next.phase === "ready_for_check"
              ? "Your explanation has helped me connect the key ideas. Would you like to try a new example on your own, or keep teaching me?"
              : replyData.studentMessage,
        createdAt: new Date().toISOString(),
        sequence: session.nextSequence + 1,
        kind: "teaching",
      };
      return { session: next, messages: [learner, reply] };
    },
  );
  await event(id, "turn_submitted", input.operationId);
  if (input.board) await event(id, "board_shared", input.operationId);
}
async function evaluate(
  session: Session,
  lesson: Lesson,
  messages: Message[],
  skipped: boolean,
  ctx: CallContext,
  model: Model,
  parameters?: { small: number; large: number },
) {
  const raw = await model.generate(
    ReportGeneratedSchema,
    EVALUATE_PROMPT,
    {
      knowledge: lesson.knowledge,
      objectives: lesson.objectives,
      concerns: lesson.concerns,
      misconceptionCorrection: lesson.misconceptionCorrection,
      transfer: lesson.transfer,
      messages,
      ledger: session.ledger,
      skipped,
      arithmetic:
        lesson.transfer.arithmetic === "cnn"
          ? { expectedParameters: 204, submitted: parameters ?? null }
          : {
              verification:
                "No vetted deterministic numeric key; withhold uncertain factual judgments.",
            },
    },
    ctx,
  );
  const report = finalizeReport(raw, lesson, messages, skipped, parameters);
  if (session.ledger.unresolvedError) {
    report.criticalMisconception = true;
    if (report.overallLabel === "strong_evidence")
      report.overallLabel = "developing";
  }
  return report;
}
export async function sessionAction(
  id: string,
  input: z.infer<typeof ActionSchema>,
  ctx: CallContext,
  model: Model = gemini,
) {
  await sessionOperation(
    ctx.ownerId,
    id,
    input.operationId,
    input.revision,
    input,
    async (session) => {
      if (!["baseline", "teaching", "ready_for_check"].includes(session.phase))
        throw new AppError(
          "WRONG_PHASE",
          "This action is not available at this stage.",
          409,
        );
      const lesson = await readOwned<Lesson>(
        "lessons",
        session.lessonId,
        ctx.ownerId,
      );
      if (input.action === "continue")
        return { session: { ...session, phase: "teaching" } };
      if (input.action === "start_transfer")
        return { session: { ...session, phase: "transfer" } };
      if (input.action === "hint") {
        if (session.hintUsed)
          throw new AppError(
            "HINT_USED",
            "You've used this session's hint. Try an example, or end for feedback.",
            409,
          );
        // A graduated process hint does not reveal a topic answer or call the model.
        return {
          session: {
            ...session,
            hintUsed: true,
            nextSequence: session.nextSequence + 1,
          },
          messages: [
            {
              id: randomUUID(),
              role: "student",
              text: "Could you pick one small example, walk me through what happens, and explain why each step follows? Start with the part you feel most sure about.",
              createdAt: new Date().toISOString(),
              sequence: session.nextSequence,
              kind: "hint",
            },
          ],
        };
      }
      const messages = await evidenceMessages(
        session,
        await readMessages(id, 20),
      );
      const report = await evaluate(
        session,
        lesson,
        messages,
        true,
        ctx,
        model,
      );
      return {
        session: { ...session, phase: "report", report, transferSkipped: true },
      };
    },
  );
  if (input.action === "end")
    await event(id, "session_completed", input.operationId);
}
export async function submitTransfer(
  id: string,
  input: z.infer<typeof TransferSchema>,
  ctx: CallContext,
  model: Model = gemini,
) {
  if (!input.skip && !input.answer.trim())
    throw new AppError(
      "ANSWER_REQUIRED",
      "Explain your answer, or choose Skip.",
    );
  await sessionOperation(
    ctx.ownerId,
    id,
    input.operationId,
    input.revision,
    input,
    async (session) => {
      if (session.phase !== "transfer")
        throw new AppError(
          "WRONG_PHASE",
          "The independent check is not available at this stage.",
          409,
        );
      const lesson = await readOwned<Lesson>(
        "lessons",
        session.lessonId,
        ctx.ownerId,
      );
      if (
        lesson.transfer.arithmetic === "cnn" &&
        !input.skip &&
        !input.parameters
      )
        throw new AppError(
          "NUMBERS_REQUIRED",
          "Enter the parameter count for each input.",
        );
      const learner: Message = {
        id: input.operationId,
        role: "learner",
        text: input.answer,
        sequence: session.nextSequence,
        createdAt: new Date().toISOString(),
        kind: "transfer",
      };
      // Save the answer before evaluation. Retrying the same operation overwrites this pending record, never adds a turn.
      await database()
        .collection("sessions")
        .doc(id)
        .collection("operations")
        .doc(input.operationId)
        .update({
          pendingAnswer: {
            answer: input.answer,
            skip: input.skip,
            parameters: input.parameters ?? null,
          },
        });
      const messages = [
        ...(await evidenceMessages(session, await readMessages(id, 20))),
        ...(input.skip ? [] : [learner]),
      ];
      const report = await evaluate(
        session,
        lesson,
        messages,
        input.skip,
        ctx,
        model,
        input.parameters,
      );
      return {
        session: {
          ...session,
          phase: "report",
          report,
          transferAnswerId: input.skip ? undefined : learner.id,
          transferSkipped: input.skip,
          nextSequence: session.nextSequence + (input.skip ? 0 : 1),
        },
        messages: input.skip ? [] : [learner],
      };
    },
  );
  await event(id, "transfer_submitted", input.operationId);
  await event(id, "session_completed", input.operationId);
}
