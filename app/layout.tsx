import type { Metadata, Viewport } from "next";
import "./globals.css";
import { headers } from "next/headers";
import { readInstanceState } from "@/scripts/restore-core.mjs";
import { getDatabasePath } from "@/lib/data-directory";
import { DataGenerationBanner } from "./components/data-generation-banner";

export const metadata: Metadata = {
  title: "Serendipity",
  description: "AI 旅行规划助手：把想法整理成可确认、可执行的旅行计划。",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const generation = requestHeaders.get("x-page-data-generation") ?? readInstanceState(getDatabasePath()).dataGeneration;
  return (
    <html lang="zh-CN">
      <head><meta name="serendipity-data-generation" content={generation} /></head>
      <body><DataGenerationBanner />{children}</body>
    </html>
  );
}
