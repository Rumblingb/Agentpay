#!/usr/bin/env python3
"""
Example: Python backend agent using AgentPay Protocol V1

Prerequisites:
    pip install requests

Usage:
    AGENTPAY_BASE_URL=http://localhost:3001 MERCHANT_ID=<uuid> python agent.py
"""

import os
import time
import requests

BASE_URL = os.environ.get("AGENTPAY_BASE_URL", "http://localhost:3001")
MERCHANT_ID = os.environ.get("MERCHANT_ID", "00000000-0000-0000-0000-000000000000")


def api_post(path: str, body: dict) -> dict:
    resp = requests.post(f"{BASE_URL}{path}", json=body)
    resp.raise_for_status()
    return resp.json()


def api_get(path: str) -> dict:
    resp = requests.get(f"{BASE_URL}{path}")
    resp.raise_for_status()
    return resp.json()


def main():
    # 1. Register agent
    result = api_post("/api/agents/register", {
        "pin": "123456",
        "spendingLimit": 100,
    })
    agent_id = result["data"]["agentId"]
    print(f"Registered agent: {agent_id}")

    # 2. Create payment intent (with PIN for human authorization)
    intent = api_post("/api/v1/payment-intents", {
        "merchantId": MERCHANT_ID,
        "agentId": agent_id,
        "amount": 1.00,
        "currency": "USDC",
        "pin": "123456",
    })
    intent_id = intent.get("intentId")
    print(f"Payment intent: {intent_id}")
    crypto = intent.get("instructions", {}).get("crypto", {})
    print(f"Send USDC to: {crypto.get('recipientAddress')}")
    print(f"Memo: {crypto.get('memo')}")

    # 3. Poll for verification
    for _ in range(10):
        status = api_get(f"/api/v1/payment-intents/{intent_id}")
        print(f"Status: {status.get('status')}")
        if status.get("status") == "verified":
            print("Payment verified!")
            break
        if status.get("status") in ("expired", "failed"):
            print(f"Payment failed: {status.get('status')}")
            break
        time.sleep(2)


if __name__ == "__main__":
    main()
