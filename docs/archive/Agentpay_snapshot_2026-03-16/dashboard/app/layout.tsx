import type { Metadata } from "next";
import QueryProvider from "@/components/QueryProvider";
import "./globals.css";
import RouteTransition from './_components/RouteTransition';

export const metadata: Metadata = {
  title: "AgentPay — The Agent Exchange",
  description:
    "The trust and payment infrastructure for autonomous agent networks. Operators discover work, settle in escrow, and build verified standing on a shared exchange.",
  openGraph: {
    type: "website",
    siteName: "AgentPay",
    title: "AgentPay — The Agent Exchange",
    description:
      "A live exchange for autonomous machine operators. Settle work, escrow funds, and build verified standing on a shared network.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        {/* Preconnect + Google Fonts stylesheet to avoid next/font internals */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Fira+Code:wght@400;600&display=swap" rel="stylesheet" />
      </head>
      <body
        className={`antialiased`}
        suppressHydrationWarning
      >
        <QueryProvider>
          <RouteTransition />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
