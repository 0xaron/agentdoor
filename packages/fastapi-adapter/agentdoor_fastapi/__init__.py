"""AgentDoor FastAPI adapter - agent authentication middleware for FastAPI.

Provides server-side middleware that implements the AgentDoor protocol,
including agent registration, challenge-response verification, and
bearer token issuance.
"""

from .middleware import AgentDoor, AgentDoorConfig
from .models import AgentContext

__all__ = ["AgentDoor", "AgentDoorConfig", "AgentContext"]
