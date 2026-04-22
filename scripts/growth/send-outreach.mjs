import path from "node:path";
import {
  draftsDir,
  ensureDir,
  fetchJson,
  getGithubToken,
  isoNow,
  outboundDir,
  readJson,
  readText,
  signalsDir,
  todayStamp,
  writeJson,
  writeText,
} from "./lib/common.mjs";

const FROM_EMAIL = process.env.OUTBOUND_EMAIL_FROM ?? "rajiv_baskaran@agentpay.so";
const MAX_DAILY_SENDS = Number(process.env.OUTBOUND_MAX_DAILY_SENDS ?? 6);
const MIN_FIT_SCORE = Number(process.env.OUTBOUND_MIN_FIT_SCORE ?? 70);
const DEDUPE_WINDOW_DAYS = 30;

function githubHeaders() {
  const headers = {
    "x-github-api-version": "2022-11-28",
  };
  const token = getGithubToken();
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  return headers;
}

function scoreSignal(signal) {
  return Number(signal.relevance ?? signal.score ?? 0);
}

function dedupeWindowCutoff() {
  return Date.now() - DEDUPE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

async function enrichGithubLead(signal) {
  if (signal.source !== "github" || !signal.title?.includes("/")) {
    return null;
  }

  const repo = await fetchJson(`https://api.github.com/repos/${signal.title}`, {
    headers: githubHeaders(),
  }).catch((error) => ({
    __fetchError: error instanceof Error ? error.message : String(error),
  }));
  if (!repo || repo.__fetchError) {
    return {
      signal,
      repo: null,
      owner: null,
      contactEmail: null,
      error: repo?.__fetchError ?? "repo_lookup_failed",
    };
  }

  const ownerLogin = repo.owner?.login;
  const owner = ownerLogin
    ? await fetchJson(`https://api.github.com/users/${ownerLogin}`, { headers: githubHeaders() }).catch((error) => ({
      __fetchError: error instanceof Error ? error.message : String(error),
    }))
    : null;

  const ownerFetchError = owner && typeof owner === "object" && "__fetchError" in owner ? owner.__fetchError : null;
  const normalizedOwner = ownerFetchError ? null : owner;

  const contactEmail = normalizedOwner?.email
    || extractEmail(repo.homepage)
    || null;

  return {
    signal,
    repo,
    owner: normalizedOwner,
    contactEmail,
    error: ownerFetchError,
  };
}

function extractEmail(value) {
  if (!value || typeof value !== "string") return null;
  const match = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0] : null;
}

function buildDraft(lead) {
  const repoName = lead.repo?.full_name ?? lead.signal.title;
  const homepage = lead.repo?.homepage ? ` I also noticed ${lead.repo.homepage}.` : "";

  const subject = `The trust seam in ${repoName}`;
  const body = [
    `Hi ${lead.owner?.name || lead.owner?.login || "there"},`,
    "",
    `I came across ${repoName} while tracking agent infrastructure signals.${homepage}`,
    "The recurring break I keep seeing is not model quality. It is what happens when an agent needs a third-party API key or a paid action mid-workflow.",
    "",
    "We built AgentPay for that seam:",
    "- capability vault so the raw upstream credential never enters the agent context",
    "- governed spend/autonomy controls set once in-host",
    "- hosted payment/approval steps that resume the exact blocked action automatically",
    "",
    "If useful, I can send the concrete host-native flow for Claude/OpenAI distribution surfaces.",
    "",
    "Rajiv",
    "AgentPay Labs",
  ].join("\n");

  return { subject, body };
}

async function sendEmail({ to, subject, body }) {
  if (!process.env.RESEND_API_KEY) {
    return { status: "dry_run", provider: "resend_not_configured" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: `Rajiv Baskaran <${FROM_EMAIL}>`,
      to: [to],
      subject,
      text: body,
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`RESEND_SEND_FAILED:${response.status}:${JSON.stringify(payload).slice(0, 200)}`);
  }

  return {
    status: "sent",
    provider: "resend",
    id: payload.id ?? null,
  };
}

