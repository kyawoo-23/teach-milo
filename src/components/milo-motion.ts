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
    duration: 3600,
    loop: true,
    parts: {
      // Move the whole figure together and ease each nod to avoid sharp reversals.
      figure: [
        {
          transform: "rotate(0deg) translateY(0px)",
          offset: 0,
          easing: "ease-in-out",
        },
        {
          transform: "rotate(-4deg) translateY(0px)",
          offset: 0.22,
          easing: "ease-in-out",
        },
        {
          transform: "rotate(-4deg) translateY(3px)",
          offset: 0.45,
          easing: "ease-in-out",
        },
        {
          transform: "rotate(-4deg) translateY(0px)",
          offset: 0.65,
          easing: "ease-in-out",
        },
        { transform: "rotate(0deg) translateY(0px)", offset: 0.85 },
        { transform: "rotate(0deg) translateY(0px)", offset: 1 },
      ],
      blink: blink(3600, 2800),
    },
  },
  thinking: {
    duration: 2400,
    loop: true,
    parts: {
      // Keep the body tilted while the eyes search upward and antennae twitch.
      body: transforms(["rotate(5deg)", "rotate(7deg)", "rotate(5deg)"]),
      eyes: [
        { transform: "translate(-4px, -4px)", offset: 0 },
        { transform: "translate(-4px, -4px)", offset: 0.35 },
        { transform: "translate(4px, -4px)", offset: 0.5 },
        { transform: "translate(4px, -4px)", offset: 0.8 },
        { transform: "translate(-4px, -4px)", offset: 1 },
      ],
      antennae: [
        { transform: "rotate(0deg)", offset: 0 },
        { transform: "rotate(0deg)", offset: 0.2 },
        { transform: "rotate(12deg)", offset: 0.28 },
        { transform: "rotate(-8deg)", offset: 0.36 },
        { transform: "rotate(0deg)", offset: 0.44 },
        { transform: "rotate(0deg)", offset: 1 },
      ],
      blink: blink(2400, 1500),
    },
  },
  reply: {
    duration: 1200,
    loop: false,
    parts: {
      body: transforms([
        "translateY(0px) rotate(0deg) scale(1, 1)",
        "translateY(-5px) rotate(-3deg) scale(0.98, 1.03)",
        "translateY(1px) rotate(2deg) scale(1.03, 0.97)",
        "translateY(-3px) rotate(-2deg) scale(0.99, 1.02)",
        "translateY(0px) rotate(0deg) scale(1, 1)",
      ]),
      eyes: transforms(["scaleY(1)", "scaleY(0.85)", "scaleY(1)"]),
      mouth: transforms([
        "scaleY(0.2)",
        "scaleY(1)",
        "scaleY(0.3)",
        "scaleY(0.85)",
        "scaleY(0.2)",
        "scaleY(0.7)",
        "scaleY(0.2)",
      ]),
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
  listening: {
    figure: "rotate(-4deg)",
    eyes: "scaleY(1.12)",
    antennae: "rotate(-4deg)",
  },
  thinking: { body: "rotate(5deg)", eyes: "translateY(-2px)" },
  reply: { mouth: "scaleY(0.65)" },
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
