import { parentPort, workerData } from "node:worker_threads";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
const MAX_TEXT = 50000;

// Fail closed: a text layer can coexist with scans, diagrams or broken math.
function reliableText(items, text) {
  if (
    text.length < 30 ||
    /[\uFFFD\p{Co}\p{Sm}\u00b2\u00b3\u00b9\u2070-\u209f]|[\x00-\x08\x0b\x0c\x0e-\x1f]/u.test(
      text,
    )
  )
    return false;
  let previous;
  for (const item of items.filter((item) => item.str?.trim())) {
    const [a, b, c, d, x, y] = item.transform;
    if (
      item.dir !== "ltr" ||
      ![a, b, c, d, x, y, item.width, item.height].every(Number.isFinite) ||
      Math.abs(b) > 0.01 ||
      Math.abs(c) > 0.01 ||
      a <= 0 ||
      d <= 0 ||
      item.height <= 0
    )
      return false;
    if (previous) {
      const height = Math.max(previous.height, item.height);
      const dy = previous.y - y;
      // Reading-order resets, superscripts/subscripts and wide column gaps
      // are uncertain. Let vision reconstruct them rather than flatten them.
      if (
        dy < -0.5 ||
        (Math.abs(dy) > 0.5 && dy < height * 0.8) ||
        (Math.abs(dy) <= 0.5 &&
          (x < previous.x - 0.5 || x - previous.end > height * 3))
      )
        return false;
    }
    previous = { x, y, end: x + item.width, height: item.height };
  }
  return true;
}

async function inspectOfficeArchive(bytes, extension) {
  const yauzl = require("yauzl");
  let nativeEquations = false;
  const parts = new Map();
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (err, zip) => {
        if (err || !zip)
          return reject(
            new Error(`This ${extension.toUpperCase()} archive is damaged.`),
          );
        let count = 0,
          inflated = 0;
        const names = new Set();
        const fail = (message) => {
          zip.close();
          reject(new Error(message));
        };
        zip.on("error", () => fail("This document archive could not be read."));
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
            const xml = [];
            const isWordXml = /^word\/.*\.xml$/.test(entry.fileName);
            const isPresentationXml =
              extension === "pptx" &&
              /^(?:ppt\/presentation\.xml|ppt\/_rels\/presentation\.xml\.rels|ppt\/slides\/[^/]+\.xml)$/.test(
                entry.fileName,
              );
            stream.on("data", (chunk) => {
              if (isWordXml || isPresentationXml) xml.push(chunk);
              inflated += chunk.length;
              if (inflated > 25000000) {
                stream.destroy();
                fail(
                  "This document expands beyond the 25 MB extraction limit.",
                );
              }
            });
            stream.on("error", () => fail("This document archive is damaged."));
            stream.on("end", () => {
              if (isPresentationXml)
                parts.set(entry.fileName, Buffer.concat(xml).toString("utf8"));
              if (
                isWordXml &&
                /<(?:[\w.-]+:)?oMath(?:Para)?(?=[\s/>])/.test(
                  Buffer.concat(xml).toString("utf8"),
                )
              )
                nativeEquations = true;
              zip.readEntry();
            });
          });
        });
        zip.on("end", () =>
          names.has("[Content_Types].xml") &&
          (extension === "docx"
            ? names.has("word/document.xml")
            : names.has("ppt/presentation.xml") &&
              names.has("ppt/_rels/presentation.xml.rels"))
            ? resolve()
            : reject(
                new Error(
                  `Upload a valid ${extension.toUpperCase()} document.`,
                ),
              ),
        );
        zip.readEntry();
      },
    );
  });
  return { nativeEquations, parts };
}

