import { randomUUID } from "node:crypto";
import { z } from "zod";
import { Lesson, Session, SessionSummary } from "@/lib/contracts";
import { database, decode } from "@/server/db";
import { assertOrigin, guest, json, respond, route } from "@/server/http";
import { ownerOperation } from "@/server/operations";
import { createSession, publicSession } from "@/server/sessions";

export const runtime = "nodejs";

export async function GET() {
  return route(async () => {
    const ownerId = await guest();
    const snap = await database()
      .collection("sessions")
      .where("ownerId", "==", ownerId)
      .get();

    const sessionDocs = snap.docs.map((d) => decode<Session>(d.data()));
    const now = Date.now();
    const activeSessions = sessionDocs.filter(
      (s) => new Date(s.expiresAt).getTime() > now,
    );
    activeSessions.sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );

    const lessonRefs = activeSessions.map((s) =>
      database().collection("lessons").doc(s.lessonId),
    );
    const lessonDocs =
      lessonRefs.length > 0 ? await database().getAll(...lessonRefs) : [];
    const lessonMap = new Map<string, Lesson>();
    for (const doc of lessonDocs) {
      if (doc.exists) {
        lessonMap.set(doc.id, decode<Lesson>(doc.data()));
      }
    }

    const summaries: SessionSummary[] = activeSessions.map((s) => {
      const lesson = lessonMap.get(s.lessonId);
      return {
        id: s.id,
        title: lesson?.title || "Untitled Lesson",
        scope: lesson?.scope || "",
        level: lesson?.level || "introductory",
        phase: s.phase,
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

    return respond({ sessions: summaries });
  });
}

export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const ownerId = await guest();
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
