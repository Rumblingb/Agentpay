"""Custom exceptions for the AgentPay SDK."""

from __future__ import annotations


class AgentPayError(Exception):
    """Base exception for all AgentPay SDK errors."""

    def __init__(
        self,
        message: str,
        status_code: int | None = None,
        code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.status_code = status_code
        self.code = code

    def __repr__(self) -> str:
        return (
            f"{self.__class__.__name__}("
            f"message={str(self)!r}, "
            f"status_code={self.status_code!r}, "
            f"code={self.code!r})"
        )


class IntentExpiredError(AgentPayError):
    """Raised when a payment intent has expired before verification completed."""

    def __init__(self, intent_id: str) -> None:
        super().__init__(
            f"Payment intent {intent_id} has expired",
            status_code=410,
            code="INTENT_EXPIRED",
        )
        self.intent_id = intent_id


class VerificationFailedError(AgentPayError):
    """Raised when verification of a payment intent fails."""

    def __init__(self, intent_id: str, reason: str | None = None) -> None:
        message = f"Verification failed for intent {intent_id}"
        if reason:
            message += f": {reason}"
        super().__init__(message, status_code=402, code="VERIFICATION_FAILED")
        self.intent_id = intent_id


class VerificationTimeoutError(AgentPayError):
    """Raised when :meth:`AgentPay.wait_for_verification` times out."""

    def __init__(self, intent_id: str, timeout_ms: int) -> None:
        super().__init__(
            f"Verification timed out for intent {intent_id} after {timeout_ms}ms",
            status_code=408,
            code="VERIFICATION_TIMEOUT",
        )
        self.intent_id = intent_id
