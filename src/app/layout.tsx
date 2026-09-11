import type { Metadata } from "next";
import { DM_Sans, Manrope } from "next/font/google";
import "./globals.css";
import "./ui-polish.css";
import "./gtm-premium.css";
import "./command-palette.css";
import "./data-surface.css";
import "./gtm-table.css";
import "./share-view.css";
import { GtmCommandPalette } from "@/components/GtmCommandPalette";
import { UsageTracker } from "@/components/UsageTracker";
import { MotionConfig } from "motion/react";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-dm-sans",
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  weight: ["600", "700", "800"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "SDR Command Center",
  description: "Live HubSpot SDR performance, attribution, data quality, and pipeline intelligence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${dmSans.variable} ${manrope.variable}`}>
      <body>
        <MotionConfig reducedMotion="user">
          {children}
          <GtmCommandPalette/>
        </MotionConfig>
        <UsageTracker/>
      </body>
    </html>
  );
}
