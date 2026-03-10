"""Headless auth engine — no HTTP, no FastAPI dependency.

Consumers create an ``AgentEngine`` and call its methods directly.
The engine auto-selects the store backend based on the config:

* ``config.store`` set → use it (manual override).
* ``config.database_url`` set → ``PostgresAgentStore``.
* Otherwise → ``InMemoryAgentStore``.
"""

from __future__ import annotations

import secrets
import time

from .crypto import is_timestamp_valid, verify_signature
from .errors import AgentDoorError
from .store import (
    AgentRecord,
    InMemoryAgentStore,
    PendingRegistration,
    TokenRecord,
)


class AgentEngine:
    """Headless auth engine.  No routes, no HTTP."""

    def __init__(self, config) -> None:  # config: AgentDoorConfig
        self.config = config

        if config.store:
            self.store = config.store
        elif getattr(config, "database_url", None):
            try:
                from .postgres_store import PostgresAgentStore
            except ImportError:
                raise ImportError(
                    "asyncpg is required for PostgresAgentStore. "
                    "Install with: pip install agentdoor-fastapi[postgres]"
                )
            self.store = PostgresAgentStore(config.database_url)
        else:
            self.store = InMemoryAgentStore()

    # ------------------------------------------------------------------
    # Registration
    # ------------------------------------------------------------------

    async def start_registration(
        self,
        agent_name: str,
        public_key: str,
    ) -> PendingRegistration:
        """Create a pending registration with a challenge.

        Checks ``get_agent_by_public_key()`` first — if the key is
        already registered, raises ``AgentDoorError(status=409)``.
        """
        existing = await self.store.get_agent_by_public_key(public_key)
        if existing is not None:
            raise AgentDoorError(
                code="duplicate_key",
                message=(
                    f"Public key already registered as {existing.agent_id}"
                ),
                status=409,
            )

        return await self.store.create_pending_registration(
            agent_name=agent_name,
            public_key=public_key,
        )

    async def verify_registration(
        self,
        registration_id: str,
        challenge: str,
        signature: str,
    ) -> AgentRecord:
        """Verify Ed25519 signature on challenge, complete registration."""
        pending = await self.store.get_pending_registration(registration_id)
        if pending is None:
            raise AgentDoorError(
                code="registration_not_found",
                message="Registration not found or expired",
                status=404,
            )

        if challenge != pending.challenge:
            raise AgentDoorError(
                code="challenge_mismatch",
                message="Challenge mismatch",
                status=400,
            )

        if not verify_signature(
            challenge, signature, pending.public_key
        ):
            raise AgentDoorError(
                code="invalid_signature",
                message="Invalid signature",
                status=401,
            )

        return await self.store.complete_registration(registration_id)

    # ------------------------------------------------------------------
    # Metadata
    # ------------------------------------------------------------------

    async def update_agent_metadata(
        self,
        agent_id: str,
        metadata: dict,
    ) -> None:
        """Merge *metadata* into an existing agent's metadata dict."""
        agent = await self.store.get_agent(agent_id)
        if agent is None:
            raise AgentDoorError(
                code="agent_not_found",
                message="Agent not found",
                status=404,
            )
        await self.store.update_agent_metadata(agent_id, metadata)

    # ------------------------------------------------------------------
    # Token issuance
    # ------------------------------------------------------------------

    async def issue_token(
        self,
        agent_id: str,
        timestamp: str,
        signature: str,
    ) -> TokenRecord:
        """Verify Ed25519 signature on *timestamp*, issue bearer token.

        No api_key required — signature is the proof.
        """
        agent = await self.store.get_agent(agent_id)
        if agent is None:
            raise AgentDoorError(
                code="unknown_agent",
                message="Unknown agent",
                status=401,
            )

        if not is_timestamp_valid(
            timestamp,
            max_drift_seconds=self.config.max_timestamp_drift,
        ):
            raise AgentDoorError(
                code="stale_timestamp",
                message="Timestamp outside acceptable range",
                status=401,
            )

        if not verify_signature(
            timestamp, signature, agent.public_key
        ):
            raise AgentDoorError(
                code="invalid_signature",
                message="Invalid signature",
                status=401,
            )

        token = f"agt_{secrets.token_urlsafe(32)}"
        expires_at = time.time() + self.config.token_ttl_seconds

        record = TokenRecord(
            token=token,
            agent_id=agent.agent_id,
            expires_at=expires_at,
        )
        await self.store.store_token(record)
        return record

    # ------------------------------------------------------------------
    # Token validation
    # ------------------------------------------------------------------

    async def validate_token(
        self,
        token: str,
    ) -> tuple[TokenRecord, AgentRecord]:
        """Validate a bearer token.

        Returns:
            ``(TokenRecord, AgentRecord)`` on success.

        Raises:
            AgentDoorError: If the token is invalid, expired, or the
                agent is not found.
        """
        token_record = await self.store.get_token(token)
        if token_record is None:
            raise AgentDoorError(
                code="invalid_token",
                message="Invalid or expired token",
                status=401,
            )

        agent = await self.store.get_agent(token_record.agent_id)
        if agent is None:
            raise AgentDoorError(
                code="agent_not_found",
                message="Agent not found",
                status=401,
            )

        return token_record, agent
