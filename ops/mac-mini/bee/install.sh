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

# 3) local brain (free). NIM is the cloud fallback if a key is set.
if command -v ollama >/dev/null; then
  ollama list 2>/dev/null | grep -q "gemma3:12b" || { echo "→ pulling gemma3:12b (local brain, ~7GB, one-time)…"; ollama pull gemma3:12b; }
  ollama list 2>/dev/null | grep -q "nomic-embed-text" || ollama pull nomic-embed-text 2>/dev/null || true
else
  echo "⚠ ollama not found → Bee's free local brain is off. Install from https://ollama.com,"
  echo "  or set NVIDIA_API_KEY in ~/.bee/.env to run on NIM (70b) instead."
fi

# 4) desktop companion deps
if [ -d "$HERE/desk" ]; then echo "→ installing the butterfly companion deps…"; (cd "$HERE/desk" && npm i --silent) || echo "  (npm i failed — run it manually in desk/)"; fi

# 5) secrets (gitignored, local only)
if [ ! -f "$BEE_DIR/.env" ]; then
  printf '# Bee secrets — local only, never committed. Add keys below:\n# NVIDIA_API_KEY=nvapi-...   (the 70b cloud brain + Nemotron worker)\n' > "$BEE_DIR/.env"
  chmod 600 "$BEE_DIR/.env"
  echo "→ created ~/.bee/.env (add NVIDIA_API_KEY for the sharp brain)"
fi

# 6) init the board + health check
node "$HERE/bee.mjs" doctor >/dev/null 2>&1 || true

echo
echo "✅ Bee is installed. Try:"
echo "   bee \"draft a launch tweet\"     # create → route → dispatch"
echo "   bee dash                        # the control plane"
echo "   bee decide \"first revenue\"      # OODA decision (what/who/when)"
echo "   bee converse                    # talk to Bee, hands-free (grant Terminal mic once)"
echo "   npm --prefix \"$HERE/desk\" start  # the butterfly companion"
echo
echo "One-time macOS grants for the full experience: Accessibility + Screen Recording → your terminal."
echo "Always-on mode: load $HERE/../launchd/*.template into ~/Library/LaunchAgents."
