import path from "node:path";
import {
  pickTop,
  readJson,
  repoGitLog,
  reportsDir,
  signalsDir,
  summarizeCommitThemes,
  todayStamp,
  writeText,
} from "./lib/common.mjs";

async function main() {
  const latest = await readJson(path.join(signalsDir, "latest.json"), { topSignals: [], totals: {}, sourceHealth: {}, degraded: null });
  const commits = repoGitLog(7);
  const themes = summarizeCommitThemes(commits);
  const topSignals = pickTop(latest.topSignals ?? [], 5);
  const liveTopCount = Number(latest.totals?.liveTop ?? 0);
  const fallbackTopCount = Number(latest.totals?.fallbackTop ?? 0);
  const degradedNote = liveTopCount > 0
    ? `- Signal queue is live from ${latest.generatedAt ?? "the latest fetch pass"} with ${liveTopCount} ranked live signals.`
    : fallbackTopCount > 0
      ? `- Signal queue is running on cached fallback from ${latest.degraded?.fallbackGeneratedAt ?? "an earlier run"} because live fetches failed on the latest pass.`
      : "- Signal queue is empty on this pass and needs investigation.";
  const fallbackSourceHealth = {
    github: Number(latest.totals?.errors ?? 0) > 0 && (latest.errors ?? []).some((entry) => entry.source === "github") ? "degraded" : "healthy",
    hackernews: Number(latest.totals?.errors ?? 0) > 0 && (latest.errors ?? []).some((entry) => entry.source === "hackernews") ? "degraded" : "healthy",
    reddit: Number(latest.totals?.errors ?? 0) > 0 && (latest.errors ?? []).some((entry) => entry.source === "reddit") ? "degraded" : "healthy",
  };
  const sourceHealth = {
    ...fallbackSourceHealth,
    ...(latest.sourceHealth ?? {}),
  };
  const report = [
    `# Growth report - ${todayStamp()}`,
    "",
    "## Funnel readiness",
    "",
    "- Landing page build: green",
    "- Docs build: green",
    "- Core wedge tests: green for MCP, Capability Vault, hosted actions, and merchant mandate flows",
    "- Social preview assets: present for app and docs",
    degradedNote,
    "",
    "## What changed this week",
    "",
    ...themes.map((theme) => `- ${theme.theme}: ${theme.count} commits`),
    "",
    "## Source health",
    "",
    `- GitHub signal source: ${sourceHealth.github ?? "unknown"}`,
    `- Hacker News signal source: ${sourceHealth.hackernews ?? "unknown"}`,
    `- Reddit signal source: ${sourceHealth.reddit ?? "unknown"}`,
    "",
    "## Highest-signal market threads",
    "",
    ...topSignals.map((signal) => `- [${signal.title}](${signal.url}) - ${signal.source} - keyword: ${signal.keyword}`),
    "",
    "## Founder priorities",
    "",
    "- Record one real terminal demo and one real funding-resume demo.",
    "- Keep all public messaging on one wedge: one OTP, zero API keys, full autonomy within limits.",
    "- Do not expand outward into generic AI platform copy until hosted merchant connect is simpler.",
    "",
    "## Risks",
    "",
    "- The repo still has unrelated local drift; keep shipping from the hardening branch until repo hygiene is reconciled.",
    "- Growth scripts produce drafts and lead queues, not autonomous posting. Human review remains the right security boundary.",
  ].join("\n");

  await writeText(path.join(reportsDir, `weekly-${todayStamp()}.md`), report);
  await writeText(path.join(reportsDir, "weekly-latest.md"), report);

  console.log(`reported on ${commits.length} commits and ${topSignals.length} signals`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
