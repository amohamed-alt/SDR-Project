import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SDR Command Center",
  description: "Live HubSpot SDR performance, attribution, data quality, and pipeline intelligence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
