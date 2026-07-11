#!/bin/bash
# AgentPay security posture — deterministic checks (no network settlement).
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
LOG_DIR="${BEE_DIR:-$HOME/.bee}/logs"
mkdir -p "$LOG_DIR"
STAMP="$(date -u +%Y-%m-%dT%H-%M-%SZ)"
OUT="$LOG_DIR/security-posture-$STAMP.log"
JSON="$LOG_DIR/security-posture-latest.json"
BEE="$HERE/bin/bee"

fail=0
pass() { echo "  ✅ $1"; }
bad() { echo "  ❌ $1"; fail=1; }

{
  echo "=== AgentPay security posture $STAMP ==="
  echo "repo: $REPO"

  echo
  echo "[1/4] bee doctor"
  if "$BEE" doctor >"$LOG_DIR/.doctor.tmp" 2>&1; then
    if grep -q 'all green' "$LOG_DIR/.doctor.tmp"; then pass 'bee doctor all green'; else bad 'bee doctor not all green'; cat "$LOG_DIR/.doctor.tmp"; fi
  else bad 'bee doctor command failed'; cat "$LOG_DIR/.doctor.tmp" || true; fi

  echo
  echo "[2/4] bee mandate + rail tests"
  if node --test "$HERE/bee/bee.test.mjs" >"$LOG_DIR/.bee-test.tmp" 2>&1; then pass 'bee.test.mjs'; else bad 'bee.test.mjs failed'; tail -40 "$LOG_DIR/.bee-test.tmp"; fi

  echo
  echo "[3/4] wallet provider adapters"
  "$BEE" provider-adapters >"$LOG_DIR/.adapters.tmp" 2>&1 || true
  ready_count="$(grep -c ' ready$' "$LOG_DIR/.adapters.tmp" || true)"
  if [ "${ready_count:-0}" -gt 0 ]; then pass "$ready_count wallet adapter(s) ready"; else echo "  ⚠ no wallet adapters fully configured (expected until env keys are set)"; fi
  cat "$LOG_DIR/.adapters.tmp"

  echo
  echo "[4/4] landing worker smoke"
  if node "$REPO/workers/agentpay-landing/worker.test.mjs" >"$LOG_DIR/.landing-test.tmp" 2>&1; then pass 'agentpay-landing worker smoke'; else bad 'landing worker smoke failed'; cat "$LOG_DIR/.landing-test.tmp"; fi

  echo
  if [ "$fail" -eq 0 ]; then echo "RESULT: PASS"; else echo "RESULT: FAIL"; fi
} | tee "$OUT"

python3 - <<PY
import json, pathlib, time
out = pathlib.Path("$OUT").read_text()
result = "PASS" if "RESULT: PASS" in out else "FAIL"
pathlib.Path("$JSON").write_text(json.dumps({
  "at": "$STAMP",
  "result": result,
  "log": "$OUT",
  "repo": "$REPO",
}, indent=2) + "\n")
PY

exit "$fail"
