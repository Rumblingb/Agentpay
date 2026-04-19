import path from "node:path";
import { draftsDir, pickTop, readJson, signalsDir, todayStamp, writeText } from "./lib/common.mjs";

function classifyLead(signal) {
  const text = `${signal.title} ${signal.summary} ${signal.keyword}`.toLowerCase();
  if (text.includes("mcp")) return "MCP builder";
  if (text.includes("api key") || text.includes("firecrawl") || text.includes("browserbase")) return "Tooling builder";
  if (text.includes("agent")) return "Agent team";
  return "Developer infra";
}

function emailDraft(signal) {
  const lane = classifyLead(signal);
  const sourceLine = signal.source === "github"
    ? `Saw ${signal.title} on GitHub.`
    : `Saw the ${signal.source} thread "${signal.title}".`;

  return [
    `Subject: your ${lane.toLowerCase()} flow`,
    "",
    `Hi ${signal.author || "there"},`,
    "",
    sourceLine,
    "The reason I am reaching out is simple: if users need to paste API keys or approve payments outside the host, the agent experience usually breaks there.",
    "",
    "We built AgentPay for that exact gap:",
    "- one hosted connect flow to vault upstream credentials",
    "- governed mandates so the user sets the budget and approval line once",
    "- host-native funding requests instead of copy-paste checkout glue",
    "",
    `If that is relevant, the fastest path is: ${signal.source === "github" ? "docs.agentpay.so/quickstart" : "app.agentpay.so and docs.agentpay.so/examples"}.`,
    "Happy to send the exact MCP or REST flow that would fit your stack.",
  ].join("\n");
}

async function main() {
  const latest = await readJson(path.join(signalsDir, "latest.json"), { topSignals: [] });
  const selected = pickTop(
    (latest.topSignals ?? []).filter((signal) =>
      signal.source === "github"
      || (signal.source === "hackernews" && (/^show hn:|^launch hn:/i.test(signal.title) || signal.url.includes("github.com"))),
    ),
    12,
  );
  const sections = [
    "# Outbound drafts",
    "",
    "These are plain-text first-touch drafts. Do not automate sending without a human pass.",
    "",
  ];

  for (const signal of selected) {
    sections.push(`## ${signal.title}`);
    sections.push(`Source: ${signal.source}`);
    sections.push(`Link: ${signal.url}`);
    sections.push(`ICP lane: ${classifyLead(signal)}`);
    sections.push("");
    sections.push("```text");
    sections.push(emailDraft(signal));
    sections.push("```");
    sections.push("");
  }

  const stamp = todayStamp();
  await writeText(path.join(draftsDir, `outbound-${stamp}.md`), sections.join("\n"));
  await writeText(path.join(draftsDir, "outbound-latest.md"), sections.join("\n"));

  console.log(`drafted ${selected.length} outbound leads`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
