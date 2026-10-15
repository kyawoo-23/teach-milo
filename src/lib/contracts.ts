import { z } from "zod";
import {
  teachingLanguages,
  lessonLanguage,
  type TeachingLanguage,
} from "./i18n/locales";
import { ToolStateSchema, BOARD_PNG_BYTES, type ToolKind } from "./board-tools";
export const TeachingLanguageSchema = z.enum(teachingLanguages);

export const Id = z.string().uuid();
export const Level = z.enum(["introductory", "intermediate", "advanced"]);
export const Phase = z.enum([
  "preparing",
  "baseline",
  "teaching",
  "ready_for_check",
  "transfer",
  "report",
]);
export type Phase = z.infer<typeof Phase>;
export const CitationSchema = z.object({
  messageId: Id,
  quote: z.string().min(1).max(500),
});
export type Citation = z.infer<typeof CitationSchema>;
export const SourceSchema = z.object({
  id: z.string(),
  label: z.string(),
  text: z.string().max(50_000),
  warnings: z.array(z.string().max(400)).max(20),
});
export type Source = z.infer<typeof SourceSchema>;
const Ref = z.string().regex(/^[a-z][a-z0-9_]{0,30}$/);
const BoardItemSchema = z.object({
  id: z.string().max(40),
  label: z.string().max(100),
  detail: z.string().max(300),
});
export type BoardItem = z.infer<typeof BoardItemSchema>;
// Gemini structured output rejects minimum/maximum on numeric fields in large
// schemas, so bounds and steps are validated by compileBoard instead.
export const BoardStateSchema = z.object({
  id: Ref,
  label: z.string().max(80),
  unit: z.string().max(30),
  type: z.enum(["number", "boolean", "choice"]),
  initial: z.number(),
  min: z.number(),
  max: z.number(),
  step: z.number(),
  options: z.array(z.string().max(60)).max(8),
});
export type BoardState = z.infer<typeof BoardStateSchema>;
export const BoardNodeSchema = z.object({
  id: z.string().max(40),
  parentId: z.string().max(40),
  component: z.string().max(40),
  props: z
    .array(z.object({ key: z.string().max(40), value: z.string().max(300) }))
    .max(12),
  items: z.array(BoardItemSchema).max(10),
});
export type BoardNode = z.infer<typeof BoardNodeSchema>;
// The model-facing shape omits version: Gemini structured output lacks const.
export const BoardGeneratedSchema = z.object({
  title: z.string().max(100),
  instruction: z.string().max(350),
  assumptions: z.string().max(500),
  state: z.array(BoardStateSchema).max(8),
  derived: z
    .array(
      z.object({
        id: Ref,
        label: z.string().max(80),
        unit: z.string().max(30),
      }),
    )
    .max(8),
  code: z.string().max(12_000),
  nodes: z.array(BoardNodeSchema).max(40),
  suggestedTool: z.object({
    kind: z.enum(["none", "sketch", "concept_map", "matching", "table"]),
    items: z.array(BoardItemSchema).max(10),
    columns: z.array(z.string().max(60)).max(5),
  }),
});
export type BoardGenerated = z.infer<typeof BoardGeneratedSchema>;
export const BoardSchema = BoardGeneratedSchema.extend({
  version: z.literal(2),
});
export type Board = z.infer<typeof BoardSchema>;
export const BoardCompositeValueSchema = z.union([
  z.array(z.string().max(40)).max(10),
  z.record(z.string().max(40), z.string().max(60)),
  z.string().max(40),
]);
export type BoardCompositeValue = z.infer<typeof BoardCompositeValueSchema>;
export const BoardStateSubmissionSchema = z
  .object({
    version: z.literal(3),
    state: z
      .record(z.string().max(40), z.number().finite())
      .refine((v) => Object.keys(v).length <= 8),
    composites: z
      .record(z.string().max(40), BoardCompositeValueSchema)
      .refine((v) => Object.keys(v).length <= 10),
  })
  .strict();
