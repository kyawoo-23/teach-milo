"use client";
import { useId } from "react";
import { Languages } from "lucide-react";
import {
  isLocale,
  isTeachingLanguage,
  locales,
  teachingLanguages,
  teachingLanguageEnglishNames,
  teachingLanguageNames,
  type TeachingLanguage,
} from "@/lib/i18n/locales";
import { useI18n } from "./locale-context";
import { CustomSelect } from "./custom-select";

function LanguageFlag({ language }: { language: TeachingLanguage }) {
  const star =
    "0,-1 0.2245,-0.309 0.9511,-0.309 0.3633,0.118 0.5878,0.809 0,0.382 -0.5878,0.809 -0.3633,0.118 -0.9511,-0.309 -0.2245,-0.309";
  return (
    <svg
      width={24}
      height={16}
      viewBox={
        language === "en"
          ? "0 0 60 30"
          : language === "ko"
            ? "0 0 24 16"
            : "0 0 30 20"
      }
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
      ) : language === "ja" ? (
        <>
          <path fill="#fff" d="M0 0h30v20H0z" />
          <circle cx={15} cy={10} r={6} fill="#bc002d" />
        </>
      ) : language === "ko" ? (
        <>
          <path fill="#fff" d="M0 0h24v16H0z" />
          <g transform="translate(12 8) rotate(-90)">
            <circle r={3.4} fill="#0047a0" />
            <path
              fill="#cd2e3a"
              d="M0-3.4a3.4 3.4 0 0 1 0 6.8 1.7 1.7 0 0 1 0-3.4 1.7 1.7 0 0 0 0-3.4"
            />
          </g>
          <g fill="#000">
            {(
              [
                [3.4, 2.6, -45, [0, 0, 0]],
                [20.6, 2.6, 45, [1, 0, 1]],
                [3.4, 13.4, 45, [0, 1, 0]],
                [20.6, 13.4, -45, [1, 1, 1]],
              ] as const
            ).map(([x, y, rotate, bars]) => (
              <g
                key={`${x}-${y}`}
                transform={`translate(${x} ${y}) rotate(${rotate})`}
              >
                {bars.map((broken, index) => {
                  const barY = (index - 1) * 1.2 - 0.4;
                  return broken ? (
                    <g key={index}>
                      <rect x={-1.55} y={barY} width={1.1} height={0.8} />
                      <rect x={0.45} y={barY} width={1.1} height={0.8} />
                    </g>
                  ) : (
                    <rect
                      key={index}
                      x={-1.55}
                      y={barY}
                      width={3.1}
                      height={0.8}
                    />
                  );
                })}
              </g>
            ))}
          </g>
        </>
      ) : language === "th" ? (
        <>
          <path fill="#a51931" d="M0 0h30v3.34H0zM0 16.66h30V20H0z" />
          <path fill="#fff" d="M0 3.34h30V6.67H0zM0 13.33h30v3.33H0z" />
          <path fill="#2d2a4a" d="M0 6.67h30v6.66H0z" />
        </>
      ) : language === "vi" ? (
        <>
          <path fill="#da251d" d="M0 0h30v20H0z" />
          <polygon
            points={star}
            fill="#ff0"
            transform="translate(15 10) scale(5)"
          />
        </>
      ) : language === "id" ? (
        <>
          <path fill="#ce1126" d="M0 0h30v10H0z" />
          <path fill="#fff" d="M0 10h30v10H0z" />
        </>
      ) : language === "ms" ? (
        <>
          <path fill="#cc0001" d="M0 0h30v1.43H0z" />
          <path fill="#fff" d="M0 1.43h30v1.42H0z" />
          <path fill="#cc0001" d="M0 2.85h30v1.43H0z" />
          <path fill="#fff" d="M0 4.28h30v1.42H0z" />
          <path fill="#cc0001" d="M0 5.7h30v1.43H0z" />
          <path fill="#fff" d="M0 7.13h30v1.42H0z" />
          <path fill="#cc0001" d="M0 8.55h30v1.43H0z" />
          <path fill="#fff" d="M0 9.98h30v1.42H0z" />
          <path fill="#cc0001" d="M0 11.4h30v1.43H0z" />
          <path fill="#fff" d="M0 12.83h30v1.42H0z" />
          <path fill="#cc0001" d="M0 14.25h30v1.43H0z" />
          <path fill="#fff" d="M0 15.68h30v1.42H0z" />
          <path fill="#cc0001" d="M0 17.1h30v1.45H0z" />
          <path fill="#fff" d="M0 18.55h30V20H0z" />
          <path fill="#010066" d="M0 0h15v10H0z" />
          <circle cx={6.2} cy={5} r={2.6} fill="#ffcc00" />
          <circle cx={7.2} cy={5} r={2.1} fill="#010066" />
        </>
      ) : (
        <>
          <path fill="#fecb00" d="M0 0h30v6.67H0z" />
          <path fill="#34b233" d="M0 6.67h30v6.66H0z" />
          <path fill="#ea2839" d="M0 13.33h30V20H0z" />
          <polygon
            points={star}
            fill="#fff"
            transform="translate(15 10) scale(4)"
          />
        </>
      )}
    </svg>
  );
}

export function LanguageSelector({
  value,
  onChange,
  onBlur,
  teaching = false,
  disabled = false,
}: {
  value?: TeachingLanguage;
  onChange?: (language: TeachingLanguage) => void;
  onBlur?: () => void;
  teaching?: boolean;
  disabled?: boolean;
}) {
  const { locale, setLocale, t } = useI18n();
  const id = useId();
  const label = t(
    teaching ? "What language should Milo use?" : "Website language",
  );
  const choices = teaching ? teachingLanguages : locales;
  return (
    <div
      className={teaching ? "teaching-language-field" : "language-selector"}
      onBlur={onBlur}
    >
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
        options={choices.map((language) => ({
          value: language,
          label: teachingLanguageNames[language],
          lang: language,
          searchText: `${teachingLanguageEnglishNames[language]} ${language}`,
          icon: <LanguageFlag language={language} />,
        }))}
        onChange={(language) => {
          if (!isTeachingLanguage(language)) return;
          if (teaching) onChange?.(language);
          else if (isLocale(language)) (onChange ?? setLocale)(language);
        }}
      />
    </div>
  );
}
