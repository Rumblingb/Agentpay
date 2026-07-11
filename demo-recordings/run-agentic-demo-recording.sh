#!/bin/sh
cd /Users/brain/agentpay-demo-qa || exit 1
printf '\033[8;42;150t'
clear
printf 'Codex + AgentPay MCP: full agentic demo\n'
printf 'Leak Guard -> Buy API -> Human setup resume -> Paid exact-call resume\n\n'
sleep 2
npm run demo:codex-agentpay-mcp 2>&1 | while IFS= read -r line; do
  printf '%s\n' "$line"
  case "$line" in
    *"MCP call:"*|*"Agent decision"*|*"Human step surfaced"*|*"Paid execution pause"*|*"Final agent answer"*)
      sleep 1.0
      ;;
    "")
      sleep 0.12
      ;;
    *)
      sleep 0.045
      ;;
  esac
done
printf '\nDemo complete. AgentPay MCP kept raw secrets out of Codex and resumed the exact paid call.\n'
sleep 8