export type BoardStateSubmission = z.infer<typeof BoardStateSubmissionSchema>;
export const WorkspaceSubmissionSchema = z
  .object({
    version: z.literal(2),
    inputs: z.record(z.string(), z.never()),
    state: ToolStateSchema,
    png: z
      .string()
      .max(Math.ceil(BOARD_PNG_BYTES / 3) * 4)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
  })
  .strict()
  .refine(
    (s) => !s.png || s.state.kind === "sketch",
    "Only sketches can include an image.",
  );
export const BoardSubmissionSchema = z.discriminatedUnion("version", [
  WorkspaceSubmissionSchema,
  BoardStateSubmissionSchema,
]);
export type BoardSubmission = z.infer<typeof BoardSubmissionSchema>;
export const BoardOutputSchema = z
  .object({
    metrics: z
      .record(z.string().max(40), z.number().finite())
      .refine((v) => Object.keys(v).length <= 10),
  })
  .strict();
export type BoardOutput = z.infer<typeof BoardOutputSchema>;
export type BoardDisplay = { label: string; value: string; unit?: string }[];
export type BoardSnapshot = BoardSubmission & {
  kind: "board" | ToolKind;
  verified: boolean;
  metrics?: Record<string, number>;
  imageUrl?: string;
  display?: BoardDisplay;
};
export const NumericFieldSchema = z.object({
  id: Ref,
  label: z.string().max(80),
  unit: z.string().max(30),
  expected: z.number(),
  tolerance: z.number(),
});
export type NumericField = z.infer<typeof NumericFieldSchema>;
export const NumericTransferSchema = z.object({
  fields: z.array(NumericFieldSchema).max(4),
  inputs: z.array(z.object({ id: Ref, value: z.number() })).max(8),
  code: z.string().max(12_000),
});
export type NumericTransfer = z.infer<typeof NumericTransferSchema>;

export const LessonGeneratedSchema = z.object({
  title: z.string().min(3).max(100),
  scope: z.string().max(500),
  objectives: z
    .array(
      z.object({
        id: z.string().regex(/^o[1-3]$/),
        label: z.string().max(140),
        criterion: z.string().max(700),
        sourceIds: z.array(z.string()).min(1).max(10),
      }),
    )
    .min(2)
    .max(3),
  knowledge: z.string().min(20).max(7000),
  concerns: z.array(z.string().max(500)).max(5),
  misconception: z.string().min(10).max(400),
  misconceptionCorrection: z.string().min(10).max(700),
  opening: z.string().min(10).max(400),
  transfer: z.object({
    question: z.string().min(10).max(1200),
    expected: z.string().min(10).max(2200),
    criteria: z.array(z.string().max(500)).min(1).max(5),
    numeric: NumericTransferSchema,
  }),
  board: BoardGeneratedSchema,
});
export type LessonGenerated = z.infer<typeof LessonGeneratedSchema>;
export type Material = {
  id: string;
  ownerId: string;
  name: string;
  sources: Source[];
  text: string;
  expiresAt: string;
  createdAt: string;
};
export type Lesson = Omit<LessonGenerated, "board"> & {
  board: Board;
  id: string;
  ownerId: string;
  materialId: string;
  level: z.infer<typeof Level>;
  teachingLanguage?: TeachingLanguage;
  sources: Source[];
  expiresAt: string;
  createdAt: string;
  confirmed: boolean;
};
export type LessonPublic = Pick<
  Lesson,
  "id" | "title" | "scope" | "level" | "concerns" | "teachingLanguage"
