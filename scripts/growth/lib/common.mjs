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

function defaultGrowthUserAgent() {
  return process.env.GROWTH_USER_AGENT ?? "AgentPayGrowthBot/0.1 (+https://github.com/Rumblingb/Agentpay)";
}

function browserHtmlHeaders(extraHeaders = {}) {
  return {
    "user-agent": defaultGrowthUserAgent(),
    accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    ...extraHeaders,
  };
}

function jsonHeaders(extraHeaders = {}) {
  return {
    "user-agent": defaultGrowthUserAgent(),
    accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    "accept-language": "en-US,en;q=0.9",
    "cache-control": "no-cache",
    pragma: "no-cache",
    ...extraHeaders,
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeFetchError(error) {
  if (!(error instanceof Error)) {
    return String(error);
  }
  const causeCode = error.cause && typeof error.cause === "object" && "code" in error.cause
    ? error.cause.code
    : null;
  const parts = [error.name, error.message];
  if (causeCode) parts.push(String(causeCode));
  return parts.filter(Boolean).join(": ");
}

async function fetchWithRetry(url, init = {}, options = {}) {
  const {
    retries = 2,
    timeoutMs = 15000,
    parse = async (response) => response,
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`request_timeout_${timeoutMs}ms`)), timeoutMs);

    try {
      const response = await fetch(url, {
        ...init,
        redirect: "follow",
        signal: controller.signal,
      });

      if (!response.ok) {
        const text = await response.text().catch(() => "");
        throw new Error(`${response.status} ${response.statusText}: ${text.slice(0, 220)}`.trim());
      }

      return await parse(response);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await sleep(350 * (attempt + 1));
        continue;
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error(describeFetchError(lastError));
}

export async function fetchJson(url, init = {}) {
  return fetchWithRetry(url, {
    ...init,
    headers: jsonHeaders(init.headers ?? {}),
  }, {
    parse: (response) => response.json(),
  });
}

export async function fetchText(url, init = {}) {
  return fetchWithRetry(url, {
    ...init,
    headers: browserHtmlHeaders(init.headers ?? {}),
  }, {
    parse: (response) => response.text(),
  });
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

let cachedGithubToken;

export function getGithubToken() {
  if (cachedGithubToken !== undefined) {
    return cachedGithubToken;
  }

  if (process.env.GITHUB_TOKEN?.trim()) {
    cachedGithubToken = process.env.GITHUB_TOKEN.trim();
    return cachedGithubToken;
  }

  try {
    const token = execFileSync("gh", ["auth", "token"], {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    cachedGithubToken = token || null;
    return cachedGithubToken;
  } catch {
    cachedGithubToken = null;
    return cachedGithubToken;
  }
}
