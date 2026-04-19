import { ImageResponse } from "next/og";

export const alt = "AgentPay - Zero API keys. Full autonomy.";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background:
            "radial-gradient(circle at top left, rgba(16,185,129,0.22), transparent 28%), radial-gradient(circle at right, rgba(56,189,248,0.18), transparent 30%), linear-gradient(180deg, #04110d 0%, #071018 100%)",
          color: "#f8fafc",
          padding: "56px 64px",
          fontFamily: "Inter, Arial, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: 999,
              background: "#10b981",
              boxShadow: "0 0 28px rgba(16,185,129,0.65)",
            }}
          />
          <div style={{ display: "flex", fontSize: 28, fontWeight: 700, letterSpacing: -0.5 }}>
            <span>Agent</span>
            <span style={{ color: "#10b981" }}>Pay</span>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 920 }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              alignSelf: "flex-start",
              border: "1px solid rgba(16,185,129,0.28)",
              borderRadius: 999,
              color: "#86efac",
              background: "rgba(16,185,129,0.08)",
              padding: "10px 18px",
              fontSize: 20,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
            }}
          >
            Trust and payment layer for AI agents
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              fontSize: 72,
              lineHeight: 1.02,
              fontWeight: 800,
              letterSpacing: -2.6,
            }}
          >
            <div>One OTP.</div>
            <div style={{ color: "#10b981" }}>Zero API keys.</div>
            <div>Full autonomy.</div>
          </div>
          <div style={{ fontSize: 28, lineHeight: 1.4, color: "#cbd5e1", maxWidth: 860 }}>
            Vault credentials, enforce governed mandates, and settle paid actions through one MCP
            server for Claude, OpenAI, and any MCP-compatible host.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 24, color: "#94a3b8" }}>
          <div>npx -y @agentpayxyz/mcp-server</div>
          <div style={{ color: "#38bdf8" }}>app.agentpay.so</div>
        </div>
      </div>
    ),
    size,
  );
}
