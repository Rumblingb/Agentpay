"""AgentPay Python SDK client."""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from .exceptions import (
    AgentPayError,
    IntentExpiredError,
    VerificationFailedError,
    VerificationTimeoutError,
)
from .models import (
    Certificate,
    CreateIntentResponse,
    IntentStatusResponse,
    ValidateCertificateResponse,
)


class AgentPay:
    """Synchronous client for the AgentPay API.

    Parameters
    ----------
    base_url:
        Base URL of the AgentPay API, e.g. ``https://api.agentpay.io``.
    api_key:
        API key for authentication.
    timeout:
        Request timeout in seconds (default: 10).
    """

    def __init__(
        self,
        base_url: str,
        api_key: str,
        timeout: float = 10.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._client = httpx.Client(
            base_url=self._base_url,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            timeout=timeout,
        )

    def close(self) -> None:
        """Close the underlying HTTP client."""
        self._client.close()

    def __enter__(self) -> "AgentPay":
        return self

    def __exit__(self, *args: Any) -> None:
        self.close()

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _request(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            response = self._client.request(method, path, **kwargs)
        except httpx.TimeoutException as exc:
            raise AgentPayError(
                f"Request timed out: {exc}", status_code=408, code="TIMEOUT"
            ) from exc
        except httpx.RequestError as exc:
            raise AgentPayError(
                f"Network error: {exc}", status_code=0, code="NETWORK_ERROR"
            ) from exc

        if not response.is_success:
            try:
                body: dict[str, Any] = response.json()
            except Exception:
                body = {}
            message = body.get("error") or body.get("message") or f"HTTP {response.status_code}"
            raise AgentPayError(
                message,
                status_code=response.status_code,
                code=body.get("code"),
            )

        return response.json()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def create_intent(
        self,
        amount: float,
        metadata: dict[str, Any] | None = None,
    ) -> CreateIntentResponse:
        """Create a new payment intent.

        Parameters
        ----------
        amount:
            Amount to charge.
        metadata:
            Optional key/value metadata to attach to the intent.
        """
        payload: dict[str, Any] = {"amount": amount}
        if metadata is not None:
            payload["metadata"] = metadata
        data = self._request("POST", "/api/intents", json=payload)
        return CreateIntentResponse.model_validate(data)

    def get_intent_status(self, intent_id: str) -> IntentStatusResponse:
        """Retrieve the current status of a payment intent.

        Parameters
        ----------
        intent_id:
            ID of the intent to query.
        """
        data = self._request("GET", f"/api/intents/{intent_id}/status")
        return IntentStatusResponse.model_validate(data)

    def wait_for_verification(
        self,
        intent_id: str,
        timeout_ms: int = 60_000,
        poll_interval_ms: int = 2_000,
    ) -> IntentStatusResponse:
        """Poll until the intent is verified or times out.

        Parameters
        ----------
        intent_id:
            ID of the intent to watch.
        timeout_ms:
            Maximum time to wait in milliseconds (default: 60 000).
        poll_interval_ms:
            Polling interval in milliseconds (default: 2 000).

        Raises
        ------
        IntentExpiredError
            If the intent expires before verification.
        VerificationFailedError
            If the intent reaches a ``failed`` status.
        VerificationTimeoutError
            If *timeout_ms* elapses without verification.
        """
        deadline = time.monotonic() + timeout_ms / 1000.0

        while time.monotonic() < deadline:
            status = self.get_intent_status(intent_id)

            if status.status == "verified":
                return status
            if status.status == "expired":
                raise IntentExpiredError(intent_id)
            if status.status == "failed":
                raise VerificationFailedError(intent_id)

            remaining = deadline - time.monotonic()
            if remaining <= 0:
                break
            time.sleep(min(poll_interval_ms / 1000.0, remaining))

        raise VerificationTimeoutError(intent_id, timeout_ms)

    def validate_certificate(
        self, certificate: Certificate | dict[str, Any]
    ) -> ValidateCertificateResponse:
        """Validate an agent certificate.

        Parameters
        ----------
        certificate:
            A :class:`~agentpay.models.Certificate` instance or plain dict.
        """
        if isinstance(certificate, Certificate):
            payload = certificate.model_dump(exclude_none=True)
        else:
            payload = certificate
        data = self._request("POST", "/api/certificates/validate", json=payload)
        return ValidateCertificateResponse.model_validate(data)
