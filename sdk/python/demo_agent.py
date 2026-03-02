#!/usr/bin/env python3
"""
AgentPay Demo Agent
===================

Simulates an AI agent purchasing "1 000 LLM Tokens" for 1.00 USDC via the
AgentPay protocol.

Usage::

    # Make sure the AgentPay API is running on localhost:3001
    pip install httpx
    python demo_agent.py

    # Or with a custom API URL:
    AGENTPAY_API_URL=https://api.agentpay.gg python demo_agent.py
"""

from __future__ import annotations

import asyncio
import os
import sys

from agentpay_client import AgentPayClient, SpendingLimitError, AgentPayError

# ── Configuration ───────────────────────────────────────────────────────────

API_URL = os.getenv("AGENTPAY_API_URL", "http://localhost:3001")
MERCHANT_ID = os.getenv("AGENTPAY_MERCHANT_ID", "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11")
AGENT_ID = os.getenv("AGENTPAY_AGENT_ID", "demo-llm-agent-001")
PURCHASE_AMOUNT = 1.00  # 1.00 USDC for 1 000 LLM tokens


async def main() -> None:
    print("=" * 60)
    print("  🤖 AgentPay Demo Agent — LLM Token Purchase")
    print("=" * 60)
    print(f"  API:       {API_URL}")
    print(f"  Merchant:  {MERCHANT_ID}")
    print(f"  Agent:     {AGENT_ID}")
    print(f"  Amount:    {PURCHASE_AMOUNT} USDC (1 000 LLM Tokens)")
    print("=" * 60)
    print()

    async with AgentPayClient(base_url=API_URL) as client:
        # ── Step 1: Check remaining daily budget ────────────────────────
        print("📊 Step 1 — Checking remaining daily budget...")
        budget = await client.get_remaining_budget(AGENT_ID, MERCHANT_ID)
        if budget.get("limitReached"):
            print(f"   ⚠️  Limit reached! Spent today: {budget['spentToday']} USDC")
            print(f"   ⚠️  Daily limit: {budget['dailyLimit']} USDC")
            print(f"   ⚠️  Remaining: {budget['remaining']} USDC")
            print("   Aborting purchase.")
            return
        print(f"   ✅ Budget check passed: {budget}")
        print()

        # ── Step 2: Create a payment intent ─────────────────────────────
        print(f"💳 Step 2 — Creating payment intent for {PURCHASE_AMOUNT} USDC...")
        try:
            intent = await client.create_intent(
                amount=PURCHASE_AMOUNT,
                merchant_id=MERCHANT_ID,
                agent_id=AGENT_ID,
                metadata={"product": "LLM Tokens", "quantity": 1000},
            )
        except SpendingLimitError as e:
            print(f"   🚫 Spending limit hit: {e}")
            print(f"      Spent today: {e.spent_today} USDC")
            print(f"      Daily limit: {e.daily_limit} USDC")
            return
        except AgentPayError as e:
            print(f"   ❌ API error: {e}")
            return

        intent_id = intent["intentId"]
        print(f"   ✅ Intent created: {intent_id}")
        print(f"   📋 Verification token: {intent['verificationToken']}")
        print(f"   ⏰ Expires at: {intent['expiresAt']}")
        if "crypto" in intent.get("instructions", {}):
            crypto = intent["instructions"]["crypto"]
            print(f"   💰 Pay to: {crypto['recipientAddress']}")
            print(f"   📝 Memo: {crypto['memo']}")
        print()

        # ── Step 3: Poll status ─────────────────────────────────────────
        print("🔄 Step 3 — Polling payment intent status...")
        status = await client.get_status(intent_id)
        print(f"   Status: {status['status']}")
        print(f"   Amount: {status['amount']} {status['currency']}")
        print()

        # ── Step 4: (Simulated) On-chain payment + verification ─────────
        print("⛓️  Step 4 — In production, the agent would now:")
        print("   1. Send a Solana USDC transfer to the recipient address")
        print("   2. Call client.verify_payment(tx_hash, intent_id)")
        print("   3. Receive a verification certificate")
        print()

        # Simulated hash for demo purposes
        fake_tx_hash = "5abc123...simulated...def456"
        print(f"   (Simulated tx hash: {fake_tx_hash})")
        print()

        print("=" * 60)
        print("  ✅ Demo complete! In production, the LLM tokens would")
        print("     be credited after on-chain verification.")
        print("=" * 60)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n👋 Demo interrupted.")
        sys.exit(0)
