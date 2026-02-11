"""AgentDoor service discovery.

Fetches and parses the /.well-known/agentdoor.json discovery document
from an AgentDoor-enabled service.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import httpx


@dataclass
class ScopeDefinition:
    """A single scope offered by the service."""

    name: str
    description: str


@dataclass
class DiscoveryDocument:
    """Parsed AgentDoor discovery document.

    Represents the contents of /.well-known/agentdoor.json, which
    describes the service's AgentDoor capabilities and endpoints.
    """

    agentdoor_version: str
    service_name: str
    registration_endpoint: str
    verification_endpoint: str
    auth_endpoint: str
    scopes: list[ScopeDefinition] = field(default_factory=list)
    token_ttl_seconds: int = 3600
    raw: dict[str, Any] = field(default_factory=dict, repr=False)


def parse_discovery_document(data: dict[str, Any]) -> DiscoveryDocument:
    """Parse a raw JSON dict into a DiscoveryDocument.

    Args:
        data: The parsed JSON body of /.well-known/agentdoor.json.

    Returns:
        A populated DiscoveryDocument dataclass.

    Raises:
        KeyError: If required fields are missing from the document.
    """
    scopes = [
        ScopeDefinition(name=s["name"], description=s.get("description", ""))
        for s in data.get("scopes", [])
    ]

    return DiscoveryDocument(
        agentdoor_version=data["agentdoor_version"],
        service_name=data["service_name"],
        registration_endpoint=data.get(
            "registration_endpoint", "/agentdoor/register"
        ),
        verification_endpoint=data.get(
            "verification_endpoint", "/agentdoor/register/verify"
        ),
        auth_endpoint=data.get("auth_endpoint", "/agentdoor/auth"),
        scopes=scopes,
        token_ttl_seconds=data.get("token_ttl_seconds", 3600),
        raw=data,
    )


async def discover(base_url: str, client: httpx.AsyncClient | None = None) -> DiscoveryDocument:
    """Fetch and parse the AgentDoor discovery document from a service.

    Args:
        base_url: The base URL of the AgentDoor-enabled service
            (e.g. ``https://api.example.com``).
        client: An optional httpx.AsyncClient to use for the request.
            If not provided, a new client is created.

    Returns:
        The parsed DiscoveryDocument.

    Raises:
        httpx.HTTPStatusError: If the discovery endpoint returns a non-2xx status.
        KeyError: If the discovery document is missing required fields.
    """
    url = f"{base_url.rstrip('/')}/.well-known/agentdoor.json"

    if client is None:
        async with httpx.AsyncClient() as new_client:
            response = await new_client.get(url)
    else:
        response = await client.get(url)

    response.raise_for_status()
    data = response.json()
    return parse_discovery_document(data)
