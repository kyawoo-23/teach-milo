import { Id } from "@/lib/contracts";
import { readBoardImage } from "@/server/board-media";
import { requireUserId, route } from "@/server/http";
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; messageId: string }> },
) {
  return route(async () => {
    const owner = await requireUserId();
    const params = await context.params;
    const bytes = await readBoardImage(
      Id.parse(params.id),
      Id.parse(params.messageId),
      owner,
    );
    return new Response(new Uint8Array(bytes), {
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  });
}
