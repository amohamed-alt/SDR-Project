import type { Metadata } from "next";
import "./globals.css";
import "./ui-polish.css";
import "./gtm-premium.css";
import "./command-palette.css";
import { GtmCommandPalette } from "@/components/GtmCommandPalette";
import { UsageTracker } from "@/components/UsageTracker";

export const metadata: Metadata = {
  title: "SDR Command Center",
  description: "Live HubSpot SDR performance, attribution, data quality, and pipeline intelligence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <GtmCommandPalette/>
        <UsageTracker/>
      </body>
    </html>
  );
}
