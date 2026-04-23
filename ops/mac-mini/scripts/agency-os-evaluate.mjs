import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

const root = path.join(os.homedir(), ".openclaw");
const agencyWorkspace = path.join(root, "workspace-agency-os");
const boardsDir = path.join(agencyWorkspace, "boards");

const boardFiles = {
  experiments: "lab_experiments.json",
  archive: "lab_archive.json",
  metrics: "lab_metrics.json",
  safety: "lab_safety_reviews.json",
  outbound: "send_queue.json",
  revenue: "revenue.json",
  product: "product_truth.json",
  approvals: "approvals.json"
};

async function readJson(fileName, fallback) {
  const filePath = path.join(boardsDir, fileName);
  if (!existsSync(filePath)) {
    return { value: fallback, missing: true, path: filePath };
  }

  try {
    return { value: JSON.parse(await fs.readFile(filePath, "utf8")), missing: false, path: filePath };
  } catch (error) {
    return {
      value: fallback,
      missing: false,
      parseError: error.message,
      path: filePath
    };
  }
}

function scoreRatio(passed, total) {
  if (total === 0) return 0;
  return Math.round((passed / total) * 100);
}

function hasString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function hasArray(value) {
  return Array.isArray(value) && value.length > 0;
}

function experimentContractScore(experiment) {
  const checks = [
    hasString(experiment.id),
    hasString(experiment.owner),
    hasString(experiment.surface),
    hasString(experiment.hypothesis),
    Array.isArray(experiment.editable_paths),
    Array.isArray(experiment.read_paths),
    Boolean(experiment.budget && Number.isFinite(Number(experiment.budget.time_minutes))),
    Boolean(experiment.budget && Number.isFinite(Number(experiment.budget.model_budget_usd))),
    Boolean(experiment.budget && hasString(experiment.budget.external_actions)),
    hasArray(experiment.metrics),
    typeof experiment.approval_required === "boolean",
    hasString(experiment.rollback_rule),
    hasString(experiment.expected_artifact),
    hasString(experiment.status)
  ];

  return scoreRatio(checks.filter(Boolean).length, checks.length);
}

function actionNeedsApproval(item) {
  const externalActions = item?.budget?.external_actions;
  return externalActions && externalActions !== "none";
}

function scoreOutboundPacket(packet) {
  const checks = [
    hasString(packet.id),
    hasString(packet.recipient) || hasString(packet.contact) || hasString(packet.account),
    hasString(packet.reason) || hasString(packet.hypothesis),
    hasString(packet.proof) || hasString(packet.proof_claim),
    hasString(packet.cta) || hasString(packet.next_action),
    hasString(packet.follow_up_date) || hasString(packet.follow_up_at),
    hasString(packet.approval_status) || packet.approval_required === true
  ];
  return scoreRatio(checks.filter(Boolean).length, checks.length);
}

function scoreRevenueItem(item) {
  const checks = [
    hasString(item.id),
    hasString(item.buyer) || hasString(item.account) || hasString(item.customer),
    Number.isFinite(Number(item.amount)) || hasString(item.amount),
    hasString(item.currency) || hasString(item.pricing_basis),
    hasString(item.due_date) || hasString(item.target_date),
    hasString(item.next_step) || hasString(item.next_action),
    hasString(item.payment_path) || hasString(item.collection_path) || hasString(item.invoice_path),
    hasString(item.approval_status) || item.approval_required === true
  ];
  return scoreRatio(checks.filter(Boolean).length, checks.length);
}

