import "server-only";
import { Worker } from "node:worker_threads";
import path from "node:path";
import { Readable } from "node:stream";
import Busboy from "busboy";
import { z } from "zod";
import { Material, Source } from "@/lib/contracts";
import { AppError } from "@/lib/errors";
import { assertOwned, database, decode, encode, expiresAt } from "./db";
import { gemini, Model } from "./model";
import { CallContext } from "./usage";
import { OCR_PROMPT } from "@/content/prompts";

const MAX_BYTES = 10 * 1024 * 1024;
export async function readUpload(
  request: Request,
): Promise<{ bytes: Buffer; filename: string; operationId: string }> {
  if (!request.body)
    throw new AppError("EMPTY_FILE", "Choose a document to upload.");
  if (Number(request.headers.get("content-length") || 0) > MAX_BYTES + 16384)
    throw new AppError("TOO_LARGE", "Files must be 10 MB or smaller.", 413);
  return new Promise((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: Object.fromEntries(request.headers),
        limits: {
          fileSize: MAX_BYTES,
          files: 1,
          fields: 1,
          fieldSize: 100,
          parts: 2,
        },
      });
    } catch {
      return reject(
        new AppError("INVALID_UPLOAD", "The upload could not be read."),
      );
    }
    const source = Readable.fromWeb(
      request.body as import("node:stream/web").ReadableStream,
    );
    let bytes = Buffer.alloc(0);
    let filename = "";
    let operationId = "";
    let total = 0;
    let failed = false;
    const fail = (message: string) => {
      if (failed) return;
      failed = true;
      source.unpipe(parser);
      source.destroy();
      parser.destroy();
      reject(new AppError("INVALID_UPLOAD", message, 413));
    };
    source.on("data", (chunk) => {
      total += chunk.length;
      if (total > MAX_BYTES + 16384) fail("Files must be 10 MB or smaller.");
    });
    source.on("error", () => fail("The upload was interrupted. Try again."));
    parser.on("file", (field, stream, info) => {
      if (field !== "file") return fail("Choose one PDF, DOCX, or TXT file.");
      filename = path.basename(info.filename).slice(0, 120);
      const chunks: Buffer[] = [];
      stream.on("limit", () => fail("Files must be 10 MB or smaller."));
      stream.on("data", (chunk) => chunks.push(chunk));
      stream.on("end", () => {
        bytes = Buffer.concat(chunks);
      });
      stream.on("error", () => fail("The file could not be read."));
    });
    parser.on("field", (name, value) => {
      if (name !== "operationId") fail("Unexpected upload field.");
      else operationId = value;
    });
    parser.on("filesLimit", () => fail("Upload one file at a time."));
    parser.on("partsLimit", () => fail("Upload one file at a time."));
    parser.on("fieldsLimit", () => fail("Unexpected upload fields."));
    parser.on("error", () => fail("The upload could not be read."));
    parser.on("close", () => {
      if (!failed) {
        if (!bytes.length)
          reject(new AppError("EMPTY_FILE", "The file is empty."));
        else resolve({ bytes, filename, operationId });
      }
    });
    source.pipe(parser);
  });
}
type Extraction = {
  sources: Source[];
  chunks: { start: number; count: number; bytes: Uint8Array }[];
};
export function extractInWorker(
  bytes: Buffer,
  extension: string,
): Promise<Extraction> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      path.join(process.cwd(), "scripts/extract-worker.mjs"),
      {
        workerData: { bytes, extension },
        resourceLimits: {
          maxOldGenerationSizeMb: 256,
          maxYoungGenerationSizeMb: 32,
        },
      },
    );
    const timer = setTimeout(() => {
      void worker.terminate();
      reject(
        new AppError(
          "EXTRACTION_TIMEOUT",
          "This document took too long to read. Try a smaller section.",
          422,
        ),
      );
    }, 45_000);
    worker.once("message", ({ result, error }) => {
      clearTimeout(timer);
      void worker.terminate();
      error
        ? reject(new AppError("EXTRACTION_FAILED", error, 422))
        : resolve(result);
    });
    worker.once("error", () => {
      clearTimeout(timer);
      reject(
        new AppError(
          "EXTRACTION_FAILED",
          "This document could not be read within the extraction limits. Try a smaller section.",
          422,
        ),
      );
    });
    worker.once("exit", (code) => {
      clearTimeout(timer);
      if (code !== 0)
        reject(
          new AppError(
            "EXTRACTION_FAILED",
            "Document extraction stopped. Try a smaller section.",
            422,
          ),
        );
    });
  });
}
export async function extractUpload(
  bytes: Buffer,
  filename: string,
  ctx: CallContext,
  model: Model = gemini,
) {
  const extension = filename.split(".").at(-1)?.toLowerCase();
  if (!extension || !["pdf", "docx", "txt"].includes(extension))
    throw new AppError(
      "UNSUPPORTED_FILE",
      "Choose a PDF, DOCX, or TXT document.",
      415,
    );
  const extracted = await extractInWorker(bytes, extension);
  if (extension !== "pdf") return extracted.sources;
  const schema = z.object({
    pages: z
      .array(
        z.object({
          page: z.number().int().positive(),
          text: z.string().max(50_000),
          warnings: z.array(z.string().max(400)).max(20),
        }),
      )
      .min(1)
      .max(5),
  });
  const result: Source[] = [];
  let characters = 0;
  const started = Date.now();
  for (const chunk of extracted.chunks) {
    if (Date.now() - started > 210_000)
      throw new AppError(
        "EXTRACTION_TIMEOUT",
        "OCR took too long. Try uploading fewer pages at a time.",
        422,
      );
    const visual = await model.generate(
      schema,
      OCR_PROMPT,
      {
        pageCount: chunk.count,
        nativeText: extracted.sources
          .slice(chunk.start - 1, chunk.start + chunk.count - 1)
          .map((s) => s.text),
      },
      ctx,
      Buffer.from(chunk.bytes),
    );
    if (
      visual.pages.length !== chunk.count ||
      new Set(visual.pages.map((p) => p.page)).size !== chunk.count ||
      visual.pages.some((p) => p.page > chunk.count)
    )
      throw new AppError(
        "OCR_INCOMPLETE",
        "OCR did not cover every page. Retry or upload a smaller section.",
        422,
      );
    for (const page of visual.pages.sort((a, b) => a.page - b.page)) {
      const actual = chunk.start + page.page - 1;
      const native = extracted.sources[actual - 1].text;
      const text = page.text.trim() || native;
      const warnings = [...page.warnings];
      if (native.length > 200 && text.length < native.length * 0.6)
        warnings.push(
          "The visual extraction is shorter than the selectable text. Review for missing content.",
        );
      if (!text)
        warnings.push("No readable content was extracted from this page.");
      characters += text.length;
      if (characters > 50_000)
        throw new AppError(
          "TOO_MUCH_TEXT",
          "The extracted document exceeds 50,000 characters. Upload a shorter section.",
          413,
        );
      result.push({
        id: `p${actual}`,
        label: `Page ${actual}`,
        text,
        warnings,
      });
    }
  }
  if (characters < 30)
    throw new AppError(
      "UNREADABLE",
      "Too little content could be read. Try a clearer PDF or paste your notes.",
      422,
    );
  return result;
}
export async function saveMaterial(
  id: string,
  ownerId: string,
  name: string,
  sources: Source[],
) {
  const material: Material = {
    id,
    ownerId,
    name,
    sources,
    text: sources.map((s) => s.text).join("\n\n"),
    createdAt: new Date().toISOString(),
    expiresAt: expiresAt(),
  };
  const ref = database().collection("materials").doc(id);
  await database().runTransaction(async (tx) => {
    const existing = await tx.get(ref);
    if (existing.exists) {
      assertOwned(decode<Material>(existing.data()), ownerId);
      return;
    }
    tx.create(ref, encode(material));
  });
  return id;
}
