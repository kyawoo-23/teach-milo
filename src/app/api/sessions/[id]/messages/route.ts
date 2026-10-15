import { Id, Message, Session } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { database, decode, readOwned } from "@/server/db";
import { requireLearningOwnerId, respond, route } from "@/server/http";
import { readMessagePage } from "@/server/sessions";
import { publicMessages } from "@/server/board-media";
export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  return route(async () => {
    const owner = await requireLearningOwnerId();
    const id = Id.parse((await context.params).id);
    const session = await readOwned<
      Pick<Session, "ownerId" | "expiresAt" | "phase">
    >("sessions", id, owner, ["phase"]);
    if (session.phase === "transfer")
      throw new AppError(
        "ASSESSMENT_ACTIVE",
        "Teaching history is unavailable during the independent check.",
        403,
      );
    const query = new URL(request.url).searchParams;
    if (query.has("messageId")) {
      const messageId = Id.parse(query.get("messageId"));
      const doc = await database()
        .collection("sessions")
        .doc(id)
        .collection("messages")
        .doc(messageId)
        .get();
      if (!doc.exists)
        throw new AppError(
          "NOT_FOUND",
          "This evidence message is unavailable.",
          404,
        );
      return respond({
        messages: publicMessages(id, [decode<Message>(doc.data())]),
      });
    }
    const before = query.has("before")
      ? Number(query.get("before"))
      : undefined;
    if (before !== undefined && (!Number.isSafeInteger(before) || before < 0))
      throw new AppError("INVALID_CURSOR", "Invalid message cursor.");
    return respond(await readMessagePage(id, before));
  });
}
