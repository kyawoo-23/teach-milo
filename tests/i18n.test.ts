import { prepareOperationPayload } from "@/server/lessons";
import { describe, expect, it } from "vitest";
import { dictionaries, localizeError, translate } from "@/lib/i18n/messages";
import {
  formatDate,
  formatNumber,
  lessonLanguage,
  locales,
  resolveLocale,
} from "@/lib/i18n/locales";
import { PrepareSchema, publicLesson, TurnSchema } from "@/lib/contracts";
import {
  greetLearner,
  normalizeStudentReply,
  replyWords,
  validateStudent,
} from "@/lib/controller";
import { finalizeReport } from "@/lib/assessment";
import { localizedCnnBoard, localizedCnnTransfer } from "@/content/cnn";
import { textBoard } from "@/lib/boards";
import { languageInstruction } from "@/content/prompts";
import { AppError } from "@/lib/errors";
import {
  lessonFixture,
  messageFixture,
  replyFixture,
  reportFixture,
  sessionFixture,
} from "./fixtures";

describe("website locales", () => {
  it("has complete dictionaries with matching interpolation parameters", () => {
    const keys = Object.keys(dictionaries.en).sort();
    for (const locale of locales) {
      expect(Object.keys(dictionaries[locale]).sort()).toEqual(keys);
      for (const key of keys as (keyof typeof dictionaries.en)[]) {
        expect(dictionaries[locale][key].trim()).not.toBe("");
        const params = (text: string) =>
          [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
        expect(params(dictionaries[locale][key])).toEqual(
          params(dictionaries.en[key]),
        );
      }
    }
  });
  it("prefers a valid cookie, then weighted supported browser preferences, then English", () => {
    expect(resolveLocale("ja", "zh-CN,en;q=0.8")).toBe("ja");
    expect(resolveLocale("bogus", "de-DE,zh-TW;q=0.7,ja;q=0.9")).toBe("ja");
    expect(resolveLocale(undefined, "en;q=0,ja-JP;q=0.8")).toBe("ja");
    expect(resolveLocale(undefined, "zh-Hans-CN")).toBe("zh-CN");
    expect(resolveLocale(undefined, "fr-FR")).toBe("en");
    expect(resolveLocale(undefined, "ja;q=invalid,en;q=0.5")).toBe("en");
    expect(resolveLocale(undefined, "ko-KR,en;q=0.5")).toBe("ko");
    expect(resolveLocale("th", "ja")).toBe("th");
    expect(resolveLocale(undefined, "th-TH,en;q=0.8")).toBe("th");
    expect(resolveLocale(undefined, "vi-VN,en;q=0.2")).toBe("en");
    expect(resolveLocale(undefined, "my,id;q=0.9")).toBe("en");
  });
  it("interpolates without interpreting supplied text as markup", () => {
    expect(
      translate("ja", "Teaching language: {language}", {
        language: "简体中文",
      }),
    ).toBe("教える言語：简体中文");
    expect(formatNumber("zh-CN", 194400)).toBe("194,400");
    expect(
      formatDate("ja", "2026-10-12T00:00:00Z", {
        timeZone: "UTC",
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
    ).toContain("2026年10月12日");
  });
  it("preserves API error codes and English messages while translating optional descriptors", () => {
    const error = new AppError(
      "INVALID_BOARD",
      "The board inputs have changed. Reset the board.",
      409,
    );
    expect(error.messageKey).toBe(error.message);
    expect(error.code).toBe("INVALID_BOARD");
    expect(localizeError("ja", error)).toContain("リセット");
    const interpolated = new AppError(
      "ERROR",
      "Original diagnostic",
      400,
      undefined,
      "Move {item} up",
      { item: "項目" },
    );
    expect(localizeError("ja", interpolated)).toBe("項目を上に移動");
    expect(localizeError("en", new Error("Unrecognized diagnostic"))).toBe(
      "Unrecognized diagnostic",
    );
    expect(localizeError("zh-CN", new Error("Unrecognized diagnostic"))).toBe(
      translate("zh-CN", "Something went wrong. Please retry."),
    );
  });
});

describe("fixed teaching language", () => {
  it("defaults legacy records and clients to English and accepts short CJK topics", () => {
    const lesson = lessonFixture();
    expect(lessonLanguage(lesson.teachingLanguage)).toBe("en");
    expect(publicLesson(lesson).teachingLanguage).toBe("en");
    const input = {
      operationId: lesson.id,
      materialId: lesson.materialId,
      topic: "光",
      level: lesson.level,
      sources: lesson.sources,
    };
    expect(PrepareSchema.parse(input).teachingLanguage).toBe("en");
    expect(
      JSON.stringify(prepareOperationPayload(PrepareSchema.parse(input))),
    ).toBe(JSON.stringify({ type: "prepare", ...input }));
    expect(
      prepareOperationPayload(
        PrepareSchema.parse({ ...input, teachingLanguage: "zh-CN" }),
      ),
    ).not.toEqual(
      prepareOperationPayload(
        PrepareSchema.parse({ ...input, teachingLanguage: "ja" }),
      ),
    );
    expect(
      PrepareSchema.parse({ ...input, teachingLanguage: "ja" })
        .teachingLanguage,
    ).toBe("ja");
    expect(PrepareSchema.safeParse({ ...input, topic: " " }).success).toBe(
      false,
    );
    expect(
      PrepareSchema.safeParse({ ...input, teachingLanguage: "fr" }).success,
    ).toBe(false);
    expect(
      PrepareSchema.parse({ ...input, teachingLanguage: "my" })
        .teachingLanguage,
    ).toBe("my");
    expect(
      PrepareSchema.safeParse({ ...input, teachingLanguage: "zh-TW" }).success,
    ).toBe(false);
    expect(
      TurnSchema.safeParse({
        operationId: lesson.id,
        revision: 0,
        text: "Explain",
        teachingLanguage: "ja",
      }).success,
    ).toBe(false);
  });
  it.each(["zh-CN", "ja"] as const)(
    "localizes deterministic content in %s without changing arithmetic",
    (locale) => {
      const lesson = { ...lessonFixture(), teachingLanguage: locale };
      const message = messageFixture(
        locale === "ja"
          ? "同じ重みを各位置で使います。"
          : "每个位置重复使用相同权重。",
      );
      const transfer = localizedCnnTransfer(locale);
      expect(transfer.arithmetic).toBe("cnn");
      expect(transfer.expected).toContain("204");
      expect(transfer.question).not.toBe(localizedCnnTransfer("en").question);
      expect(localizedCnnBoard(locale).title).not.toBe(
        localizedCnnBoard("en").title,
      );
      expect(textBoard(locale).instruction).not.toBe(textBoard().instruction);
      lesson.transfer = transfer;
      const report = finalizeReport(
        reportFixture(message),
        lesson,
        [message],
        true,
      );
      expect(report.scores.transfer.explanation).toBe(
        translate(
          locale,
          "The independent check was skipped, so there is no unaided transfer evidence.",
        ),
      );
      expect(report.expectedTransferExplanation).toBe(transfer.expected);
      expect(report.scores.accuracy.citations[0].quote).toBe(message.text);
      expect(languageInstruction(locale)).toContain(
        locale === "ja" ? "Japanese" : "Simplified Chinese",
      );
    },
  );
  it("localizes canned teaching copy for languages without a site catalog", () => {
    expect(languageInstruction("vi")).toContain("Vietnamese");
    expect(languageInstruction("my")).toContain("Burmese");
    expect(textBoard("my").title).not.toBe(textBoard("en").title);
    expect(textBoard("my").instruction).not.toBe(textBoard().instruction);
    expect(localizedCnnBoard("my").title).not.toBe(
      localizedCnnBoard("en").title,
    );
    expect(localizedCnnTransfer("id").expected).toContain("204");
    expect(localizedCnnTransfer("vi").question).not.toBe(
      localizedCnnTransfer("en").question,
    );
    expect(
      greetLearner("မင်္ဂလာပါ! ကွန်ဗိုလူးရှင်းကို သင်ပေးပါ။", "my"),
    ).toMatch(/^မင်္ဂလာပါ!/);
  });
  it("adds a single localized greeting", () => {
    expect(greetLearner("こんにちは！光について教えて？", "ja")).toBe(
      "こんにちは！ 光について教えて？",
    );
    expect(greetLearner("你好！能教我卷积吗？", "zh-CN")).toBe(
      "你好！ 能教我卷积吗？",
    );
  });
  it.each(["zh-CN", "ja"] as const)(
    "handles word boundaries and full-width questions in %s without modifying citations",
    (locale) => {
      const lesson = { ...lessonFixture(), teachingLanguage: locale };
      const session = sessionFixture(lesson);
      const message = messageFixture("学习者の原文保持。");
      const raw = {
        ...replyFixture(message),
        studentMessage: "为什么？どうして?",
      };
      expect(() => validateStudent(raw, session, lesson, [message])).toThrow();
      const normalized = normalizeStudentReply(raw, session, lesson, [message]);
      expect(normalized.studentMessage).toBe("为什么？");
      expect(normalized.evidence[0].citations[0].quote).toBe(message.text);
      expect(() =>
        validateStudent(normalized, session, lesson, [message]),
      ).not.toThrow();
      const long = (
        locale === "ja" ? "これは大事な説明です。" : "这是重要的解释。"
      ).repeat(70);
      expect(replyWords(long, locale).length).toBeGreaterThan(65);
      const trimmed = normalizeStudentReply(
        { ...raw, studentMessage: long },
        session,
        lesson,
        [message],
      );
      expect(
        replyWords(trimmed.studentMessage, locale).length,
      ).toBeLessThanOrEqual(65);
      const empty = normalizeStudentReply(
        { ...raw, studentMessage: " " },
        session,
        lesson,
        [message],
      );
      expect(empty.studentMessage).toBe(
        translate(locale, "Can you say a bit more about that?"),
      );
    },
  );
});
