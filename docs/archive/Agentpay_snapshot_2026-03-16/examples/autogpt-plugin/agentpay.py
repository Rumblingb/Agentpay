"""
AgentPay Plugin for AutoGPT
============================
This plugin gives AutoGPT agents the ability to create payments,
verify transactions, and check AgentRank scores through AgentPay.

Installation:
    1. Copy this file to your AutoGPT plugins directory
    2. Set AGENTPAY_API_KEY in your AutoGPT .env file
    3. Enable the plugin in your AutoGPT config

Environment variables:
    AGENTPAY_API_KEY    - Your AgentPay API key (required)
    AGENTPAY_API_URL    - Override API URL (optional, default: https://api.agentpay.gg)
"""

import os
import json
import urllib.request
import urllib.error
from typing import Any

AGENTPAY_BASE_URL = os.environ.get("AGENTPAY_API_URL", "https://api.agentpay.gg")
AGENTPAY_API_KEY = os.environ.get("AGENTPAY_API_KEY", "")


def _request(method: str, path: str, body: Any = None) -> dict:
    """Make an authenticated request to the AgentPay API."""
    url = f"{AGENTPAY_BASE_URL}{path}"
    data = json.dumps(body).encode("utf-8") if body else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {AGENTPAY_API_KEY}",
        },
    )
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8")
        raise RuntimeError(f"AgentPay API error {e.code}: {error_body}") from e


# ---------------------------------------------------------------------------
# Plugin command definitions (AutoGPT command registry format)
# ---------------------------------------------------------------------------

COMMAND_CATEGORIES = ["payments", "finance", "agentpay"]

COMMANDS = [
    {
        "name": "agentpay_create_payment",
        "description": (
            "Create a payment request via AgentPay. "
            "Returns a payment intent ID and payment URL."
        ),
        "parameters": {
            "amount_usd": {"description": "Payment amount in USD (e.g. 5.00)", "type": "float"},
            "recipient_id": {"description": "Recipient agent ID or wallet address", "type": "str"},
            "memo": {
                "description": "Optional memo / description for the payment",
                "type": "str",
                "required": False,
            },
            "method": {
                "description": "Payment method: 'solana' (default) or 'stripe'",
                "type": "str",
                "required": False,
            },
        },
        "function": "agentpay_create_payment",
    },
    {
        "name": "agentpay_verify_payment",
        "description": "Verify the status of an existing AgentPay payment.",
        "parameters": {
            "payment_id": {"description": "The payment intent ID to verify", "type": "str"},
        },
        "function": "agentpay_verify_payment",
    },
    {
        "name": "agentpay_check_rank",
        "description": (
            "Check the AgentRank trust score (0-1000) for an agent. "
            "Higher is better; use before hiring/paying untrusted agents."
        ),
        "parameters": {
            "agent_id": {"description": "The agent ID to check", "type": "str"},
        },
        "function": "agentpay_check_rank",
    },
    {
        "name": "agentpay_create_escrow",
        "description": (
            "Create an escrow transaction to safely pay an agent after task completion. "
            "Funds are locked until you approve the work."
        ),
        "parameters": {
            "amount_usd": {"description": "Escrow amount in USD", "type": "float"},
            "payee_id": {"description": "Agent ID of the payee", "type": "str"},
            "task_description": {"description": "Description of the task being escrowed", "type": "str"},
        },
        "function": "agentpay_create_escrow",
    },
]


# ---------------------------------------------------------------------------
# Command implementations
# ---------------------------------------------------------------------------

def agentpay_create_payment(amount_usd: float, recipient_id: str, memo: str = "", method: str = "solana") -> str:
    """Create a payment intent via AgentPay."""
    result = _request("POST", "/api/v1/payment-intents", {
        "amount": int(amount_usd * 100),
        "recipient": recipient_id,
        "memo": memo or "AutoGPT payment",
        "method": method,
    })
    return (
        f"Payment created. ID: {result.get('id')}, "
        f"Status: {result.get('status')}, "
        f"URL: {result.get('payment_url', 'N/A')}"
    )


def agentpay_verify_payment(payment_id: str) -> str:
    """Verify a payment intent."""
    result = _request("GET", f"/api/verify/{payment_id}")
    return f"Payment {payment_id}: status={result.get('status')}, amount={result.get('amount')}"


def agentpay_check_rank(agent_id: str) -> str:
    """Get AgentRank score for an agent."""
    result = _request("GET", f"/api/agentrank/{agent_id}")
    score = result.get("score", result.get("agentRank", "unknown"))
    tier = result.get("tier", "unknown")
    return f"AgentRank for {agent_id}: {score}/1000 (tier: {tier})"


def agentpay_create_escrow(amount_usd: float, payee_id: str, task_description: str) -> str:
    """Create an escrow transaction."""
    result = _request("POST", "/api/escrow/create", {
        "payeeAgentId": payee_id,
        "amount": amount_usd,
        "taskDescription": task_description,
    })
    return (
        f"Escrow created. ID: {result.get('id')}, "
        f"Status: {result.get('status')}, "
        f"Amount: ${amount_usd}"
    )


# ---------------------------------------------------------------------------
# AutoGPT plugin entrypoint
# ---------------------------------------------------------------------------

class AgentPayPlugin:
    """AutoGPT plugin class for AgentPay integration."""

    name = "AgentPay"
    version = "1.0.0"
    description = "Universal payment gateway for AI agents — pay, verify, escrow, and rank agents"

    def __init__(self):
        if not AGENTPAY_API_KEY:
            raise EnvironmentError(
                "AGENTPAY_API_KEY environment variable is not set. "
                "Get your key at https://dashboard.agentpay.gg"
            )

    @staticmethod
    def get_commands():
        return COMMANDS

    @staticmethod
    def execute_command(command_name: str, **kwargs) -> str:
        commands_map = {
            "agentpay_create_payment": agentpay_create_payment,
            "agentpay_verify_payment": agentpay_verify_payment,
            "agentpay_check_rank": agentpay_check_rank,
            "agentpay_create_escrow": agentpay_create_escrow,
        }
        fn = commands_map.get(command_name)
        if not fn:
            return f"Unknown AgentPay command: {command_name}"
        return fn(**kwargs)


# Singleton instance for AutoGPT plugin loader
plugin = AgentPayPlugin
