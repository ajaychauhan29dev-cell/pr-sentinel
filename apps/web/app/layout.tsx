import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "PR Sentinel",
  description: "Agentic code review harness with self-verifying findings"
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="nav">
          <Link href="/" className="brand">
            🛡️ PR Sentinel
          </Link>
          <Link href="/">Runs</Link>
          <Link href="/escalations">Escalation queue</Link>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
