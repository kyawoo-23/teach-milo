import { z } from "zod";
import { conceptPairKey } from "./board-tools";
import {
  CreateMaterialSchema,
  LoginSchema,
  PrepareSchema,
  SignupSchema,
  TransferSchema,
  TurnSchema,
  UpdatePasswordSchema,
} from "./contracts";

export const formErrorMap: z.core.$ZodErrorMap = (issue) => {
  if (issue.code === "too_small" && issue.origin === "string")
    return issue.minimum === 1
      ? "This field is required."
      : `Enter at least ${issue.minimum} characters.`;
  if (issue.code === "too_big" && issue.origin === "string")
    return `Use at most ${issue.maximum} characters.`;
  return "Please check this value.";
};

export const authFormSchema = (signup: boolean) =>
  (signup ? SignupSchema : LoginSchema.extend({ name: z.string() }))
    .extend({ confirmPassword: z.string() })
    .superRefine((value, ctx) => {
      if (signup && value.password !== value.confirmPassword)
        ctx.addIssue({
          code: "custom",
          path: ["confirmPassword"],
          message: "Passwords do not match.",
        });
    });

export const PasswordFormSchema = UpdatePasswordSchema.safeExtend({
  confirmPassword: z.string(),
}).refine((value) => value.newPassword === value.confirmPassword, {
  path: ["confirmPassword"],
  message: "Passwords do not match.",
});

export const LearningFileSchema = z
  .custom<File>(
    (value) => typeof File !== "undefined" && value instanceof File,
    "Choose a learning document first.",
  )
  .refine(
    (file) =>
      typeof File !== "undefined" &&
      file instanceof File &&
      /\.(pdf|docx|txt)$/i.test(file.name),
    "Choose a PDF, DOCX, or TXT file.",
  )
  .refine(
    (file) =>
      typeof File !== "undefined" &&
      file instanceof File &&
      file.size > 0 &&
      file.size <= 10 * 1024 * 1024,
    "Choose a file smaller than 10 MB.",
  );

const lessonFields = PrepareSchema.pick({
  topic: true,
  level: true,
  teachingLanguage: true,
});
export const materialFormSchema = (upload: boolean) =>
  lessonFields.extend({
    notes: upload ? z.string() : CreateMaterialSchema.shape.text,
    file: LearningFileSchema.nullable().superRefine((file, ctx) => {
      if (upload && !file)
        ctx.addIssue({
          code: "custom",
          message: "Choose a learning document first.",
        });
    }),
  });
export const LessonReviewFormSchema = PrepareSchema.pick({
  sources: true,
}).superRefine(({ sources }, ctx) => {
  if (sources.reduce((sum, source) => sum + source.text.length, 0) > 50_000)
    ctx.addIssue({
      code: "custom",
      path: ["sources"],
      message: "Keep reviewed material within 50,000 characters.",
    });
  if (sources.every((source) => source.text.trim().length < 30))
    ctx.addIssue({
      code: "custom",
      path: ["sources", 0, "text"],
      message: "Include at least one passage of 30 characters.",
    });
});
export const ExplanationFormSchema = TurnSchema.pick({ text: true });
export const transferFormSchema = (fieldIds: string[]) =>
  z
    .object({
      answer: TransferSchema.shape.answer.refine(
        (value) => value.length > 0,
        "Explain your thinking before submitting.",
      ),
      numbers: z.record(z.string(), z.string()),
    })
    .superRefine(({ numbers }, ctx) => {
      for (const id of fieldIds) {
        const value = (numbers[id] ?? "").trim();
        if (!value || !Number.isFinite(Number(value)))
          ctx.addIssue({
            code: "custom",
            path: ["numbers", id],
            message: "Enter a number.",
          });
      }
    });
export const ConceptFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a concept.").max(100),
});
export const relationshipFormSchema = (
  ids: string[],
  links: { id: string; from: string; to: string }[] = [],
  currentId?: string,
) =>
  z
    .object({
      from: z.string().refine((id) => ids.includes(id), "Choose a concept."),
      to: z.string().refine((id) => ids.includes(id), "Choose a concept."),
      relation: z.string().trim().min(1, "Enter a relationship.").max(300),
    })
    .superRefine((value, ctx) => {
      if (value.from === value.to) {
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "Choose two different concepts.",
        });
        return;
      }
      if (
        links.some(
          (link) =>
            link.id !== currentId &&
            conceptPairKey(link.from, link.to) ===
              conceptPairKey(value.from, value.to),
        )
      )
        ctx.addIssue({
          code: "custom",
          path: ["to"],
          message: "These concepts are already connected.",
        });
    });
