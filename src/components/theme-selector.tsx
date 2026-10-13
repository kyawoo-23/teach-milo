"use client";
import { useId } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { isTheme, themes, type Theme } from "@/lib/theme";
import { useI18n } from "./locale-context";
import { useTheme } from "./theme-context";
import { CustomSelect } from "./custom-select";

const themeIcons = { system: Monitor, light: Sun, dark: Moon } as const;
const themeLabels = { system: "System", light: "Light", dark: "Dark" } as const;

function ThemeIcon({ theme, size }: { theme: Theme; size: number }) {
  const Icon = themeIcons[theme];
  return <Icon size={size} aria-hidden />;
}

export function ThemeSelector() {
  const { t } = useI18n();
  const { theme, setTheme } = useTheme();
  const id = useId();
  const label = t("Theme");
  return (
    <div className="theme-selector">
      <label id={`${id}-label`} htmlFor={id} className="visually-hidden">
        {label}
      </label>
      <CustomSelect
        id={id}
        label={label}
        labelledBy={`${id}-label`}
        value={theme}
        compact
        icon={<ThemeIcon theme={theme} size={16} />}
        options={themes.map((option) => ({
          value: option,
          label: t(themeLabels[option]),
          icon: <ThemeIcon theme={option} size={16} />,
        }))}
        onChange={(next) => {
          if (isTheme(next)) setTheme(next);
        }}
      />
    </div>
  );
}
