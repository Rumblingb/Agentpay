"""Pydantic models for AgentPay API responses."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


IntentStatus = Literal["pending", "verified", "expired", "failed"]


class CreateIntentResponse(BaseModel):
    """Response from POST /api/intents."""

    intent_id: str = Field(alias="intentId")
    amount: float
    currency: str
    status: IntentStatus
    expires_at: str = Field(alias="expiresAt")
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class IntentStatusResponse(BaseModel):
    """Response from GET /api/intents/:intentId/status."""

    intent_id: str = Field(alias="intentId")
    status: IntentStatus
    amount: float
    currency: str
    expires_at: str = Field(alias="expiresAt")
    verified_at: str | None = Field(default=None, alias="verifiedAt")
    metadata: dict[str, Any] | None = None

    model_config = {"populate_by_name": True}


class Certificate(BaseModel):
    """Certificate object to validate."""

    certificate: str
    algorithm: str | None = None

    model_config = {"extra": "allow"}


class ValidateCertificateResponse(BaseModel):
    """Response from POST /api/certificates/validate."""

    valid: bool
    subject: str | None = None
    issuer: str | None = None
    expires_at: str | None = Field(default=None, alias="expiresAt")
    error: str | None = None

    model_config = {"populate_by_name": True}
