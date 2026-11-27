import type { Metadata, Viewport } from "next";
import { Rajdhani, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import { THEME_BOOT } from "@/lib/brand";
import { BrandSync } from "@/components/brand-sync";

const rajdhani = Rajdhani({
  variable: "--font-rajdhani",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "500"],
  subsets: ["latin"],
});

export const viewport: Viewport = {
  themeColor: "#0a1526",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export const metadata: Metadata = {
  title: "Maintenance ERP — Operations Command",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Maintenance", statusBarStyle: "black-translucent" },
  icons: { apple: "/icons/apple" },
  description: "Maintenance ERP — work orders, assets, preventive maintenance, purchasing and invoicing, for any maintenance team.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // The theme script sets data-theme and the brand colour before React loads.
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body className={`${rajdhani.variable} ${plexSans.variable} ${plexMono.variable} antialiased`}>
        <BrandSync />
        {children}
      </body>
    </html>
  );
}
