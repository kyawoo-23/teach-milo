"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { LOCALE_COOKIE, type Locale } from "@/lib/i18n/locales";
import {
  localize,
  localizeError,
  translate,
  type TranslationKey,
  type TranslationParams,
} from "@/lib/i18n/messages";
const LocaleContext = createContext<{
  locale: Locale;
  setLocale: (locale: Locale) => void;
} | null>(null);
export function LocaleProvider({
  initialLocale,
  children,
}: {
  initialLocale: Locale;
  children: React.ReactNode;
}) {
  const [locale, updateLocale] = useState(initialLocale);
  const router = useRouter();
  const setLocale = useCallback(
    (next: Locale) => {
      document.cookie = `${LOCALE_COOKIE}=${next}; Path=/; Max-Age=31536000; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
      updateLocale(next);
      router.refresh();
    },
    [router],
  );
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "TeachBack AI — Learn by teaching");
    const description = document.querySelector('meta[name="description"]');
    if (description)
      description.setAttribute(
        "content",
        translate(
          locale,
          "Bring your learning material. Teach Milo, a curious AI student. Find out what your explanations really show.",
        ),
      );
  }, [locale]);
  const value = useMemo(() => ({ locale, setLocale }), [locale, setLocale]);
  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}
export function useI18n() {
  const context = useContext(LocaleContext);
  if (!context) throw new Error("useI18n requires LocaleProvider");
  const { locale } = context;
  const t = useCallback(
    (key: TranslationKey, params?: TranslationParams) =>
      translate(locale, key, params),
    [locale],
  );
  const text = useCallback(
    (value: string) => localize(locale, value),
    [locale],
  );
  const errorText = useCallback(
    (value: string | Error) => localizeError(locale, value),
    [locale],
  );
  return { ...context, t, text, errorText };
}
