export type MiloState =
  "idle" | "greeting" | "listening" | "thinking" | "reply" | "celebration";
export type MiloPart =
  "figure" | "body" | "antennae" | "eyes" | "blink" | "mouth" | "feet";
export type MiloTimeline = {
  duration: number;
  loop: boolean;
  parts: Partial<Record<MiloPart, Keyframe[]>>;
};
const transforms = (values: string[]): Keyframe[] =>
  values.map((transform) => ({ transform }));

const blink = (duration: number, at: number): Keyframe[] => [
  { transform: "scaleY(1)", offset: 0 },
  { transform: "scaleY(1)", offset: (at - 100) / duration },
  { transform: "scaleY(0.08)", offset: at / duration },
  { transform: "scaleY(0.08)", offset: (at + 40) / duration },
  { transform: "scaleY(1)", offset: (at + 140) / duration },
  { transform: "scaleY(1)", offset: 1 },
];

// Shared by the live SVG and sprite exporter. Units are SVG viewBox units.
export const MILO_MOTIONS: Record<MiloState, MiloTimeline> = {
  idle: {
    duration: 6000,
    loop: true,
    parts: {
      body: transforms([
        "scale(1, 1)",
        "scale(1.012, 1.018)",
        "scale(1, 1)",
        "scale(1.012, 1.018)",
        "scale(1, 1)",
      ]),
      blink: blink(6000, 3900),
    },
  },
  greeting: {
    duration: 1000,
    loop: false,
    parts: {
      figure: transforms([
        "rotate(0deg)",
        "rotate(-3deg)",
        "rotate(3deg)",
        "rotate(-2deg)",
        "rotate(0deg)",
      ]),
      antennae: transforms([
        "rotate(0deg)",
        "rotate(9deg)",
        "rotate(-7deg)",
        "rotate(5deg)",
        "rotate(0deg)",
      ]),
      mouth: transforms(["scaleY(1)", "scaleY(1.3)", "scaleY(1)"]),
      blink: blink(1000, 500),
    },
  },
  listening: {
    duration: 1800,
    loop: true,
    parts: {
      body: transforms([
        "rotate(-2deg) translateY(0px)",
        "rotate(1deg) translateY(1px)",
        "rotate(-2deg) translateY(0px)",
      ]),
      antennae: transforms(["rotate(-3deg)", "rotate(3deg)", "rotate(-3deg)"]),
      blink: blink(1800, 1000),
    },
  },
  thinking: {
    duration: 2400,
    loop: true,
    parts: {
      body: transforms(["rotate(-2deg)", "rotate(2deg)", "rotate(-2deg)"]),
      eyes: transforms([
        "translate(-1px, -2px)",
        "translate(2px, -2px)",
        "translate(-1px, -2px)",
      ]),
      antennae: transforms(["rotate(-5deg)", "rotate(5deg)", "rotate(-5deg)"]),
      blink: blink(2400, 1500),
    },
  },
  reply: {
    duration: 1200,
    loop: false,
    parts: {
      body: transforms([
        "translateY(0px) rotate(0deg)",
        "translateY(2px) rotate(2deg)",
        "translateY(0px) rotate(0deg)",
      ]),
      eyes: transforms(["scaleY(1)", "scaleY(0.75)", "scaleY(1)"]),
      mouth: transforms(["scaleY(1)", "scaleY(1.5)", "scaleY(1)"]),
      blink: blink(1200, 500),
    },
  },
  celebration: {
    duration: 1600,
    loop: false,
    parts: {
      figure: transforms([
        "translateY(0px)",
        "translateY(1px)",
        "translateY(-4px)",
        "translateY(0px)",
        "translateY(-3px)",
        "translateY(0px)",
      ]),
      body: transforms([
        "scale(1, 1)",
        "scale(1.02, 0.98)",
        "scale(0.99, 1.02)",
        "scale(1, 1)",
      ]),
      antennae: transforms([
        "rotate(0deg)",
        "rotate(-6deg)",
        "rotate(6deg)",
        "rotate(0deg)",
      ]),
      feet: transforms([
        "rotate(0deg)",
        "rotate(-3deg)",
        "rotate(3deg)",
        "rotate(0deg)",
      ]),
    },
  },
};
export const MILO_ORIGINS: Record<MiloPart, string> = {
  figure: "60px 90px",
  body: "60px 104px",
  antennae: "60px 29px",
  eyes: "60px 62px",
  blink: "60px 62px",
  mouth: "61px 71px",
  feet: "60px 104px",
};
export const MILO_STATIC_POSES: Partial<
  Record<MiloState, Partial<Record<MiloPart, string>>>
> = {
  listening: { body: "rotate(-2deg)" },
  thinking: { body: "rotate(2deg)", eyes: "translateY(-2px)" },
};
export function animateMilo(svg: SVGSVGElement, state: MiloState): Animation[] {
  return animateMiloTimeline(svg, MILO_MOTIONS[state]);
}
export function animateMiloTimeline(
  svg: SVGSVGElement,
  motion: MiloTimeline,
): Animation[] {
  return Object.entries(motion.parts).flatMap(([part, keyframes]) => {
    const element = svg.querySelector<SVGGElement>(
      `[data-milo-part="${part}"]`,
    );
    if (!element?.animate) return [];
    return [
      element.animate(keyframes, {
        duration: motion.duration,
        iterations: motion.loop ? Infinity : 1,
        easing: part === "blink" ? "linear" : "ease-in-out",
        fill: "both",
      }),
    ];
  });
}
