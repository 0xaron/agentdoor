"""AgentDoor FastAPI adapter - agent authentication middleware for FastAPI.

Provides server-side middleware that implements the AgentDoor protocol,
including agent registration, challenge-response verification, and
bearer token issuance.
"""

from .engine import AgentEngine
from .errors import AgentDoorError
from .middleware import AgentDoor, AgentDoorConfig
from .models import AgentContext
from .store import AgentRecord, InMemoryAgentStore, TokenRecord

__all__ = [
    "AgentDoor",
    "AgentDoorConfig",
    "AgentContext",
    "AgentEngine",
    "AgentDoorError",
    "AgentRecord",
    "InMemoryAgentStore",
    "TokenRecord",
]
