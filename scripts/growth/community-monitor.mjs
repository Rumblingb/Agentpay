import path from "node:path";
import { draftsDir, pickTop, readJson, signalsDir, todayStamp, writeText } from "./lib/common.mjs";

function replyDraft(signal) {
  return [
    `Context: ${signal.title}`,
    "",
    "Suggested reply:",
    "",
    "You can solve this without asking users to paste keys into chat or wiring a second payment surface.",
    "The cleaner pattern is:",
    "1. hosted capability connect so the raw upstream key never enters the agent context",
    "2. governed mandate so the user defines the budget and approval threshold once",
    "3. host-native funding request when money needs to move",
    "",
    "That is basically the AgentPay model. If useful, the quickest reference is docs.agentpay.so/quickstart and docs.agentpay.so/examples.",
    "",
    "Rule: keep the reply helpful first. Mention AgentPay only when it directly fits the thread.",
  ].join("\n");
}

async function main() {
  const latest = await readJson(path.join(signalsDir, "latest.json"), { topSignals: [] });
  const communitySignals = pickTop(
    (latest.topSignals ?? []).filter((signal) => signal.source === "reddit" || signal.source === "hackernews"),
    10,
  );

  const lines = [
    "# Community reply queue",
    "",
    "Human review required before posting. Replies should stay useful, specific, and non-salesy.",
    "",
  ];

  for (const signal of communitySignals) {
    lines.push(`## ${signal.title}`);
    lines.push(`Source: ${signal.source}`);
    lines.push(`Link: ${signal.url}`);
    lines.push("");
    lines.push("```text");
    lines.push(replyDraft(signal));
    lines.push("```");
    lines.push("");
  }

  const stamp = todayStamp();
  await writeText(path.join(draftsDir, `community-${stamp}.md`), lines.join("\n"));
  await writeText(path.join(draftsDir, "community-latest.md"), lines.join("\n"));

  console.log(`prepared ${communitySignals.length} community replies`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
