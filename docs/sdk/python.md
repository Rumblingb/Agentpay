# AgentPay Python SDK

The `agentpay` package is a Python 3.10+ library for interacting with the AgentPay API. It uses [httpx](https://www.python-httpx.org/) for HTTP and [Pydantic v2](https://docs.pydantic.dev/) for model validation.

## Installation

```bash
pip install agentpay
```

## Quick start

```python
from agentpay import AgentPay, Certificate

client = AgentPay(
    base_url="https://api.agentpay.io",
    api_key="your-api-key",
)

# 1. Create a payment intent
intent = client.create_intent(500, metadata={"order_id": "ord_abc"})
print(intent.intent_id)  # "intent_xyz"

# 2. Poll until verified (raises on expiry / failure / timeout)
verified = client.wait_for_verification(intent.intent_id)
print(verified.status)  # "verified"

# 3. Validate an agent certificate
result = client.validate_certificate(
    Certificate(certificate="<base64-cert>", algorithm="RS256")
)
print(result.valid)  # True

client.close()
```

### Context manager

```python
with AgentPay(base_url="https://api.agentpay.io", api_key="...") as client:
    intent = client.create_intent(100)
```

## API reference

### `AgentPay(base_url, api_key, timeout=10.0)`

Constructs a synchronous SDK client.

| Parameter  | Type    | Description                           |
|------------|---------|---------------------------------------|
| `base_url` | `str`   | Base URL, e.g. `https://api.agentpay.io` |
| `api_key`  | `str`   | API key for authentication            |
| `timeout`  | `float` | Request timeout in seconds (default 10) |

---

### `client.create_intent(amount, metadata=None)`

Creates a new payment intent.

**Endpoint:** `POST /api/intents`

**Returns** `CreateIntentResponse`

---

### `client.get_intent_status(intent_id)`

Retrieves the current status of a payment intent.

**Endpoint:** `GET /api/intents/:intentId/status`

**Returns** `IntentStatusResponse`

---

### `client.wait_for_verification(intent_id, timeout_ms=60_000, poll_interval_ms=2_000)`

Polls until the intent is verified or raises an exception.

| Parameter          | Type  | Default    |
|--------------------|-------|------------|
| `timeout_ms`       | `int` | `60_000`   |
| `poll_interval_ms` | `int` | `2_000`    |

**Raises**

- `IntentExpiredError` — intent reached `expired` status
- `VerificationFailedError` — intent reached `failed` status
- `VerificationTimeoutError` — polling timed out

**Returns** `IntentStatusResponse`

---

### `client.validate_certificate(certificate)`

Validates an agent certificate.

**Endpoint:** `POST /api/certificates/validate`

`certificate` may be a `Certificate` model instance or a plain `dict`.

**Returns** `ValidateCertificateResponse`

---

## Models

```python
from agentpay import (
    Certificate,
    CreateIntentResponse,
    IntentStatusResponse,
    ValidateCertificateResponse,
)
```

All models are Pydantic v2 `BaseModel` subclasses.

## Exceptions

| Exception                 | `code`                 | `status_code` |
|---------------------------|------------------------|---------------|
| `AgentPayError`           | varies                 | varies        |
| `IntentExpiredError`      | `INTENT_EXPIRED`       | 410           |
| `VerificationFailedError` | `VERIFICATION_FAILED`  | 402           |
| `VerificationTimeoutError`| `VERIFICATION_TIMEOUT` | 408           |

```python
from agentpay import AgentPayError, IntentExpiredError

try:
    client.wait_for_verification("intent_123")
except IntentExpiredError as e:
    print(f"Expired: {e.intent_id}")
except AgentPayError as e:
    print(f"Error {e.status_code}: {e}")
```

## Running tests

```bash
cd sdk/python
pip install -e ".[dev]"
pytest tests/
```
