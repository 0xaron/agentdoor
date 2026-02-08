"""Pydantic models for AgentGate FastAPI adapter.

Defines request/response schemas for the AgentGate registration,
verification, and authentication endpoints, as well as the discovery
document and agent context models.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


class ScopeDefinition(BaseModel):
    """A single permission scope offered by the service."""

    name: str
    description: str = ""


class DiscoveryDocument(BaseModel):
    """The ``/.well-known/agentgate.json`` response body."""

    agentgate_version: str = "0.1"
    service_name: str
    registration_endpoint: str = "/agentgate/register"
    verification_endpoint: str = "/agentgate/register/verify"
    auth_endpoint: str = "/agentgate/auth"
    scopes: list[ScopeDefinition] = Field(default_factory=list)
    token_ttl_seconds: int = 3600


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class RegistrationRequest(BaseModel):
    """POST /agentgate/register request body."""

    agent_name: str
    public_key: str
    scopes: list[str] = Field(default_factory=list)


class RegistrationResponse(BaseModel):
    """POST /agentgate/register response body."""

    registration_id: str
    challenge: str


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


class VerifyRequest(BaseModel):
    """POST /agentgate/register/verify request body."""

    registration_id: str
    challenge: str
    signature: str


class VerifyResponse(BaseModel):
    """POST /agentgate/register/verify response body."""

    agent_id: str
    api_key: str


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


class AuthRequest(BaseModel):
    """POST /agentgate/auth request body."""

    agent_id: str
    api_key: str
    timestamp: str
    signature: str


class AuthResponse(BaseModel):
    """POST /agentgate/auth response body."""

    token: str
    expires_in: int


# ---------------------------------------------------------------------------
# Agent context (injected into protected routes)
# ---------------------------------------------------------------------------


class AgentContext(BaseModel):
    """Information about the authenticated agent.

    This is injected into protected route handlers via the
    ``agent_required`` FastAPI dependency.
    """

    agent_id: str
    agent_name: str
    scopes: list[str] = Field(default_factory=list)
