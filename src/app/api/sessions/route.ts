import { lessonLanguage } from "@/lib/i18n/locales";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { z } from "zod";
import {
  Lesson,
  Session,
  SessionHistoryPage,
  SessionSummary,
} from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { database, decode } from "@/server/db";
import {
  assertOrigin,
  requireUserId,
  json,
  respond,
  route,
} from "@/server/http";
import { ownerOperation } from "@/server/operations";
import { createSession, publicSession } from "@/server/sessions";

export const runtime = "nodejs";

type HistorySession = Pick<
  Session,
  | "id"
  | "lessonId"
  | "lessonSummary"
  | "phase"
  | "createdAt"
  | "updatedAt"
  | "expiresAt"
> & { ledger: Pick<Session["ledger"], "evidence"> };
type HistoryLesson = Pick<
  Lesson,
  "title" | "scope" | "level" | "objectives" | "teachingLanguage"
>;

const PAGE_SIZE = 20;
const CursorSchema = z
  .object({
    updatedAt: z.string().datetime(),
    expiresAt: z
      .object({
        seconds: z.number().int().min(-62135596800).max(253402300799),
        nanoseconds: z.number().int().min(0).max(999999999),
      })
      .strict(),
    id: z.string().uuid(),
  })
  .strict();

function readCursor(value: string | null) {
  if (value === null) return undefined;
  try {
    if (value.length > 1024 || !/^[A-Za-z0-9_-]+$/.test(value))
      throw new Error();
    return CursorSchema.parse(
      JSON.parse(Buffer.from(value, "base64url").toString("utf8")),
    );
  } catch {
    throw new AppError(
      "INVALID_CURSOR",
      "This history page is invalid. Reopen your sessions to start again.",
      400,
    );
  }
}

export async function GET(request: Request) {
  return route(async () => {
    const ownerId = await requireUserId();
    const cursor = readCursor(new URL(request.url).searchParams.get("cursor"));
    const now = Timestamp.now();
    let query = database()
      .collection("sessions")
      .where("ownerId", "==", ownerId)
      .where("expiresAt", ">", now)
      .orderBy("updatedAt", "desc")
      .orderBy("expiresAt", "asc")
      .orderBy(FieldPath.documentId(), "asc")
      .select(
        "id",
        "lessonId",
        "lessonSummary",
        "phase",
        "createdAt",
        "updatedAt",
        "expiresAt",
        "ledger.evidence",
      )
      .limit(PAGE_SIZE + 1);
    if (cursor) {
      query = query.startAfter(
        cursor.updatedAt,
        new Timestamp(cursor.expiresAt.seconds, cursor.expiresAt.nanoseconds),
        cursor.id,
      );
    }
    const snap = await query.get();
    const pageDocs = snap.docs.slice(0, PAGE_SIZE);

    const activeSessions = pageDocs.map((d) =>
      decode<HistorySession>(d.data()),
    );

    const lessonRefs = [
      ...new Set(
        activeSessions.filter((s) => !s.lessonSummary).map((s) => s.lessonId),
      ),
    ].map((id) => database().collection("lessons").doc(id));
    const lessonDocs =
      lessonRefs.length > 0
        ? await database().getAll(...lessonRefs, {
            fieldMask: [
              "title",
              "scope",
              "level",
              "objectives",
              "teachingLanguage",
            ],
          })
        : [];
    const lessonMap = new Map<string, HistoryLesson>();
    for (const doc of lessonDocs) {
      if (doc.exists) {
        lessonMap.set(doc.id, decode<HistoryLesson>(doc.data()));
      }
    }

    const summaries: SessionSummary[] = activeSessions.map((s) => {
      const lesson = s.lessonSummary ?? lessonMap.get(s.lessonId);
      return {
        id: s.id,
        title: lesson?.title || "Untitled Lesson",
        scope: lesson?.scope || "",
        level: lesson?.level || "introductory",
        phase: s.phase,
        teachingLanguage: lessonLanguage(lesson?.teachingLanguage),
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        expiresAt: s.expiresAt,
        progress: (lesson?.objectives || []).map((o) => ({
          id: o.id,
          label: o.label,
          status:
            s.ledger.evidence.find((e) => e.objectiveId === o.id)
              ?.understanding || "missing",
        })),
      };
    });

    const result: SessionHistoryPage = { sessions: summaries };
    if (snap.size > PAGE_SIZE) {
      const last = pageDocs.at(-1)!;
      const expiry = last.get("expiresAt") as Timestamp;
      result.nextCursor = Buffer.from(
        JSON.stringify({
          updatedAt: last.get("updatedAt"),
          expiresAt: {
            seconds: expiry.seconds,
            nanoseconds: expiry.nanoseconds,
          },
          id: last.id,
        }),
      ).toString("base64url");
    }
    return respond(result);
  });
}

export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const ownerId = await requireUserId();
    const input = await json(
      request,
      z
        .object({ operationId: z.string().uuid(), lessonId: z.string().uuid() })
        .strict(),
    );
    const id = await ownerOperation(
      ownerId,
      input.operationId,
      { type: "create", lessonId: input.lessonId },
      () => createSession(input.operationId, input.lessonId, ownerId),
    );
    return respond(await publicSession(id, ownerId), 201);
  });
}
