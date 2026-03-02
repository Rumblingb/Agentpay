"""
AgentPay Python SDK — Payment infrastructure for AI agents.

Usage:
    from agentpay import AgentPay

    client = AgentPay(api_key='ap_live_...')

    # Register a bot
    bot = client.bots.register(handle='@MyBot')

    # Check spending
    spending = client.bots.get_spending('@MyBot')

    # Create payment
    payment = client.payments.create(
        amount=2.50,
        recipient_address='wallet_address',
    )
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional
from urllib import request as urllib_request
from urllib.error import HTTPError


class AgentPayError(Exception):
    """Base error for AgentPay SDK."""

    def __init__(self, message: str, status_code: int = 0, code: Optional[str] = None):
        super().__init__(message)
        self.status_code = status_code
        self.code = code


class RateLimitError(AgentPayError):
    """Rate limit exceeded."""

    def __init__(self, message: str = "Rate limit exceeded"):
        super().__init__(message, status_code=429, code="RATE_LIMIT")


def _http_request(
    base_url: str,
    api_key: str,
    method: str,
    path: str,
    body: Optional[Dict[str, Any]] = None,
    max_retries: int = 3,
) -> Any:
    """Make an HTTP request with retry logic."""
    last_error: Optional[Exception] = None

    for attempt in range(max_retries):
        try:
            url = f"{base_url}{path}"
            data = json.dumps(body).encode("utf-8") if body else None
            req = urllib_request.Request(
                url,
                data=data,
                method=method,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}",
                },
            )
            with urllib_request.urlopen(req) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except HTTPError as e:
            if e.code == 429:
                time.sleep(2**attempt)
                continue
            error_body = e.read().decode("utf-8", errors="replace")
            try:
                parsed = json.loads(error_body)
            except json.JSONDecodeError:
                parsed = {}
            raise AgentPayError(
                parsed.get("message", parsed.get("error", f"HTTP {e.code}")),
                status_code=e.code,
                code=parsed.get("error"),
            )
        except Exception as e:
            last_error = e
            if attempt < max_retries - 1:
                time.sleep(2**attempt)

    if last_error:
        raise last_error
    raise AgentPayError("Request failed after retries")


@dataclass
class Payment:
    id: str
    amount_usdc: float
    recipient_address: str
    status: str
    created_at: str
    metadata: Optional[Dict[str, Any]] = None


class Payments:
    """Payment operations."""

    def __init__(self, base_url: str, api_key: str, max_retries: int):
        self._base_url = base_url
        self._api_key = api_key
        self._max_retries = max_retries

    def create(
        self,
        amount: float,
        recipient_address: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        return _http_request(
            self._base_url,
            self._api_key,
            "POST",
            "/api/intents",
            {
                "amountUsdc": amount,
                "recipientAddress": recipient_address,
                "metadata": metadata or {},
            },
            self._max_retries,
        )

    def get(self, payment_id: str) -> Dict[str, Any]:
        return _http_request(
            self._base_url, self._api_key, "GET", f"/api/intents/{payment_id}", max_retries=self._max_retries
        )

    def list(self, limit: int = 50, offset: int = 0) -> List[Dict[str, Any]]:
        result = _http_request(
            self._base_url,
            self._api_key,
            "GET",
            f"/api/intents?limit={limit}&offset={offset}",
            max_retries=self._max_retries,
        )
        return result.get("data", result) if isinstance(result, dict) else result


class Bots:
    """Bot management operations."""

    def __init__(self, base_url: str, api_key: str, max_retries: int):
        self._base_url = base_url
        self._api_key = api_key
        self._max_retries = max_retries

    def register(
        self, handle: str, display_name: Optional[str] = None, bio: Optional[str] = None
    ) -> Dict[str, Any]:
        body: Dict[str, Any] = {"handle": handle}
        if display_name:
            body["display_name"] = display_name
        if bio:
            body["bio"] = bio
        return _http_request(
            self._base_url, self._api_key, "POST", "/api/moltbook/bots/register", body, self._max_retries
        )

    def get_spending(self, handle: str) -> Dict[str, Any]:
        result = _http_request(
            self._base_url, self._api_key, "GET", f"/api/moltbook/bots/{handle}/spending", max_retries=self._max_retries
        )
        return result.get("data", result) if isinstance(result, dict) else result

    def update_policy(self, handle: str, **kwargs: Any) -> Dict[str, Any]:
        return _http_request(
            self._base_url, self._api_key, "PUT", f"/api/moltbook/bots/{handle}/spending-policy", kwargs, self._max_retries
        )

    def pause(self, handle: str) -> Dict[str, Any]:
        return _http_request(
            self._base_url, self._api_key, "POST", f"/api/moltbook/bots/{handle}/pause", {}, self._max_retries
        )

    def resume(self, handle: str) -> Dict[str, Any]:
        return _http_request(
            self._base_url, self._api_key, "POST", f"/api/moltbook/bots/{handle}/resume", {}, self._max_retries
        )


class AgentPay:
    """AgentPay Python SDK client.

    Args:
        api_key: Your AgentPay API key.
        environment: 'production' or 'sandbox'. Defaults to 'production'.
        base_url: Override the API base URL.
        max_retries: Maximum retry attempts. Defaults to 3.
    """

    def __init__(
        self,
        api_key: str,
        environment: str = "production",
        base_url: Optional[str] = None,
        max_retries: int = 3,
    ):
        if not api_key:
            raise ValueError("api_key is required")

        self._base_url = base_url or (
            "https://sandbox.agentpay.gg" if environment == "sandbox" else "https://api.agentpay.gg"
        )
        self._api_key = api_key
        self._max_retries = max_retries

        self.payments = Payments(self._base_url, self._api_key, self._max_retries)
        self.bots = Bots(self._base_url, self._api_key, self._max_retries)
