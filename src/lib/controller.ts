import { lessonLanguage, type TeachingLanguage } from "./i18n/locales";
import { translateTeaching, type TranslationKey } from "./i18n/messages";
import { ThoughtEmotionSchema } from "./contracts";
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
    session.mode !== "teach" &&
    session.phase !== "baseline" &&
    !session.challengeUsed &&
    session.ledger.misconceptionCorrection.length === 0 &&
    session.ledger.evidence.some((e) => e.citations.length)
  )
    moves.push("surface_misconception");
  return moves;
}
// Keep greeting and reply limits consistent across spaced and unspaced languages.
export function greetLearner(opening: string, language?: TeachingLanguage) {
  const body = opening
    .replace(
      /^\s*(?:(?:xin chào|hello|helo|halo|greetings|hey|hai|hi|chào)\b[^.!?,\n]{0,40}[.!?,]|(?:你好|您好|嗨|こんにちは|こんばんは|おはようございます|안녕하세요|안녕|สวัสดี|မင်္ဂလာပါ)[！!。,.，、]?)[\s]*/i,
      "",
    )
    .trim();
  const locale = lessonLanguage(language);
  return `${translateTeaching(locale, "Hi!")} ${locale === "en" ? body.charAt(0).toUpperCase() + body.slice(1) : body}`;
}
export function replyWords(text: string, language?: TeachingLanguage) {
  return [
    ...new Intl.Segmenter(lessonLanguage(language), {
      granularity: "word",
    }).segment(text),
  ].filter((s) => s.isWordLike);
}
function limitReply(text: string, language?: TeachingLanguage) {
  const words = replyWords(text, language);
  return words.length > 65 ? text.slice(0, words[65].index).trim() : text;
}
const thoughtFallbacks: Record<StudentReply["move"], TranslationKey> = {
  ask_explanation: "I want to understand your explanation a little better.",
  probe_mechanism: "I'm still wondering why it works that way.",
  request_example: "I think a small example would help me follow your idea.",
  request_demo: "I think a small example would help me follow your idea.",
  surface_misconception: "I'm unsure whether my idea makes sense.",
  acknowledge: "Your explanation is helping me connect the ideas.",
  redirect: "I want to understand your explanation a little better.",
};
// Check the whole reason before shortening it, including schema names with altered separators.
const privateThought =
  /ledger|transfer|rubric|score|citation|ready|readiness|phase|misconception|script|planted|assess|grading|\bgrade\b|evidence|mechanism|demonstration|unresolved[\s_-]*error|objective[\s_-]*id|message[\s_-]*id|student[\s_-]*message|allowed[\s_-]*moves?|challenge[\s_-]*used|hint[\s_-]*used|summary|knowledge|criterion|criteria|\bunderstanding\b|\bmove\b|\bquote\b|评估|评分|准备好|误解|台账|評価|採点|誤解|ルーブリック|평가|점수|오개념|เกณฑ์|คะแนน/iu;

