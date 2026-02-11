"""AgentDoor Python SDK - headless agent authentication for AI agents.

This package provides a client SDK for agents to connect to
AgentDoor-enabled services, register their identities, and make
authenticated requests.
"""

from .agent import Agent, AgentConfig
from .credentials import Credential

__all__ = ["Agent", "AgentConfig", "Credential"]