async function main() {
  await ensureDir(outboundDir);
  const latestSignals = await readJson(path.join(signalsDir, "latest.json"), { topSignals: [], topGithubSignals: [] });
  const existingLog = await readJson(path.join(outboundDir, "sent-log.json"), []);
  const latestDrafts = await readText(path.join(draftsDir, "outbound-latest.md"), "");
  const sentRecently = new Set(
    existingLog
      .filter((entry) =>
        entry.sendStatus === "sent"
        && new Date(entry.sentAt ?? 0).getTime() >= dedupeWindowCutoff())
      .map((entry) => `${entry.to}:${entry.signalUrl}`),
  );

  const candidateSignals = (latestSignals.topGithubSignals?.length ? latestSignals.topGithubSignals : latestSignals.topSignals ?? [])
    .filter((signal) => signal.source === "github")
    .filter((signal) => scoreSignal(signal) >= MIN_FIT_SCORE)
    .slice(0, MAX_DAILY_SENDS * 3);

  const enriched = [];
  for (const signal of candidateSignals) {
    const lead = await enrichGithubLead(signal);
    if (lead) enriched.push(lead);
  }

  const results = [];
  for (const lead of enriched) {
    if (results.filter((entry) => entry.sendStatus === "sent").length >= MAX_DAILY_SENDS) {
      break;
    }

    if (lead.error && !lead.contactEmail) {
      results.push({
        signalTitle: lead.signal.title,
        signalUrl: lead.signal.url,
        sendStatus: "skipped_enrichment_failed",
        error: lead.error,
      });
      continue;
    }

    if (!lead.contactEmail) {
      results.push({
        signalTitle: lead.signal.title,
        signalUrl: lead.signal.url,
        sendStatus: "skipped_no_email",
      });
      continue;
    }

    const dedupeKey = `${lead.contactEmail}:${lead.signal.url}`;
    if (sentRecently.has(dedupeKey)) {
      results.push({
        signalTitle: lead.signal.title,
        signalUrl: lead.signal.url,
        to: lead.contactEmail,
        sendStatus: "skipped_duplicate",
      });
      continue;
    }

    const draft = buildDraft(lead);
    const sendResult = await sendEmail({
      to: lead.contactEmail,
      subject: draft.subject,
      body: draft.body,
    }).catch((error) => ({
      status: "failed",
      provider: "resend",
      error: error instanceof Error ? error.message : String(error),
    }));

    results.push({
      signalTitle: lead.signal.title,
      signalUrl: lead.signal.url,
      to: lead.contactEmail,
      fitScore: scoreSignal(lead.signal),
      subject: draft.subject,
      draftSource: "outbound-latest.md",
      sendStatus: sendResult.status,
      provider: sendResult.provider,
      providerMessageId: sendResult.id ?? null,
      error: sendResult.error ?? null,
      replyStatus: "unknown",
      sentAt: isoNow(),
    });
  }

  const nextLog = [...existingLog, ...results.filter((entry) => entry.sendStatus === "sent" || entry.sendStatus === "dry_run")];
  await writeJson(path.join(outboundDir, `sent-${todayStamp()}.json`), results);
  await writeJson(path.join(outboundDir, "sent-log.json"), nextLog);
  await writeText(path.join(outboundDir, "latest-summary.md"), [
    "# Outbound send summary",
    "",
    `Generated at: ${isoNow()}`,
    "",
    `Draft source snapshot length: ${latestDrafts.length} characters`,
    "",
    ...results.map((entry) => `- ${entry.signalTitle}: ${entry.sendStatus}${entry.to ? ` -> ${entry.to}` : ""}`),
  ].join("\n"));

  console.log(`processed ${results.length} outbound targets`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
