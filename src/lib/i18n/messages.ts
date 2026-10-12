import zh from "./zh-CN.json";
import ja from "./ja.json";
import type { Locale } from "./locales";
export type TranslationKey = keyof typeof zh;
export type TranslationParams = Record<string, string | number>;
export type Messages = Record<TranslationKey, string>;
export const dictionaries: Record<Locale, Messages> = {
  en: Object.fromEntries(Object.keys(zh).map((key) => [key, key])) as Messages,
  "zh-CN": zh,
  ja: ja satisfies Messages,
};
export function isTranslationKey(key: string): key is TranslationKey {
  return Object.hasOwn(zh, key);
}
export function translate(
  locale: Locale,
  key: TranslationKey,
  params: TranslationParams = {},
): string {
  return dictionaries[locale][key].replace(
    /\{(\w+)\}/g,
    (match, name: string) => String(params[name] ?? match),
  );
}
// Dynamic app notices and enum labels may arrive from older API responses.
// Source text, conversation text, and generated lesson content never use this helper.
export function localize(locale: Locale, value: string): string {
  return isTranslationKey(value) ? translate(locale, value) : value;
}

export function localizeError(locale: Locale, error: string | Error): string {
  const detail = error as Error & {
    messageKey?: string;
    params?: TranslationParams;
  };
  const message = typeof error === "string" ? error : error.message;
  if (isTranslationKey(detail.messageKey ?? ""))
    return translate(
      locale,
      detail.messageKey as TranslationKey,
      detail.params,
    );
  if (isTranslationKey(message)) return translate(locale, message);
  const cancelled = /^Google sign-in was cancelled \((.*)\)\.$/.exec(message);
  if (cancelled)
    return translate(locale, "Google sign-in was cancelled ({reason}).", {
      reason: cancelled[1],
    });
  return locale === "en"
    ? message
    : translate(locale, "Something went wrong. Please retry.");
}
