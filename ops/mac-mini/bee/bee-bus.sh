#!/bin/bash
# Bee State Bus - Unified inter-agent communication
# Usage: bee-bus.sh <action> <key> [value]
# Actions: report, read, claim, state

ACTION="$1"
KEY="$2"
VALUE="$3"

BEE_DIR="$HOME/.bee"
STATE_DB="$BEE_DIR/labs-board.db"

case "$ACTION" in
  report)
    # Report task outcome to shared board
    sqlite3 "$STATE_DB" "INSERT OR REPLACE INTO outcomes (key, value, updated_at) VALUES ('$KEY', '$(date +%s)|$VALUE', $(date +%s))"
    ;;
  read)
    # Read shared state
    sqlite3 "$STATE_DB" "SELECT value FROM outcomes WHERE key='$KEY' ORDER BY updated_at DESC LIMIT 1"
    ;;
  state)
    # Generate unified state snapshot
    node -e "require('$BEE_DIR/bee.mjs').stateJSON() && require('fs').writeFileSync('$BEE_DIR/state.json', JSON.stringify(require('$BEE_DIR/bee.mjs').stateJSON(), null, 2))"
    cat "$BEE_DIR/state.json"
    ;;
esac