function average(scores) {
  if (scores.length === 0) return 0;
  return Math.round(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function buildIssues(boards, dimensions) {
  const issues = [];
  for (const [name, board] of Object.entries(boards)) {
    if (board.missing) issues.push(`${name}: missing ${board.path}`);
    if (board.parseError) issues.push(`${name}: invalid JSON (${board.parseError})`);
  }

  if (dimensions.experiment_contracts < 90) {
    issues.push("lab experiments need stronger contracts: owner, surface, hypothesis, budget, metrics, rollback, and approval rule.");
  }
  if (dimensions.approval_gates < 100) {
    issues.push("one or more experiments can create external effects without an explicit approval gate.");
  }
  if (dimensions.product_truth < 50) {
    issues.push("product truth has too little proof; outbound/revenue/partner claims risk drifting into invention.");
  }
  if (dimensions.safety_coverage < 50) {
    issues.push("safety review coverage is thin; approval-required experiments need review records before external action.");
  }
  if (dimensions.revenue_traceability < 50) {
    issues.push("revenue board lacks buyer/amount/date/payment-path traceability.");
  }
  if (dimensions.outbound_readiness < 50) {
    issues.push("send queue lacks recipient/proof/CTA/follow-up/approval-ready packets.");
  }
  return issues;
}

function buildNextActions(dimensions) {
  const actions = [];
  if (dimensions.product_truth < 50) {
    actions.push("Add one concrete product proof row before scaling outbound or platform submissions.");
  }
  if (dimensions.experiment_contracts < 90) {
    actions.push("Tighten proposed lab experiments until each has a fixed surface, evaluator, rollback rule, and approval class.");
  }
  if (dimensions.outbound_readiness < 50) {
    actions.push("Create one founder-approval-ready MCP billing gateway outreach packet.");
  }
  if (dimensions.revenue_traceability < 50) {
    actions.push("Create one first-cash revenue packet with buyer, amount, due date, next step, and payment path.");
  }
  if (dimensions.safety_coverage < 50) {
    actions.push("Add safety review entries for experiments that touch external action, spend, claims, payments, or customer promises.");
  }
  return actions.slice(0, 5);
}

async function main() {
  const boards = {
    experiments: await readJson(boardFiles.experiments, { experiments: [] }),
    archive: await readJson(boardFiles.archive, { runs: [] }),
    metrics: await readJson(boardFiles.metrics, {}),
    safety: await readJson(boardFiles.safety, { reviews: [] }),
    outbound: await readJson(boardFiles.outbound, { packets: [] }),
    revenue: await readJson(boardFiles.revenue, { items: [] }),
    product: await readJson(boardFiles.product, { surfaces: [] }),
    approvals: await readJson(boardFiles.approvals, { requests: [] })
  };

  const experiments = boards.experiments.value.experiments ?? [];
  const safetyReviews = boards.safety.value.reviews ?? [];
  const outboundPackets = boards.outbound.value.packets ?? [];
  const revenueItems = boards.revenue.value.items ?? [];
  const productSurfaces = boards.product.value.surfaces ?? [];
  const approvalRequests = boards.approvals.value.requests ?? [];

  const contractScores = experiments.map(experimentContractScore);
  const externalActionExperiments = experiments.filter(actionNeedsApproval);
  const unsafeExternalActions = externalActionExperiments.filter((experiment) => experiment.approval_required !== true);
  const approvalGates = unsafeExternalActions.length === 0 ? 100 : scoreRatio(externalActionExperiments.length - unsafeExternalActions.length, externalActionExperiments.length);
  const reviewCoverage = experiments.length === 0
    ? 0
    : scoreRatio(
      experiments.filter((experiment) => safetyReviews.some((review) => review.experiment_id === experiment.id)).length,
      experiments.length
    );

  const dimensions = {
    experiment_contracts: average(contractScores),
    approval_gates: approvalGates,
    outbound_readiness: average(outboundPackets.map(scoreOutboundPacket)),
    revenue_traceability: average(revenueItems.map(scoreRevenueItem)),
    product_truth: scoreRatio(
      productSurfaces.filter((surface) => hasString(surface.name) && (hasString(surface.proof) || hasString(surface.proof_url) || hasString(surface.status))).length,
      Math.max(productSurfaces.length, 1)
    ),
    safety_coverage: Math.max(reviewCoverage, approvalRequests.length > 0 ? 50 : 0)
  };

  const overallScore = average(Object.values(dimensions));
  const issues = buildIssues(boards, dimensions);
  const nextActions = buildNextActions(dimensions);
  const result = {
    schema_version: 1,
    purpose: "AgentPay Labs evaluator output. The lab loop writes measured board health, experiment readiness, and safety posture here.",
    last_evaluated_at: new Date().toISOString(),
    overall_score: overallScore,
    dimensions,
    counts: {
      experiments: experiments.length,
      archived_runs: (boards.archive.value.runs ?? []).length,
      safety_reviews: safetyReviews.length,
      outbound_packets: outboundPackets.length,
      revenue_items: revenueItems.length,
      product_surfaces: productSurfaces.length
    },
    issues,
    next_actions: nextActions
  };

  if (!checkOnly) {
    await fs.mkdir(boardsDir, { recursive: true });
    await fs.writeFile(path.join(boardsDir, boardFiles.metrics), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  }

  console.log(JSON.stringify({
    command: "agency-os-evaluate",
    checkOnly,
    metricsPath: path.join(boardsDir, boardFiles.metrics),
    result
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack ?? error.message);
  process.exitCode = 1;
});
