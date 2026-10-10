import {
  Citation,
  Ledger,
  Lesson,
  Message,
  Session,
  StudentReply,
} from "./contracts";
import { AppError } from "./errors";

export function validCitations(
  citations: Citation[],
  messages: Message[],
  kind?: "teaching" | "transfer",
) {
  return citations.filter((c) =>
    messages.some(
      (m) =>
        m.id === c.messageId &&
        m.role === "learner" &&
        (!kind || (m.kind || "teaching") === kind) &&
        m.text.includes(c.quote),
    ),
  );
}
export function allowedMoves(session: Session) {
  const moves = [
    "ask_explanation",
    "probe_mechanism",
    "request_example",
    "request_demo",
    "acknowledge",
    "redirect",
  ];
  if (
    session.phase !== "baseline" &&
    !session.challengeUsed &&
    session.ledger.misconceptionCorrection.length === 0 &&
    session.ledger.evidence.some((e) => e.citations.length)
  )
    moves.push("surface_misconception");
  return moves;
}
export function validateStudent(
  reply: StudentReply,
  session: Session,
  lesson: Lesson,
  messages: Message[],
): Ledger {
  if (
    !allowedMoves(session).includes(reply.move) ||
    reply.studentMessage.split(/\s+/).length > 65 ||
    (reply.studentMessage.match(/\?/g) || []).length > 1 ||
    /\b(mastered|\d+\s*\/\s*10)\b/i.test(reply.studentMessage)
  )
    throw new AppError(
      "MODEL_FAILURE",
      "Milo's response didn't fit the lesson. Please retry.",
      502,
    );
  const fields = [
    ...reply.evidence.flatMap((e) => e.citations),
    ...reply.mechanism,
    ...reply.demonstration,
    ...reply.misconceptionCorrection,
  ];
  if (validCitations(fields, messages, "teaching").length !== fields.length)
    throw new AppError(
      "MODEL_FAILURE",
      "Milo could not link the response to your explanation. Please retry.",
      502,
    );
  const ids = lesson.objectives.map((o) => o.id);
  if (
    new Set(reply.evidence.map((e) => e.objectiveId)).size !==
      reply.evidence.length ||
    reply.evidence.some(
      (e) =>
        !ids.includes(e.objectiveId) ||
        (e.understanding !== "missing" && !e.citations.length),
    )
  )
    throw new AppError(
      "MODEL_FAILURE",
      "Milo returned incomplete learning evidence. Please retry.",
      502,
    );
  const { studentMessage: _message, move: _move, ...ledger } = reply;
  return ledger;
}
export function readyForCheck(session: Session, lesson: Lesson) {
  return (
    lesson.concerns.length === 0 &&
    !session.ledger.unresolvedError &&
    lesson.objectives.every((o) =>
      session.ledger.evidence.some(
        (e) =>
          e.objectiveId === o.id &&
          e.understanding === "supported" &&
          e.citations.length > 0,
      ),
    ) &&
    session.ledger.mechanism.length > 0 &&
    session.ledger.demonstration.length > 0 &&
    (!session.challengeUsed ||
      session.ledger.misconceptionCorrection.length > 0)
  );
}
