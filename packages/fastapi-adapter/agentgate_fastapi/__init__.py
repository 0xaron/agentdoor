"""AgentGate FastAPI adapter - agent authentication middleware for FastAPI.

Provides server-side middleware that implements the AgentGate protocol,
including agent registration, challenge-response verification, and
bearer token issuance.
"""

from .middleware import AgentGate, AgentGateConfig
from .models import AgentContext

__all__ = ["AgentGate", "AgentGateConfig", "AgentContext"]
