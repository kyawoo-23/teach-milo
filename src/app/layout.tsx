import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: {
    default: "TeachBack AI — Learn by teaching",
    template: "%s | TeachBack AI",
  },
  description:
    "Bring your learning material. Teach Milo, a curious AI student. Find out what your explanations really show.",
};
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a className="skip-link" href="#main">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
