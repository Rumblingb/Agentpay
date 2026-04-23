import path from "node:path";
import {
  dedupeBy,
  ensureDir,
  fetchJson,
  getKeywords,
  isoNow,
  opsRoot,
  pickTop,
  signalsDir,
  todayStamp,
  writeJson,
} from "./lib/common.mjs";

const RELEVANCE_TERMS = [
  { term: "mcp", weight: 60 },
  { term: "model context protocol", weight: 60 },
  { term: "api key", weight: 55 },
  { term: "credential", weight: 45 },
  { term: "vault", weight: 45 },
  { term: "payment", weight: 50 },
  { term: "billing", weight: 45 },
  { term: "checkout", weight: 45 },
  { term: "funding", weight: 45 },
  { term: "mandate", weight: 50 },
  { term: "agent", weight: 20 },
  { term: "claude", weight: 20 },
  { term: "openai", weight: 20 },
  { term: "firecrawl", weight: 25 },
  { term: "browserbase", weight: 25 },
  { term: "automation", weight: 18 },
];

const QUERY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "into",
  "that",
  "this",
  "your",
]);

function normalizeText(item) {
  return `${item.title} ${item.summary}`.toLowerCase();
}

function queryTokens(query) {
  return query
    .toLowerCase()
    .replaceAll("@", " ")
    .split(/[^a-z0-9]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !QUERY_STOPWORDS.has(token));
}

function relevanceScore(item) {
  const haystack = normalizeText(item);
  let score = 0;
  for (const rule of RELEVANCE_TERMS) {
    if (haystack.includes(rule.term)) score += rule.weight;
  }
  if (item.source === "github") score += 25;
  if (item.source === "hackernews" && /^show hn:|^launch hn:/i.test(item.title)) score += 20;
  if (item.url.includes("github.com")) score += 15;
  if (haystack.includes("browser extensions")) score -= 80;
  if (haystack.includes("wall street") && !haystack.includes("payment")) score -= 20;
  if (haystack.includes("tolkien") || haystack.includes("middle-earth") || haystack.includes("game of thrones")) {
    score -= 180;
  }

  const matchedQueryTokens = queryTokens(item.keyword).filter((token) => haystack.includes(token));
  if (matchedQueryTokens.length >= 2) score += 45;
  else if (matchedQueryTokens.length === 1) score += 15;

  return score;
}

function githubHeaders() {
  const headers = {
    "x-github-api-version": "2022-11-28",
  };
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function searchGitHub(query) {
  const url = new URL("https://api.github.com/search/repositories");
  const normalizedQuery = query.replaceAll("@", " ").replace(/\s+/g, " ").trim();
  url.searchParams.set("q", `${normalizedQuery} pushed:>=2026-03-01`);
  url.searchParams.set("sort", "updated");
  url.searchParams.set("order", "desc");
  url.searchParams.set("per_page", "8");

  const data = await fetchJson(url, { headers: githubHeaders() });
  return (data.items ?? []).map((item) => ({
    source: "github",
    keyword: query,
    title: item.full_name,
    url: item.html_url,
    summary: item.description ?? "",
    author: item.owner?.login ?? "",
    score: Number(item.stargazers_count ?? 0) + Number(item.watchers_count ?? 0),
    stars: Number(item.stargazers_count ?? 0),
    updatedAt: item.updated_at,
    language: item.language,
  }));
}

async function searchHackerNews(query) {
  const url = new URL("https://hn.algolia.com/api/v1/search_by_date");
  url.searchParams.set("query", query);
  url.searchParams.set("tags", "story");
  url.searchParams.set("hitsPerPage", "8");

  const data = await fetchJson(url);
  return (data.hits ?? []).map((item) => ({
    source: "hackernews",
    keyword: query,
    title: item.title ?? item.story_title ?? query,
    url: item.url ?? `https://news.ycombinator.com/item?id=${item.objectID}`,
    summary: item.story_text ?? "",
    author: item.author ?? "",
    score: Number(item.points ?? 0) + Number(item.num_comments ?? 0),
    comments: Number(item.num_comments ?? 0),
    updatedAt: item.created_at,
  }));
}

async function searchReddit(query) {
  const url = new URL("https://www.reddit.com/search.json");
  url.searchParams.set("q", query);
  url.searchParams.set("sort", "new");
  url.searchParams.set("limit", "8");
  url.searchParams.set("t", "month");

  const data = await fetchJson(url);
  const children = data.data?.children ?? [];
  return children.map((child) => {
    const item = child.data ?? {};
    return {
      source: "reddit",
      keyword: query,
      title: item.title ?? query,
      url: `https://www.reddit.com${item.permalink ?? ""}`,
      summary: item.selftext?.slice(0, 240) ?? "",
      author: item.author ?? "",
      score: Number(item.score ?? 0) + Number(item.num_comments ?? 0),
      comments: Number(item.num_comments ?? 0),
      subreddit: item.subreddit ?? "",
      updatedAt: item.created_utc ? new Date(item.created_utc * 1000).toISOString() : null,
    };
  });
}

async function main() {
  const runAt = isoNow();
  const date = todayStamp();
  const keywords = getKeywords();
  const errors = [];
  const collected = [];
  let githubRateLimited = false;

  await ensureDir(opsRoot);
  await ensureDir(signalsDir);

  for (const keyword of keywords) {
    for (const [source, loader] of [
      ["github", searchGitHub],
      ["hackernews", searchHackerNews],
      ["reddit", searchReddit],
    ]) {
      if (source === "github" && githubRateLimited) {
        continue;
      }
      try {
        const items = await loader(keyword);
        collected.push(...items);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        errors.push({
          source,
          keyword,
          error: message,
        });
        if (source === "github" && message.includes("rate limit exceeded")) {
          githubRateLimited = true;
        }
      }
    }
  }

  const deduped = dedupeBy(
    collected.map((item) => ({
      ...item,
      relevance: relevanceScore(item),
    })),
    (item) => `${item.source}:${item.url}`,
  )
    .filter((item) => item.relevance >= 45)
    .map((item) => ({
      ...item,
      score: (item.score ?? 0) + item.relevance,
      fit: item.relevance >= 110 ? "high" : item.relevance >= 70 ? "medium" : "watch",
    }));

  const payload = {
    generatedAt: runAt,
    keywords,
    totals: {
      raw: collected.length,
      deduped: deduped.length,
      top: Math.min(25, deduped.length),
      errors: errors.length,
    },
    topSignals: pickTop(deduped, 25),
    errors,
  };

  await writeJson(path.join(signalsDir, `${date}.json`), payload);
  await writeJson(path.join(signalsDir, "latest.json"), payload);

  console.log(JSON.stringify(payload.totals, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
