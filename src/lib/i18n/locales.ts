export const locales = ["en", "zh-CN", "ja"] as const;
export type Locale = (typeof locales)[number];
export const localeNames: Record<Locale, string> = {
  en: "English",
  "zh-CN": "简体中文",
  ja: "日本語",
};
export const LOCALE_COOKIE = "teachback-locale";
export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && locales.includes(value as Locale);
}
export function lessonLanguage(value?: string): Locale {
  return isLocale(value) ? value : "en";
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
