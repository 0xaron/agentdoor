"""Tests for agentgate.agent module."""

from __future__ import annotations

import json
import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from agentgate.agent import Agent, AgentConfig
from agentgate.credentials import Credential, InMemoryCredentialStore


# ---------------------------------------------------------------------------
# Fixtures / helpers
# ---------------------------------------------------------------------------

DISCOVERY_DOC = {
    "agentgate_version": "0.1",
    "service_name": "Test Service",
    "registration_endpoint": "/agentgate/register",
    "verification_endpoint": "/agentgate/register/verify",
    "auth_endpoint": "/agentgate/auth",
    "scopes": [{"name": "read", "description": "Read access"}],
    "token_ttl_seconds": 3600,
}


def _make_response(status: int = 200, json_data: dict | None = None) -> httpx.Response:
    """Build a minimal httpx.Response for mocking."""
    resp = httpx.Response(
        status_code=status,
        json=json_data or {},
        request=httpx.Request("GET", "https://example.com"),
    )
    return resp


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestAgentInit:
    """Agent construction tests."""

    def test_defaults(self) -> None:
        agent = Agent()
        assert agent.base_url is None
        assert agent.discovery is None
        assert agent.credential is None
        assert agent.is_connected is False
        assert agent.is_registered is False

    def test_custom_config(self) -> None:
        store = InMemoryCredentialStore()
        cfg = AgentConfig(agent_name="custom", credential_store=store)
        agent = Agent(config=cfg)
        assert agent._config.agent_name == "custom"


class TestAgentConnect:
    """Tests for Agent.connect()."""

    @pytest.mark.asyncio
    async def test_connect_fetches_discovery(self) -> None:
        agent = Agent()
        with patch("agentgate.agent.discover", new_callable=AsyncMock) as mock_discover:
            from agentgate.discovery import parse_discovery_document

            mock_discover.return_value = parse_discovery_document(DISCOVERY_DOC)
            doc = await agent.connect("https://example.com")

        assert doc.service_name == "Test Service"
        assert agent.is_connected is True
        assert agent.base_url == "https://example.com"

        # Cleanup
        await agent.close()

    @pytest.mark.asyncio
    async def test_connect_loads_cached_credential(self) -> None:
        store = InMemoryCredentialStore()
        cred = Credential(
            service_url="https://example.com",
            agent_id="agent-1",
            public_key="pub",
            secret_key="sec",
            api_key="key-123",
        )
        store.save(cred)

        agent = Agent(config=AgentConfig(credential_store=store))
        with patch("agentgate.agent.discover", new_callable=AsyncMock) as mock_discover:
            from agentgate.discovery import parse_discovery_document

            mock_discover.return_value = parse_discovery_document(DISCOVERY_DOC)
            await agent.connect("https://example.com")

        assert agent.credential is not None
        assert agent.credential.api_key == "key-123"
        await agent.close()


class TestAgentRegister:
    """Tests for Agent.register()."""

    @pytest.mark.asyncio
    async def test_register_without_connect_raises(self) -> None:
        agent = Agent()
        with pytest.raises(RuntimeError, match="connect"):
            await agent.register(scopes=["read"])

    @pytest.mark.asyncio
    async def test_register_performs_challenge_flow(self) -> None:
        agent = Agent(config=AgentConfig(agent_name="test-agent"))

        # Mock connect
        with patch("agentgate.agent.discover", new_callable=AsyncMock) as mock_discover:
            from agentgate.discovery import parse_discovery_document

            mock_discover.return_value = parse_discovery_document(DISCOVERY_DOC)
            await agent.connect("https://example.com")

        # Mock the registration HTTP calls
        reg_response = _make_response(200, {
            "challenge": "sign-this-challenge",
            "registration_id": "reg-abc",
        })
        verify_response = _make_response(200, {
            "api_key": "apikey-xyz",
            "agent_id": "agent-42",
        })

        assert agent._client is not None
        original_post = agent._client.post
        call_count = 0

        async def mock_post(url: str, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                return reg_response
            return verify_response

        agent._client.post = mock_post  # type: ignore[assignment]

        cred = await agent.register(scopes=["read"])

        assert cred.api_key == "apikey-xyz"
        assert cred.agent_id == "agent-42"
        assert cred.scopes == ["read"]
        assert agent.is_registered is True
        assert call_count == 2

        await agent.close()


class TestAgentAuthenticate:
    """Tests for Agent.authenticate()."""

    @pytest.mark.asyncio
    async def test_authenticate_without_register_raises(self) -> None:
        agent = Agent()
        with pytest.raises(RuntimeError, match="register"):
            await agent.authenticate()

    @pytest.mark.asyncio
    async def test_authenticate_returns_token(self) -> None:
        agent = Agent(config=AgentConfig(agent_name="test-agent"))

        # Set up connected + registered state
        with patch("agentgate.agent.discover", new_callable=AsyncMock) as mock_discover:
            from agentgate.discovery import parse_discovery_document

            mock_discover.return_value = parse_discovery_document(DISCOVERY_DOC)
            await agent.connect("https://example.com")

        from agentgate.crypto import generate_keypair

        pub, sec = generate_keypair()
        agent._credential = Credential(
            service_url="https://example.com",
            agent_id="agent-42",
            public_key=pub,
            secret_key=sec,
            api_key="apikey-xyz",
        )

        auth_response = _make_response(200, {
            "token": "bearer-token-abc",
            "expires_in": 3600,
        })

        async def mock_post(url: str, **kwargs):
            return auth_response

        assert agent._client is not None
        agent._client.post = mock_post  # type: ignore[assignment]

        token = await agent.authenticate()
        assert token == "bearer-token-abc"
        assert agent._credential.token == "bearer-token-abc"
        assert agent._credential.token_expires_at is not None

        await agent.close()

    @pytest.mark.asyncio
    async def test_authenticate_uses_cached_token(self) -> None:
        agent = Agent(config=AgentConfig(agent_name="test-agent"))

        with patch("agentgate.agent.discover", new_callable=AsyncMock) as mock_discover:
            from agentgate.discovery import parse_discovery_document

            mock_discover.return_value = parse_discovery_document(DISCOVERY_DOC)
            await agent.connect("https://example.com")

        from agentgate.crypto import generate_keypair

        pub, sec = generate_keypair()
        agent._credential = Credential(
            service_url="https://example.com",
            agent_id="agent-42",
            public_key=pub,
            secret_key=sec,
            api_key="apikey-xyz",
            token="cached-token",
            token_expires_at=time.time() + 3600,
        )

        # Should not call the server at all
        token = await agent.authenticate()
        assert token == "cached-token"

        await agent.close()


class TestAgentRequest:
    """Tests for Agent.request()."""

    @pytest.mark.asyncio
    async def test_request_without_connect_raises(self) -> None:
        agent = Agent()
        with pytest.raises(RuntimeError, match="connect"):
            await agent.request("GET", "/data")
