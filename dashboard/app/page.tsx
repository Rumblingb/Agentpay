"use client";

import Link from "next/link";
import { useState } from "react";

const PILLARS = [
  {
    label: "Capability Vault",
    headline: "Zero API keys in agent context",
    body: "Users approve one hosted connect flow. AgentPay vaults Firecrawl, Perplexity, OpenAI, and other upstream credentials so the raw key never enters the prompt loop.",
    tool: "agentpay_request_capability_connect",
  },
  {
    label: "Governed Mandates",
    headline: "Agents that spend within limits",
    body: "Your agent proposes the action, budget cap, and approval threshold. The human approves once. AgentPay enforces the policy on every subsequent step.",
    tool: "agentpay_create_mandate",
  },
  {
    label: "Settlement",
    headline: "Payment recovery and receipts built in",
    body: "Collect card or UPI funding, execute the action, and return a verifiable receipt. The host sees a clean workflow instead of bespoke payment plumbing.",
    tool: "agentpay_create_human_funding_request",
  },
];

const STEPS = [
  {
    step: "01",
    title: "Install the MCP server",
    detail: "Add AgentPay to Claude Desktop or any MCP host with one command and one API key.",
  },
  {
    step: "02",
    title: "Connect paid capabilities once",
    detail: "When the agent needs Firecrawl, Perplexity, or another upstream service, AgentPay opens the hosted connect flow and vaults the credential.",
  },
  {
    step: "03",
    title: "Approve the mandate",
    detail: "The agent proposes the action and budget. The human approves once. Policy is locked before execution starts.",
  },
  {
    step: "04",
    title: "Let the agent finish",
    detail: "AgentPay enforces the budget, runs the action, and returns the settlement and receipt trail the developer needs.",
  },
];

const SHIP_THIS_WEEK = [
  {
    title: "Paid research agent",
    detail:
      "Give Claude or GPT a governed path to browse, scrape, and summarize without storing the user's Firecrawl key in the prompt loop.",
  },
  {
    title: "Zero-key browsing copilot",
    detail:
      "Ship Browserbase or Firecrawl access through AgentPay instead of telling every user to manage their own upstream credentials and billing.",
  },
  {
    title: "Chat-native checkout",
    detail:
      "Create a funding request in chat, collect payment, and let the agent continue the workflow without tab switching or manual settlement glue.",
  },
];

const LIVE_SURFACES = [
  { label: "Docs", value: "docs.agentpay.so", href: "https://docs.agentpay.so" },
  { label: "Quickstart", value: "MCP in 2 minutes", href: "https://docs.agentpay.so/quickstart" },
  { label: "Remote MCP", value: "api.agentpay.so/api/mcp", href: "https://api.agentpay.so/api/mcp" },
  { label: "npm", value: "@agentpayxyz/mcp-server", href: "https://www.npmjs.com/package/@agentpayxyz/mcp-server" },
];

const PROMPTS = [
  'Connect Firecrawl without exposing the raw API key to the agent.',
  'Create a governed mandate to scrape this site with a $5 budget cap.',
  'Create a funding request so the human can pay without leaving the chat.',
];

