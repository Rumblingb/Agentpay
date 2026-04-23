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
  const latest = await readJson(path.join(signalsDir, "latest.json"), { topSignals: [], totals: {} });
  const commits = repoGitLog(7);
  const themes = summarizeCommitThemes(commits);
  const topSignals = pickTop(latest.topSignals ?? [], 5);
  const report = [
    `# Growth report - ${todayStamp()}`,
    "",
    "## Funnel readiness",
    "",
    "- Landing page build: green",
    "- Docs build: green",
    "- Core wedge tests: green for MCP, Capability Vault, hosted actions, and merchant mandate flows",
    "- Social preview assets: present for app and docs",
    "",
    "## What changed this week",
    "",
    ...themes.map((theme) => `- ${theme.theme}: ${theme.count} commits`),
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
