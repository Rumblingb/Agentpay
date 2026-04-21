import type { Metadata } from "next";
import QueryProvider from "@/components/QueryProvider";
import "./globals.css";
import RouteTransition from "./_components/RouteTransition";

export const metadata: Metadata = {
  metadataBase: new URL("https://app.agentpay.so"),
  title: "AgentPay - Zero API keys. Full autonomy.",
  description:
    "AgentPay is the trust and payment layer for AI agents. Vault credentials with one OTP, enforce spending mandates, and settle payments through one MCP server.",
  openGraph: {
    type: "website",
    siteName: "AgentPay",
    title: "AgentPay - Zero API keys. Full autonomy.",
    description:
      "The trust and payment layer for AI agents. One OTP vaults credentials. Governed mandates enforce budgets. Works with Claude, GPT-4o, and any MCP host.",
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
    title: "AgentPay - Zero API keys. Full autonomy.",
    description:
      "Vault credentials, enforce spending limits, and settle payments through one MCP server. npx -y @agentpayxyz/mcp-server",
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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&family=Fira+Code:wght@400;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        <QueryProvider>
          <RouteTransition />
          {children}
        </QueryProvider>
      </body>
    </html>
  );
}
