"use client";

import { LanguageSelector } from "./language-selector";
import { ThemeSelector } from "./theme-selector";

export function HeaderPreferences({ showTheme = true }: { showTheme?: boolean }) {
  return (
    <div className="header-preferences">
      <LanguageSelector />
      {showTheme ? <ThemeSelector /> : null}
    </div>
  );
}
