import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(os.homedir(), ".openclaw");
const agencyWorkspace = path.join(root, "workspace-agency-os");
const laneIds = ["jack", "bigb", "digital-you"];
const placeholderOutboxes = new Set([
  "# Outbox\n\nWrite compact operator-facing updates here when a run materially changes state.",
  "# Agency OS Outbox\n\nUse this for compact operator-facing summaries of product, build, growth, and revenue progress."
]);

function fmtTime(date) {
  return date.toLocaleString("en-GB", { hour12: false, timeZone: "Asia/Kolkata" });
}

async function readText(filePath) {
  if (!existsSync(filePath)) return "";
  return fs.readFile(filePath, "utf8");
}

function meaningfulText(text) {
  const trimmed = text.trim();
  if (!trimmed || placeholderOutboxes.has(trimmed)) return "";
  return trimmed;
}

function tail(text, lines = 8) {
  const trimmed = meaningfulText(text);
  if (!trimmed) return "No material operator update yet.";
  return trimmed.split(/\r?\n/).slice(-lines).join("\n");
}

async function laneSummary(id) {
  const workspace = path.join(root, `workspace-${id}`);
  const outboxPath = path.join(workspace, "OUTBOX.md");
  const inboxPath = path.join(workspace, "INBOX.md");
  const advicePath = path.join(workspace, "MAIN_ADVICE.md");
  const [outbox, inbox, advice] = await Promise.all([readText(outboxPath), readText(inboxPath), readText(advicePath)]);
  const stat = existsSync(outboxPath) ? await fs.stat(outboxPath) : null;
  const posture = advice.split(/\r?\n/).find((line) => line.startsWith("- current posture:"))?.replace("- current posture:", "").trim() ?? "not declared";
  return {
    id,
    updatedAt: stat?.mtime ?? null,
    posture,
    inboxTail: tail(inbox, 4),
    outboxTail: tail(outbox, 8),
    hasMaterialUpdate: Boolean(meaningfulText(outbox))
  };
}

const now = new Date();
const agencyInbox = await readText(path.join(agencyWorkspace, "INBOX.md"));
const lanes = await Promise.all(laneIds.map((id) => laneSummary(id)));
const activeLanes = lanes.filter((lane) => lane.hasMaterialUpdate);

const outboxLines = [
  "# Agency OS Outbox",
  "",
  "Auto-generated founder-facing merge of the company-building lanes.",
  "",
  `- last sync: ${fmtTime(now)} IST`,
  `- active lane updates: ${activeLanes.length}/${lanes.length}`,
  `- founder inbox tail: ${tail(agencyInbox, 4).replace(/\n/g, " | ")}`,
  ""
];

for (const lane of lanes) {
  outboxLines.push(`## ${lane.id}`);
  outboxLines.push(`- posture: ${lane.posture}`);
  outboxLines.push(`- updated: ${lane.updatedAt ? fmtTime(lane.updatedAt) + " IST" : "never"}`);
  outboxLines.push("");
  outboxLines.push(lane.outboxTail);
  outboxLines.push("");
}

const statusLines = [
  "# Agency OS Status",
  "",
  `- last sync: ${fmtTime(now)} IST`,
  `- active lane updates: ${activeLanes.length}/${lanes.length}`,
  `- lanes with material updates: ${activeLanes.map((lane) => lane.id).join(", ") || "none"}`,
  `- lanes awaiting first real output: ${lanes.filter((lane) => !lane.hasMaterialUpdate).map((lane) => lane.id).join(", ") || "none"}`
];

await fs.mkdir(agencyWorkspace, { recursive: true });
await fs.writeFile(path.join(agencyWorkspace, "OUTBOX.md"), `${outboxLines.join("\n")}\n`, "utf8");
await fs.writeFile(path.join(agencyWorkspace, "STATUS.md"), `${statusLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  command: "agency-os-sync",
  syncedAt: now.toISOString(),
  outboxPath: path.join(agencyWorkspace, "OUTBOX.md"),
  statusPath: path.join(agencyWorkspace, "STATUS.md"),
  activeLaneUpdates: activeLanes.length,
  totalLanes: lanes.length
}, null, 2));
