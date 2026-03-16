"""Unit tests for the AgentPay Python SDK (mocked HTTP)."""

from __future__ import annotations

import pytest
import httpx
import respx

from agentpay import (
    AgentPay,
    AgentPayError,
    Certificate,
    IntentExpiredError,
    VerificationFailedError,
    VerificationTimeoutError,
)


BASE_URL = "https://api.agentpay.gg"
API_KEY = "test-api-key"


@pytest.fixture
def client() -> AgentPay:
    return AgentPay(base_url=BASE_URL, api_key=API_KEY)


# ---- create_intent ----------------------------------------------------------


@respx.mock
def test_create_intent_success(client: AgentPay) -> None:
    payload = {
        "intentId": "intent_123",
        "amount": 500,
        "currency": "USD",
        "status": "pending",
        "expiresAt": "2026-01-01T00:00:00Z",
    }
    respx.post(f"{BASE_URL}/api/intents").mock(
        return_value=httpx.Response(200, json=payload)
    )

    result = client.create_intent(500, metadata={"orderId": "ord_1"})

    assert result.intent_id == "intent_123"
    assert result.amount == 500
    assert result.status == "pending"


@respx.mock
def test_create_intent_http_error(client: AgentPay) -> None:
    respx.post(f"{BASE_URL}/api/intents").mock(
        return_value=httpx.Response(401, json={"error": "Unauthorized"})
    )

    with pytest.raises(AgentPayError) as exc_info:
        client.create_intent(100)

    assert exc_info.value.status_code == 401
    assert "Unauthorized" in str(exc_info.value)


# ---- get_intent_status ------------------------------------------------------


@respx.mock
def test_get_intent_status_verified(client: AgentPay) -> None:
    payload = {
        "intentId": "intent_abc",
        "status": "verified",
        "amount": 200,
        "currency": "USD",
        "expiresAt": "2026-01-01T00:00:00Z",
    }
    respx.get(f"{BASE_URL}/api/intents/intent_abc/status").mock(
        return_value=httpx.Response(200, json=payload)
    )

    result = client.get_intent_status("intent_abc")

    assert result.intent_id == "intent_abc"
    assert result.status == "verified"


@respx.mock
def test_get_intent_status_not_found(client: AgentPay) -> None:
    respx.get(f"{BASE_URL}/api/intents/missing/status").mock(
        return_value=httpx.Response(404, json={"error": "Intent not found"})
    )

    with pytest.raises(AgentPayError) as exc_info:
        client.get_intent_status("missing")

    assert exc_info.value.status_code == 404


# ---- wait_for_verification --------------------------------------------------


@respx.mock
def test_wait_for_verification_already_verified(client: AgentPay) -> None:
    payload = {
        "intentId": "intent_v",
        "status": "verified",
        "amount": 100,
        "currency": "USD",
        "expiresAt": "2026-01-01T00:00:00Z",
    }
    respx.get(f"{BASE_URL}/api/intents/intent_v/status").mock(
        return_value=httpx.Response(200, json=payload)
    )

    result = client.wait_for_verification("intent_v", timeout_ms=5000, poll_interval_ms=100)
    assert result.status == "verified"


@respx.mock
def test_wait_for_verification_expired(client: AgentPay) -> None:
    payload = {
        "intentId": "intent_e",
        "status": "expired",
        "amount": 100,
        "currency": "USD",
        "expiresAt": "2020-01-01T00:00:00Z",
    }
    respx.get(f"{BASE_URL}/api/intents/intent_e/status").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(IntentExpiredError) as exc_info:
        client.wait_for_verification("intent_e", timeout_ms=5000, poll_interval_ms=100)

    assert exc_info.value.intent_id == "intent_e"


@respx.mock
def test_wait_for_verification_failed(client: AgentPay) -> None:
    payload = {
        "intentId": "intent_f",
        "status": "failed",
        "amount": 100,
        "currency": "USD",
        "expiresAt": "2026-01-01T00:00:00Z",
    }
    respx.get(f"{BASE_URL}/api/intents/intent_f/status").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(VerificationFailedError):
        client.wait_for_verification("intent_f", timeout_ms=5000, poll_interval_ms=100)


@respx.mock
def test_wait_for_verification_timeout(client: AgentPay) -> None:
    payload = {
        "intentId": "intent_p",
        "status": "pending",
        "amount": 100,
        "currency": "USD",
        "expiresAt": "2026-01-01T00:00:00Z",
    }
    # Always returns pending
    respx.get(f"{BASE_URL}/api/intents/intent_p/status").mock(
        return_value=httpx.Response(200, json=payload)
    )

    with pytest.raises(VerificationTimeoutError) as exc_info:
        client.wait_for_verification("intent_p", timeout_ms=50, poll_interval_ms=10)

    assert exc_info.value.intent_id == "intent_p"


# ---- validate_certificate ---------------------------------------------------


@respx.mock
def test_validate_certificate_valid(client: AgentPay) -> None:
    respx.post(f"{BASE_URL}/api/certificates/validate").mock(
        return_value=httpx.Response(200, json={"valid": True, "subject": "CN=agent1"})
    )

    cert = Certificate(certificate="base64cert==", algorithm="RS256")
    result = client.validate_certificate(cert)

    assert result.valid is True
    assert result.subject == "CN=agent1"


@respx.mock
def test_validate_certificate_invalid(client: AgentPay) -> None:
    respx.post(f"{BASE_URL}/api/certificates/validate").mock(
        return_value=httpx.Response(
            200, json={"valid": False, "error": "Certificate expired"}
        )
    )

    result = client.validate_certificate({"certificate": "bad_cert"})
    assert result.valid is False
    assert result.error == "Certificate expired"


# ---- exception hierarchy ----------------------------------------------------


def test_intent_expired_is_agent_pay_error() -> None:
    err = IntentExpiredError("intent_x")
    assert isinstance(err, AgentPayError)
    assert err.code == "INTENT_EXPIRED"
    assert err.status_code == 410


def test_verification_failed_is_agent_pay_error() -> None:
    err = VerificationFailedError("intent_y", "bad sig")
    assert isinstance(err, AgentPayError)
    assert err.code == "VERIFICATION_FAILED"


def test_verification_timeout_is_agent_pay_error() -> None:
    err = VerificationTimeoutError("intent_z", 60000)
    assert isinstance(err, AgentPayError)
    assert err.code == "VERIFICATION_TIMEOUT"
