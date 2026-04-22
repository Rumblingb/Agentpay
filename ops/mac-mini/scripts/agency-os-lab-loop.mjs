import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run") || !args.has("--write");
const root = path.join(os.homedir(), ".openclaw");
const agencyWorkspace = path.join(root, "workspace-agency-os");
const boardsDir = path.join(agencyWorkspace, "boards");
const scriptPath = fileURLToPath(import.meta.url);
const evaluateScript = path.join(path.dirname(scriptPath), "agency-os-evaluate.mjs");

async function readJson(fileName, fallback) {
  const filePath = path.join(boardsDir, fileName);
  if (!existsSync(filePath)) return fallback;
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(fileName, value) {
  await fs.mkdir(boardsDir, { recursive: true });
  await fs.writeFile(path.join(boardsDir, fileName), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function pickExperiment(experiments) {
  const openStatuses = new Set(["proposed", "queued", "needs_evaluation"]);
  const candidates = experiments.filter((experiment) => openStatuses.has(experiment.status));
  if (candidates.length === 0) return null;

  return candidates
    .map((experiment) => ({
      experiment,
      priority: experiment.owner === "revenue-ops" ? 3 : experiment.owner === "outbound-ops" ? 2 : 1
    }))
    .sort((left, right) => right.priority - left.priority || left.experiment.id.localeCompare(right.experiment.id))[0].experiment;
}

function scoreExperiment(experiment) {
  const checks = [
    Boolean(experiment.owner),
    Boolean(experiment.surface),
    Boolean(experiment.hypothesis),
    Array.isArray(experiment.editable_paths),
    Array.isArray(experiment.read_paths),
    Boolean(experiment.budget?.time_minutes),
    Boolean(experiment.budget?.external_actions),
    Array.isArray(experiment.metrics) && experiment.metrics.length > 0,
    experiment.approval_required === true,
    Boolean(experiment.rollback_rule),
    Boolean(experiment.expected_artifact)
  ];
  return Math.round((checks.filter(Boolean).length / checks.length) * 100);
}

function buildRunRecord(experiment, metrics) {
  const score = scoreExperiment(experiment);
  const passed = score >= 90 && metrics.overall_score >= 50;
  return {
    id: `lab-run-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${experiment.id}`,
    experiment_id: experiment.id,
    parent_experiment_id: experiment.parent_experiment_id ?? null,
    owner: experiment.owner,
    surface: experiment.surface,
    started_at: new Date().toISOString(),
    dry_run: dryRun,
    score,
    evaluator_overall_score: metrics.overall_score,
    status: passed ? "ready_for_founder_review" : "needs_rework",
    external_actions: experiment.budget?.external_actions ?? "none",
    approval_required: experiment.approval_required === true,
    expected_artifact: experiment.expected_artifact,
    issues: metrics.issues ?? [],
    next_actions: metrics.next_actions ?? [],
    decision: passed ? "archive_and_prepare_approval_packet" : "archive_failure_and_mutate_contract"
  };
}

function buildReflection(runRecord) {
  return {
    id: `reflection-${runRecord.id}`,
    run_id: runRecord.id,
    experiment_id: runRecord.experiment_id,
    created_at: new Date().toISOString(),
    keep: runRecord.score >= 90 ? "The experiment contract is complete enough to evaluate repeatedly." : "Keep the experiment hypothesis but tighten the contract.",
    discard: runRecord.score >= 90 ? "Do not execute external actions until founder approval is explicit." : "Discard vague surfaces, missing rollback rules, and unmeasured outputs.",
    next_mutation: runRecord.next_actions[0] ?? "Create a smaller, more measurable experiment with one artifact and one evaluator.",
    founder_decision_needed: runRecord.approval_required ? "Approve or reject the staged artifact before any external action." : "None for this dry-run cycle."
  };
}

function runEvaluator() {
  const result = spawnSync(process.execPath, [evaluateScript], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || "agency-os-evaluate failed");
  }
}

async function main() {
  runEvaluator();

  const experimentsBoard = await readJson("lab_experiments.json", { experiments: [] });
  const archiveBoard = await readJson("lab_archive.json", { schema_version: 1, purpose: "AgentPay Labs experiment run archive.", runs: [] });
  const reflectionsBoard = await readJson("lab_reflections.json", { schema_version: 1, purpose: "AgentPay Labs experiment reflections.", reflections: [] });
  const metricsBoard = await readJson("lab_metrics.json", { overall_score: 0, issues: [], next_actions: [] });
  const experiment = pickExperiment(experimentsBoard.experiments ?? []);

  if (!experiment) {
    console.log(JSON.stringify({
      command: "agency-os-lab-loop",
      dryRun,
      status: "no_open_experiments",
      metricsPath: path.join(boardsDir, "lab_metrics.json")
    }, null, 2));
    return;
  }

  const runRecord = buildRunRecord(experiment, metricsBoard);
  const reflection = buildReflection(runRecord);

  if (!dryRun) {
    archiveBoard.runs = [...(archiveBoard.runs ?? []), runRecord];
    reflectionsBoard.reflections = [...(reflectionsBoard.reflections ?? []), reflection];
    experimentsBoard.experiments = (experimentsBoard.experiments ?? []).map((item) => (
      item.id === experiment.id
        ? { ...item, status: runRecord.status, last_run_id: runRecord.id, last_score: runRecord.score, last_evaluated_at: runRecord.started_at }
        : item
    ));

    await writeJson("lab_archive.json", archiveBoard);
    await writeJson("lab_reflections.json", reflectionsBoard);
    await writeJson("lab_experiments.json", experimentsBoard);
    runEvaluator();
  }

  console.log(JSON.stringify({
    command: "agency-os-lab-loop",
    dryRun,
    selectedExperiment: experiment.id,
    archivePath: path.join(boardsDir, "lab_archive.json"),
    reflectionsPath: path.join(boardsDir, "lab_reflections.json"),
    runRecord,
    reflection
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
