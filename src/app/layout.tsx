import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { TooltipProvider } from "@/components/ui/tooltip";
import "./globals.css";

// shadcn/ui typography: Geist for text and headings, Geist Mono for codes, quantities and dates.
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "VMS · NCF – Integra Group",
  description: "Non Conformity Form, QMS to VMS",
};

// viewport-fit=cover lets the phone action bar sit above the iPhone home indicator (env(safe-area-inset-bottom)).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className={`h-full antialiased ${sans.variable} ${mono.variable}`}>
      <body className="min-h-full bg-background text-sm text-foreground">
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
