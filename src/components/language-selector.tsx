"use client";
import { useId } from "react";
import { Languages } from "lucide-react";
import {
  isLocale,
  locales,
  localeNames,
  type Locale,
} from "@/lib/i18n/locales";
import { useI18n } from "./locale-context";
import { CustomSelect } from "./custom-select";

function LanguageFlag({ language }: { language: Locale }) {
  const star =
    "0,-1 0.2245,-0.309 0.9511,-0.309 0.3633,0.118 0.5878,0.809 0,0.382 -0.5878,0.809 -0.3633,0.118 -0.9511,-0.309 -0.2245,-0.309";
  return (
    <svg
      width={24}
      height={16}
      viewBox={language === "en" ? "0 0 60 30" : "0 0 30 20"}
      preserveAspectRatio="none"
      className="language-flag"
      aria-hidden="true"
      focusable="false"
    >
      {language === "en" ? (
        <>
          <path fill="#012169" d="M0 0h60v30H0z" />
          <path stroke="#fff" strokeWidth={6} d="m0 0 60 30M60 0 0 30" />
          <path
            fill="#c8102e"
            d="M0 0 30 15h-4L0 2zM60 0 30 15v-2L56 0zM60 30 30 15h4l26 13zM0 30 30 15v2L4 30z"
          />
          <path stroke="#fff" strokeWidth={10} d="M30 0v30M0 15h60" />
          <path stroke="#c8102e" strokeWidth={6} d="M30 0v30M0 15h60" />
        </>
      ) : language === "zh-CN" ? (
        <>
          <path fill="#de2910" d="M0 0h30v20H0z" />
          <g fill="#ffde00">
            <polygon points={star} transform="translate(5 5) scale(3)" />
            <polygon points={star} transform="translate(10 2) rotate(-121)" />
            <polygon points={star} transform="translate(12 4) rotate(-98)" />
            <polygon points={star} transform="translate(12 7) rotate(-74)" />
            <polygon points={star} transform="translate(10 9) rotate(-51)" />
          </g>
        </>
      ) : (
        <>
          <path fill="#fff" d="M0 0h30v20H0z" />
          <circle cx={15} cy={10} r={6} fill="#bc002d" />
        </>
      )}
    </svg>
  );
}

export function LanguageSelector({
  value,
  onChange,
  teaching = false,
  disabled = false,
}: {
  value?: Locale;
  onChange?: (locale: Locale) => void;
  teaching?: boolean;
  disabled?: boolean;
}) {
  const { locale, setLocale, t } = useI18n();
  const id = useId();
  const label = t(teaching ? "AI teaching language" : "Website language");
  return (
    <div className={teaching ? "teaching-language-field" : "language-selector"}>
      <label
        id={`${id}-label`}
        htmlFor={id}
        className={teaching ? "field-label" : "visually-hidden"}
      >
        {label}
      </label>
      <CustomSelect
        id={id}
        label={label}
        labelledBy={`${id}-label`}
        value={value ?? locale}
        disabled={disabled}
        compact={!teaching}
        name={teaching ? "teachingLanguage" : undefined}
        icon={<Languages size={teaching ? 18 : 16} />}
        options={locales.map((language) => ({
          value: language,
          label: localeNames[language],
          lang: language,
          searchText: language,
          icon: <LanguageFlag language={language} />,
        }))}
        onChange={(language) => {
          if (isLocale(language)) (onChange ?? setLocale)(language);
        }}
      />
    </div>
  );
}
