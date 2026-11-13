import type { Metadata, Viewport } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Inter } from "next/font/google";
import "./globals.css";

// INTEC design system: Inter for headings, IBM Plex Sans for text, IBM Plex Mono for codes, quantities and dates.
const display = Inter({ subsets: ["latin"], weight: ["500", "600", "700"], variable: "--font-inter" });
const body = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-mono" });

export const metadata: Metadata = {
  title: "VMS · NCF – Integra Group",
  description: "Non Conformity Form, QMS to VMS",
};

// viewport-fit=cover lets the phone action bar sit above the iPhone home indicator (env(safe-area-inset-bottom)).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f7f8fa" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={`h-full antialiased ${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-full bg-page text-ink">{children}</body>
    </html>
  );
}
