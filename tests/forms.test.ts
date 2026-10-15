import { describe, expect, it } from "vitest";
import {
  authFormSchema,
  materialFormSchema,
  LessonReviewFormSchema,
  ExplanationFormSchema,
  transferFormSchema,
  relationshipFormSchema,
} from "@/lib/form-schemas";

describe("client form validation", () => {
  it("requires confirmation only for signup and never trims passwords", () => {
    const values = {
      name: " Ada ",
      email: " ada@example.test ",
      password: " password ",
      confirmPassword: "password",
    };
    expect(authFormSchema(true).safeParse(values).success).toBe(false);
    expect(authFormSchema(false).parse(values)).toMatchObject({
      email: "ada@example.test",
      password: " password ",
    });
    expect(
      authFormSchema(true).parse({
        ...values,
        confirmPassword: values.password,
      }).name,
    ).toBe("Ada");
    expect(
      authFormSchema(true).safeParse({
        ...values,
        name: " ",
        password: "short",
        confirmPassword: "short",
      }).success,
    ).toBe(false);
  });

  it("validates the active material method, file type/size and canonical level", () => {
    const base = {
      topic: " Photosynthesis ",
      level: "introductory",
      teachingLanguage: "en",
      file: null,
      notes: "A".repeat(30),
    };
    expect(materialFormSchema(false).parse(base).topic).toBe("Photosynthesis");
    expect(
      materialFormSchema(false).safeParse({ ...base, notes: "short" }).success,
    ).toBe(false);
    expect(
      materialFormSchema(false).safeParse({ ...base, topic: " " }).success,
    ).toBe(false);
    expect(
      materialFormSchema(false).safeParse({ ...base, level: "入门" }).success,
    ).toBe(false);
    expect(materialFormSchema(true).safeParse(base).success).toBe(false);
    expect(
      materialFormSchema(true).safeParse({
        ...base,
        notes: "",
        file: new File(["source"], "notes.TXT"),
      }).success,
    ).toBe(true);
    expect(
      materialFormSchema(true).safeParse({
        ...base,
        file: new File(["presentation"], "lesson.PPTX"),
      }).success,
    ).toBe(true);
    for (const file of [
      new File(["source"], "notes.exe"),
      new File([], "empty.txt"),
      new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.pdf"),
    ])
      expect(
        materialFormSchema(true).safeParse({ ...base, file }).success,
      ).toBe(false);
    expect(
      materialFormSchema(true).safeParse({ ...base, file: {} }).success,
    ).toBe(false);
  });

  it("bounds the complete reviewed material while allowing a short source alongside a usable passage", () => {
    const source = {
      id: "s1",
      label: "Notes",
      text: "A".repeat(30),
      warnings: [],
    };
    expect(LessonReviewFormSchema.safeParse({ sources: [] }).success).toBe(
      false,
    );
    expect(
      LessonReviewFormSchema.safeParse({ sources: [{ ...source, text: " " }] })
        .success,
    ).toBe(false);
    expect(
      LessonReviewFormSchema.safeParse({
        sources: [source, { ...source, id: "s2", text: "Short" }],
      }).success,
    ).toBe(true);
    expect(
      LessonReviewFormSchema.safeParse({
        sources: [{ ...source, text: "A".repeat(50_000) }, source],
      }).success,
    ).toBe(false);
  });

  it("requires explanatory text and rejects blank, fractional or unsafe numeric answers", () => {
    expect(ExplanationFormSchema.safeParse({ text: " " }).success).toBe(false);
    expect(
      ExplanationFormSchema.safeParse({ text: "A".repeat(2001) }).success,
    ).toBe(false);
    expect(
      ExplanationFormSchema.parse({ text: " Because weights are reused. " })
        .text,
    ).toBe("Because weights are reused.");
    const values = {
      answer: " Because weights are reused. ",
      numbers: { distance: "150", time: "-2.5" },
    };
    const numeric = transferFormSchema(["distance", "time"]);
    expect(numeric.parse(values).answer).toBe("Because weights are reused.");
    for (const distance of ["", " ", "abc", "Infinity"]) {
      const result = numeric.safeParse({
        ...values,
        numbers: { ...values.numbers, distance },
      });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0].path).toEqual(["numbers", "distance"]);
    }
    expect(
      numeric.safeParse({ ...values, numbers: { distance: "150" } }).success,
    ).toBe(false);
    expect(
      transferFormSchema([]).safeParse({ ...values, numbers: {} }).success,
    ).toBe(true);
    expect(
      transferFormSchema([]).safeParse({ ...values, answer: " " }).success,
    ).toBe(false);
  });

  it("rejects deleted concepts and self relationships before creating links", () => {
    const schema = relationshipFormSchema(["a", "b"]);
    expect(
      schema.safeParse({ from: "a", to: "a", relation: "causes" }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ from: "a", to: "deleted", relation: "causes" })
        .success,
    ).toBe(false);
    expect(
      schema.safeParse({ from: "a", to: "b", relation: " " }).success,
    ).toBe(false);
    expect(
      schema.parse({ from: "a", to: "b", relation: " causes " }).relation,
    ).toBe("causes");
    const taken = relationshipFormSchema(
      ["a", "b", "c"],
      [{ id: "edge", from: "a", to: "b" }],
    );
    expect(
      taken.safeParse({ from: "b", to: "a", relation: "reverses" }).success,
    ).toBe(false);
    expect(
      relationshipFormSchema(
        ["a", "b"],
        [{ id: "edge", from: "a", to: "b" }],
        "edge",
      ).safeParse({ from: "b", to: "a", relation: "reverses" }).success,
    ).toBe(true);
  });
});
