import path from "node:path";
import {
  ensureDir,
  isoNow,
  researchDir,
  todayStamp,
  writeText,
} from "./lib/common.mjs";

const SOURCES = [
  {
    label: "Karpathy blog index",
    url: "https://karpathy.bearblog.dev/blog/",
    family: "karpathy",
  },
  {
    label: "Karpathy - The append-and-review note",
    url: "https://karpathy.bearblog.dev/the-append-and-review-note/",
    family: "karpathy",
  },
  {
    label: "Karpathy - Verifiability",
    url: "https://karpathy.bearblog.dev/verifiability/",
    family: "karpathy",
  },
  {
    label: "OpenAI research index",
    url: "https://openai.com/research/index/",
    family: "openai",
  },
  {
    label: "OpenAI research overview",
    url: "https://openai.com/research/",
    family: "openai",
  },
  {
    label: "OpenAI - Introducing deep research",
    url: "https://openai.com/index/introducing-deep-research/",
    family: "openai",
  },
];

const TOPICS = [
  { label: "verifiability", terms: ["verifiability", "verify", "verification", "evidence", "proof"] },
  { label: "agents and autonomy", terms: ["agent", "autonomy", "autonomous", "tool", "tools", "workflow"] },
  { label: "research to product", terms: ["product", "deploy", "deployment", "release", "launched", "shipping"] },
  { label: "developer workflow", terms: ["developer", "coding", "code", "terminal", "prompt", "review"] },
  { label: "safety and evals", terms: ["safety", "eval", "evaluation", "risk", "guardrail", "policy"] },
];

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": process.env.GROWTH_USER_AGENT ?? "AgentPayGrowthBot/0.1",
      accept: "text/html,application/xhtml+xml",
    },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return stripHtml(await response.text());
}

function scoreTopics(text) {
  const lower = text.toLowerCase();
  return TOPICS.map((topic) => ({
    label: topic.label,
    score: topic.terms.reduce((sum, term) => sum + (lower.includes(term) ? 1 : 0), 0),
  }))
    .filter((topic) => topic.score > 0)
    .sort((a, b) => b.score - a.score);
}

function buildMemo(sourceRecords) {
  const rankedThemes = new Map();
  for (const source of sourceRecords) {
    for (const theme of source.themes) {
      if (theme.label === "fetch_failed") continue;
      rankedThemes.set(theme.label, (rankedThemes.get(theme.label) ?? 0) + theme.score);
    }
  }

  const topThemes = [...rankedThemes.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4)
    .map(([label]) => label);

  const resolvedTopThemes = topThemes.length > 0
    ? topThemes
    : ["verifiability", "research to product", "developer workflow", "safety and evals"];

  const karpathySignals = sourceRecords.filter((source) => source.family === "karpathy");
  const openaiSignals = sourceRecords.filter((source) => source.family === "openai");
  const failedSources = sourceRecords.filter((source) => source.error);

  return [
    `# Public research patterns - ${todayStamp()}`,
    "",
    `Generated at: ${isoNow()}`,
    "",
    "## Source health",
    "",
    failedSources.length > 0
      ? `- ${failedSources.length} public sources failed to fetch on this run, so the memo leans on evergreen pattern extraction instead of fresh source summaries.`
      : "- All configured public sources fetched successfully on this run.",
    "",
    "## What they are talking about now",
    "",
    `- Recurring themes across the public material: ${resolvedTopThemes.join(", ")}.`,
    "- Karpathy-style public writing is still strongest when it compresses a complex idea into one memorable frame and one practical loop.",
    "- OpenAI-style research publishing is strongest when a concrete capability ships beside the explanation, evals, and operating guidance.",
    "",
    "## What format is winning",
    "",
    `- Karpathy sources are winning with short first-principles notes and compact essays: ${karpathySignals.map((source) => source.label).join("; ")}.`,
    `- OpenAI sources are winning with product-linked research pages and release explainers: ${openaiSignals.map((source) => source.label).join("; ")}.`,
    "- The reusable format pattern is: one sharp name, one specific problem, one proof artifact, one explicit boundary.",
    "",
    "## What research-to-product pattern is reusable for AgentPay",
    "",
    "- Name the seam clearly: trust + capability vault + governed paid execution.",
    "- Pair every product claim with an observable path: connect, guardrail, fund, resume, receipt.",
    "- Publish compact lab notes on orchestration failures and what changed, then fold the learnings into the quickstart and public docs quickly.",
    "- Keep a founder append-and-review loop for distribution ideas, product edge cases, and proof assets so the best ideas compound instead of getting lost in chat history.",
    "",
    "## What not to copy",
    "",
    "- Do not copy OpenAI's release volume or polish expectations directly; copy the structure of claim + proof + boundary instead.",
    "- Do not copy a personality; copy the clarity, naming discipline, and insistence on verifiability.",
    "- Do not mistake brand gravity for tactic quality. Anything that only works because the publisher already owns the audience should be excluded from the AgentPay playbook.",
    "",
    "## AgentPay themes this week",
    "",
    "- Show the OAuth-like connect flow more than the dashboard.",
    "- Show the paid-step resume seam more than the generic agent story.",
    "- Turn technical hardening work into proof-oriented content, not vague platform claims.",
    "",
    "## Source notes",
    "",
    ...sourceRecords.flatMap((source) => [
      `### ${source.label}`,
      `- URL: ${source.url}`,
      `- Dominant themes: ${source.themes.filter((theme) => theme.label !== "fetch_failed").slice(0, 3).map((theme) => theme.label).join(", ") || (source.error ? "fetch failed on this run" : "none detected")}`,
      `- Pattern note: ${source.family === "karpathy"
        ? "Concise framing, strong naming, and explicit thinking loops."
        : "Capability shipped with supporting research and operational framing."}`,
      ...(source.error ? [`- Fetch note: ${source.error}`] : []),
      "",
    ]),
  ].join("\n");
}

async function main() {
  await ensureDir(researchDir);
  const sourceRecords = [];

  for (const source of SOURCES) {
    try {
      const text = await fetchText(source.url);
      sourceRecords.push({
        ...source,
        themes: scoreTopics(text),
      });
    } catch (error) {
      sourceRecords.push({
        ...source,
        themes: [{ label: "fetch_failed", score: 1 }],
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const memo = buildMemo(sourceRecords);
  await writeText(path.join(researchDir, `patterns-${todayStamp()}.md`), memo);
  await writeText(path.join(researchDir, "patterns-latest.md"), memo);

  console.log(`researched ${sourceRecords.length} public sources`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
