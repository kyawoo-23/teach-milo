import { useId, type Ref } from "react";
import {
  MILO_ORIGINS,
  MILO_STATIC_POSES,
  type MiloPart,
  type MiloState,
} from "./milo-motion";

export function MiloArtwork({
  size = 48,
  state = "idle",
  decorative = false,
  svgRef,
  label = "Milo, your AI student",
}: {
  size?: number;
  state?: MiloState;
  decorative?: boolean;
  svgRef?: Ref<SVGSVGElement>;
  label?: string;
}) {
  const gradientId = `milo-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const part = (name: MiloPart) => ({
    "data-milo-part": name,
    style: {
      transformBox: "view-box" as const,
      transformOrigin: MILO_ORIGINS[name],
      transform: MILO_STATIC_POSES[state]?.[name],
    },
  });
  return (
    <svg
      ref={svgRef}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role={decorative ? undefined : "img"}
      aria-hidden={decorative || undefined}
      aria-label={decorative ? undefined : label}
      className="milo"
      data-milo-state={state}
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop stopColor="#7876ec" />
          <stop offset="1" stopColor="#4d58bb" />
        </linearGradient>
      </defs>
      <g transform="translate(6 6) scale(.9)">
        <g {...part("figure")}>
          <g {...part("body")}>
            <g {...part("antennae")}>
              <path
                d="M34 22C34 12 43 9 48 18L54 31M72 29L82 16C90 9 97 19 89 28"
                fill="none"
                stroke="#9290e9"
                strokeWidth="9"
                strokeLinecap="round"
              />
            </g>
            <path
              d="M16 61C16 34 35 23 61 23s44 12 44 38v19c0 13-10 24-23 24H39C26 104 16 94 16 80Z"
              fill={`url(#${gradientId})`}
            />
            <path
              d="M12 64C2 61 2 83 14 82M108 63c13-2 12 20 0 19"
              fill="#9394ea"
            />
            <rect x="27" y="42" width="68" height="43" rx="20" fill="#f3f2ff" />
            <g {...part("eyes")}>
              <g {...part("blink")}>
                {state === "celebration" ? (
                  <path
                    d="M39 63q5-9 10 0M73 63q5-9 10 0"
                    fill="none"
                    stroke="#31355e"
                    strokeWidth="3.5"
                    strokeLinecap="round"
                  />
                ) : (
                  <>
                    <ellipse cx="44" cy="62" rx="5" ry="7" fill="#31355e" />
                    <ellipse cx="78" cy="62" rx="5" ry="7" fill="#31355e" />
                  </>
                )}
              </g>
            </g>
            <g {...part("mouth")}>
              <path
                d={
                  state === "celebration"
                    ? "M54 70q7 10 14 0"
                    : "M55 71q6 6 12 0"
                }
                fill="none"
                stroke="#6b69ad"
                strokeWidth="3"
                strokeLinecap="round"
              />
            </g>
          </g>
          <g {...part("feet")}>
            <path
              d="m41 105-5 7m46-7 5 7"
              stroke="#525bb6"
              strokeWidth="8"
              strokeLinecap="round"
            />
          </g>
        </g>
      </g>
    </svg>
  );
}
