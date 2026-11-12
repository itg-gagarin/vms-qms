import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "VMS · NCF – Integra Group",
  description: "Non Conformity Form, QMS to VMS",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="id" className="h-full antialiased">
      <body className="min-h-full bg-slate-100 text-slate-900">{children}</body>
    </html>
  );
}
