import type { Metadata, Viewport } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { LocaleProvider } from "@/components/locale-context";
import { getLocale } from "@/lib/i18n/server";
import { ThemeProvider } from "@/components/theme-context";
import { getTheme } from "@/lib/theme-server";
import { translate } from "@/lib/i18n/messages";
import { AuthProvider } from "@/components/auth-context";
import { AuthModal } from "@/components/auth-modal";
import { SessionHistoryModal } from "@/components/session-history-modal";
import { ConfirmationProvider } from "@/components/confirmation";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f9fc" },
    { media: "(prefers-color-scheme: dark)", color: "#12131c" },
  ],
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: {
      default: translate(locale, "Teach Milo — Learn by teaching"),
      template: "%s | Teach Milo",
    },
    description: translate(
      locale,
      "Bring your learning material. Teach Milo, a curious AI student. Find out what your explanations really show.",
    ),
    icons: {
      icon: [
        {
          url: "/brand/teach-milo-icon-64.png",
          sizes: "64x64",
          type: "image/png",
        },
        {
          url: "/brand/teach-milo-mark.svg",
          sizes: "any",
          type: "image/svg+xml",
        },
      ],
      apple: [
        {
          url: "/brand/teach-milo-apple-icon.png",
          sizes: "180x180",
          type: "image/png",
        },
      ],
    },
  };
}

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [locale, theme] = await Promise.all([getLocale(), getTheme()]);
  return (
    <html lang={locale} data-theme={theme} data-scroll-behavior="smooth">
      <body>
        <LocaleProvider initialLocale={locale}>
          <ThemeProvider initialTheme={theme}>
            <a className="skip-link" href="#main">
              {translate(locale, "Skip to content")}
            </a>
            <AuthProvider>
              <ConfirmationProvider>
                <AuthModal />
                <SessionHistoryModal />
                {children}
              </ConfirmationProvider>
            </AuthProvider>
          </ThemeProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
