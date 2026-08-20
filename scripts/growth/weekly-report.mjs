import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  pickTop,
  readJson,
  repoRoot,
  repoGitLog,
  reportsDir,
  signalsDir,
  summarizeCommitThemes,
  todayStamp,
  writeText,
} from "./lib/common.mjs";

const ORCHESTRATION_EVIDENCE = [
  {
    label: "Authority bootstrap and same-workbench leases",
    source: "apps/api-edge/src/routes/capabilities.ts",
    test: "tests/routes/capabilities.test.ts",
  },
  {
    label: "Durable exact-call attempts and server-side resume",
    source: "apps/api-edge/src/lib/capabilityExecutionAttempts.ts",
    test: "tests/routes/capabilities.test.ts",
  },
  {
    label: "Hosted funding completion triggers an attempt resume",
    source: "apps/api-edge/src/routes/stripeWebhooks.ts",
    test: "tests/routes/stripeWebhooks.edge.test.ts",
  },
  {
    label: "Host-native next-action framing",
    source: "apps/api-edge/src/routes/mcp.ts",
    test: "tests/routes/mcpRemote.test.ts",
  },
];

function workingTreeState() {
  try {
    const output = execFileSync("git", ["status", "--porcelain"], {
      cwd: repoRoot,
      encoding: "utf8",
    }).trim();
    return output ? "has local changes" : "clean";
  } catch {
    return "not verified";
  }
}

function orchestrationEvidence() {
  return ORCHESTRATION_EVIDENCE.map((item) => {
    const sourcePresent = fs.existsSync(path.join(repoRoot, item.source));
    const testPresent = fs.existsSync(path.join(repoRoot, item.test));
    return {
      ...item,
      status: sourcePresent && testPresent ? "source and test present" : "needs follow-up",
    };
  });
}

async function main() {
  const latest = await readJson(path.join(signalsDir, "latest.json"), { topSignals: [], totals: {} });
  const commits = repoGitLog(7);
  const themes = summarizeCommitThemes(commits);
  const topSignals = pickTop(latest.topSignals ?? [], 5);
  const productEvidence = orchestrationEvidence();
  const treeState = workingTreeState();
  const report = [
    `# Growth report - ${todayStamp()}`,
    "",
    "## Product proof status",
    "",
    ...productEvidence.map((item) => `- ${item.label}: ${item.status} (${item.source}; ${item.test})`),
    "- Live proof still required: complete one real hosted funding or confirmation step, observe server-side exact-call resume, and record the returned receipt/proof.",
    "- This report does not claim build or test success unless a check was run in the same automation invocation.",
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
    `- Working tree: ${treeState}.`,
    "- The real demo path is not proven until a live provider request completes after a hosted human step.",
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
