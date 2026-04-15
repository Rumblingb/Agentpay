#!/bin/bash
set -euo pipefail

stack_agentpay_root() {
  CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../../.." && pwd
}

stack_workspace_root() {
  printf '%s\n' "/Users/baskar_viji/.openclaw"
}

stack_bill_workspace() {
  printf '%s\n' "$(stack_workspace_root)/workspace-bill"
}

stack_agency_workspace() {
  printf '%s\n' "$(stack_workspace_root)/workspace-agency-os"
}

stack_openjarvis_workspace() {
  printf '%s\n' "$(stack_workspace_root)/workspace-open-jarvis"
}

stack_lane_workspace() {
  case "$1" in
    jack) printf '%s\n' "$(stack_workspace_root)/workspace-jack" ;;
    bigb) printf '%s\n' "$(stack_workspace_root)/workspace-bigb" ;;
    chief-agent) printf '%s\n' "$(stack_workspace_root)/workspace-chief-agent" ;;
    digital-you) printf '%s\n' "$(stack_workspace_root)/workspace-digital-you" ;;
    bill) printf '%s\n' "$(stack_workspace_root)/workspace-bill" ;;
    open-jarvis) printf '%s\n' "$(stack_openjarvis_workspace)" ;;
    *) echo "Unknown lane: $1" >&2; exit 2 ;;
  esac
}

stack_now() {
  TZ="${STACK_TIMEZONE:-Asia/Kolkata}" date '+%Y-%m-%d %H:%M:%S %Z'
}

stack_read_message() {
  if [[ $# -gt 0 ]]; then
    printf '%s\n' "$*"
  else
    cat
  fi
}

stack_append_entry() {
  local file="$1"
  local title="$2"
  local body="$3"
  mkdir -p "$(dirname -- "$file")"
  touch "$file"
  if [[ -s "$file" ]]; then
    printf '\n\n' >> "$file"
  fi
  printf '## %s\n' "$(stack_now)" >> "$file"
  printf -- '- %s\n\n' "$title" >> "$file"
  printf '%s\n' "$body" >> "$file"
}
