import { randomUUID } from "node:crypto";
import { z } from "zod";
import { CreateMaterialSchema, Id } from "@/lib/contracts";
import {
  assertOrigin,
  requireUserId,
  hash,
  json,
  respond,
  route,
} from "@/server/http";
import { readOwned } from "@/server/db";
import {
  extractCachedUpload,
  readUpload,
  saveMaterial,
} from "@/server/materials";
import { ownerOperation } from "@/server/operations";
import { callContext } from "@/server/usage";
import type { Material } from "@/lib/contracts";
export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  return route(async () => {
    assertOrigin(request);
    const ownerId = await requireUserId();
    let id: string;
    if (
      request.headers.get("content-type")?.startsWith("multipart/form-data")
    ) {
      const upload = await readUpload(request);
      const op = Id.parse(upload.operationId);
      id = await ownerOperation(
        ownerId,
        op,
        {
          type: "upload",
          digest: hash(upload.bytes.toString("base64")),
          name: upload.filename,
        },
        async () =>
          saveMaterial(
            op,
            ownerId,
            upload.filename,
            await extractCachedUpload(
              upload.bytes,
              upload.filename,
              callContext(ownerId, request),
            ),
          ),
      );
    } else {
      const input = await json(
        request,
        CreateMaterialSchema.extend({ operationId: z.string().uuid() }),
      );
      id = await ownerOperation(
        ownerId,
        input.operationId,
        { type: "paste", text: input.text, name: input.name },
        () =>
          saveMaterial(input.operationId, ownerId, input.name, [
            { id: "s1", label: "Pasted notes", text: input.text, warnings: [] },
          ]),
      );
    }
    const material = await readOwned<Material>("materials", id, ownerId);
    return respond({ id, name: material.name, sources: material.sources }, 201);
  });
}
