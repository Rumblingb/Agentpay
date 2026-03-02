"""
AgentPay Python SDK
===================

An asynchronous Python client for the AgentPay payment protocol.
Designed for AI agents (LangChain, AutoGPT, CrewAI) to programmatically
create payment intents, check statuses, and verify payments.

Usage::

    import asyncio
    from agentpay_client import AgentPayClient

    async def main():
        client = AgentPayClient(base_url="http://localhost:3001")
        intent = await client.create_intent(
            amount=1.00,
            merchant_id="<uuid>",
            agent_id="my-agent-001",
        )
        print(intent)

    asyncio.run(main())
"""

from __future__ import annotations

import hashlib
import hmac
import json
from typing import Any, Dict, Optional

import httpx


class AgentPayError(Exception):
    """Base exception for AgentPay SDK errors."""

    def __init__(self, message: str, status_code: int | None = None, body: Any = None):
        super().__init__(message)
        self.status_code = status_code
        self.body = body


class SpendingLimitError(AgentPayError):
    """Raised when the agent's daily spending limit has been reached (HTTP 429)."""

    def __init__(self, body: Any):
        super().__init__(
            f"Daily spending limit reached: {body.get('remaining', 0)} USDC remaining",
            status_code=429,
            body=body,
        )
        self.spent_today: float = body.get("spentToday", 0)
        self.daily_limit: float = body.get("dailyLimit", 0)
        self.remaining: float = body.get("remaining", 0)


class AgentPayClient:
    """Async client for the AgentPay protocol.

    Parameters
    ----------
    base_url : str
        Root URL of the AgentPay API (e.g. ``http://localhost:3001``).
    api_key : str, optional
        Merchant API key for authenticated endpoints. Not required for
        the agent-facing ``/api/v1/payment-intents`` routes.
    timeout : float
        HTTP request timeout in seconds (default 30).
    """

    def __init__(
        self,
        base_url: str = "http://localhost:3001",
        api_key: str | None = None,
        timeout: float = 30.0,
    ):
        self.base_url = base_url.rstrip("/")
        self._headers: Dict[str, str] = {
            "Content-Type": "application/json",
            "User-Agent": "AgentPay-Python-SDK/1.0",
        }
        if api_key:
            self._headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            headers=self._headers,
            timeout=timeout,
        )

    # ── Lifecycle ───────────────────────────────────────────────────────

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        await self._client.aclose()

    async def __aenter__(self) -> "AgentPayClient":
        return self

    async def __aexit__(self, *exc: Any) -> None:
        await self.close()

    # ── Internal helpers ────────────────────────────────────────────────

    def _raise_for_status(self, response: httpx.Response) -> None:
        if response.status_code == 429:
            raise SpendingLimitError(response.json())
        if response.status_code >= 400:
            try:
                body = response.json()
            except Exception:
                body = response.text
            raise AgentPayError(
                f"HTTP {response.status_code}: {body}",
                status_code=response.status_code,
                body=body,
            )

    # ── Agent-facing endpoints (/api/v1/payment-intents) ────────────────

    async def create_intent(
        self,
        amount: float,
        merchant_id: str,
        agent_id: str,
        currency: str = "USDC",
        pin: str | None = None,
        metadata: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        """Create a new payment intent.

        Parameters
        ----------
        amount : float
            Amount in USDC to pay.
        merchant_id : str
            UUID of the merchant to pay.
        agent_id : str
            Unique identifier for the paying agent.
        currency : str
            Currency code (default ``USDC``).
        pin : str, optional
            Agent PIN for additional verification.
        metadata : dict, optional
            Arbitrary key-value metadata attached to the intent.

        Returns
        -------
        dict
            ``{ success, intentId, verificationToken, expiresAt, instructions }``

        Raises
        ------
        SpendingLimitError
            If the agent has exceeded its daily spending policy.
        AgentPayError
            On any other API error.
        """
        payload: Dict[str, Any] = {
            "merchantId": merchant_id,
            "agentId": agent_id,
            "amount": amount,
            "currency": currency,
        }
        if pin is not None:
            payload["pin"] = pin
        if metadata is not None:
            payload["metadata"] = metadata

        resp = await self._client.post("/api/v1/payment-intents", json=payload)
        self._raise_for_status(resp)
        return resp.json()

    async def get_status(self, intent_id: str) -> Dict[str, Any]:
        """Poll the status of an existing payment intent.

        Parameters
        ----------
        intent_id : str
            UUID of the payment intent.

        Returns
        -------
        dict
            ``{ success, intentId, merchantId, amount, currency, status, ... }``
        """
        resp = await self._client.get(f"/api/v1/payment-intents/{intent_id}")
        self._raise_for_status(resp)
        return resp.json()

    async def verify_payment(
        self,
        transaction_hash: str,
        intent_id: str,
    ) -> Dict[str, Any]:
        """Submit a transaction hash for on-chain verification.

        Parameters
        ----------
        transaction_hash : str
            The Solana transaction signature.
        intent_id : str
            UUID of the payment intent being verified.

        Returns
        -------
        dict
            Verification result from the API.
        """
        resp = await self._client.post(
            "/api/verify",
            json={
                "transactionHash": transaction_hash,
                "intentId": intent_id,
            },
        )
        self._raise_for_status(resp)
        return resp.json()

    # ── Certificate verification ────────────────────────────────────────

    @staticmethod
    def verify_certificate(
        certificate_json: str,
        secret: str = "change-me-in-production",
    ) -> bool:
        """Verify an AgentPay certificate's HMAC-SHA256 signature locally.

        Parameters
        ----------
        certificate_json : str
            Raw JSON string of the certificate payload (without ``signature``).
        secret : str
            The shared HMAC secret used to sign the payload.

        Returns
        -------
        bool
            ``True`` if the signature is valid.
        """
        try:
            data = json.loads(certificate_json)
        except json.JSONDecodeError:
            return False

        signature = data.pop("signature", None)
        if not signature:
            return False

        # Strip "sha256=" prefix if present
        if signature.startswith("sha256="):
            signature = signature[len("sha256="):]

        payload_str = json.dumps(data, separators=(",", ":"), sort_keys=True)
        expected = hmac.new(
            secret.encode(),
            payload_str.encode(),
            hashlib.sha256,
        ).hexdigest()

        return hmac.compare_digest(expected, signature)

    # ── Spending policy helpers ─────────────────────────────────────────

    async def get_remaining_budget(
        self,
        agent_id: str,
        merchant_id: str,
    ) -> Dict[str, Any]:
        """Check remaining daily spending budget.

        Attempts a zero-amount intent to retrieve spending info.
        Falls back gracefully when the API does not expose a dedicated endpoint.
        """
        try:
            # Use a minimal probe — many policies report remaining in error body
            resp = await self._client.post(
                "/api/v1/payment-intents",
                json={
                    "merchantId": merchant_id,
                    "agentId": agent_id,
                    "amount": 0.000001,
                    "currency": "USDC",
                },
            )
            if resp.status_code == 429:
                body = resp.json()
                return {
                    "spentToday": body.get("spentToday", 0),
                    "dailyLimit": body.get("dailyLimit", 0),
                    "remaining": body.get("remaining", 0),
                    "limitReached": True,
                }
            return {"limitReached": False, "note": "No spending limit enforced or budget available"}
        except Exception:
            return {"error": "Unable to check budget"}
