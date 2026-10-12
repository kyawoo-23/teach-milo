import { lessonLanguage } from "./i18n/locales";
import { translate, localize } from "./i18n/messages";
import {
  dimensions,
  Lesson,
  Message,
  ReportGenerated,
  SessionReport,
} from "./contracts";
import { validCitations } from "./controller";
import { convolution } from "./cnn";

export function finalizeReport(
  raw: ReportGenerated,
  lesson: Lesson,
  messages: Message[],
  skipped: boolean,
  arithmetic?: { small: number; large: number },
): SessionReport {
  const locale = lessonLanguage(lesson.teachingLanguage);
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
  if (lesson.transfer.arithmetic === "cnn" && !skipped) {
    const expected = convolution(20, 5, 2, 4).parameters;
    const dimension = report.scores.transfer;
    if (!arithmetic) {
      dimension.score = null;
      dimension.status = "insufficient_evidence";
      dimension.explanation = localize(
        locale,
        "The numerical fields were not supplied, so arithmetic could not be independently checked.",
      );
    } else if (arithmetic.small !== expected || arithmetic.large !== expected) {
      if (dimension.score !== null)
        dimension.score = Math.min(dimension.score, 1) as 0 | 1;
      dimension.explanation += translate(
        locale,
        " The entered parameter counts were {small} and {large}; both should be {expected}.",
        { small: arithmetic.small, large: arithmetic.large, expected },
      );
      if (arithmetic.small !== arithmetic.large)
        report.criticalMisconception = true;
    }
  }
  report.strengths = report.strengths
    .map((s) => ({ ...s, citations: validCitations(s.citations, messages) }))
    .filter((s) => s.citations.length);
  report.nextSteps = report.nextSteps.map((s) => ({
    ...s,
    citations: validCitations(s.citations, messages),
  }));
  const assessed = dimensions.filter((d) => report.scores[d].score !== null);
  const earnedPoints = assessed.reduce(
    (sum, d) => sum + report.scores[d].score!,
    0,
  );
  const total = assessed.length === 5 ? earnedPoints : null;
  return {
    ...report,
    total,
    earnedPoints,
    availablePoints: assessed.length * 2,
    overallLabel:
      total !== null &&
      total >= 8 &&
      report.scores.transfer.score === 2 &&
      !report.criticalMisconception
        ? "strong_evidence"
        : skipped || assessed.length < 5
          ? "incomplete"
          : "developing",
    expectedTransferExplanation: lesson.transfer.expected,
    transferCorrect:
      report.scores.transfer.score === null
        ? null
        : report.scores.transfer.score === 2,
  };
}
