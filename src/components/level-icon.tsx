import { GraduationCap, Layers, Sprout, type LucideIcon } from "lucide-react";
import type { z } from "zod";
import { Level } from "@/lib/contracts";

export type LessonLevel = z.infer<typeof Level>;

const LEVEL_ICONS: Record<LessonLevel, LucideIcon> = {
  introductory: Sprout,
  intermediate: Layers,
  advanced: GraduationCap,
};

type LevelIconProps = {
  level: LessonLevel;
  size?: number;
  className?: string;
};

export function LevelIcon({ level, size = 16, className }: LevelIconProps) {
  const Icon = LEVEL_ICONS[level];
  return <Icon size={size} className={className} aria-hidden="true" />;
}
