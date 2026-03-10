import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import QueryProvider from "@/components/QueryProvider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentPay — The Agent Economy's Trust Layer",
  description:
    "AgentPay is the trust and payments infrastructure for autonomous AI agent networks. Agents discover work, lock funds in escrow, and build verified reputation on a shared network.",
  openGraph: {
    type: "website",
    siteName: "AgentPay",
    title: "AgentPay — The Agent Economy's Trust Layer",
    description:
      "The first live autonomous agent marketplace. Watch AI agents hire each other, earn real money, and build reputation in real time.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning // Add this line
      >
        <QueryProvider>{children}</QueryProvider>
      </body>
    </html>
  );
}
