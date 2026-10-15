import { describe, expect, it, vi } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { crc32 } from "node:zlib";
import { extractInWorker, extractUpload, readUpload } from "@/server/materials";
import type { Model } from "@/server/model";
import { ctx } from "./fixtures";
import { pngFixture } from "./board-fixtures";
import { extractionCacheId } from "@/server/extraction-cache";
async function scannedPdf(pages = 1) {
  const pdf = await PDFDocument.create();
  const image = await pdf.embedPng(pngFixture());
  for (let i = 0; i < pages; i++)
    pdf.addPage().drawImage(image, { x: 0, y: 0, width: 200, height: 200 });
  return pdf;
}
function zip(entries: Record<string, string>) {
  const chunks: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const nameBuffer = Buffer.from(name);
    const data = Buffer.from(content);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt32LE(crc32(data), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(crc32(data), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuffer.length, 28);
    central.writeUInt32LE(offset, 42);
    chunks.push(local, nameBuffer, data);
    directory.push(central, nameBuffer);
    offset += local.length + nameBuffer.length + data.length;
  }
  const dir = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(Object.keys(entries).length, 8);
  end.writeUInt16LE(Object.keys(entries).length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, dir, end]);
}
function pptx(
  slides: string[],
  order = slides.map((_, i) => i + 1),
  extra: Record<string, string> = {},
) {
  return zip({
    "[Content_Types].xml":
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
    "ppt/presentation.xml": `<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst>${order.map((n, i) => `<p:sldId id="${256 + i}" r:id="rId${n}"/>`).join("")}</p:sldIdLst></p:presentation>`,
    "ppt/_rels/presentation.xml.rels": `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${slides.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide" Target="slides/slide${i + 1}.xml"/>`).join("")}</Relationships>`,
    ...Object.fromEntries(
      slides.map((content, i) => [
        `ppt/slides/slide${i + 1}.xml`,
        `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree>${content}</p:spTree></p:cSld></p:sld>`,
      ]),
    ),
    ...extra,
  });
}
describe("bounded material extraction", () => {
  it("extracts PPTX paragraphs, runs and table cells in presentation order without Gemini", async () => {
    const bytes = pptx(
      [
        "<p:sp><p:txBody><a:p><a:r><a:t>Second &amp; final slide explains </a:t></a:r><a:r><a:t>energy transfer.</a:t></a:r></a:p></p:txBody></p:sp>",
        "<p:sp><p:txBody><a:p><a:r><a:t>First slide explains how plants store energy.</a:t></a:r><a:br/><a:r><a:t>More detail.</a:t></a:r></a:p></p:txBody></p:sp><a:tbl><a:tr><a:tc><a:txBody><a:p><a:r><a:t>Table cell</a:t></a:r></a:p></a:txBody></a:tc></a:tr></a:tbl>",
      ],
      [2, 1],
      {
        "ppt/notesSlides/notesSlide1.xml":
          "<notes>Private speaker notes</notes>",
      },
    );
    const generate = vi.fn();
    const sources = await extractUpload(bytes, "Lesson.PPTX", ctx, {
      generate,
    });
    expect(sources.map(({ id, label, text }) => ({ id, label, text }))).toEqual(
      [
        {
          id: "s1",
          label: "Slide 1",
          text: "First slide explains how plants store energy.\nMore detail.\nTable cell",
        },
        {
          id: "s2",
          label: "Slide 2",
          text: "Second & final slide explains energy transfer.",
        },
      ],
    );
    expect(generate).not.toHaveBeenCalled();
  });
  it("retains blank PPTX slides and warns about visual content", async () => {
    const result = await extractInWorker(
      pptx([
        "<a:p><a:r><a:t>A useful explanation with enough readable text for a lesson.</a:t></a:r></a:p>",
        "<p:pic/>",
        "",
      ]),
      "pptx",
    );
    expect(result.sources).toHaveLength(3);
    expect(result.sources[1]).toMatchObject({ label: "Slide 2", text: "" });
    expect(result.sources[1].warnings.join(" ")).toContain("Upload a PDF");
    expect(result.sources[2].warnings).toEqual([
      "No readable text was extracted from this slide.",
    ]);
  });
  it("preserves literal formulas but does not flatten native PPTX equations into prose", async () => {
    const result = await extractInWorker(
      pptx([
        '<a:p><a:r><a:t>A useful worked example uses $x^2$ and explains each step.</a:t></a:r><m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><m:r><m:t>lost structure</m:t></m:r></m:oMath></a:p>',
      ]),
      "pptx",
    );
    expect(result.sources[0].text).toBe(
      "A useful worked example uses $x^2$ and explains each step.",
    );
    expect(result.sources[0].warnings.join(" ")).toContain("native equations");
  });
  it("rejects invalid, oversized, unreadable and unsafe PPTX files", async () => {
    await expect(
      extractInWorker(Buffer.from("not a zip"), "pptx"),
    ).rejects.toThrow();
    await expect(
      extractInWorker(zip({ "[Content_Types].xml": "<Types/>" }), "pptx"),
    ).rejects.toThrow("valid PPTX");
    await expect(
      extractInWorker(pptx(["<a:p><a:t>short</a:t></a:p>"]), "pptx"),
    ).rejects.toThrow("too little readable text");
    await expect(
      extractInWorker(pptx(Array(51).fill("")), "pptx"),
    ).rejects.toThrow("50 slides");
    await expect(
      extractInWorker(
        pptx([`<a:p><a:t>${"x".repeat(50001)}</a:t></a:p>`]),
        "pptx",
      ),
    ).rejects.toThrow("50,000");
    await expect(extractInWorker(pptx(["<a:p>"]), "pptx")).rejects.toThrow(
      "damaged",
    );
    await expect(
      extractInWorker(
        pptx([""], [1], {
          "ppt/slides/slide1.xml":
            '<!DOCTYPE x [<!ENTITY x "expanded">]><x>&x;</x>',
        }),
        "pptx",
      ),
    ).rejects.toThrow("damaged");
    await expect(
      extractInWorker(
        pptx([""], [1], {
          "ppt/_rels/presentation.xml.rels":
            '<Relationships><Relationship Id="rId1" Type="example/slide" Target="../../outside.xml"/></Relationships>',
        }),
        "pptx",
      ),
    ).rejects.toThrow("invalid slide reference");
    await expect(
      extractInWorker(pptx([""], [1], { "../escape": "bad" }), "pptx"),
    ).rejects.toThrow();
  });
  it("invalidates extraction reuse when user, bytes, model or prompt change", () => {
    const key = extractionCacheId(
      "owner",
      Buffer.from("pdf"),
      "model",
      "prompt",
    );
    expect(
      extractionCacheId("owner", Buffer.from("pdf"), "model", "prompt"),
    ).toBe(key);
    for (const changed of [
      extractionCacheId("another", Buffer.from("pdf"), "model", "prompt"),
      extractionCacheId("owner", Buffer.from("changed"), "model", "prompt"),
      extractionCacheId("owner", Buffer.from("pdf"), "another", "prompt"),
      extractionCacheId("owner", Buffer.from("pdf"), "model", "another"),
    ])
      expect(changed).not.toBe(key);
  });
  it("extracts UTF-8 text and rejects binary or oversized text", async () => {
    const data = await extractInWorker(
      Buffer.from(
        "A useful paragraph about how plants store energy through photosynthesis.",
      ),
      "txt",
    );
    expect(data.sources[0].text).toContain("photosynthesis");
    await expect(
      extractInWorker(Buffer.from([0xff, 0xff]), "txt"),
    ).rejects.toThrow("UTF-8");
    await expect(
      extractInWorker(Buffer.from("x".repeat(50001)), "txt"),
    ).rejects.toThrow("50,000");
  });
  it("extracts a real text PDF with page references", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    pdf
      .addPage()
      .drawText(
        "The same convolution weights are reused at each spatial position.",
        { font, size: 12 },
      );
    const result = await extractInWorker(Buffer.from(await pdf.save()), "pdf");
    expect(result.sources[0].id).toBe("p1");
    expect(result.sources[0].text).toContain("convolution weights");
    expect(result.chunks).toHaveLength(0);
  });
  it("extracts clean prose and blank pages without calling Gemini", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    for (let i = 0; i < 20; i++)
      pdf
        .addPage()
        .drawText(
          "A clear explanation of how energy is stored and transferred.",
          { font, size: 12 },
        );
    pdf.addPage();
    const generate = vi.fn();
    const sources = await extractUpload(
      Buffer.from(await pdf.save()),
      "prose.pdf",
      ctx,
      { generate },
    );
    expect(generate).not.toHaveBeenCalled();
    expect(sources).toHaveLength(21);
    expect(sources[20]).toMatchObject({
      id: "p21",
      text: "",
      warnings: [expect.any(String)],
    });
    expect(sources[0].text).toContain("energy is stored");
  });
  it("packs nonadjacent visual pages together and keeps original references", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const image = await pdf.embedPng(pngFixture());
    const prose =
      "A clear explanation of how energy is stored and transferred.";
    pdf.addPage().drawText(prose, { font, size: 12 });
    pdf.addPage().drawImage(image, { width: 200, height: 200 });
    pdf.addPage().drawText(prose, { font, size: 12 });
    const diagram = pdf.addPage();
    diagram.drawText(prose, { font, size: 12 });
    diagram.drawLine({ start: { x: 20, y: 20 }, end: { x: 90, y: 90 } });
    pdf.addPage();
    pdf
      .addPage()
      .drawText("Calculate the unknown quantity using the formula x = 2.", {
        font,
        size: 12,
      });
    const mixed = pdf.addPage();
    mixed.drawText(prose, { font, size: 12 });
    mixed.drawImage(image, { width: 200, height: 200 });
    const bytes = Buffer.from(await pdf.save());
    expect(
      (await extractInWorker(bytes, "pdf")).chunks.map((chunk) => chunk.pages),
    ).toEqual([[2, 4, 6, 7]]);
    let calls = 0;
    const model: Model = {
      async generate(schema, _system, data, _ctx, media) {
        calls++;
        expect(data).toEqual({ pageCount: 4 });
        expect((await PDFDocument.load(media as Buffer)).getPageCount()).toBe(
          4,
        );
        return schema.parse({
          pages: [4, 2, 1, 3].map((page) => ({
            page,
            text: `Visual learning content from attachment page ${page}.`,
            warnings: [],
          })),
        });
      },
    };
    const sources = await extractUpload(bytes, "mixed.pdf", ctx, model);
    expect(calls).toBe(1);
    expect(sources.map((source) => source.id)).toEqual([
      "p1",
      "p2",
      "p3",
      "p4",
      "p5",
      "p6",
      "p7",
    ]);
    expect(sources[3].text).toContain("attachment page 2");
    expect(sources[6].text).toContain("attachment page 4");
    expect(sources[0].text).toBe(prose);
  });
  it("keeps superscripts and column reading-order resets on the vision path", async () => {
    const pdf = await PDFDocument.create();
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    const equation = pdf.addPage();
    equation.drawText("The unknown quantity is expressed by the variable x", {
      font,
      size: 12,
      x: 20,
      y: 500,
    });
    equation.drawText("2", { font, size: 7, x: 290, y: 505 });
    const columns = pdf.addPage();
    columns.drawText("First column begins with a useful explanation.", {
      font,
      size: 12,
      x: 20,
      y: 500,
    });
    columns.drawText("First column continues with another sentence.", {
      font,
      size: 12,
      x: 20,
      y: 480,
    });
    columns.drawText("Second column begins with related material.", {
      font,
      size: 12,
      x: 320,
      y: 500,
    });
    expect(
      (await extractInWorker(Buffer.from(await pdf.save()), "pdf")).chunks[0]
        .pages,
    ).toEqual([1, 2]);
  });
  it("uses visual extraction for scanned pages and preserves uncertainty", async () => {
    const pdf = await scannedPdf();
    const model: Model = {
      async generate(schema, _s, _d, _ctx, bytes) {
        expect(bytes?.length).toBeGreaterThan(0);
        return schema.parse({
          pages: [
            {
              page: 1,
              text: "Scanned lesson notes describe energy being stored as chemical energy in sugars.",
              warnings: ["A formula on this page is unclear."],
            },
          ],
        });
      },
    };
    const sources = await extractUpload(
      Buffer.from(await pdf.save()),
      "scan.pdf",
      ctx,
      model,
    );
    expect(sources[0].warnings).toHaveLength(1);
    expect(sources[0].label).toBe("Page 1");
  });
  it("rejects incomplete OCR coverage and excessive PDF pages", async () => {
    const pdf = await scannedPdf(2);
    const model: Model = {
      async generate(schema) {
        return schema.parse({
          pages: [
            {
              page: 1,
              text: "Only one page was extracted from this two page document.",
              warnings: [],
            },
          ],
        });
      },
    };
    await expect(
      extractUpload(Buffer.from(await pdf.save()), "partial.pdf", ctx, model),
    ).rejects.toMatchObject({ code: "OCR_INCOMPLETE" });
    for (let i = 2; i < 51; i++) pdf.addPage();
    await expect(
      extractInWorker(Buffer.from(await pdf.save()), "pdf"),
    ).rejects.toThrow("50 pages");
  });
  it("never checkpoints incomplete coverage and rejects a wholly blank document", async () => {
    const pdf = await scannedPdf(2);
    const checkpoint = vi.fn();
    const model: Model = {
      async generate(schema) {
        return schema.parse({
          pages: [1, 1].map((page) => ({
            page,
            text: "A readable explanation of the learning material.",
            warnings: [],
          })),
        });
      },
    };
    await expect(
      extractUpload(
        Buffer.from(await pdf.save()),
        "duplicate.pdf",
        ctx,
        model,
        { sources: [], checkpoint },
      ),
    ).rejects.toMatchObject({ code: "OCR_INCOMPLETE" });
    expect(checkpoint).not.toHaveBeenCalled();
    const blank = await PDFDocument.create();
    blank.addPage();
    const generate = vi.fn();
    await expect(
      extractUpload(Buffer.from(await blank.save()), "blank.pdf", ctx, {
        generate,
      }),
    ).rejects.toMatchObject({ code: "UNREADABLE" });
    expect(generate).not.toHaveBeenCalled();
  });
  it("does not cache unreadable OCR or extraction exceeding the combined text limit", async () => {
    const pdf = await scannedPdf(2);
    const bytes = Buffer.from(await pdf.save());
    const checkpoint = vi.fn();
    for (const [text, code] of [
      ["", "UNREADABLE"],
      ["x".repeat(25_001), "TOO_MUCH_TEXT"],
    ] as const) {
      const model: Model = {
        async generate(schema) {
          return schema.parse({
            pages: [1, 2].map((page) => ({ page, text, warnings: [] })),
          });
        },
      };
      await expect(
        extractUpload(bytes, "scan.pdf", ctx, model, {
          sources: [],
          checkpoint,
        }),
      ).rejects.toMatchObject({ code });
      expect(checkpoint).not.toHaveBeenCalled();
    }
  });
  it("reads raw DOCX text without rendering document HTML", async () => {
    const bytes = zip({
      "[Content_Types].xml":
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      "word/document.xml":
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>A useful explanation of how filters reuse their learned weights at each position.</w:t></w:r></w:p></w:body></w:document>',
    });
    expect((await extractInWorker(bytes, "docx")).sources[0].text).toContain(
      "filters reuse",
    );
  });
  it("preserves textual LaTeX and warns when a DOCX contains native equations", async () => {
    const latex = String.raw`A worked example uses $\frac{1}{2}$ and explains the division in detail.`;
    const bytes = zip({
      "[Content_Types].xml":
        '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>',
      "word/document.xml": `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"><w:body><w:p><w:r><w:t>${latex}</w:t></w:r><m:oMath><m:r><m:t>x</m:t></m:r></m:oMath></w:p></w:body></w:document>`,
    });
    const result = await extractInWorker(bytes, "docx");
    expect(result.sources[0].text).toContain(latex);
    expect(result.sources[0].warnings).toEqual([
      "Native equations in this DOCX were not extracted. Add them as LaTeX during review, or upload a PDF.",
    ]);
  });
  it("rejects damaged and suspicious archives", async () => {
    await expect(
      extractInWorker(Buffer.from("not a zip"), "docx"),
    ).rejects.toThrow();
    await expect(
      extractInWorker(zip({ "../escape": "bad" }), "docx"),
    ).rejects.toThrow();
  });
  it("enforces upload limits before parsing unbounded multipart content", async () => {
    await expect(
      readUpload(
        new Request("http://localhost/api/materials", {
          method: "POST",
          headers: { "content-length": "20000000" },
          body: "anything",
        }),
      ),
    ).rejects.toMatchObject({ status: 413 });
  });
  it.each([false, true])(
    "accepts one file and its operation ID (file first: %s)",
    async (fileFirst) => {
      const form = new FormData();
      const operationId = "11111111-1111-4111-8111-111111111111";
      const contents = "A learning document about energy storage.";
      const appendFile = () =>
        form.append("file", new Blob([contents]), "lesson.txt");
      if (fileFirst) appendFile();
      form.append("operationId", operationId);
      if (!fileFirst) appendFile();
      const upload = await readUpload(
        new Request("http://localhost/api/materials", {
          method: "POST",
          body: form,
        }),
      );
      expect(upload).toEqual({
        bytes: Buffer.from(contents),
        filename: "lesson.txt",
        operationId,
      });
    },
  );
  it.each(["file", "operationId"])(
    "rejects an additional %s part",
    async (extraPart) => {
      const form = new FormData();
      form.append("operationId", "11111111-1111-4111-8111-111111111111");
      form.append("file", new Blob(["Learning notes"]), "lesson.txt");
      if (extraPart === "file")
        form.append("file", new Blob(["More notes"]), "extra.txt");
      else form.append("operationId", "22222222-2222-4222-8222-222222222222");
      const encoded = new Request("http://localhost/api/materials", {
        method: "POST",
        body: form,
      });
      await expect(
        readUpload(
          new Request(encoded.url, {
            method: "POST",
            headers: encoded.headers,
            body: await encoded.arrayBuffer(),
          }),
        ),
      ).rejects.toMatchObject({
        status: 413,
        message:
          extraPart === "file"
            ? "Upload one file at a time."
            : "Unexpected upload fields.",
      });
    },
  );
});
