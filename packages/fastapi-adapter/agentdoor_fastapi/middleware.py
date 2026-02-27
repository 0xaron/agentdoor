"""AgentDoor FastAPI middleware.

Provides the :class:`AgentDoor` class that mounts all AgentDoor protocol
endpoints onto a FastAPI application, and the :func:`agent_required`
dependency for protecting individual routes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.routing import APIRouter

from .engine import AgentEngine
from .errors import AgentDoorError
from .models import (
    AgentContext,
    AuthResponse,
    DiscoveryDocument,
    RegistrationRequest,
    RegistrationResponse,
    ScopeDefinition,
    TokenRequest,
    VerifyRequest,
    VerifyResponse,
)
from .store import AgentStore


@dataclass
class AgentDoorConfig:
    """Configuration for the AgentDoor middleware.

    Attributes:
        service_name: Human-readable name of this service.
        scopes: Permission scopes offered by this service.
        token_ttl_seconds: Lifetime of issued bearer tokens.
        max_timestamp_drift: Maximum clock drift for signed
            timestamps, in seconds.
        database_url: If set, uses PostgresAgentStore.
        store: Manual store override (takes priority).
        route_prefix: URL prefix for AgentDoor endpoints.
    """

    service_name: str = "AgentDoor Service"
    scopes: list[dict[str, str]] = field(default_factory=list)
    token_ttl_seconds: int = 3600
    max_timestamp_drift: int = 300
    database_url: str | None = None
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
        mount_routes: bool = True,
    ) -> None:
        self._app = app
        self._config = config or AgentDoorConfig()
        self.engine = AgentEngine(self._config)

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

        if mount_routes:
            self._mount_routes()

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def store(self) -> AgentStore:
        """The underlying agent store."""
        return self.engine.store

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
        """POST /agentdoor/register"""
        # Validate requested scopes
        available = {s["name"] for s in self._config.scopes}
        if available:
            invalid = set(body.scopes) - available
            if invalid:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid scopes: {', '.join(sorted(invalid))}",
                )

        try:
            pending = await self.engine.start_registration(
                agent_name=body.agent_name,
                public_key=body.public_key,
            )
        except AgentDoorError as e:
            raise HTTPException(
                status_code=e.status, detail=e.message
            )

        return RegistrationResponse(
            registration_id=pending.registration_id,
            challenge=pending.challenge,
        )

    async def _handle_verify(
        self, body: VerifyRequest
    ) -> VerifyResponse:
        """POST /agentdoor/register/verify"""
        try:
            agent_record = await self.engine.verify_registration(
                body.registration_id,
                body.challenge,
                body.signature,
            )
        except AgentDoorError as e:
            raise HTTPException(
                status_code=e.status, detail=e.message
            )

        return VerifyResponse(agent_id=agent_record.agent_id)

    async def _handle_auth(self, body: TokenRequest) -> AuthResponse:
        """POST /agentdoor/auth"""
        try:
            token_record = await self.engine.issue_token(
                body.agent_id, body.timestamp, body.signature
            )
        except AgentDoorError as e:
            raise HTTPException(
                status_code=e.status, detail=e.message
            )

        return AuthResponse(
            token=token_record.token,
            expires_in=self._config.token_ttl_seconds,
        )

    # ------------------------------------------------------------------
    # Dependency injection
    # ------------------------------------------------------------------

    def agent_required(self, scopes: list[str] | None = None) -> Callable:
        """Create a FastAPI dependency that requires agent auth.

        Args:
            scopes: Optional list of scopes the agent must possess.

        Returns:
            A FastAPI dependency callable that resolves to an
            :class:`AgentContext`.
        """
        engine = self.engine

        async def _dependency(request: Request) -> AgentContext:
            auth_header = request.headers.get("Authorization")
            if not auth_header or not auth_header.startswith("Bearer "):
                raise HTTPException(
                    status_code=401,
                    detail="Missing or invalid Authorization header",
                )

            token = auth_header[7:]  # Strip "Bearer " prefix
            try:
                token_record, agent_record = (
                    await engine.validate_token(token)
                )
            except AgentDoorError:
                raise HTTPException(
                    status_code=401,
                    detail="Invalid or expired token",
                )

            # Check scopes
            if scopes:
                missing = set(scopes) - set(agent_record.scopes)
                if missing:
                    raise HTTPException(
                        status_code=403,
                        detail=(
                            "Missing required scopes: "
                            f"{', '.join(sorted(missing))}"
                        ),
                    )

            return AgentContext(
                agent_id=agent_record.agent_id,
                agent_name=agent_record.agent_name,
                scopes=agent_record.scopes,
            )

        return _dependency
