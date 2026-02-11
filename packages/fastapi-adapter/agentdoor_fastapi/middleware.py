"""AgentDoor FastAPI middleware.

Provides the :class:`AgentDoor` class that mounts all AgentDoor protocol
endpoints onto a FastAPI application, and the :func:`agent_required`
dependency for protecting individual routes.
"""

from __future__ import annotations

import secrets
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.routing import APIRouter

from .crypto import is_timestamp_valid, verify_signature
from .models import (
    AgentContext,
    AuthRequest,
    AuthResponse,
    DiscoveryDocument,
    RegistrationRequest,
    RegistrationResponse,
    ScopeDefinition,
    VerifyRequest,
    VerifyResponse,
)
from .store import AgentStore, InMemoryAgentStore, TokenRecord


@dataclass
class AgentDoorConfig:
    """Configuration for the AgentDoor middleware.

    Attributes:
        service_name: Human-readable name of this service.
        scopes: Permission scopes offered by this service.
        token_ttl_seconds: Lifetime of issued bearer tokens in seconds.
        max_timestamp_drift: Maximum clock drift allowed for signed
            timestamps, in seconds.
        store: The agent store backend.  Defaults to an in-memory store.
        route_prefix: URL prefix for AgentDoor endpoints (without
            trailing slash).
    """

    service_name: str = "AgentDoor Service"
    scopes: list[dict[str, str]] = field(default_factory=list)
    token_ttl_seconds: int = 3600
    max_timestamp_drift: int = 300
    store: AgentStore | None = None
    route_prefix: str = "/agentdoor"


