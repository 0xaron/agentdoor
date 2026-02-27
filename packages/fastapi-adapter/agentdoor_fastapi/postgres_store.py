"""Postgres-backed AgentStore using asyncpg.

Auto-creates tables on first use via ``CREATE TABLE IF NOT EXISTS``.
No Alembic, no migration files — the consumer just passes a
``database_url`` and everything works.
"""

from __future__ import annotations

import json
import secrets
import time
from datetime import datetime, timezone

import asyncpg  # type: ignore[import-untyped]

from .store import AgentRecord, PendingRegistration, TokenRecord


class PostgresAgentStore:
    """Postgres-backed AgentStore using asyncpg."""

    def __init__(self, database_url: str) -> None:
        self._database_url = database_url
        self._pool: asyncpg.Pool | None = None
        self._initialized = False

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def _ensure_initialized(self) -> None:
        """Lazy init: create connection pool + tables on first call."""
        if self._initialized:
            return
        self._pool = await asyncpg.create_pool(self._database_url)
        await self._create_tables()
        self._initialized = True

    async def _create_tables(self) -> None:
        """CREATE TABLE IF NOT EXISTS — idempotent, no migrations."""
        assert self._pool is not None
        async with self._pool.acquire() as conn:
            await conn.execute("""
                CREATE TABLE IF NOT EXISTS agentdoor_agents (
                    agent_id        TEXT PRIMARY KEY,
                    agent_name      TEXT NOT NULL,
                    public_key      TEXT NOT NULL UNIQUE,
                    metadata        JSONB NOT NULL DEFAULT '{}',
                    status          TEXT NOT NULL DEFAULT 'active',
                    created_at      TIMESTAMPTZ DEFAULT NOW(),
                    last_auth_at    TIMESTAMPTZ DEFAULT NOW(),
                    total_requests  INTEGER DEFAULT 0
                );

                CREATE TABLE IF NOT EXISTS agentdoor_pending (
                    registration_id TEXT PRIMARY KEY,
                    agent_name      TEXT NOT NULL,
                    public_key      TEXT NOT NULL,
                    challenge       TEXT NOT NULL,
                    created_at      TIMESTAMPTZ DEFAULT NOW(),
                    expires_at      TIMESTAMPTZ NOT NULL
                );

                CREATE TABLE IF NOT EXISTS agentdoor_tokens (
                    token           TEXT PRIMARY KEY,
                    agent_id        TEXT NOT NULL
                        REFERENCES agentdoor_agents(agent_id),
                    expires_at      TIMESTAMPTZ NOT NULL,
                    created_at      TIMESTAMPTZ DEFAULT NOW()
                );

                CREATE INDEX IF NOT EXISTS
                    idx_agentdoor_agents_public_key
                    ON agentdoor_agents(public_key);
                CREATE INDEX IF NOT EXISTS
                    idx_agentdoor_tokens_expires
                    ON agentdoor_tokens(expires_at);
                CREATE INDEX IF NOT EXISTS
                    idx_agentdoor_pending_expires
                    ON agentdoor_pending(expires_at);
            """)

    async def close(self) -> None:
        """Close the connection pool.  Call on shutdown."""
        if self._pool:
            await self._pool.close()

    # ------------------------------------------------------------------
    # Pending registrations
    # ------------------------------------------------------------------

    async def create_pending_registration(
        self,
        agent_name: str,
        public_key: str,
    ) -> PendingRegistration:
        await self._ensure_initialized()
        assert self._pool is not None

        registration_id = f"reg_{secrets.token_urlsafe(16)}"
        challenge = secrets.token_urlsafe(32)
        now = time.time()
        expires_at = now + 300  # 5 min TTL

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO agentdoor_pending
                    (registration_id, agent_name, public_key,
                     challenge, expires_at)
                VALUES ($1, $2, $3, $4,
                        to_timestamp($5))
                """,
                registration_id,
                agent_name,
                public_key,
                challenge,
                expires_at,
            )

        return PendingRegistration(
            registration_id=registration_id,
            agent_name=agent_name,
            public_key=public_key,
            challenge=challenge,
            created_at=now,
            expires_at=expires_at,
        )

    async def get_pending_registration(
        self, registration_id: str
    ) -> PendingRegistration | None:
        await self._ensure_initialized()
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT registration_id, agent_name, public_key,
                       challenge,
                       EXTRACT(EPOCH FROM created_at) AS created_at,
                       EXTRACT(EPOCH FROM expires_at) AS expires_at
                FROM agentdoor_pending
                WHERE registration_id = $1
                """,
                registration_id,
            )

        if row is None:
            return None

        # Expired? Delete and return None.
        if time.time() > row["expires_at"]:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    "DELETE FROM agentdoor_pending "
                    "WHERE registration_id = $1",
                    registration_id,
                )
            return None

        return PendingRegistration(
            registration_id=row["registration_id"],
            agent_name=row["agent_name"],
            public_key=row["public_key"],
            challenge=row["challenge"],
            created_at=row["created_at"],
            expires_at=row["expires_at"],
        )

    async def complete_registration(
        self, registration_id: str
    ) -> AgentRecord:
        await self._ensure_initialized()
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                "SELECT * FROM agentdoor_pending "
                "WHERE registration_id = $1",
                registration_id,
            )
            if row is None:
                raise ValueError(
                    f"Pending registration {registration_id} not found"
                )

            agent_id = f"agent_{secrets.token_urlsafe(12)}"

            await conn.execute(
                """
                INSERT INTO agentdoor_agents
                    (agent_id, agent_name, public_key)
                VALUES ($1, $2, $3)
                """,
                agent_id,
                row["agent_name"],
                row["public_key"],
            )

            await conn.execute(
                "DELETE FROM agentdoor_pending "
                "WHERE registration_id = $1",
                registration_id,
            )

        return AgentRecord(
            agent_id=agent_id,
            agent_name=row["agent_name"],
            public_key=row["public_key"],
        )

    # ------------------------------------------------------------------
    # Agent lookup
    # ------------------------------------------------------------------

    async def get_agent(self, agent_id: str) -> AgentRecord | None:
        await self._ensure_initialized()
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT agent_id, agent_name, public_key, metadata,
                       EXTRACT(EPOCH FROM created_at) AS created_at
                FROM agentdoor_agents
                WHERE agent_id = $1
                """,
                agent_id,
            )

        if row is None:
            return None

        meta = row["metadata"]
        if isinstance(meta, str):
            meta = json.loads(meta)

        return AgentRecord(
            agent_id=row["agent_id"],
            agent_name=row["agent_name"],
            public_key=row["public_key"],
            metadata=meta or {},
            created_at=row["created_at"],
        )

    async def get_agent_by_public_key(
        self, public_key: str
    ) -> AgentRecord | None:
        await self._ensure_initialized()
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT agent_id, agent_name, public_key, metadata,
                       EXTRACT(EPOCH FROM created_at) AS created_at
                FROM agentdoor_agents
                WHERE public_key = $1
                """,
                public_key,
            )

        if row is None:
            return None

        meta = row["metadata"]
        if isinstance(meta, str):
            meta = json.loads(meta)

        return AgentRecord(
            agent_id=row["agent_id"],
            agent_name=row["agent_name"],
            public_key=row["public_key"],
            metadata=meta or {},
            created_at=row["created_at"],
        )

    async def update_agent_metadata(
        self, agent_id: str, metadata: dict
    ) -> None:
        await self._ensure_initialized()
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                UPDATE agentdoor_agents
                SET metadata = metadata || $2::jsonb
                WHERE agent_id = $1
                """,
                agent_id,
                json.dumps(metadata),
            )

    # ------------------------------------------------------------------
    # Tokens
    # ------------------------------------------------------------------

    async def store_token(self, token_record: TokenRecord) -> None:
        await self._ensure_initialized()
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            await conn.execute(
                """
                INSERT INTO agentdoor_tokens
                    (token, agent_id, expires_at)
                VALUES ($1, $2, to_timestamp($3))
                """,
                token_record.token,
                token_record.agent_id,
                token_record.expires_at,
            )

    async def get_token(self, token: str) -> TokenRecord | None:
        await self._ensure_initialized()
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            row = await conn.fetchrow(
                """
                SELECT token, agent_id,
                       EXTRACT(EPOCH FROM expires_at) AS expires_at
                FROM agentdoor_tokens
                WHERE token = $1
                """,
                token,
            )

        if row is None:
            return None

        if time.time() > row["expires_at"]:
            async with self._pool.acquire() as conn:
                await conn.execute(
                    "DELETE FROM agentdoor_tokens WHERE token = $1",
                    token,
                )
            return None

        return TokenRecord(
            token=row["token"],
            agent_id=row["agent_id"],
            expires_at=row["expires_at"],
        )

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    async def cleanup_expired(self) -> None:
        """Delete expired tokens and pending registrations."""
        await self._ensure_initialized()
        assert self._pool is not None

        async with self._pool.acquire() as conn:
            await conn.execute(
                "DELETE FROM agentdoor_tokens WHERE expires_at < NOW()"
            )
            await conn.execute(
                "DELETE FROM agentdoor_pending WHERE expires_at < NOW()"
            )
