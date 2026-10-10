import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const MAX_TEXT = 50000;

async function inspectDocx(bytes) {
  const yauzl = require("yauzl");
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, zip) => {
        if (err || !zip)
          return reject(new Error("This DOCX archive is damaged."));
        let count = 0,
          inflated = 0;
        const names = new Set();
        const fail = (message) => {
          zip.close();
          reject(new Error(message));
        };
        zip.on("error", () => fail("This DOCX archive could not be read."));
        zip.on("entry", (entry) => {
          if (
            ++count > 500 ||
            names.has(entry.fileName) ||
            entry.fileName.startsWith("/") ||
            entry.fileName.split("/").includes("..") ||
            entry.generalPurposeBitFlag & 1 ||
            entry.uncompressedSize > 25000000
          )
            return fail(
              "This document archive exceeds safe extraction limits.",
            );
          names.add(entry.fileName);
          if (entry.fileName.endsWith("/")) return zip.readEntry();
          zip.openReadStream(entry, (error, stream) => {
            if (error || !stream)
              return fail("This document archive is damaged.");
            stream.on("data", (chunk) => {
              inflated += chunk.length;
              if (inflated > 25000000) {
                stream.destroy();
                fail(
                  "This document expands beyond the 25 MB extraction limit.",
                );
              }
            });
            stream.on("error", () => fail("This document archive is damaged."));
            stream.on("end", () => zip.readEntry());
          });
        });
        zip.on("end", () =>
          names.has("[Content_Types].xml") && names.has("word/document.xml")
            ? resolve()
            : reject(new Error("Upload a valid DOCX document.")),
        );
        zip.readEntry();
      },
    );
  });
}
async function extract() {
  const bytes = Buffer.from(workerData.bytes);
  if (workerData.extension === "pdf") {
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("This file is not a PDF.");
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const task = getDocument({
      data: new Uint8Array(bytes),
      stopAtErrors: true,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 50)
        throw new Error("Choose a PDF with 50 pages or fewer.");
      const sources = [];
      let length = 0;
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        const text = content.items
          .filter((x) => "str" in x)
          .map((x) => x.str + (x.hasEOL ? "\n" : " "))
          .join("")
          .trim();
        length += text.length;
        if (length > MAX_TEXT)
          throw new Error(
            "Choose a shorter section: materials are limited to 50,000 characters.",
          );
        sources.push({ id: `p${i}`, label: `Page ${i}`, text, warnings: [] });
        page.cleanup();
      }
      const { PDFDocument } = await import("pdf-lib");
      const original = await PDFDocument.load(bytes, { updateMetadata: false });
      const chunks = [];
      for (let start = 0; start < pdf.numPages; start += 5) {
        const part = await PDFDocument.create();
        const count = Math.min(5, pdf.numPages - start);
        for (const page of await part.copyPages(
          original,
          Array.from({ length: count }, (_, i) => start + i),
        ))
          part.addPage(page);
        chunks.push({ start: start + 1, count, bytes: await part.save() });
      }
      return { sources, chunks };
    } finally {
      await task.destroy();
    }
  }
  let text;
  if (workerData.extension === "docx") {
    await inspectDocx(bytes);
    const mammoth = require("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    text = result.value.trim();
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true })
        .decode(bytes)
        .replace(/^\uFEFF/, "")
        .trim();
    } catch {
      throw new Error(
        "Save this text file using UTF-8 encoding and upload it again.",
      );
    }
    if (text.includes("\0")) throw new Error("Upload a plain UTF-8 text file.");
  }
  if (text.length > MAX_TEXT)
    throw new Error(
      "Choose a shorter section: materials are limited to 50,000 characters.",
    );
  if (text.length < 30)
    throw new Error(
      "This document has too little readable text. Paste at least a short paragraph instead.",
    );
  const paragraphs = text.split(/\n\s*\n/);
  const sources = [];
  let block = "";
  for (const paragraph of paragraphs) {
    if (block && block.length + paragraph.length > 4000) {
      sources.push({
        id: `s${sources.length + 1}`,
        label: `Section ${sources.length + 1}`,
        text: block.trim(),
        warnings: [],
      });
      block = "";
    }
    block += paragraph + "\n\n";
  }
  if (block.trim())
    sources.push({
      id: `s${sources.length + 1}`,
      label: `Section ${sources.length + 1}`,
      text: block.trim(),
      warnings: [],
    });
  return { sources, chunks: [] };
}
extract()
  .then((result) => parentPort.postMessage({ result }))
  .catch((error) =>
    parentPort.postMessage({
      error:
        error.name === "PasswordException"
          ? "Password-protected PDFs are not supported. Upload an unlocked copy."
          : error.message,
    }),
  );
