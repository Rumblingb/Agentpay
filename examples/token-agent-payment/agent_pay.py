"""
examples/token-agent-payment/agent_pay.py

Python example: AI agent making a payment via AgentPay using USDC on Solana.
Uses solders (Solana Python SDK) to create and verify payments.

Prerequisites:
    pip install requests solders solana

Usage:
    export AGENTPAY_API_KEY=your_api_key
    export AGENTPAY_URL=http://localhost:3001
    python agent_pay.py
"""

import os
import json
import requests
from typing import Optional

AGENTPAY_URL = os.environ.get("AGENTPAY_URL", "http://localhost:3001")
API_KEY = os.environ.get("AGENTPAY_API_KEY", "")

USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v"  # Mainnet USDC
USDC_DEVNET_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"  # Devnet USDC


def create_payment(
    amount_usdc: float,
    recipient_address: str,
    metadata: Optional[dict] = None,
    token_mint: Optional[str] = None,
) -> dict:
    """Create a payment request via AgentPay API."""
    payload = {
        "amountUsdc": amount_usdc,
        "recipientAddress": recipient_address,
    }
    if metadata:
        payload["metadata"] = metadata
    if token_mint:
        payload["tokenMint"] = token_mint

    response = requests.post(
        f"{AGENTPAY_URL}/api/merchants/payments",
        json=payload,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
    )
    response.raise_for_status()
    return response.json()


def verify_payment(transaction_id: str, tx_hash: str) -> dict:
    """Verify a payment on-chain via AgentPay API."""
    response = requests.post(
        f"{AGENTPAY_URL}/api/merchants/payments/{transaction_id}/verify",
        json={"transactionHash": tx_hash},
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
    )
    response.raise_for_status()
    return response.json()


def get_stats() -> dict:
    """Get merchant payment statistics."""
    response = requests.get(
        f"{AGENTPAY_URL}/api/merchants/stats",
        headers={"Authorization": f"Bearer {API_KEY}"},
    )
    response.raise_for_status()
    return response.json()


def main():
    """Example: Agent creates and verifies a payment."""
    print("🤖 AgentPay Python Agent Example")
    print(f"   Server: {AGENTPAY_URL}")
    print()

    if not API_KEY:
        print("❌ Set AGENTPAY_API_KEY environment variable")
        print("   Register first: POST /api/merchants/register")
        return

    # Step 1: Create a payment request
    print("1️⃣  Creating payment request...")
    try:
        payment = create_payment(
            amount_usdc=1.00,
            recipient_address="9B5X2FWc4PQHqbXkhmr8vgYKHjgP7V8HBzMgMTf8Hkqo",
            metadata={"botId": "python-agent", "purpose": "data-access"},
        )
        print(f"   ✅ Payment created: {payment.get('paymentId')}")
        print(f"   💰 Amount: {payment.get('amount')} USDC")
        print(f"   📍 Recipient: {payment.get('recipientAddress')}")
    except requests.HTTPError as e:
        print(f"   ❌ Failed: {e.response.text}")
        return

    # Step 2: Send Solana transaction (simulated)
    # In production, use solders/solana-py to send actual USDC transfer
    print()
    print("2️⃣  Sending Solana transaction...")
    print("   (In production, use solders to create and send USDC transfer)")
    print("   tx_hash = send_usdc_transfer(amount, recipient)")
    tx_hash = "SIMULATED_TX_HASH_FOR_DEMO"

    # Step 3: Verify payment
    print()
    print("3️⃣  Verifying payment...")
    try:
        result = verify_payment(payment["transactionId"], tx_hash)
        print(f"   Verified: {result.get('verified')}")
        print(f"   Message: {result.get('message')}")
    except requests.HTTPError as e:
        print(f"   ⚠️  Verification: {e.response.text}")
        print("   (Expected in demo mode without real Solana tx)")

    # Step 4: Check stats
    print()
    print("4️⃣  Checking merchant stats...")
    try:
        stats = get_stats()
        print(f"   Stats: {json.dumps(stats, indent=2)}")
    except requests.HTTPError as e:
        print(f"   ❌ Stats failed: {e.response.text}")


if __name__ == "__main__":
    main()
