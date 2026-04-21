import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const scripts = [
  "collect-signals.mjs",
  "draft-outreach.mjs",
  "draft-content.mjs",
  "community-monitor.mjs",
  "research-patterns.mjs",
  "send-outreach.mjs",
  "weekly-report.mjs",
];

for (const script of scripts) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
