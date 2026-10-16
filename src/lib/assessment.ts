import { dictionaryLocale } from "./i18n/locales";
import { translate, localize } from "./i18n/messages";
import {
  CitationSchema,
  Dimension,
  DimensionSchema,
  dimensions,
  Lesson,
  Message,
  ReportGenerated,
  ReportGeneratedSchema,
  SessionReport,
} from "./contracts";
import { z } from "zod";
import { validCitations } from "./controller";
import { formatBoardNumber } from "./boards";

// Constrain citation selection before generation, as well as validating it
// afterwards. Transfer evidence must never supply a teaching skill's score.
export function reportSchemaForMessages(messages: Message[]) {
  const forKind = (kind: "teaching" | "transfer") => {
    const ids = messages
      .filter((m) => m.role === "learner" && (m.kind || "teaching") === kind)
      .map((m) => m.id);
    return ids.length
      ? DimensionSchema.extend({
          citations: z
            .array(CitationSchema.extend({ messageId: z.enum(ids) }))
            .max(3),
        })
      : DimensionSchema;
  };
  const teaching = forKind("teaching");
  return ReportGeneratedSchema.extend({
    scores: z.object({
      accuracy: teaching,
      mechanism: teaching,
      evidence: teaching,
      misconception: teaching,
      transfer: forKind("transfer"),
    }),
  });
}

export const withinTolerance = (
  value: number,
  expected: number,
  tolerance: number,
) =>
  Math.abs(value - expected) <=
  tolerance + 1e-9 * Math.max(1, Math.abs(expected));

export function finalizeReport(
  raw: ReportGenerated,
  lesson: Lesson,
  messages: Message[],
  skipped: boolean,
  answers?: Record<string, number>,
  excluded: Dimension[] = [],
): SessionReport {
  const locale = dictionaryLocale(lesson.teachingLanguage);
  const report = structuredClone(raw);
  for (const name of dimensions) {
    const item = report.scores[name];
    item.citations = validCitations(
      item.citations,
      messages,
      name === "transfer" ? "transfer" : "teaching",
    );
    if (!item.citations.length || (name === "transfer" && skipped)) {
      item.score = null;
      item.status = "insufficient_evidence";
      item.explanation =
        name === "transfer" && skipped
          ? localize(
              locale,
              "The independent check was skipped, so there is no unaided transfer evidence.",
            )
          : localize(
              locale,
              "There is not enough cited learner evidence to assess this dimension.",
            );
    }
    if (item.status !== "assessed") item.score = null;
    if (item.score === null && item.status === "assessed")
      item.status = "uncertain";
  }
  if (lesson.concerns.length)
    for (const name of ["accuracy", "transfer"] as const)
      if (report.scores[name].status !== "insufficient_evidence") {
        report.scores[name].score = null;
        report.scores[name].status = "uncertain";
        report.scores[name].explanation = localize(
          locale,
          "The source material has unresolved factual concerns. This judgment is withheld until those concerns are clarified.",
        );
      }
  const fields = lesson.transfer.numeric?.fields ?? [];
  if (fields.length && !skipped) {
    const dimension = report.scores.transfer;
    if (!answers || fields.some((f) => answers[f.id] === undefined)) {
      dimension.score = null;
      dimension.status = "insufficient_evidence";
      dimension.explanation = localize(
        locale,
        "The numerical fields were not supplied, so arithmetic could not be independently checked.",
      );
    } else
      for (const f of fields)
        if (!withinTolerance(answers[f.id], f.expected, f.tolerance)) {
          if (dimension.score !== null)
            dimension.score = Math.min(dimension.score, 1) as 0 | 1;
          dimension.explanation += translate(
            locale,
            " {label}: you entered {submitted}; the expected value is {expected}.",
            {
              label: f.label,
              submitted: `${answers[f.id]}${f.unit ? ` ${f.unit}` : ""}`,
              expected: `${formatBoardNumber(f.expected, 6)}${f.unit ? ` ${f.unit}` : ""}`,
            },
          );
        }
  }
  report.strengths = report.strengths
    .map((s) => ({ ...s, citations: validCitations(s.citations, messages) }))
    .filter((s) => s.citations.length);
  report.nextSteps = report.nextSteps.map((s) => ({
    ...s,
    citations: validCitations(s.citations, messages),
  }));
  // Skills left out of this session never count toward the total or its maximum.
  for (const name of excluded)
    report.scores[name] = {
      score: null,
      status: "insufficient_evidence",
      citations: [],
      explanation: localize(
        locale,
        "Not part of this lesson — you chose to teach without Milo’s mix-up.",
      ),
    };
  const included = dimensions.filter((d) => !excluded.includes(d));
  const maxTotal = included.length * 2;
  const assessed = included.filter((d) => report.scores[d].score !== null);
  const earnedPoints = assessed.reduce(
    (sum, d) => sum + report.scores[d].score!,
    0,
  );
  const total = assessed.length === included.length ? earnedPoints : null;
  return {
    ...report,
    total,
    earnedPoints,
    maxTotal,
    excluded,
    availablePoints: assessed.length * 2,
    overallLabel:
      total !== null &&
      total >= 0.8 * maxTotal &&
      report.scores.transfer.score === 2 &&
      !report.criticalMisconception
        ? "strong_evidence"
        : skipped || assessed.length < included.length
          ? "incomplete"
          : "developing",
    expectedTransferExplanation: lesson.transfer.expected,
    transferCorrect:
      report.scores.transfer.score === null
        ? null
        : report.scores.transfer.score === 2,
  };
}
