import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Talentera SDR Command Center",
  description: "Live HubSpot SDR performance, attribution, data quality, and pipeline intelligence.",
  icons: {
    icon: [{ url: "/icon.svg", type: "image/svg+xml" }],
    shortcut: "/icon.svg",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
