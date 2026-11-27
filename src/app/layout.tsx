import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { connection } from "next/server";
import { StageBanner } from "@/components/shell/stage-banner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { isStaging, STAGE_BANNER_PX } from "@/platform/environment";
import "./globals.css";

// shadcn/ui typography: Geist for text and headings, Geist Mono for codes, quantities and dates.
const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

const TITLE = "VMS · NCF – Integra Group";

/** On staging every tab title starts with [STAGING]; page titles use the template too. */
export async function generateMetadata(): Promise<Metadata> {
  await connection();
  const prefix = isStaging() ? "[STAGING] " : "";
  return { title: { default: prefix + TITLE, template: `${prefix}%s` }, description: "Non Conformity Form, QMS to VMS" };
}

// viewport-fit=cover lets the phone action bar sit above the iPhone home indicator (env(safe-area-inset-bottom)).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#ffffff" };

export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  // Staging: the banner is fixed at the top, and --stage-h moves the page and the app's sticky bars below it.
  const stage = isStaging() ? ({ "--stage-h": `${STAGE_BANNER_PX}px` } as React.CSSProperties) : undefined;
  return (
    <html lang="id" className={`h-full antialiased ${sans.variable} ${mono.variable}`} style={stage}>
      <body className="min-h-full bg-background pt-[var(--stage-h,0px)] text-sm text-foreground print:pt-0">
        <StageBanner />
        <TooltipProvider delayDuration={200}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