class AgentDoor:
    """Mount AgentDoor protocol endpoints onto a FastAPI application.

    Usage::

        app = FastAPI()
        gate = AgentDoor(app, config=AgentDoorConfig(service_name="My API"))

        @app.get("/protected")
        async def protected(agent: AgentContext = Depends(gate.agent_required)):
            return {"hello": agent.agent_name}
    """

    def __init__(
        self,
        app: FastAPI,
        config: AgentDoorConfig | None = None,
    ) -> None:
        self._app = app
        self._config = config or AgentDoorConfig()
        self._store: AgentStore = self._config.store or InMemoryAgentStore()

        self._discovery_doc = DiscoveryDocument(
            service_name=self._config.service_name,
            registration_endpoint=f"{self._config.route_prefix}/register",
            verification_endpoint=f"{self._config.route_prefix}/register/verify",
            auth_endpoint=f"{self._config.route_prefix}/auth",
            scopes=[
                ScopeDefinition(**s) for s in self._config.scopes
            ],
            token_ttl_seconds=self._config.token_ttl_seconds,
        )

        self._mount_routes()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def store(self) -> AgentStore:
        """The underlying agent store."""
        return self._store

    @property
    def config(self) -> AgentDoorConfig:
        """The current configuration."""
        return self._config

    # ------------------------------------------------------------------
    # Route mounting
    # ------------------------------------------------------------------

    def _mount_routes(self) -> None:
        """Add all AgentDoor routes to the FastAPI application."""
        router = APIRouter()

        router.add_api_route(
            "/.well-known/agentdoor.json",
            self._handle_discovery,
            methods=["GET"],
            response_model=DiscoveryDocument,
            tags=["agentdoor"],
        )
        router.add_api_route(
            f"{self._config.route_prefix}/register",
            self._handle_register,
            methods=["POST"],
            response_model=RegistrationResponse,
            tags=["agentdoor"],
        )
        router.add_api_route(
            f"{self._config.route_prefix}/register/verify",
            self._handle_verify,
            methods=["POST"],
            response_model=VerifyResponse,
            tags=["agentdoor"],
        )
        router.add_api_route(
            f"{self._config.route_prefix}/auth",
            self._handle_auth,
            methods=["POST"],
            response_model=AuthResponse,
            tags=["agentdoor"],
        )

        self._app.include_router(router)

    # ------------------------------------------------------------------
    # Endpoint handlers
    # ------------------------------------------------------------------

    async def _handle_discovery(self) -> DiscoveryDocument:
        """GET /.well-known/agentdoor.json"""
        return self._discovery_doc

    async def _handle_register(
        self, body: RegistrationRequest
    ) -> RegistrationResponse:
        """POST /agentdoor/register

        Initiates agent registration by creating a pending registration
        with a challenge that the agent must sign.
        """
        # Validate requested scopes
        available = {s["name"] for s in self._config.scopes}
        if available:
            invalid = set(body.scopes) - available
            if invalid:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid scopes: {', '.join(sorted(invalid))}",
                )

        pending = await self._store.create_pending_registration(
            agent_name=body.agent_name,
            public_key=body.public_key,
            scopes=body.scopes,
        )

        return RegistrationResponse(
            registration_id=pending.registration_id,
            challenge=pending.challenge,
        )

    async def _handle_verify(self, body: VerifyRequest) -> VerifyResponse:
        """POST /agentdoor/register/verify

        Completes agent registration by verifying the signed challenge.
        """
        pending = await self._store.get_pending_registration(body.registration_id)
        if pending is None:
            raise HTTPException(
                status_code=404,
                detail="Registration not found or expired",
            )

        # Verify that the challenge matches
        if body.challenge != pending.challenge:
            raise HTTPException(
                status_code=400,
                detail="Challenge mismatch",
            )

        # Verify the signature
        if not verify_signature(body.challenge, body.signature, pending.public_key):
            raise HTTPException(
                status_code=401,
                detail="Invalid signature",
            )

        # Promote to full agent
        agent_record = await self._store.complete_registration(
            body.registration_id
        )

        return VerifyResponse(
            agent_id=agent_record.agent_id,
            api_key=agent_record.api_key,
        )

    async def _handle_auth(self, body: AuthRequest) -> AuthResponse:
        """POST /agentdoor/auth

        Issues a short-lived bearer token after verifying the agent's
        signed timestamp.
        """
        # Look up agent
        agent_record = await self._store.get_agent(body.agent_id)
        if agent_record is None:
            raise HTTPException(status_code=401, detail="Unknown agent")

        # Verify API key
        if agent_record.api_key != body.api_key:
            raise HTTPException(status_code=401, detail="Invalid API key")

        # Verify timestamp freshness
        if not is_timestamp_valid(
            body.timestamp,
            max_drift_seconds=self._config.max_timestamp_drift,
        ):
            raise HTTPException(
                status_code=401,
                detail="Timestamp outside acceptable range",
            )

        # Verify signature on timestamp
        if not verify_signature(
            body.timestamp, body.signature, agent_record.public_key
        ):
            raise HTTPException(status_code=401, detail="Invalid signature")

        # Issue token
        token = f"agt_{secrets.token_urlsafe(32)}"
        expires_at = time.time() + self._config.token_ttl_seconds

        token_record = TokenRecord(
            token=token,
            agent_id=agent_record.agent_id,
            expires_at=expires_at,
            scopes=agent_record.scopes,
        )
        await self._store.store_token(token_record)

        return AuthResponse(
            token=token,
            expires_in=self._config.token_ttl_seconds,
        )

    # ------------------------------------------------------------------
    # Dependency injection
    # ------------------------------------------------------------------

    def agent_required(self, scopes: list[str] | None = None) -> Callable:
        """Create a FastAPI dependency that requires agent authentication.

        Args:
            scopes: Optional list of scopes the agent must possess.
                If ``None``, any authenticated agent is accepted.

        Returns:
            A FastAPI dependency callable that resolves to an
            :class:`AgentContext`.

        Usage::

            @app.get("/data")
            async def get_data(
                agent: AgentContext = Depends(gate.agent_required())
            ):
                return {"agent": agent.agent_id}
        """
        store = self._store

        async def _dependency(request: Request) -> AgentContext:
            auth_header = request.headers.get("Authorization")
            if not auth_header or not auth_header.startswith("Bearer "):
                raise HTTPException(
                    status_code=401,
                    detail="Missing or invalid Authorization header",
                )

            token = auth_header[7:]  # Strip "Bearer " prefix
            token_record = await store.get_token(token)

            if token_record is None:
                raise HTTPException(
                    status_code=401,
                    detail="Invalid or expired token",
                )

            # Check scopes
            if scopes:
                missing = set(scopes) - set(token_record.scopes)
                if missing:
                    raise HTTPException(
                        status_code=403,
                        detail=f"Missing required scopes: {', '.join(sorted(missing))}",
                    )

            # Look up agent details
            agent_record = await store.get_agent(token_record.agent_id)
            if agent_record is None:
                raise HTTPException(
                    status_code=401,
                    detail="Agent not found",
                )

            return AgentContext(
                agent_id=agent_record.agent_id,
                agent_name=agent_record.agent_name,
                scopes=token_record.scopes,
            )

        return _dependency
