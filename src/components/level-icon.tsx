import { GraduationCap, Sprout, type LucideIcon } from "lucide-react";
import type { z } from "zod";
import { Level } from "@/lib/contracts";

export type LessonLevel = z.infer<typeof Level>;

const LEVEL_ICONS: Record<Exclude<LessonLevel, "intermediate">, LucideIcon> = {
  introductory: Sprout,
  advanced: GraduationCap,
};

function IntermediateLevelIcon({
  size = 16,
  className,
  muted = false,
}: {
  size?: number;
  className?: string;
  muted?: boolean;
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={`level-icon-intermediate${muted ? " is-muted" : ""}${className ? ` ${className}` : ""}`}
      aria-hidden="true"
      focusable="false"
    >
      <rect
        className="level-icon-bar level-icon-bar--left"
        x="11"
        y="36"
        width="10"
        height="17"
        rx="3"
      />
      <rect
        className="level-icon-bar level-icon-bar--mid"
        x="27"
        y="24"
        width="10"
        height="29"
        rx="3"
      />
      <rect
        className="level-icon-bar level-icon-bar--right"
        x="43"
        y="11"
        width="10"
        height="42"
        rx="3"
      />
    </svg>
  );
}

type LevelIconProps = {
  level: LessonLevel;
  size?: number;
  className?: string;
  /** Unselected level chips: monochrome bars matching Lucide icons. */
  muted?: boolean;
};

export function LevelIcon({
  level,
  size = 16,
  className,
  muted = false,
}: LevelIconProps) {
  if (level === "intermediate") {
    return (
      <IntermediateLevelIcon size={size} className={className} muted={muted} />
    );
  }
  const Icon = LEVEL_ICONS[level];
  return <Icon size={size} className={className} aria-hidden="true" />;
}
