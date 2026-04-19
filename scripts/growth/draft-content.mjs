import path from "node:path";
import {
  draftsDir,
  pickTop,
  readJson,
  repoGitLog,
  signalsDir,
  summarizeCommitThemes,
  todayStamp,
  writeText,
} from "./lib/common.mjs";

function makeThread(theme, signal) {
  return [
    `1. The real blocker for AI agents is not model quality. It is the trust surface around ${theme.toLowerCase()}.`,
    `2. We keep seeing this in the wild: ${signal.title}`,
    "3. If the user has to paste keys into chat or leave the host to fund the action, the workflow is already broken.",
    "4. The better path is one hosted connect flow, one governed mandate, and one settlement trail.",
    "5. That is the wedge AgentPay is focused on: one OTP, zero API keys, full autonomy within user-defined limits.",
    "6. Quickstart: docs.agentpay.so/quickstart",
  ].join("\n");
}

async function main() {
  const commits = repoGitLog(21);
  const latest = await readJson(path.join(signalsDir, "latest.json"), { topSignals: [] });
  const themes = summarizeCommitThemes(commits);
  const topSignals = pickTop(latest.topSignals ?? [], 6);

  const lines = [
    "# Content backlog",
    "",
    "## Weekly narrative",
    "",
    "Keep the story on the infrastructure wedge. Do not lead with Ace, RCM, or long-range vision on public distribution surfaces.",
    "",
    "## Commit themes",
    "",
  ];

  for (const theme of themes) {
    lines.push(`- ${theme.theme}: ${theme.count} recent commits`);
  }

  lines.push("", "## Blog briefs", "");
  lines.push("### 1. How to remove API key paste from the agent UX");
  lines.push("- Problem: users still get asked to paste upstream secrets into chat or .env files.");
  lines.push("- Proof: show capability connect flow plus hosted vault handoff.");
  lines.push("- CTA: docs.agentpay.so/examples and docs.agentpay.so/quickstart.");
  lines.push("");
  lines.push("### 2. Governed mandates are the missing safety primitive for paid agents");
  lines.push("- Problem: approval is either too loose or too manual.");
  lines.push("- Proof: show mandate creation, threshold, approval, and execution.");
  lines.push("- CTA: app.agentpay.so plus MCP tool reference.");
  lines.push("");
  lines.push("### 3. Why host-native funding beats sending users to another checkout flow");
  lines.push("- Problem: the agent loses continuity at payment time.");
  lines.push("- Proof: show hosted action session and funding request resume flow.");
  lines.push("");
  lines.push("## X thread drafts", "");

  topSignals.slice(0, 3).forEach((signal, index) => {
    const theme = themes[index]?.theme ?? "Agent trust and payments";
    lines.push(`### Thread ${index + 1}`);
    lines.push("```text");
    lines.push(makeThread(theme, signal));
    lines.push("```");
    lines.push("");
  });

  lines.push("## Short-form video prompts", "");
  lines.push("- Terminal magic: run `npx -y @agentpayxyz/mcp-server`, then show capability connect and a governed mandate in one take.");
  lines.push("- Before and after: messy .env and key copy-paste on the left, AgentPay connect flow on the right.");
  lines.push("- Payment continuity: show the agent pause for a host-native funding request, then resume without tab-switching.");

  const content = lines.join("\n");
  const stamp = todayStamp();
  await writeText(path.join(draftsDir, `content-${stamp}.md`), content);
  await writeText(path.join(draftsDir, "content-latest.md"), content);

  console.log(`drafted content from ${commits.length} commits and ${topSignals.length} signals`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
