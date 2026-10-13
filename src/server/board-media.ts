import "server-only";
import { inflateSync } from "node:zlib";
import type { Message, Session } from "@/lib/contracts";
import {
  BOARD_PNG_BYTES,
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
} from "@/lib/board-tools";
import { AppError } from "@/lib/errors";
import { database, decode, readOwned } from "./db";

export function validatePng(base64: string): Buffer {
  const bytes = Buffer.from(base64, "base64");
  const invalid = () => {
    throw new AppError(
      "INVALID_BOARD",
      "The sketch preview could not be read. Attach it again.",
    );
  };
  if (
    bytes.length > BOARD_PNG_BYTES ||
    bytes.length < 45 ||
    bytes.toString("base64") !== base64 ||
    !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return invalid();
  if (
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR"
  )
    return invalid();
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (
    !width ||
    !height ||
    width > CANVAS_WIDTH ||
    height > CANVAS_HEIGHT ||
    bytes[24] !== 8 ||
    ![0, 2, 4, 6].includes(bytes[25]) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    bytes[28] !== 0
  )
    return invalid();
  let at = 8,
    imageData = false,
    ended = false;
  const compressed: Buffer[] = [];
  while (at + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(at),
      end = at + 12 + length;
    if (end > bytes.length) return invalid();
    const kind = bytes.toString("ascii", at + 4, at + 8);
    let crc = 0xffffffff;
    for (const b of bytes.subarray(at + 4, end - 4)) {
      crc ^= b;
      for (let n = 0; n < 8; n++)
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
    if ((crc ^ 0xffffffff) >>> 0 !== bytes.readUInt32BE(end - 4))
      return invalid();
    if (kind === "IHDR" && at !== 8) return invalid();
    if (kind === "IDAT") {
      imageData = true;
      compressed.push(bytes.subarray(at + 8, end - 4));
    }
    if (kind === "IEND") {
      ended = length === 0 && end === bytes.length;
      break;
    }
    at = end;
  }
  if (!imageData || !ended) return invalid();
  const channels: Record<number, number> = { 0: 1, 2: 3, 4: 2, 6: 4 };
  const rowBytes = width * channels[bytes[25]] + 1;
  try {
    const pixels = inflateSync(Buffer.concat(compressed), {
      maxOutputLength: rowBytes * height,
    });
    if (pixels.length !== rowBytes * height) return invalid();
    for (let row = 0; row < height; row++)
      if (pixels[row * rowBytes] > 4) return invalid();
  } catch {
    return invalid();
  }
  return bytes;
}
export function modelMessages(messages: Message[]): Message[] {
  return messages.map((message) => {
    if (!message.board || message.board.version !== 2) return message;
    const { png: _png, imageUrl: _url, ...board } = message.board;
    return { ...message, board };
  });
}
export function publicMessages(
  sessionId: string,
  messages: Message[],
): Message[] {
  return messages.map((message) => {
    if (message.board?.version !== 2 || !message.board.png) return message;
    const { png: _png, ...board } = message.board;
    return {
      ...message,
      board: {
        ...board,
        imageUrl: `/api/sessions/${sessionId}/messages/${message.id}/board-image`,
      },
    };
  });
}
export async function readBoardImage(
  sessionId: string,
  messageId: string,
  ownerId: string,
) {
  const session = await readOwned<
    Pick<Session, "ownerId" | "expiresAt" | "phase">
  >("sessions", sessionId, ownerId, ["phase"]);
  if (session.phase === "transfer")
    throw new AppError(
      "ASSESSMENT_ACTIVE",
      "Teaching history is unavailable during the independent check.",
      403,
    );
  const doc = await database()
    .collection("sessions")
    .doc(sessionId)
    .collection("messages")
    .doc(messageId)
    .get();
  const message = doc.exists ? decode<Message>(doc.data()) : undefined;
  if (message?.board?.version !== 2 || !message.board.png)
    throw new AppError(
      "NOT_FOUND",
      "This evidence message is unavailable.",
      404,
    );
  return validatePng(message.board.png);
}
