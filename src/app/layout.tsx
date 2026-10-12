import type { Metadata, Viewport } from "next";
import "./globals.css";
import { LocaleProvider } from "@/components/locale-context";
import { getLocale } from "@/lib/i18n/server";
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
  themeColor: "#f8f9fc",
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  return {
    title: {
      default: translate(locale, "TeachBack AI — Learn by teaching"),
      template: "%s | TeachBack AI",
    },
    description: translate(
      locale,
      "Bring your learning material. Teach Milo, a curious AI student. Find out what your explanations really show.",
    ),
    icons: {
      icon: [
        {
          url: "/brand/teachback-icon-64.png",
          sizes: "64x64",
          type: "image/png",
        },
      ],
      apple: [
        {
          url: "/brand/teachback-icon-master.png",
          sizes: "1254x1254",
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
  const locale = await getLocale();
  return (
    <html lang={locale} data-scroll-behavior="smooth">
      <body>
        <LocaleProvider initialLocale={locale}>
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
        </LocaleProvider>
      </body>
    </html>
  );
}
