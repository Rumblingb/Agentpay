import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..", "..", "..");
export const opsRoot = path.join(repoRoot, "ops", "growth");
export const signalsDir = path.join(opsRoot, "signals");
export const draftsDir = path.join(opsRoot, "drafts");
export const reportsDir = path.join(opsRoot, "reports");
export const outboundDir = path.join(opsRoot, "outbound");
export const researchDir = path.join(opsRoot, "research");

export const DEFAULT_KEYWORDS = [
  "model context protocol",
  "mcp server",
  "@modelcontextprotocol/sdk",
  "@anthropic-ai/sdk",
  "openai agents",
  "firecrawl",
  "browserbase",
  "agent payments",
  "api key management",
  "llm billing",
];

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeJson(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(filePath, value) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, `${value.trimEnd()}\n`, "utf8");
}

export async function readJson(filePath, fallback = null) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

export async function readText(filePath, fallback = "") {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch {
    return fallback;
  }
}

export function slugify(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

export function isoNow() {
  return new Date().toISOString();
}

export function getKeywords() {
  const raw = process.env.GROWTH_KEYWORDS?.trim();
  if (!raw) return DEFAULT_KEYWORDS;
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function pickTop(items, limit = 10) {
  return [...items]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, limit);
}

export function dedupeBy(items, getKey) {
  const seen = new Set();
  return items.filter((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function fetchJson(url, init = {}) {
  const response = await fetch(url, {
    ...init,
    headers: {
      "user-agent": process.env.GROWTH_USER_AGENT ?? "AgentPayGrowthBot/0.1 (+https://github.com/Rumblingb/Agentpay)",
      accept: "application/json",
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 220)}`);
  }

  return response.json();
}

export function repoGitLog(days = 14) {
  try {
    const output = execFileSync(
      "git",
      ["log", `--since=${days} days ago`, "--date=short", "--pretty=format:%h|%ad|%s"],
      { cwd: repoRoot, encoding: "utf8" },
    );

    return output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [sha, date, ...subjectParts] = line.split("|");
        return {
          sha,
          date,
          subject: subjectParts.join("|"),
        };
      });
  } catch {
    return [];
  }
}

export function summarizeCommitThemes(commits) {
  const buckets = new Map();
  for (const commit of commits) {
    const key =
      commit.subject.includes("MCP") || commit.subject.toLowerCase().includes("mcp")
        ? "MCP and host integration"
        : commit.subject.toLowerCase().includes("merchant")
          ? "Merchant onboarding and recovery"
          : commit.subject.toLowerCase().includes("vault") || commit.subject.toLowerCase().includes("capability")
            ? "Capability Vault and governed execution"
            : commit.subject.toLowerCase().includes("build") || commit.subject.toLowerCase().includes("next")
              ? "Public surface and build reliability"
              : "Platform reliability";
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  return [...buckets.entries()].map(([theme, count]) => ({ theme, count }));
}
