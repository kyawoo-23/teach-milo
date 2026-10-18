export const locales = ["en", "zh-CN", "ja", "ko", "th"] as const;
export type Locale = (typeof locales)[number];
export const teachingLanguages = [
  "en",
  "zh-CN",
  "ja",
  "ko",
  "th",
  "vi",
  "id",
  "ms",
  "my",
] as const;
export type TeachingLanguage = (typeof teachingLanguages)[number];
export const teachingLanguageNames: Record<TeachingLanguage, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
  ko: "한국어",
  th: "ภาษาไทย",
  vi: "Tiếng Việt",
  id: "Bahasa Indonesia",
  ms: "Bahasa Melayu",
  my: "မြန်မာဘာသာ",
};
export const teachingLanguageEnglishNames: Record<TeachingLanguage, string> = {
  en: "English",
  "zh-CN": "Simplified Chinese",
  ja: "Japanese",
  ko: "Korean",
  th: "Thai",
  vi: "Vietnamese",
  id: "Indonesian",
  ms: "Malay",
  my: "Burmese",
};
export const localeNames: Record<Locale, string> = {
  en: teachingLanguageNames.en,
  "zh-CN": teachingLanguageNames["zh-CN"],
  ja: teachingLanguageNames.ja,
  ko: teachingLanguageNames.ko,
  th: teachingLanguageNames.th,
};
export const LOCALE_COOKIE = "teach-milo-locale";
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}
export function isTeachingLanguage(value: unknown): value is TeachingLanguage {
  return (
    typeof value === "string" &&
    teachingLanguages.includes(value as TeachingLanguage)
  );
}
export function lessonLanguage(value?: string): TeachingLanguage {
  return isTeachingLanguage(value) ? value : "en";
}
export function dictionaryLocale(value?: string): Locale {
  const teaching = lessonLanguage(value);
  return isLocale(teaching) ? teaching : "en";
}
export function resolveLocale(cookie?: string, acceptLanguage = ""): Locale {
  if (isLocale(cookie)) return cookie;
  const preferences = acceptLanguage
    .split(",")
    .map((entry, index) => {
      const [tag, ...parameters] = entry.trim().split(";");
      const quality = parameters.find((p) => p.trim().startsWith("q="));
      return {
        tag: tag.toLowerCase(),
        quality: quality ? Number(quality.trim().slice(2)) : 1,
        index,
      };
    })
    .filter((p) => p.quality > 0 && p.quality <= 1)
    .sort((a, b) => b.quality - a.quality || a.index - b.index);
  for (const { tag } of preferences) {
    if (/^zh(?:-|$)/.test(tag)) return "zh-CN";
    if (/^ja(?:-|$)/.test(tag)) return "ja";
    if (/^ko(?:-|$)/.test(tag)) return "ko";
    if (/^th(?:-|$)/.test(tag)) return "th";
    if (/^en(?:-|$)/.test(tag)) return "en";
  }
  return "en";
}
export const formatNumber = (
  locale: Locale,
  value: number,
  options?: Intl.NumberFormatOptions,
) => new Intl.NumberFormat(locale, options).format(value);
export const formatDate = (
  locale: Locale,
  value: string,
  options?: Intl.DateTimeFormatOptions,
) => new Intl.DateTimeFormat(locale, options).format(new Date(value));
