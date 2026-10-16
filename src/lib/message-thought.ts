import type { Message } from "./contracts";
import type { TeachingLanguage } from "./i18n/locales";
import { translateTeaching, type TranslationKey } from "./i18n/messages";

const genericReasons: TranslationKey[] = [
  "I'm curious to hear how you explain this.",
  "I want to understand your explanation a little better.",
  "I'm still wondering why it works that way.",
  "I think a small example would help me follow your idea.",
  "I'm unsure whether my idea makes sense.",
  "Your explanation is helping me connect the ideas.",
];

const comparable = (text: string) =>
  text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "");

// Keep stored thoughts intact; only disclose copy that adds something to the reply.
export function visibleThought(message: Message, language?: TeachingLanguage) {
  const thought = message.role === "student" ? message.thought : undefined;
  if (!thought) return undefined;
  const reason = comparable(thought.reason);
  if (!reason || comparable(message.text).includes(reason)) return undefined;
  if (
    genericReasons.some(
      (key) =>
        reason === comparable(key) ||
        reason === comparable(translateTeaching(language, key)),
    )
  )
    return undefined;
  return thought;
}
