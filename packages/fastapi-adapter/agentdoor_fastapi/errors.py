"""AgentDoor error types.

Provides non-HTTP exceptions that the engine raises.  Consumers
(e.g. FastAPI route handlers) catch these and map them to the
appropriate HTTP response.
"""

from __future__ import annotations


class AgentDoorError(Exception):
    """Base error raised by AgentEngine operations.

    Attributes:
        code: Machine-readable error code (e.g. ``"duplicate_key"``).
        message: Human-readable description.
        status: Suggested HTTP status code for the consumer to use.
    """

    def __init__(
        self,
        code: str,
        message: str,
        status: int = 401,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status = status