export default function Home() {
  const [copied, setCopied] = useState(false);

  function copyNpx() {
    navigator.clipboard.writeText("npx -y @agentpayxyz/mcp-server").then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div
      style={{
        background:
          "radial-gradient(circle at top left, rgba(34,197,94,0.14), transparent 26%), radial-gradient(circle at top right, rgba(56,189,248,0.10), transparent 24%), linear-gradient(180deg, #040506 0%, #071018 100%)",
        color: "#F5F7FA",
        minHeight: "100vh",
        fontFamily: "Inter, system-ui, -apple-system, sans-serif",
      }}
    >
      <style>{`
        *, *::before, *::after { box-sizing: border-box; margin: 0; }
        a { text-decoration: none; }
        code, pre { font-family: 'Fira Code', 'JetBrains Mono', monospace; }

        .nav-link { color: #9AA4AF; font-size: 14px; transition: color 0.15s; }
        .nav-link:hover { color: #F5F7FA; }

        .btn-primary {
          background: linear-gradient(135deg, #22C55E 0%, #14B8A6 100%);
          color: #04110A;
          padding: 12px 22px;
          border-radius: 12px;
          font-weight: 800;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          transition: opacity 0.15s;
          cursor: pointer;
        }
        .btn-primary:hover { opacity: 0.9; }

        .btn-secondary {
          border: 1px solid rgba(77, 92, 108, 0.34);
          color: #D5DDE7;
          padding: 11px 20px;
          border-radius: 12px;
          font-size: 14px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          background: rgba(7, 16, 24, 0.68);
          transition: border-color 0.15s, color 0.15s;
        }
        .btn-secondary:hover { border-color: rgba(34,197,94,0.38); color: #F5F7FA; }

        .pill {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          border: 1px solid rgba(34,197,94,0.24);
          border-radius: 999px;
          padding: 6px 14px;
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #86EFAC;
          background: rgba(34,197,94,0.08);
        }

        .pill-dot {
          width: 7px;
          height: 7px;
          border-radius: 50%;
          background: #22C55E;
          box-shadow: 0 0 10px rgba(34,197,94,0.55);
          flex-shrink: 0;
        }

        .npx-bar {
          background: #071017;
          border: 1px solid rgba(77, 92, 108, 0.28);
          border-radius: 12px;
          padding: 14px 18px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
        }

        .npx-text { font-size: 14px; color: #4ADE80; }
        .copy-btn {
          background: #0F1E2B;
          border: 1px solid rgba(77, 92, 108, 0.28);
          border-radius: 9px;
          padding: 7px 12px;
          font-size: 12px;
          color: #9AA4AF;
          cursor: pointer;
          white-space: nowrap;
        }

        .panel {
          background: rgba(7, 16, 24, 0.88);
          border: 1px solid rgba(77, 92, 108, 0.26);
          border-radius: 16px;
          padding: 28px;
        }

        .panel-label {
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.08em;
          color: #4ADE80;
          margin-bottom: 10px;
        }

        .panel-headline {
          font-size: 18px;
          font-weight: 780;
          color: #F5F7FA;
          margin-bottom: 10px;
          line-height: 1.3;
        }

        .panel-body { font-size: 14px; color: #9AA4AF; line-height: 1.72; }
        .panel-tool {
          margin-top: 18px;
          font-size: 12px;
          color: #38BDF8;
          background: #050607;
          border: 1px solid rgba(56,189,248,0.18);
          border-radius: 8px;
          padding: 6px 10px;
          display: inline-block;
        }

        .step-row {
          display: flex;
          gap: 20px;
          align-items: flex-start;
          padding: 20px 0;
          border-bottom: 1px solid rgba(19, 33, 45, 0.9);
        }
        .step-row:last-child { border-bottom: none; }
        .step-num { font-size: 12px; color: #22C55E; min-width: 28px; padding-top: 2px; }
        .step-title { font-size: 15px; font-weight: 760; color: #F5F7FA; margin-bottom: 4px; }
        .step-detail { font-size: 13px; color: #9AA4AF; line-height: 1.65; }

        .compat-chip {
          border: 1px solid rgba(77, 92, 108, 0.22);
          border-radius: 999px;
          padding: 10px 16px;
          font-size: 13px;
          color: #9AA4AF;
          background: rgba(7, 16, 24, 0.82);
        }

        .proof-link {
          display: block;
          background: rgba(7, 16, 24, 0.88);
          border: 1px solid rgba(77, 92, 108, 0.26);
          border-radius: 14px;
          padding: 18px 16px;
        }
        .proof-link:hover { border-color: rgba(34,197,94,0.34); }

        .divider { border: none; border-top: 1px solid rgba(13, 25, 34, 0.88); }
        .code-block {
          background: #050607;
          border: 1px solid rgba(77, 92, 108, 0.2);
          border-radius: 12px;
          padding: 20px 24px;
          font-size: 13px;
          line-height: 1.8;
          overflow-x: auto;
        }

        @media (max-width: 960px) {
          .two-col { grid-template-columns: 1fr !important; }
          .pillars-grid, .proof-grid { grid-template-columns: 1fr !important; }
        }
        @media (max-width: 768px) {
          .hero-actions { flex-direction: column; align-items: stretch !important; }
          .hero-actions a, .hero-actions button { justify-content: center; }
          .footer-links { display: none !important; }
          .npx-bar { flex-direction: column; align-items: stretch; }
        }
      `}</style>

      <nav style={{ borderBottom: "1px solid rgba(13,25,34,0.88)", padding: "0 24px" }}>
        <div style={{ maxWidth: 1100, margin: "0 auto", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 800, fontSize: 16, letterSpacing: -0.3, color: "#F5F7FA" }}>
            Agent<span style={{ color: "#22C55E" }}>Pay</span>
          </span>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <a href="https://docs.agentpay.so/quickstart" target="_blank" rel="noreferrer" className="nav-link">Quickstart</a>
            <a href="https://docs.agentpay.so/mcp" target="_blank" rel="noreferrer" className="nav-link">MCP</a>
            <a href="https://github.com/Rumblingb/Agentpay" target="_blank" rel="noreferrer" className="nav-link">GitHub</a>
            <a href="https://api.agentpay.so/api/merchants/register" target="_blank" rel="noreferrer" className="btn-primary" style={{ padding: "8px 16px", fontSize: 13 }}>
              Get API key {"->"}
            </a>
          </div>
        </div>
      </nav>

      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "88px 24px 64px", textAlign: "center" }}>
        <div className="pill" style={{ marginBottom: 28, display: "inline-flex" }}>
          <span className="pill-dot" />
          Live edge API | remote MCP | npm package
        </div>

        <h1 style={{ fontSize: "clamp(36px, 5.8vw, 64px)", fontWeight: 920, letterSpacing: -1.8, lineHeight: 1.02, color: "#F5F7FA", maxWidth: 860, margin: "0 auto 22px" }}>
          One OTP.
          <br />
          <span style={{ color: "#22C55E" }}>Zero API keys.</span>
          <br />
          Agents that can actually do the job.
        </h1>

        <p style={{ fontSize: 18, color: "#9AA4AF", maxWidth: 680, margin: "0 auto 44px", lineHeight: 1.75 }}>
          AgentPay is the trust and payment layer for AI agents. Vault credentials with one hosted connect flow,
          enforce governed mandates, and settle paid actions through one MCP server for Claude, OpenAI, and any
          MCP-compatible host.
        </p>

        <div className="hero-actions" style={{ display: "flex", gap: 12, justifyContent: "center", alignItems: "center", flexWrap: "wrap", marginBottom: 36 }}>
          <a href="https://docs.agentpay.so/quickstart" target="_blank" rel="noreferrer" className="btn-primary">
            Read quickstart
          </a>
          <a href="https://api.agentpay.so/api/merchants/register" target="_blank" rel="noreferrer" className="btn-secondary">
            Register in browser
          </a>
          <a href="https://github.com/Rumblingb/Agentpay" target="_blank" rel="noreferrer" className="btn-secondary">
            View GitHub
          </a>
        </div>

        <div style={{ maxWidth: 560, margin: "0 auto" }}>
          <div className="npx-bar">
            <span className="npx-text">npx -y @agentpayxyz/mcp-server</span>
            <button className="copy-btn" onClick={copyNpx}>
              {copied ? "Copied" : "Copy install"}
            </button>
          </div>
          <div style={{ marginTop: 12, color: "#6B7C90", fontSize: 13 }}>
            Remote MCP endpoint: <code style={{ color: "#38BDF8" }}>https://api.agentpay.so/api/mcp</code>
          </div>
        </div>
      </section>

      <hr className="divider" />

      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 24px" }}>
        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48, alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4ADE80", marginBottom: 14 }}>First install</div>
            <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#F5F7FA", marginBottom: 16, lineHeight: 1.2 }}>
              30 seconds from config to first governed tool call
            </h2>
            <p style={{ fontSize: 14, color: "#9AA4AF", lineHeight: 1.75, marginBottom: 24 }}>
              Drop this into Claude Desktop. Restart. Ask the host to connect Firecrawl or create a mandate. AgentPay
              handles credential vaulting, budget enforcement, payment recovery, and receipts behind the scenes.
            </p>
            <div style={{ display: "grid", gap: 10 }}>
              {PROMPTS.map((prompt) => (
                <div key={prompt} style={{ background: "#071017", border: "1px solid rgba(77,92,108,0.22)", borderRadius: 12, padding: "12px 14px", fontSize: 13, color: "#DCE4ED", lineHeight: 1.6 }}>
                  {prompt}
                </div>
              ))}
            </div>
          </div>
          <div>
            <div style={{ fontSize: 11, color: "#475569", marginBottom: 8, fontFamily: "Fira Code, monospace" }}>~/Library/Application Support/Claude/claude_desktop_config.json</div>
            <div className="code-block">
              <span style={{ color: "#475569" }}>{"{"}</span><br />
              {"  "}<span style={{ color: "#38BDF8" }}>"mcpServers"</span><span style={{ color: "#475569" }}>: {"{"}</span><br />
              {"    "}<span style={{ color: "#38BDF8" }}>"agentpay"</span><span style={{ color: "#475569" }}>: {"{"}</span><br />
              {"      "}<span style={{ color: "#38BDF8" }}>"command"</span><span style={{ color: "#475569" }}>: </span><span style={{ color: "#A3E635" }}>"npx"</span><span style={{ color: "#475569" }}>,</span><br />
              {"      "}<span style={{ color: "#38BDF8" }}>"args"</span><span style={{ color: "#475569" }}>: [</span><span style={{ color: "#A3E635" }}>"-y"</span><span style={{ color: "#475569" }}>, </span><span style={{ color: "#A3E635" }}>"@agentpayxyz/mcp-server"</span><span style={{ color: "#475569" }}>],</span><br />
              {"      "}<span style={{ color: "#38BDF8" }}>"env"</span><span style={{ color: "#475569" }}>: {"{"}</span><br />
              {"        "}<span style={{ color: "#38BDF8" }}>"AGENTPAY_API_KEY"</span><span style={{ color: "#475569" }}>: </span><span style={{ color: "#4ADE80" }}>"apk_your_key"</span><br />
              {"      "}<span style={{ color: "#475569" }}>{"}"}</span><br />
              {"    "}<span style={{ color: "#475569" }}>{"}"}</span><br />
              {"  "}<span style={{ color: "#475569" }}>{"}"}</span><br />
              <span style={{ color: "#475569" }}>{"}"}</span>
            </div>
          </div>
        </div>
      </section>

      <hr className="divider" />

      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 48 }}>
          <h2 style={{ fontSize: 32, fontWeight: 800, letterSpacing: -0.5, color: "#F5F7FA", marginBottom: 12 }}>
            Three hard problems. One product surface.
          </h2>
          <p style={{ fontSize: 15, color: "#9AA4AF", maxWidth: 520, margin: "0 auto", lineHeight: 1.75 }}>
            This is where the value lives today. Keep the public story tight: protect credentials, govern spending,
            and return proof that the action settled.
          </p>
        </div>
        <div className="pillars-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16 }}>
          {PILLARS.map((pillar) => (
            <div key={pillar.label} className="panel">
              <div className="panel-label">{pillar.label}</div>
              <div className="panel-headline">{pillar.headline}</div>
              <div className="panel-body">{pillar.body}</div>
              <div className="panel-tool">{pillar.tool}</div>
            </div>
          ))}
        </div>
      </section>

      <hr className="divider" />

      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 24px" }}>
        <div className="two-col" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 56, alignItems: "start" }}>
          <div>
            <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4ADE80", marginBottom: 14 }}>How it works</div>
            <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#F5F7FA", marginBottom: 16, lineHeight: 1.2 }}>
              The activation loop
            </h2>
            <p style={{ fontSize: 14, color: "#9AA4AF", lineHeight: 1.75 }}>
              AgentPay should feel like the safe execution layer behind the host, not another dashboard the user has to
              babysit. The install path, connect path, approval path, and receipt path need to be obvious on first use.
            </p>
          </div>
          <div>
            {STEPS.map((step) => (
              <div key={step.step} className="step-row">
                <div className="step-num">{step.step}</div>
                <div>
                  <div className="step-title">{step.title}</div>
                  <div className="step-detail">{step.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <hr className="divider" />

      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "48px 24px", textAlign: "center" }}>
        <div style={{ fontSize: 12, textTransform: "uppercase", letterSpacing: "0.08em", color: "#475569", marginBottom: 20 }}>
          Works with any MCP-compatible host
        </div>
        <div style={{ display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
          {["Claude Desktop", "Claude Code", "GPT-4o", "Cursor", "Any MCP host"].map((name) => (
            <div key={name} className="compat-chip">{name}</div>
          ))}
        </div>
        <div style={{ marginTop: 16, fontSize: 13, color: "#475569" }}>
          Or connect via remote MCP at{" "}
          <code style={{ color: "#38BDF8", fontSize: 12 }}>https://api.agentpay.so/api/mcp</code>
        </div>
      </section>

      <hr className="divider" />

      <section style={{ maxWidth: 1100, margin: "0 auto", padding: "64px 24px" }}>
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "rgba(34,197,94,0.08)", border: "1px solid rgba(34,197,94,0.2)", borderRadius: 999, padding: "4px 12px", fontSize: 12, color: "#22C55E", marginBottom: 14 }}>
            <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#22C55E", flexShrink: 0 }} />
            What teams can ship this week
          </div>
          <h2 style={{ fontSize: 30, fontWeight: 800, letterSpacing: -0.6, color: "#F5F7FA", marginBottom: 14, lineHeight: 1.2 }}>
            The product face should stay on the wedge.
          </h2>
          <p style={{ maxWidth: 640, margin: "0 auto", fontSize: 14, color: "#9AA4AF", lineHeight: 1.8 }}>
            No ACE or RCM dependency here. The public story should stay on the installable infrastructure developers
            can evaluate quickly: governed browsing, paid execution, and safe upstream capability access.
          </p>
        </div>
        <div className="pillars-grid" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 16, marginBottom: 22 }}>
          {SHIP_THIS_WEEK.map((flow) => (
            <div key={flow.title} className="panel">
              <div className="panel-headline">{flow.title}</div>
              <div className="panel-body">{flow.detail}</div>
            </div>
          ))}
        </div>
        <div className="proof-grid" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
          {LIVE_SURFACES.map((surface) => (
            <a key={surface.label} href={surface.href} target="_blank" rel="noreferrer" className="proof-link">
              <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em", color: "#4ADE80", marginBottom: 8 }}>{surface.label}</div>
              <div style={{ fontSize: 14, color: "#F5F7FA", lineHeight: 1.5 }}>{surface.value}</div>
            </a>
          ))}
        </div>
      </section>

      <hr className="divider" />

      <footer style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 16 }}>
        <span style={{ fontWeight: 800, fontSize: 15, color: "#F5F7FA" }}>
          Agent<span style={{ color: "#22C55E" }}>Pay</span>
        </span>
        <div className="footer-links" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
          <a href="https://docs.agentpay.so" target="_blank" rel="noreferrer" className="nav-link">Docs</a>
          <a href="https://docs.agentpay.so/quickstart" target="_blank" rel="noreferrer" className="nav-link">Quickstart</a>
          <a href="https://docs.agentpay.so/examples" target="_blank" rel="noreferrer" className="nav-link">Examples</a>
          <a href="https://github.com/Rumblingb/Agentpay" target="_blank" rel="noreferrer" className="nav-link">GitHub</a>
          <Link href="/privacy" className="nav-link">Privacy</Link>
          <Link href="/terms" className="nav-link">Terms</Link>
        </div>
        <span style={{ fontSize: 12, color: "#475569" }}>(c) {new Date().getFullYear()} AgentPay</span>
      </footer>
    </div>
  );
}
