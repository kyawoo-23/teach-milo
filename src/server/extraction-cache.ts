import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { SourceSchema, type Source } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { assertGuestWritable, database, decode, encode, expiresAt } from "./db";

const Sources = z
  .array(SourceSchema)
  .max(50)
  .refine(
    (sources) =>
      new Set(sources.map((source) => source.id)).size === sources.length &&
      sources.every(
        (source) =>
          /^p[1-9]\d?$/.test(source.id) && Number(source.id.slice(1)) <= 50,
      ) &&
      sources.reduce((sum, source) => sum + source.text.length, 0) <= 50_000,
  );

export type ExtractionProgress = {
  sources: Source[];
  checkpoint(sources: Source[]): Promise<void>;
};

type Entry = {
  ownerId: string;
  expiresAt: string;
  status: "running" | "partial" | "complete";
  sources: Source[];
  token: string;
  until: number;
};

// Bump the version whenever page selection, OCR or output semantics change.
export function extractionCacheId(
  ownerId: string,
  bytes: Buffer,
  model: string,
  prompt: string,
) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return createHash("sha256")
    .update(
      JSON.stringify([ownerId, digest, "pdf-extraction-v1", model, prompt]),
    )
    .digest("hex");
}

export async function withExtractionCache(
  ownerId: string,
  key: string,
  work: (progress: ExtractionProgress) => Promise<Source[]>,
): Promise<Source[]> {
  const f = database();
  const ref = f.collection("extraction_cache").doc(key);
  const token = randomUUID();
  const reservation = await f.runTransaction(async (tx) => {
    await assertGuestWritable(tx, ownerId);
    const doc = await tx.get(ref);
    const existing = doc.exists ? decode<Entry>(doc.data()) : undefined;
    const valid =
      existing?.ownerId === ownerId &&
      new Date(existing.expiresAt).getTime() > Date.now() &&
      Sources.safeParse(existing.sources).success;
    if (
      valid &&
      existing.status === "complete" &&
      existing.sources.reduce((sum, source) => sum + source.text.length, 0) >=
        30
    )
      return { complete: true, sources: existing.sources };
    if (valid && existing.status === "running" && existing.until > Date.now())
      throw new AppError(
        "BUSY",
        "This document is still processing. Please wait, then retry.",
        409,
        5,
      );
    const sources = valid ? existing.sources : [];
    tx.set(
      ref,
      encode({
        ownerId,
        sources,
        status: "running",
        token,
        until: Date.now() + 6 * 60_000,
        // Reuse never renews retention, including interrupted uploads.
        expiresAt: valid ? existing.expiresAt : expiresAt(),
      }),
    );
    return { complete: false, sources };
  });
  if (reservation.complete) return reservation.sources;
  async function save(sources: Source[], status: "running" | "complete") {
    const validated = Sources.parse(sources);
    if (
      status === "complete" &&
      validated.reduce((sum, source) => sum + source.text.length, 0) < 30
    )
      throw new AppError(
        "UNREADABLE",
        "Too little content could be read. Try a clearer PDF or paste your notes.",
        422,
      );
    await f.runTransaction(async (tx) => {
      await assertGuestWritable(tx, ownerId);
      const doc = await tx.get(ref);
      const entry = doc.exists ? decode<Entry>(doc.data()) : undefined;
      if (
        entry?.token !== token ||
        new Date(entry.expiresAt).getTime() <= Date.now()
      )
        throw new AppError(
          "STALE_REQUEST",
          "This extraction has expired or been replaced. Please retry.",
          409,
        );
      tx.update(ref, {
        sources: validated,
        status,
        until: status === "complete" ? 0 : entry.until,
      });
    });
  }
  try {
    const sources = await work({
      sources: reservation.sources,
      checkpoint: (sources) => save(sources, "running"),
    });
    await save(sources, "complete");
    return sources;
  } catch (error) {
    await f
      .runTransaction(async (tx) => {
        await assertGuestWritable(tx, ownerId);
        const doc = await tx.get(ref);
        if (doc.get("token") === token)
          tx.update(ref, { status: "partial", until: 0 });
      })
      .catch(() => {});
    throw error;
  }
}
