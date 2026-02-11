"""Pydantic models for AgentDoor FastAPI adapter.

Defines request/response schemas for the AgentDoor registration,
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
    """The ``/.well-known/agentdoor.json`` response body."""

    agentdoor_version: str = "0.1"
    service_name: str
    registration_endpoint: str = "/agentdoor/register"
    verification_endpoint: str = "/agentdoor/register/verify"
    auth_endpoint: str = "/agentdoor/auth"
    scopes: list[ScopeDefinition] = Field(default_factory=list)
    token_ttl_seconds: int = 3600


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


class RegistrationRequest(BaseModel):
    """POST /agentdoor/register request body."""

    agent_name: str
    public_key: str
    scopes: list[str] = Field(default_factory=list)


class RegistrationResponse(BaseModel):
    """POST /agentdoor/register response body."""

    registration_id: str
    challenge: str


# ---------------------------------------------------------------------------
# Verification
# ---------------------------------------------------------------------------


class VerifyRequest(BaseModel):
    """POST /agentdoor/register/verify request body."""

    registration_id: str
    challenge: str
    signature: str


class VerifyResponse(BaseModel):
    """POST /agentdoor/register/verify response body."""

    agent_id: str
    api_key: str


# ---------------------------------------------------------------------------
# Authentication
# ---------------------------------------------------------------------------


class AuthRequest(BaseModel):
    """POST /agentdoor/auth request body."""

    agent_id: str
    api_key: str
    timestamp: str
    signature: str


class AuthResponse(BaseModel):
    """POST /agentdoor/auth response body."""

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
