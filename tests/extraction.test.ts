import { describe, expect, it } from "vitest";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { crc32 } from "node:zlib";
import { extractInWorker, extractUpload, readUpload } from "@/server/materials";
import type { Model } from "@/server/model";
import { ctx } from "./fixtures";
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
describe("bounded material extraction", () => {
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
    expect(result.chunks).toHaveLength(1);
  });
  it("uses visual extraction for scanned pages and preserves uncertainty", async () => {
    const pdf = await PDFDocument.create();
    pdf.addPage();
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
    const pdf = await PDFDocument.create();
    pdf.addPage();
    pdf.addPage();
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
});
