"""
AgentPay Tool for CrewAI
========================
Drop this file into your CrewAI project to give any agent the ability to
request and verify payments via AgentPay.

Usage:
    from crewai_agentpay_tool import AgentPayTool
    from crewai import Agent, Task, Crew

    pay_tool = AgentPayTool(api_key="sk_live_...")
    agent = Agent(role="Billing Agent", tools=[pay_tool])

Install:
    pip install agentpay crewai
"""

import os
from typing import Optional
from crewai.tools import BaseTool  # type: ignore[import]
import agentpay  # type: ignore[import]


class AgentPayTool(BaseTool):
    """
    CrewAI-compatible tool for processing payments via AgentPay.

    Supports:
      - Creating payment intents (Solana USDC or Stripe fiat)
      - Verifying payment status
      - Checking agent AgentRank score
      - Creating A2A escrow transactions
    """

    name: str = "AgentPay Payment Tool"
    description: str = (
        "Use this tool to create payment requests, verify payments, "
        "check AgentRank scores, and manage A2A escrow transactions. "
        "Input: a JSON object with 'action' and relevant parameters."
    )

    def __init__(self, api_key: Optional[str] = None, base_url: Optional[str] = None):
        super().__init__()
        self._client = agentpay.Client(
            api_key=api_key or os.environ["AGENTPAY_API_KEY"],
            base_url=base_url or os.environ.get("AGENTPAY_API_URL", "https://api.agentpay.gg"),
        )

    def _run(self, action_json: str) -> str:
        """
        Execute an AgentPay action.

        action_json examples:
          '{"action": "create_payment", "amount_usd": 10.00, "recipient": "agent_xyz", "memo": "API call fee"}'
          '{"action": "verify_payment", "payment_id": "pay_abc123"}'
          '{"action": "check_rank", "agent_id": "agent_xyz"}'
          '{"action": "create_escrow", "amount_usd": 50.0, "payee_id": "agent_xyz", "task": "Build API"}'
        """
        import json

        try:
            params = json.loads(action_json)
        except json.JSONDecodeError:
            return "Error: action_json must be valid JSON"

        action = params.get("action")

        if action == "create_payment":
            result = self._client.intents.create(
                amount_usd=params["amount_usd"],
                recipient=params.get("recipient", ""),
                memo=params.get("memo", "CrewAI agent payment"),
                method=params.get("method", "solana"),
            )
            return (
                f"Payment intent created. ID: {result['id']}, "
                f"Status: {result['status']}, "
                f"Pay at: {result.get('payment_url', 'N/A')}"
            )

        elif action == "verify_payment":
            result = self._client.intents.verify(params["payment_id"])
            return f"Payment {params['payment_id']} status: {result['status']}"

        elif action == "check_rank":
            result = self._client.agents.get_rank(params["agent_id"])
            return (
                f"AgentRank for {params['agent_id']}: {result['score']}/1000 "
                f"(tier: {result.get('tier', 'unknown')})"
            )

        elif action == "create_escrow":
            result = self._client.escrow.create(
                amount_usd=params["amount_usd"],
                payee_id=params["payee_id"],
                task_description=params.get("task", ""),
            )
            return (
                f"Escrow created. ID: {result['id']}, "
                f"Amount: ${params['amount_usd']}, "
                f"Status: {result['status']}"
            )

        else:
            return (
                f"Unknown action '{action}'. Supported: "
                "create_payment, verify_payment, check_rank, create_escrow"
            )


# ---------------------------------------------------------------------------
# Minimal example — runs standalone if you execute this file directly
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import os

    # Requires AGENTPAY_API_KEY in environment
    tool = AgentPayTool(api_key=os.environ.get("AGENTPAY_API_KEY", "sk_test_demo"))

    from crewai import Agent, Task, Crew  # type: ignore[import]

    billing_agent = Agent(
        role="Billing Manager",
        goal="Process payments and verify transactions accurately",
        backstory="An expert financial agent that manages all payment flows",
        tools=[tool],
        verbose=True,
    )

    task = Task(
        description=(
            'Create a $5.00 payment to agent "data-provider-001" '
            'with memo "API access fee for weather data"'
        ),
        expected_output="Payment intent ID and confirmation status",
        agent=billing_agent,
    )

    crew = Crew(agents=[billing_agent], tasks=[task])
    result = crew.kickoff()
    print("\n=== Result ===")
    print(result)