async function extractPptx(bytes) {
  const { parts } = await inspectOfficeArchive(bytes, "pptx");
  const { XMLParser, XMLValidator } = require("fast-xml-parser");
  const parser = new XMLParser({
    preserveOrder: true,
    ignoreAttributes: false,
    parseTagValue: false,
    trimValues: false,
  });
  const parse = (name) => {
    const xml = parts.get(name);
    if (
      !xml ||
      /<!DOCTYPE|<!ENTITY/i.test(xml) ||
      XMLValidator.validate(xml) !== true
    )
      throw new Error("This PPTX contains missing or damaged slide data.");
    return parser.parse(xml);
  };
  const localName = (key) => key.split(":").at(-1);
  const children = (nodes, name) =>
    nodes.flatMap((node) =>
      Object.entries(node)
        .filter(([key]) => localName(key) === name)
        .map(([, value]) => ({ nodes: value, attributes: node[":@"] ?? {} })),
    );
  const presentation = children(
    parse("ppt/presentation.xml"),
    "presentation",
  )[0];
  const slideList = presentation && children(presentation.nodes, "sldIdLst")[0];
  const slides = slideList ? children(slideList.nodes, "sldId") : [];
  if (!slides.length) throw new Error("This PPTX has no slides to read.");
  if (slides.length > 50)
    throw new Error("Choose a PPTX with 50 slides or fewer.");
  const relationships = children(
    parse("ppt/_rels/presentation.xml.rels"),
    "Relationships",
  )[0];
  if (!relationships)
    throw new Error("This PPTX contains missing or damaged slide data.");
  const links = new Map(
    children(relationships.nodes, "Relationship").map(({ attributes }) => [
      attributes["@_Id"],
      attributes,
    ]),
  );
  let length = 0;
  const sources = slides.map(({ attributes }, index) => {
    const relationshipId = Object.entries(attributes).find(([key]) =>
      key.endsWith(":id"),
    )?.[1];
    const link = links.get(relationshipId);
    if (
      !link ||
      link["@_TargetMode"] === "External" ||
      !link["@_Type"]?.endsWith("/slide")
    )
      throw new Error("This PPTX contains missing or damaged slide data.");
    const target = link["@_Target"] ?? "";
    const name = path.posix.normalize(
      target.startsWith("/") ? target.slice(1) : `ppt/${target}`,
    );
    if (!/^ppt\/slides\/[^/]+\.xml$/.test(name))
      throw new Error("This PPTX contains an invalid slide reference.");
    const root = children(parse(name), "sld")[0];
    if (!root)
      throw new Error("This PPTX contains missing or damaged slide data.");
    const paragraphs = [];
    let visual = false;
    const inlineText = (nodes) =>
      nodes
        .map((node) =>
          Object.entries(node)
            .filter(([key]) => key !== ":@")
            .map(([key, value]) => {
              const tag = localName(key);
              if (tag === "oMath" || tag === "oMathPara") {
                visual = true;
                return "";
              }
              if (tag === "t" && Array.isArray(value))
                return value.map((node) => node["#text"] ?? "").join("");
              if (tag === "br") return "\n";
              return Array.isArray(value) ? inlineText(value) : "";
            })
            .join(""),
        )
        .join("");
    const visit = (nodes) => {
      for (const node of nodes)
        for (const [key, value] of Object.entries(node)) {
          const tag = localName(key);
          if (["pic", "graphicData", "oMath", "oMathPara"].includes(tag))
            visual = true;
          if (tag === "oMath" || tag === "oMathPara") continue;
          if (tag === "p" && Array.isArray(value))
            paragraphs.push(inlineText(value));
          else if (Array.isArray(value)) visit(value);
        }
    };
    visit(root.nodes);
    const text = paragraphs.join("\n").trim();
    length += text.length;
    if (length > MAX_TEXT)
      throw new Error(
        "Choose a shorter section: materials are limited to 50,000 characters.",
      );
    const warnings = [];
    if (visual)
      warnings.push(
        "Images, charts, diagrams, and native equations in this slide were not extracted. Upload a PDF to include visual content.",
      );
    if (!text) warnings.push("No readable text was extracted from this slide.");
    return { id: `s${index + 1}`, label: `Slide ${index + 1}`, text, warnings };
  });
  if (length < 30)
    throw new Error(
      "This presentation has too little readable text. Upload a PDF to include visual content, or paste your notes.",
    );
  return { sources, chunks: [] };
}
async function extract() {
  const bytes = Buffer.from(workerData.bytes);
  if (workerData.extension === "pptx") return extractPptx(bytes);
  if (workerData.extension === "pdf") {
    if (!bytes.subarray(0, 1024).includes(Buffer.from("%PDF-")))
      throw new Error("This file is not a PDF.");
    const { getDocument, OPS } =
      await import("pdfjs-dist/legacy/build/pdf.mjs");
    const visualOps = new Set([
      OPS.constructPath,
      OPS.moveTo,
      OPS.lineTo,
      OPS.curveTo,
      OPS.curveTo2,
      OPS.curveTo3,
      OPS.rectangle,
      OPS.stroke,
      OPS.closeStroke,
      OPS.fill,
      OPS.eoFill,
      OPS.fillStroke,
      OPS.eoFillStroke,
      OPS.closeFillStroke,
      OPS.closeEOFillStroke,
      OPS.shadingFill,
      OPS.paintXObject,
      OPS.paintFormXObjectBegin,
      OPS.beginAnnotation,
      OPS.beginInlineImage,
      OPS.paintImageMaskXObject,
      OPS.paintImageMaskXObjectGroup,
      OPS.paintImageXObject,
      OPS.paintInlineImageXObject,
      OPS.paintInlineImageXObjectGroup,
      OPS.paintImageXObjectRepeat,
      OPS.paintImageMaskXObjectRepeat,
      OPS.paintSolidColorImageMask,
      OPS.rawFillPath,
    ]);
    const textOps = new Set([
      OPS.showText,
      OPS.showSpacedText,
      OPS.nextLineShowText,
      OPS.nextLineSetSpacingShowText,
    ]);
    const task = getDocument({
      data: new Uint8Array(bytes),
      stopAtErrors: true,
      isEvalSupported: false,
      disableFontFace: true,
      useSystemFonts: false,
      standardFontDataUrl:
        path.join(
          path.dirname(require.resolve("pdfjs-dist/package.json")),
          "standard_fonts",
        ) + path.sep,
    });
    try {
      const pdf = await task.promise;
      if (pdf.numPages > 50)
        throw new Error("Choose a PDF with 50 pages or fewer.");
      const sources = [];
      const visualPages = [];
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
        let needsVision = true;
        let blank = false;
        try {
          const operators = await page.getOperatorList();
          const annotations = await page.getAnnotations();
          const hasVisuals =
            annotations.length > 0 ||
            operators.fnArray.some(
              (op, index) =>
                visualOps.has(op) ||
                (op === OPS.setTextRenderingMode &&
                  operators.argsArray[index][0] !== 0),
            );
          blank =
            !text &&
            !hasVisuals &&
            !operators.fnArray.some((op) => textOps.has(op));
          needsVision =
            !blank && (hasVisuals || !reliableText(content.items, text));
        } catch {
          // Unsupported visual inspection keeps the existing Gemini path.
        }
        if (needsVision) visualPages.push(i);
        sources.push({
          id: `p${i}`,
          label: `Page ${i}`,
          text,
          warnings: blank
            ? ["No readable content was extracted from this page."]
            : [],
        });
        page.cleanup();
      }
      if (!visualPages.length) return { sources, chunks: [] };
      const { PDFDocument } = await import("pdf-lib");
      const original = await PDFDocument.load(bytes, { updateMetadata: false });
      const chunks = [];
      for (let start = 0; start < visualPages.length; start += 5) {
        const part = await PDFDocument.create();
        const pages = visualPages.slice(start, start + 5);
        for (const page of await part.copyPages(
          original,
          pages.map((page) => page - 1),
        ))
          part.addPage(page);
        chunks.push({ pages, bytes: await part.save() });
      }
      return { sources, chunks };
    } finally {
      await task.destroy();
    }
  }
  let text;
  const warnings = [];
  if (workerData.extension === "docx") {
    if ((await inspectOfficeArchive(bytes, "docx")).nativeEquations)
      warnings.push(
        "Native equations in this DOCX were not extracted. Add them as LaTeX during review, or upload a PDF.",
      );
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
      warnings[0] ??
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
        warnings,
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
      warnings,
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
