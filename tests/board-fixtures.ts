import { deflateSync } from "node:zlib";
export function pngFixture(width = 1, height = 1): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const payload = Buffer.concat([Buffer.from(type), data]);
    let crc = 0xffffffff;
    for (const b of payload) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length);
    payload.copy(result, 4);
    result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.from([0, 255, 255, 255, 255]))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
export const sketchFixture = {
  kind: "sketch" as const,
  objects: [
    {
      id: "label1",
      type: "text" as const,
      color: "#655dcc" as const,
      width: 4,
      points: [{ x: 80, y: 80 }],
      text: "Weights are reused",
    },
  ],
};
