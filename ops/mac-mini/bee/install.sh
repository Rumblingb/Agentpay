#!/bin/bash
# bee install — one command, idempotent, ~3 minutes. Sets up the founder-in-a-box.
set -e
echo "🐝 Installing Bee — founder-in-a-box…"
HERE="$(cd "$(dirname "$0")" && pwd)"
BEE_DIR="$HOME/.bee"
mkdir -p "$BEE_DIR/inbox/done" "$BEE_DIR/logs" "$BEE_DIR/models"

# 1) prerequisites
command -v node >/dev/null || { echo "✗ Need Node (brew install node). Stop."; exit 1; }
command -v sqlite3 >/dev/null || echo "⚠ sqlite3 not found (macOS ships it; else: brew install sqlite)"

# 2) screen-act helper
command -v cliclick >/dev/null || { echo "→ installing cliclick (for screen control)…"; brew install cliclick 2>/dev/null || echo "  (no brew — install cliclick manually if you want screen-act)"; }

# 3) local brain (free). Tiered NVIDIA NIM is the cloud fallback if a key is set.
if command -v ollama >/dev/null; then
  ollama list 2>/dev/null | grep -q "gemma3:12b" || { echo "→ pulling gemma3:12b (local brain, ~7GB, one-time)…"; ollama pull gemma3:12b; }
  ollama list 2>/dev/null | grep -q "nomic-embed-text" || ollama pull nomic-embed-text 2>/dev/null || true
else
  echo "⚠ ollama not found → Bee's free local brain is off. Install from https://ollama.com,"
  echo "  or set NVIDIA_API_KEY in ~/.bee/.env to use tiered Nemotron NIM instead."
fi

# 4) desktop companion deps
if [ -d "$HERE/desk" ]; then echo "→ installing the butterfly companion deps…"; (cd "$HERE/desk" && npm i --silent) || echo "  (npm i failed — run it manually in desk/)"; fi

# 5) secrets (gitignored, local only)
if [ ! -f "$BEE_DIR/.env" ]; then
  printf '# Bee secrets — local only, never committed. Add keys below:\n# NVIDIA_API_KEY=nvapi-...   (fast + reasoning Nemotron NIM tiers)\n' > "$BEE_DIR/.env"
  chmod 600 "$BEE_DIR/.env"
  echo "→ created ~/.bee/.env (add NVIDIA_API_KEY for the sharp brain)"
fi

# 6) init the board + health check
node "$HERE/bee.mjs" doctor >/dev/null 2>&1 || true

# 7) always-on services. Materialize templates for this checkout/home, then bootstrap idempotently.
LAUNCHD_SRC="$HERE/../launchd"
LAUNCHD_DST="$HOME/Library/LaunchAgents"
REPO_ROOT="$(cd "$HERE/../../.." && pwd)"
NODE_BIN="$(command -v node)"
mkdir -p "$LAUNCHD_DST"
for label in com.agentpay.bee.daemon com.agentpay.bee.pull com.agentpay.bee.desk com.agentpay.bee.voicebox; do
  src="$LAUNCHD_SRC/$label.plist.template"; dst="$LAUNCHD_DST/$label.plist"
  [ -f "$src" ] || continue
  if [ "$label" = com.agentpay.bee.voicebox ] && [ ! -x /Applications/Voicebox.app/Contents/MacOS/voicebox-server ]; then
    echo "  (Voicebox is not installed; Kokoro remains the voice backend)"
    continue
  fi
  sed -e "s#/Users/brain/Agentpay#$REPO_ROOT#g" -e "s#/Users/brain/.local/node/bin/node#$NODE_BIN#g" -e "s#/Users/brain#$HOME#g" "$src" > "$dst"
  plutil -lint "$dst" >/dev/null
  launchctl bootout "gui/$UID/$label" >/dev/null 2>&1 || true
  launchctl bootstrap "gui/$UID" "$dst"
done

echo
echo "✅ Bee is installed. Try:"
echo "   bee \"draft a launch tweet\"     # create → route → dispatch"
echo "   bee dash                        # the control plane"
echo "   bee decide \"first revenue\"      # OODA decision (what/who/when)"
echo "   bee converse                    # talk to Bee, hands-free (grant Terminal mic once)"
echo "   bee ask <mandate-id>            # approve/reject with Clickey"
echo
echo "One-time macOS grants for the full experience: Accessibility + Screen Recording → your terminal."
echo "Always-on mode is installed: daemon + pull worker + Clickey desk + natural voice."