> & { objectives: { id: string; label: string }[] };
export type Message = {
  id: string;
  role: "learner" | "student";
  text: string;
  createdAt: string;
  sequence: number;
  board?: BoardSnapshot;
  kind?: "teaching" | "transfer" | "hint";
  move?: "request_demo";
};
export const EvidenceSchema = z.object({
  objectiveId: z.string(),
  understanding: z.enum(["missing", "partial", "supported"]),
  citations: z.array(CitationSchema).max(3),
});
export const StudentReplySchema = z.object({
  studentMessage: z.string().min(1).max(500),
  move: z.enum([
    "ask_explanation",
    "probe_mechanism",
    "request_example",
    "surface_misconception",
    "request_demo",
    "acknowledge",
    "redirect",
  ]),
  evidence: z.array(EvidenceSchema).max(3),
  mechanism: z.array(CitationSchema).max(3),
  demonstration: z.array(CitationSchema).max(3),
  misconceptionCorrection: z.array(CitationSchema).max(3),
  unresolvedError: z.boolean(),
  unresolvedErrorDetail: z.string().max(400),
  summary: z.string().max(2000),
});
export type StudentReply = z.infer<typeof StudentReplySchema>;
export type Ledger = Pick<
  StudentReply,
  | "evidence"
  | "mechanism"
  | "demonstration"
  | "misconceptionCorrection"
  | "unresolvedError"
  | "unresolvedErrorDetail"
  | "summary"
>;
export const dimensions = [
  "accuracy",
  "mechanism",
  "evidence",
  "misconception",
  "transfer",
] as const;
export type Dimension = (typeof dimensions)[number];
export const DimensionSchema = z.object({
  score: z.union([z.literal(0), z.literal(1), z.literal(2), z.null()]),
  status: z.enum(["assessed", "insufficient_evidence", "uncertain"]),
  explanation: z.string().max(800),
  citations: z.array(CitationSchema).max(3),
});
const FeedbackSchema = z.object({
  text: z.string().max(600),
  citations: z.array(CitationSchema).max(3),
});
export const ReportGeneratedSchema = z.object({
  scores: z.object({
    accuracy: DimensionSchema,
    mechanism: DimensionSchema,
    evidence: DimensionSchema,
    misconception: DimensionSchema,
    transfer: DimensionSchema,
  }),
  criticalMisconception: z.boolean(),
  strengths: z.array(FeedbackSchema).max(3),
  nextSteps: z.array(FeedbackSchema).min(1).max(3),
});
export type ReportGenerated = z.infer<typeof ReportGeneratedSchema>;
export type SessionReport = ReportGenerated & {
  total: number | null;
  // Points possible across the skills this session assesses (10 when all five apply).
  maxTotal?: number;
  // Skills left out of this session, e.g. the misconception in "teach" mode.
  excluded?: Dimension[];
  availablePoints: number;
  earnedPoints: number;
  overallLabel: "strong_evidence" | "developing" | "incomplete";
  expectedTransferExplanation: string;
  transferCorrect: boolean | null;
};
// "correct": Milo opens with the lesson misconception for the learner to fix.
// "teach": Milo never raises a misconception. Missing on older sessions (raised mid-chat).
export const SessionModeSchema = z.enum(["correct", "teach"]);
export type SessionMode = z.infer<typeof SessionModeSchema>;
export type Session = {
  id: string;
  ownerId: string;
  lessonId: string;
  mode?: SessionMode;
  lessonSummary?: Pick<
    LessonPublic,
    "title" | "scope" | "level" | "objectives" | "teachingLanguage"
  >;
  phase: Phase;
  revision: number;
  nextSequence: number;
  challengeUsed: boolean;
  hintUsed: boolean;
  ledger: Ledger;
  expiresAt: string;
  createdAt: string;
  updatedAt: string;
  report?: SessionReport;
  transferAnswerId?: string;
  transferSkipped?: boolean;
  activeOperation?: { id: string; token: string; until: number };
};
export type SessionPublic = Pick<
  Session,
  | "id"
  | "phase"
  | "revision"
  | "challengeUsed"
  | "hintUsed"
  | "expiresAt"
  | "mode"
> & {
  lesson: LessonPublic;
  messages: Message[];
  nextCursor?: number;
  progress: {
    id: string;
    label: string;
    status: "missing" | "partial" | "supported";
  }[];
  board?: Board;
  transferQuestion?: string;
  numericFields?: Pick<NumericField, "id" | "label" | "unit">[];
  report?: SessionReport;
  pending: boolean;
};
export type SessionUpdate =
  | SessionPublic
  | {
      unchanged: true;
      revision: number;
      pending: boolean;
    };
