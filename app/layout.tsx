import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Titillium_Web } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});
const titillium = Titillium_Web({
  weight: ["400", "600", "700", "900"],
  subsets: ["latin"],
  variable: "--font-titillium",
  display: "swap",
});

export const metadata: Metadata = {
  title: "F1 Simulator Alpha",
  description: "Simulate the 2026 F1 season — race by race or full season",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={titillium.variable}>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${titillium.className} antialiased`}
      >
        {children}
        <Analytics />
      </body>
    </html>
  );
}
