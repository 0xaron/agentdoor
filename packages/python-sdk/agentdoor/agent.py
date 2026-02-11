"""Main Agent class for connecting to AgentDoor-enabled services.

Provides the high-level API that agent applications use to discover,
register with, authenticate against, and make requests to services
that implement the AgentDoor protocol.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

import httpx

from .credentials import Credential, CredentialStore, InMemoryCredentialStore
from .crypto import generate_keypair, sign_message
from .discovery import DiscoveryDocument, discover


@dataclass
class AgentConfig:
    """Configuration for an Agent instance.

    Attributes:
        agent_name: Human-readable name for this agent.
        credential_store: Where to persist credentials.  Defaults to
            an in-memory store.
        http_timeout: Timeout in seconds for HTTP requests.
    """

    agent_name: str = "agentdoor-python-sdk"
    credential_store: CredentialStore = field(
        default_factory=InMemoryCredentialStore
    )
    http_timeout: float = 30.0


class Agent:
    """AgentDoor client for headless agent authentication.

    Usage::

        agent = Agent(config=AgentConfig(agent_name="my-agent"))
        await agent.connect("https://api.example.com")
        await agent.register(scopes=["read", "write"])
        response = await agent.request("GET", "/data")
    """

    def __init__(self, config: AgentConfig | None = None) -> None:
        self._config = config or AgentConfig()
        self._client: httpx.AsyncClient | None = None
        self._base_url: str | None = None
        self._discovery: DiscoveryDocument | None = None
        self._credential: Credential | None = None

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def base_url(self) -> str | None:
        """The base URL of the connected service, or ``None``."""
        return self._base_url

    @property
    def discovery(self) -> DiscoveryDocument | None:
        """The discovery document, available after :meth:`connect`."""
        return self._discovery

    @property
    def credential(self) -> Credential | None:
        """The current credential, available after :meth:`register`."""
        return self._credential

    @property
    def is_connected(self) -> bool:
        """Whether :meth:`connect` has been called successfully."""
        return self._discovery is not None

    @property
    def is_registered(self) -> bool:
        """Whether :meth:`register` has completed successfully."""
        return self._credential is not None and self._credential.api_key is not None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    async def connect(self, base_url: str) -> DiscoveryDocument:
        """Discover an AgentDoor-enabled service.

        Fetches ``/.well-known/agentdoor.json`` from *base_url* and
        stores the resulting :class:`DiscoveryDocument`.

        Args:
            base_url: Root URL of the service (e.g. ``https://api.example.com``).

        Returns:
            The parsed discovery document.
        """
        self._base_url = base_url.rstrip("/")
        self._client = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=self._config.http_timeout,
        )

        # Check credential store for cached credential
        cached = self._config.credential_store.get(self._base_url)
        if cached is not None:
            self._credential = cached

        self._discovery = await discover(self._base_url, client=self._client)
        return self._discovery

    async def register(self, scopes: list[str] | None = None) -> Credential:
        """Register this agent with the connected service.

        Performs the two-step registration flow:

        1. POST to the registration endpoint with the agent's public key.
        2. Sign the returned challenge and POST to the verification endpoint.

        If a valid credential already exists in the store for this service,
        it is returned immediately without contacting the server.

        Args:
            scopes: The permission scopes to request.

        Returns:
            The resulting :class:`Credential` (also cached internally).

        Raises:
            RuntimeError: If :meth:`connect` has not been called.
            httpx.HTTPStatusError: On server error responses.
        """
        if self._discovery is None or self._client is None or self._base_url is None:
            raise RuntimeError("Must call connect() before register()")

        # Return cached credential if it already has an api_key
        if self._credential is not None and self._credential.api_key is not None:
            return self._credential

        # Generate a fresh keypair
        public_key, secret_key = generate_keypair()

        # Step 1 -- initiate registration
        reg_url = self._discovery.registration_endpoint
        reg_payload = {
            "agent_name": self._config.agent_name,
            "public_key": public_key,
            "scopes": scopes or [],
        }
        reg_response = await self._client.post(reg_url, json=reg_payload)
        reg_response.raise_for_status()
        reg_data = reg_response.json()

        challenge: str = reg_data["challenge"]
        registration_id: str = reg_data["registration_id"]

        # Step 2 -- sign the challenge and verify
        signature = sign_message(challenge, secret_key)
        verify_url = self._discovery.verification_endpoint
        verify_payload = {
            "registration_id": registration_id,
            "challenge": challenge,
            "signature": signature,
        }
        verify_response = await self._client.post(verify_url, json=verify_payload)
        verify_response.raise_for_status()
        verify_data = verify_response.json()

        api_key: str = verify_data["api_key"]
        agent_id: str = verify_data["agent_id"]

        # Build and persist the credential
        self._credential = Credential(
            service_url=self._base_url,
            agent_id=agent_id,
            public_key=public_key,
            secret_key=secret_key,
            api_key=api_key,
            scopes=scopes or [],
        )
        self._config.credential_store.save(self._credential)
        return self._credential

    async def authenticate(self) -> str:
        """Obtain a short-lived authentication token.

        Signs the current timestamp with the agent's secret key and
        exchanges it for a bearer token via the auth endpoint.

        Returns:
            The bearer token string.

        Raises:
            RuntimeError: If the agent is not registered.
            httpx.HTTPStatusError: On server error responses.
        """
        if (
            self._credential is None
            or self._credential.api_key is None
            or self._client is None
            or self._discovery is None
        ):
            raise RuntimeError("Must call register() before authenticate()")

        # Return cached token if still valid
        if self._credential.is_token_valid():
            assert self._credential.token is not None
            return self._credential.token

        timestamp = str(int(time.time()))
        signature = sign_message(timestamp, self._credential.secret_key)

        auth_url = self._discovery.auth_endpoint
        auth_payload = {
            "agent_id": self._credential.agent_id,
            "api_key": self._credential.api_key,
            "timestamp": timestamp,
            "signature": signature,
        }
        auth_response = await self._client.post(auth_url, json=auth_payload)
        auth_response.raise_for_status()
        auth_data = auth_response.json()

        token: str = auth_data["token"]
        expires_in: int = auth_data.get(
            "expires_in", self._discovery.token_ttl_seconds
        )

        self._credential.token = token
        self._credential.token_expires_at = time.time() + expires_in
        self._config.credential_store.save(self._credential)

        return token

    async def request(
        self,
        method: str,
        path: str,
        **kwargs: Any,
    ) -> httpx.Response:
        """Make an authenticated HTTP request to the connected service.

        Automatically obtains or refreshes the bearer token before
        sending the request.

        Args:
            method: HTTP method (GET, POST, etc.).
            path: Path relative to the service base URL.
            **kwargs: Additional keyword arguments forwarded to
                ``httpx.AsyncClient.request``.

        Returns:
            The :class:`httpx.Response`.

        Raises:
            RuntimeError: If the agent is not registered.
        """
        if self._client is None:
            raise RuntimeError("Must call connect() before request()")

        token = await self.authenticate()

        headers = kwargs.pop("headers", {})
        headers["Authorization"] = f"Bearer {token}"

        response = await self._client.request(method, path, headers=headers, **kwargs)

        # If we get a 401, try refreshing the token once and retrying
        if response.status_code == 401:
            # Force token refresh
            self._credential.token = None  # type: ignore[union-attr]
            self._credential.token_expires_at = None  # type: ignore[union-attr]
            token = await self.authenticate()
            headers["Authorization"] = f"Bearer {token}"
            response = await self._client.request(
                method, path, headers=headers, **kwargs
            )

        return response

    async def close(self) -> None:
        """Close the underlying HTTP client."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
