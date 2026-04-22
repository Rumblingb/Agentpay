import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.join(os.homedir(), ".openclaw");
const agencyWorkspace = path.join(root, "workspace-agency-os");
const agencyCellsDir = path.join(agencyWorkspace, "cells");
const legacyLaneIds = ["jack", "bigb", "chief-agent", "digital-you"];
const cellConfigs = [
  { id: "offer-strategy", fallbackLaneId: "bigb" },
  { id: "build-ops", fallbackLaneId: "chief-agent" },
  { id: "outbound-ops", fallbackLaneId: "jack" },
  { id: "media-ops", fallbackLaneId: "digital-you" },
  { id: "revenue-ops" },
  { id: "ads-ops" },
  { id: "partnerships-ops" },
  { id: "customer-ops" }
];
const FRESH_UPDATE_MINUTES = 24 * 60;
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
  return trimmed.replace(/^# Outbox\s*/m, "").trim();
}

function isFreshUpdate(date) {
  if (!(date instanceof Date)) return false;
  return Date.now() - date.getTime() <= FRESH_UPDATE_MINUTES * 60 * 1000;
}

function tail(text, lines = 8) {
  const trimmed = meaningfulText(text);
  if (!trimmed) return "No material operator update yet.";
  return trimmed.split(/\r?\n/).slice(-lines).join("\n");
}

function extractCellValue(text, key) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.toLowerCase().startsWith(`- ${key.toLowerCase()}:`))
    ?.split(":")
    .slice(1)
    .join(":")
    .trim();
}

function sectionBulletTail(text, heading, lines = 4) {
  const trimmed = meaningfulText(text);
  if (!trimmed) return [];
  const allLines = trimmed.split(/\r?\n/);
  const start = allLines.findIndex((line) => line.trim() === heading);
  if (start === -1) return [];
  const collected = [];
  for (let i = start + 1; i < allLines.length; i += 1) {
    const line = allLines[i];
    if (line.startsWith("## ")) break;
    if (line.trim().startsWith("- ")) collected.push(line.trim());
  }
  return collected.slice(0, lines);
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
    hasMaterialUpdate: Boolean(meaningfulText(outbox)),
    freshMaterialUpdate: Boolean(stat?.mtime && meaningfulText(outbox) && isFreshUpdate(stat.mtime))
  };
}

async function cellSummary(id, fallbackLane) {
  const filePath = path.join(agencyCellsDir, `${id}.md`);
  const text = await readText(filePath);
  const stat = existsSync(filePath) ? await fs.stat(filePath) : null;
  const posture = extractCellValue(text, "posture") ?? fallbackLane.posture ?? "not declared";
  const nextArtifact = extractCellValue(text, "next artifact") ?? "not declared";
  const blocker = extractCellValue(text, "blocker") ?? "none";
  const founderNeeded = extractCellValue(text, "founder needed") ?? "none";
  const ready = (extractCellValue(text, "ready") ?? "no").toLowerCase() === "yes";
  const signalSource = stat ? "cell-file" : (fallbackLane.hasMaterialUpdate ? "legacy-lane-fallback" : "mission-default");
  return {
    id,
    filePath,
    updatedAt: stat?.mtime ?? fallbackLane.updatedAt ?? null,
    posture,
    nextArtifact,
    blocker,
    founderNeeded,
    ready,
    signalSource
  };
}

const now = new Date();
const agencyInbox = await readText(path.join(agencyWorkspace, "INBOX.md"));
const agencyTaskBoard = await readText(path.join(agencyWorkspace, "TASK_BOARD.md"));
const lanes = await Promise.all(legacyLaneIds.map((id) => laneSummary(id)));
const fallbackLane = { id: "agency-os", posture: "not declared", hasMaterialUpdate: false, updatedAt: null };
const cells = await Promise.all(cellConfigs.map((config) => {
  const lane = config.fallbackLaneId
    ? (lanes.find((item) => item.id === config.fallbackLaneId) ?? fallbackLane)
    : fallbackLane;
  return cellSummary(config.id, lane);
}));
const missionBullets = sectionBulletTail(agencyTaskBoard, "## Current company mission", cellConfigs.length);
const freshCells = cells.filter((cell) => cell.updatedAt && isFreshUpdate(cell.updatedAt));
const readyCells = cells.filter((cell) => cell.ready);
const staleCellIds = cells
  .filter((cell) => cell.updatedAt && !isFreshUpdate(cell.updatedAt))
  .map((cell) => cell.id);
const criticalBlockers = cells
  .filter((cell) => cell.blocker && !["none", "no", "n/a"].includes(cell.blocker.toLowerCase()))
  .map((cell) => `${cell.id}: ${cell.blocker}`);

const outboxLines = [
  "# Agency OS Outbox",
  "",
  "Auto-generated founder-facing merge of the company-building lanes.",
  "",
  `- last sync: ${fmtTime(now)} IST`,
  `- active founder-ready packets: ${readyCells.length}`,
  `- founder inbox tail: ${tail(agencyInbox, 4).replace(/\n/g, " | ")}`,
  `- operating mode: merged AgentPay Labs office, internal cells collaborate, founder approves/sends`,
  ...(missionBullets.length > 0 ? [`- merged mission: ${missionBullets.map((line) => line.replace(/^- /, "")).join(" | ")}`] : []),
  ""
];

for (const cell of cells) {
  outboxLines.push(`## ${cell.id}`);
  outboxLines.push(`- posture: ${cell.posture}`);
  outboxLines.push(`- next artifact: ${cell.nextArtifact}`);
  outboxLines.push(`- blocker: ${cell.blocker}`);
  outboxLines.push(`- founder needed: ${cell.founderNeeded}`);
  outboxLines.push(`- ready: ${cell.ready ? "yes" : "no"}`);
  outboxLines.push(`- signal source: ${cell.signalSource}`);
  outboxLines.push("");
}

const statusLines = [
  "# Agency OS Status",
  "",
  `- last sync: ${fmtTime(now)} IST`,
  `- active internal cells: ${freshCells.length}/${cells.length}`,
  `- active founder-ready packets: ${readyCells.length}`,
  ...(missionBullets.length > 0 ? [`- merged mission: ${missionBullets.map((line) => line.replace(/^- /, "")).join(" | ")}`] : []),
  `- internal cells with fresh updates: ${freshCells.map((cell) => cell.id).join(", ") || "none"}`,
  `- critical blockers: ${criticalBlockers.join(" | ") || "none"}`,
  `- stale internal cells: ${staleCellIds.join(", ") || "none"}`
];

await fs.mkdir(agencyWorkspace, { recursive: true });
await fs.writeFile(path.join(agencyWorkspace, "OUTBOX.md"), `${outboxLines.join("\n")}\n`, "utf8");
await fs.writeFile(path.join(agencyWorkspace, "STATUS.md"), `${statusLines.join("\n")}\n`, "utf8");

console.log(JSON.stringify({
  command: "agency-os-sync",
  syncedAt: now.toISOString(),
  outboxPath: path.join(agencyWorkspace, "OUTBOX.md"),
  statusPath: path.join(agencyWorkspace, "STATUS.md"),
  activeCellUpdates: freshCells.length,
  totalCells: cells.length,
  readyPackets: readyCells.length
}, null, 2));