export const CreateMaterialSchema = z
  .object({
    text: z.string().min(30).max(50_000),
    name: z.string().max(120).default("Pasted notes"),
  })
  .strict();
export const PrepareSchema = z
  .object({
    operationId: Id,
    materialId: Id,
    topic: z.string().trim().min(1).max(200),
    teachingLanguage: TeachingLanguageSchema.default("en"),
    level: Level,
    sources: z.array(SourceSchema).min(1).max(100),
  })
  .strict();
export const TurnSchema = z
  .object({
    operationId: Id,
    revision: z.number().int().nonnegative(),
    text: z.string().trim().min(1).max(2000),
    board: BoardSubmissionSchema.optional(),
  })
  .strict();
export const ActionSchema = z
  .object({
    operationId: Id,
    revision: z.number().int().nonnegative(),
    action: z.enum(["hint", "continue", "start_transfer", "end"]),
  })
  .strict();
export const TransferSchema = z
  .object({
    operationId: Id,
    revision: z.number().int().nonnegative(),
    answer: z.string().trim().max(4000),
    skip: z.boolean(),
    answers: z
      .record(z.string().max(40), z.number().finite())
      .refine((v) => Object.keys(v).length <= 4)
      .optional(),
  })
  .strict();
export const emptyLedger = (): Ledger => ({
  evidence: [],
  mechanism: [],
  demonstration: [],
  misconceptionCorrection: [],
  unresolvedError: false,
  unresolvedErrorDetail: "",
  summary: "",
});
export const publicLesson = (lesson: Lesson): LessonPublic => ({
  id: lesson.id,
  title: lesson.title,
  scope: lesson.scope,
  level: lesson.level,
  teachingLanguage: lessonLanguage(lesson.teachingLanguage),
  concerns: lesson.concerns,
  objectives: lesson.objectives.map(({ id, label }) => ({ id, label })),
});

export const UserPublicSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string(),
  avatarUrl: z.string().optional(),
  hasPassword: z.boolean().optional(),
});
export type UserPublic = z.infer<typeof UserPublicSchema>;

export type GuestPublic = { id: string; expiresAt: string };
export type AuthIdentity = {
  user: UserPublic | null;
  guest: GuestPublic | null;
  claim?: { fromOwnerId: string; status: "pending" | "complete" };
};

export const SessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  scope: z.string(),
  level: Level,
  phase: Phase,
  teachingLanguage: TeachingLanguageSchema.default("en"),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string(),
  progress: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      status: z.enum(["missing", "partial", "supported"]),
    }),
  ),
});
export type SessionSummary = z.infer<typeof SessionSummarySchema>;

export const SessionHistoryPageSchema = z.object({
  sessions: z.array(SessionSummarySchema),
  nextCursor: z.string().optional(),
});
export type SessionHistoryPage = z.infer<typeof SessionHistoryPageSchema>;

export const SignupSchema = z
  .object({
    email: z.string().trim().email("Please enter a valid email address."),
    password: z.string().min(8, "Password must be at least 8 characters."),
    name: z.string().trim().min(1, "Name is required.").max(80),
  })
  .strict();

export const LoginSchema = z
  .object({
    email: z.string().trim().email("Please enter a valid email address."),
    password: z.string().min(1, "Password is required."),
  })
  .strict();

export const UpdateProfileSchema = z
  .object({ name: SignupSchema.shape.name })
  .strict();

export const UpdatePasswordSchema = z
  .object({
    currentPassword: z
      .string()
      .min(1, "Current password is required.")
      .max(1024),
    newPassword: SignupSchema.shape.password.max(1024),
  })
  .strict()
  .refine((value) => value.currentPassword !== value.newPassword, {
    path: ["newPassword"],
    message: "Choose a different password from your current password.",
  });
