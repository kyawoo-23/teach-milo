import { describe, expect, it } from "vitest";
import { ToolStateSchema, type SketchObject } from "@/lib/board-tools";
import {
  resizeByPointer,
  rotateByDegrees,
  scaleObject,
} from "@/lib/sketch";
import { sketchFixture } from "./board-fixtures";

const rectangle: SketchObject = {
  id: "box",
  type: "rectangle",
  color: "#655dcc",
  width: 4,
  points: [
    { x: 100, y: 100 },
    { x: 200, y: 180 },
  ],
  text: "",
};

describe("sketch transforms", () => {
  it("resizes a rectangle from the east handle", () => {
    const next = resizeByPointer(rectangle, "e", { x: 260, y: 140 });
    expect(next.points).toEqual([
      { x: 100, y: 100 },
      { x: 248, y: 180 },
    ]);
  });

  it("rotates without moving the stored points", () => {
    const next = rotateByDegrees(rectangle, 90);
    expect(next.rotation).toBe(90);
    expect(next.points).toEqual(rectangle.points);
    expect(rotateByDegrees(rectangle, 180).rotation).toBe(-180);
    expect(rotateByDegrees(rectangle, 270).rotation).toBe(-90);
  });

  it("scales text and refuses a shape that would leave the canvas", () => {
    const label = sketchFixture.objects[0];
    expect(scaleObject(label, 1.5)?.scale).toBe(1.5);
    const edge: SketchObject = {
      ...rectangle,
      points: [
        { x: 20, y: 20 },
        { x: 900, y: 600 },
      ],
    };
    expect(scaleObject(edge, 1.15)).toBeNull();
  });

  it("keeps older sketches valid and accepts rotation and scale", () => {
    expect(ToolStateSchema.safeParse(sketchFixture).success).toBe(true);
    expect(
      ToolStateSchema.safeParse({
        ...sketchFixture,
        objects: [{ ...sketchFixture.objects[0], rotation: 15, scale: 1.5 }],
      }).success,
    ).toBe(true);
    expect(
      ToolStateSchema.safeParse({
        ...sketchFixture,
        objects: [{ ...sketchFixture.objects[0], rotation: 400 }],
      }).success,
    ).toBe(false);
  });
});
