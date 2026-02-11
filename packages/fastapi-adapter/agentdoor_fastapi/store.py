"""Agent store for persisting registered agent records.

Provides an abstract protocol and a default in-memory implementation.
Services can provide custom backends (e.g., database-backed) by
implementing the :class:`AgentStore` protocol.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable


@dataclass
class AgentRecord:
    """Internal record for a registered agent."""

    agent_id: str
    agent_name: str
    public_key: str
    api_key: str
    scopes: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)


@dataclass
class PendingRegistration:
    """A registration that is awaiting challenge verification."""

    registration_id: str
    agent_name: str
    public_key: str
    challenge: str
    scopes: list[str] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)


@dataclass
class TokenRecord:
    """An issued bearer token."""

    token: str
    agent_id: str
    expires_at: float
    scopes: list[str] = field(default_factory=list)


@runtime_checkable
class AgentStore(Protocol):
    """Protocol for agent storage backends."""

    async def create_pending_registration(
        self,
        agent_name: str,
        public_key: str,
        scopes: list[str],
    ) -> PendingRegistration:
        """Create a pending registration and return it with a challenge."""
        ...

    async def get_pending_registration(
        self, registration_id: str
    ) -> PendingRegistration | None:
        """Retrieve a pending registration by its ID."""
        ...

    async def complete_registration(
        self, registration_id: str
    ) -> AgentRecord:
        """Promote a pending registration to a full agent record."""
        ...

    async def get_agent(self, agent_id: str) -> AgentRecord | None:
        """Retrieve an agent record by agent ID."""
        ...

    async def get_agent_by_api_key(self, api_key: str) -> AgentRecord | None:
        """Retrieve an agent record by API key."""
        ...

    async def store_token(self, token_record: TokenRecord) -> None:
        """Store an issued token."""
        ...

    async def get_token(self, token: str) -> TokenRecord | None:
        """Retrieve a token record, or ``None`` if expired/unknown."""
        ...


class InMemoryAgentStore:
    """In-memory agent store.

    Suitable for development and testing.  All data is lost when the
    process exits.
    """

    def __init__(self) -> None:
        self._pending: dict[str, PendingRegistration] = {}
        self._agents: dict[str, AgentRecord] = {}
        self._agents_by_api_key: dict[str, AgentRecord] = {}
        self._tokens: dict[str, TokenRecord] = {}

    async def create_pending_registration(
        self,
        agent_name: str,
        public_key: str,
        scopes: list[str],
    ) -> PendingRegistration:
        registration_id = f"reg_{secrets.token_urlsafe(16)}"
        challenge = secrets.token_urlsafe(32)

        pending = PendingRegistration(
            registration_id=registration_id,
            agent_name=agent_name,
            public_key=public_key,
            challenge=challenge,
            scopes=scopes,
        )
        self._pending[registration_id] = pending
        return pending

    async def get_pending_registration(
        self, registration_id: str
    ) -> PendingRegistration | None:
        return self._pending.get(registration_id)

    async def complete_registration(
        self, registration_id: str
    ) -> AgentRecord:
        pending = self._pending.pop(registration_id)
        agent_id = f"agent_{secrets.token_urlsafe(12)}"
        api_key = f"ak_{secrets.token_urlsafe(24)}"

        record = AgentRecord(
            agent_id=agent_id,
            agent_name=pending.agent_name,
            public_key=pending.public_key,
            api_key=api_key,
            scopes=pending.scopes,
        )
        self._agents[agent_id] = record
        self._agents_by_api_key[api_key] = record
        return record

    async def get_agent(self, agent_id: str) -> AgentRecord | None:
        return self._agents.get(agent_id)

    async def get_agent_by_api_key(self, api_key: str) -> AgentRecord | None:
        return self._agents_by_api_key.get(api_key)

    async def store_token(self, token_record: TokenRecord) -> None:
        self._tokens[token_record.token] = token_record

    async def get_token(self, token: str) -> TokenRecord | None:
        record = self._tokens.get(token)
        if record is None:
            return None
        if time.time() > record.expires_at:
            del self._tokens[token]
            return None
        return record
