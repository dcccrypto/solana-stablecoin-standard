class SSSError(Exception):
    """Base exception for all SSS SDK errors."""
    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class SSSNetworkError(SSSError):
    """Raised on network/transport failures or 5xx responses."""


class SSSAuthError(SSSError):
    """Raised on 401/403 responses."""


class SSSValidationError(SSSError):
    """Raised on 422 or invalid input."""
