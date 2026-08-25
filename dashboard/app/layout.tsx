import type { Metadata } from "next";
import QueryProvider from "@/components/QueryProvider";
import "./globals.css";
import RouteTransition from "./_components/RouteTransition";
import Analytics from "./_components/Analytics";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.agentpay.so"),
  title: {
    default: "AgentPay | AI agent payments infrastructure",
    template: "%s | AgentPay",
  },
  applicationName: "AgentPay",
  keywords: [
    "AI agent payments",
    "agentic commerce",
    "MCP payments",
    "payment infrastructure",
    "AI agents",
    "London",
  ],
  alternates: { canonical: "https://app.agentpay.so/" },
  description:
    "AgentPay is London-built payment infrastructure for AI agents: vault capabilities, enforce spending mandates, and return verifiable settlement receipts through MCP.",
  openGraph: {
    type: "website",
    siteName: "AgentPay",
    title: "AgentPay | AI agent payments infrastructure",
    description:
      "London-built infrastructure for governed agentic commerce: capability vaults, spending mandates, and verifiable payment receipts.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "AgentPay - Zero API keys. Full autonomy.",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentPay | AI agent payments infrastructure",
    description: "Governed payments and capability access for AI agents, built in London.",
    images: ["/opengraph-image"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased" suppressHydrationWarning>
        <Analytics />
        <QueryProvider>
          <RouteTransition />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
