import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/auth-context";
import { AuthModal } from "@/components/auth-modal";
import { SessionHistoryModal } from "@/components/session-history-modal";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#f8f9fc",
};

export const metadata: Metadata = {
  title: {
    default: "TeachBack AI — Learn by teaching",
    template: "%s | TeachBack AI",
  },
  description:
    "Bring your learning material. Teach Milo, a curious AI student. Find out what your explanations really show.",
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

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        <AuthProvider>
          <AuthModal />
          <SessionHistoryModal />
          {children}
        </AuthProvider>
      </body>
    </html>
  );
}
