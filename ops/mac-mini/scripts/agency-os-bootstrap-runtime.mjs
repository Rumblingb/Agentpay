import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const macMiniDir = path.resolve(path.dirname(scriptPath), "..");
const templateBoardsDir = path.join(macMiniDir, "agency-os", "boards");
const openclawRoot = path.join(os.homedir(), ".openclaw");
const agencyWorkspace = path.join(openclawRoot, "workspace-agency-os");
const liveBoardsDir = path.join(agencyWorkspace, "boards");

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const checkOnly = args.has("--check");
const overwrite = args.has("--overwrite");

const boardFiles = [
  "crm.json",
  "send_queue.json",
  "revenue.json",
  "customer_success.json",
  "partnerships.json",
  "ads_experiments.json",
  "content_queue.json",
  "product_truth.json",
  "approvals.json",
  "pnl.json",
  "platform_submissions.json",
  "research_backlog.json",
  "lab_experiments.json",
  "lab_archive.json",
  "lab_metrics.json",
  "lab_skill_library.json",
  "lab_reflections.json",
  "lab_safety_reviews.json"
];

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

async function writeJsonIfNeeded(fileName) {
  const templatePath = path.join(templateBoardsDir, fileName);
  const livePath = path.join(liveBoardsDir, fileName);
  const template = await readJson(templatePath);
  const exists = existsSync(livePath);

  if (exists && !overwrite) {
    await readJson(livePath);
    return { file: fileName, action: "kept", path: livePath };
  }

  if (checkOnly || dryRun) {
    return { file: fileName, action: exists ? "would-overwrite" : "would-create", path: livePath };
  }

  await fs.mkdir(path.dirname(livePath), { recursive: true });
  const withTimestamp = {
    ...template,
    updated_at: new Date().toISOString().slice(0, 10)
  };
  await fs.writeFile(livePath, `${JSON.stringify(withTimestamp, null, 2)}\n`, "utf8");
  return { file: fileName, action: exists ? "overwritten" : "created", path: livePath };
}

async function main() {
  if (!existsSync(templateBoardsDir)) {
    throw new Error(`template board directory missing: ${templateBoardsDir}`);
  }

  const results = [];
  for (const fileName of boardFiles) {
    results.push(await writeJsonIfNeeded(fileName));
  }

  const summary = {
    command: "agency-os-bootstrap-runtime",
    dryRun,
    checkOnly,
    overwrite,
    templateBoardsDir,
    liveBoardsDir,
    results
  };

  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
