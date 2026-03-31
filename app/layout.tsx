import type { Metadata } from "next";
import "katex/dist/katex.min.css";
import "./globals.css";
import { Providers } from "../components/Providers";
import { DM_Sans, IBM_Plex_Mono } from "next/font/google";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-ui",
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: "Bekrin School",
  description: "DIM imtahanına hazırlıq üçün kurs idarəetmə sistemi",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // suppressHydrationWarning: extensions (e.g. Grammarly) inject data-* attrs; prefer disabling on localhost
  return (
    <html lang="az" suppressHydrationWarning>
      <body className={`${dmSans.variable} ${plexMono.variable} min-h-screen bg-slate-50 text-slate-900`} suppressHydrationWarning>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}