function normalizeThoughtReason(
  reason: string,
  move: StudentReply["move"],
  language?: TeachingLanguage,
) {
  const clean = reason
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean || privateThought.test(clean))
    return translateTeaching(language, thoughtFallbacks[move]);
  // Keep a single sentence, using the lesson language's word and sentence boundaries.
  const first =
    new Intl.Segmenter(lessonLanguage(language), { granularity: "sentence" })
      .segment(clean)
      [Symbol.iterator]()
      .next()
      .value?.segment.trim() || clean;
  const words = replyWords(first, language);
  const bounded =
    words.length > 40 ? first.slice(0, words[40].index).trim() : first;
  const chars = Array.from(bounded);
  return chars.length > 300
    ? chars.slice(0, 299).join("").trimEnd() + "…"
    : bounded;
}
export function normalizeStudentReply(
  reply: StudentReply,
  session: Session,
  lesson: Lesson,
  messages: Message[],
): StudentReply {
  const moves = allowedMoves(session);
  const move = (
    moves.includes(reply.move) ? reply.move : moves[0]
  ) as StudentReply["move"];
  let studentMessage = reply.studentMessage
    .replace(/\bmastered\b/gi, "understood")
    .replace(/完全掌握|精通/g, "理解")
    .replace(/完全に習得/g, "理解")
    .replace(/완전히\s*마스터|완전\s*숙달|완전히\s*습득/g, "이해")
    .replace(/เชี่ยวชาญอย่างสมบูรณ์|เข้าใจอย่างสมบูรณ์/g, "เข้าใจ")
    .replace(/thành thạo hoàn toàn|nắm vững hoàn toàn/gi, "hiểu")
    .replace(/menguasai sepenuhnya/gi, "memahami")
    .replace(/လုံးဝကျွမ်းကျင်/g, "နားလည်")
    .replace(/\d+\s*\/\s*10/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  const question = studentMessage.search(/[?？]/);
  if (question !== -1 && /[?？]/.test(studentMessage.slice(question + 1)))
    studentMessage = studentMessage.slice(0, question + 1).trim();
  studentMessage = limitReply(studentMessage, lesson.teachingLanguage);
  const keep = (citations: Citation[]) =>
    validCitations(citations, messages, "teaching");
  const ids = new Set(lesson.objectives.map((o) => o.id));
  const seen = new Set<string>();
  const mechanism = keep(reply.mechanism);
  const misconceptionCorrection = keep(reply.misconceptionCorrection);
  const evidence = reply.evidence.flatMap((item) => {
    if (!ids.has(item.objectiveId) || seen.has(item.objectiveId)) return [];
    seen.add(item.objectiveId);
    const citations = keep(item.citations);
    return [
      {
        ...item,
        citations,
        understanding: citations.length ? item.understanding : "missing",
      },
    ];
  });
  return {
    ...reply,
    move,
    emotion: ThoughtEmotionSchema.safeParse(reply.emotion).data ?? "curious",
    reason: normalizeThoughtReason(reply.reason, move, lesson.teachingLanguage),
    studentMessage:
      studentMessage ||
      translateTeaching(
        lesson.teachingLanguage,
        "Can you say a bit more about that?",
      ),
    mechanism,
    demonstration: keep(reply.demonstration).length
      ? keep(reply.demonstration)
      : inferDemonstration(mechanism, evidence),
    // An unrelated follow-up must not erase an already cited correction.
    // A newly identified fundamental error can still revoke that evidence.
    misconceptionCorrection:
      misconceptionCorrection.length || reply.unresolvedError
        ? misconceptionCorrection
        : keep(session.ledger.misconceptionCorrection),
    evidence,
  };
}
function inferDemonstration(
  mechanism: Citation[],
  evidence: StudentReply["evidence"],
): Citation[] {
  if (mechanism.length) return mechanism.slice(0, 3);
  return evidence
    .filter((item) => item.understanding === "supported")
    .flatMap((item) => item.citations)
    .sort((a, b) => b.quote.length - a.quote.length)
    .slice(0, 3);
}
export function inferLedgerGaps(ledger: Ledger): Ledger {
  if (ledger.demonstration.length) return ledger;
  const demonstration = inferDemonstration(ledger.mechanism, ledger.evidence);
  return demonstration.length ? { ...ledger, demonstration } : ledger;
}
export function validateStudent(
  reply: StudentReply,
  session: Session,
  lesson: Lesson,
  messages: Message[],
): Ledger {
  if (
    !allowedMoves(session).includes(reply.move) ||
    replyWords(reply.studentMessage, lesson.teachingLanguage).length > 65 ||
    (reply.studentMessage.match(/[?？]/g) || []).length > 1 ||
    /(?:\bmastered\b|\d+\s*\/\s*10|完全掌握|精通|完全に習得)/i.test(
      reply.studentMessage,
    )
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
  const {
    studentMessage: _message,
    move: _move,
    emotion: _emotion,
    reason: _reason,
    ...ledger
  } = reply;
  return ledger;
}
export function readyForCheck(session: Session, lesson: Lesson) {
  const ledger = inferLedgerGaps(session.ledger);
  return (
    !ledger.unresolvedError &&
    lesson.objectives.every((o) =>
      ledger.evidence.some(
        (e) =>
          e.objectiveId === o.id &&
          e.understanding === "supported" &&
          e.citations.length > 0,
      ),
    ) &&
    ledger.mechanism.length > 0 &&
    ledger.demonstration.length > 0 &&
    (!session.challengeUsed || ledger.misconceptionCorrection.length > 0)
  );
}
