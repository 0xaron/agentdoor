"""Tests for agentdoor.discovery module."""

from __future__ import annotations

import httpx
import pytest
import respx

from agentdoor.discovery import (
    DiscoveryDocument,
    ScopeDefinition,
    discover,
    parse_discovery_document,
)


class TestParseDiscoveryDocument:
    """Tests for parse_discovery_document()."""

    def _minimal_doc(self) -> dict:
        return {
            "agentdoor_version": "0.1",
            "service_name": "Test Service",
        }

    def test_parses_minimal_document(self) -> None:
        doc = parse_discovery_document(self._minimal_doc())
        assert isinstance(doc, DiscoveryDocument)
        assert doc.agentdoor_version == "0.1"
        assert doc.service_name == "Test Service"

    def test_default_endpoints(self) -> None:
        doc = parse_discovery_document(self._minimal_doc())
        assert doc.registration_endpoint == "/agentdoor/register"
        assert doc.verification_endpoint == "/agentdoor/register/verify"
        assert doc.auth_endpoint == "/agentdoor/auth"

    def test_custom_endpoints(self) -> None:
        data = {
            **self._minimal_doc(),
            "registration_endpoint": "/custom/register",
            "verification_endpoint": "/custom/verify",
            "auth_endpoint": "/custom/auth",
        }
        doc = parse_discovery_document(data)
        assert doc.registration_endpoint == "/custom/register"
        assert doc.verification_endpoint == "/custom/verify"
        assert doc.auth_endpoint == "/custom/auth"

    def test_parses_scopes(self) -> None:
        data = {
            **self._minimal_doc(),
            "scopes": [
                {"name": "read", "description": "Read access"},
                {"name": "write", "description": "Write access"},
            ],
        }
        doc = parse_discovery_document(data)
        assert len(doc.scopes) == 2
        assert doc.scopes[0] == ScopeDefinition(name="read", description="Read access")
        assert doc.scopes[1] == ScopeDefinition(name="write", description="Write access")

    def test_scopes_default_description(self) -> None:
        data = {
            **self._minimal_doc(),
            "scopes": [{"name": "admin"}],
        }
        doc = parse_discovery_document(data)
        assert doc.scopes[0].description == ""

    def test_default_token_ttl(self) -> None:
        doc = parse_discovery_document(self._minimal_doc())
        assert doc.token_ttl_seconds == 3600

    def test_custom_token_ttl(self) -> None:
        data = {**self._minimal_doc(), "token_ttl_seconds": 7200}
        doc = parse_discovery_document(data)
        assert doc.token_ttl_seconds == 7200

    def test_raw_preserved(self) -> None:
        data = {**self._minimal_doc(), "extra_field": "extra_value"}
        doc = parse_discovery_document(data)
        assert doc.raw == data

    def test_missing_required_fields_raises(self) -> None:
        with pytest.raises(KeyError):
            parse_discovery_document({"service_name": "incomplete"})

        with pytest.raises(KeyError):
            parse_discovery_document({"agentdoor_version": "0.1"})

    def test_empty_scopes(self) -> None:
        data = {**self._minimal_doc(), "scopes": []}
        doc = parse_discovery_document(data)
        assert doc.scopes == []


class TestDiscover:
    """Tests for the async discover() function."""

    _DOC = {
        "agentdoor_version": "0.1",
        "service_name": "Remote Service",
        "registration_endpoint": "/agentdoor/register",
        "verification_endpoint": "/agentdoor/register/verify",
        "auth_endpoint": "/agentdoor/auth",
        "scopes": [{"name": "read", "description": "Read access"}],
        "token_ttl_seconds": 7200,
    }

    @pytest.mark.asyncio
    @respx.mock
    async def test_discover_fetches_and_parses(self) -> None:
        respx.get("https://api.example.com/.well-known/agentdoor.json").mock(
            return_value=httpx.Response(200, json=self._DOC)
        )
        doc = await discover("https://api.example.com")
        assert isinstance(doc, DiscoveryDocument)
        assert doc.service_name == "Remote Service"
        assert doc.token_ttl_seconds == 7200
        assert len(doc.scopes) == 1

    @pytest.mark.asyncio
    @respx.mock
    async def test_discover_strips_trailing_slash(self) -> None:
        respx.get("https://api.example.com/.well-known/agentdoor.json").mock(
            return_value=httpx.Response(200, json=self._DOC)
        )
        doc = await discover("https://api.example.com/")
        assert doc.service_name == "Remote Service"

    @pytest.mark.asyncio
    @respx.mock
    async def test_discover_with_provided_client(self) -> None:
        respx.get("https://api.example.com/.well-known/agentdoor.json").mock(
            return_value=httpx.Response(200, json=self._DOC)
        )
        async with httpx.AsyncClient() as client:
            doc = await discover("https://api.example.com", client=client)
        assert doc.service_name == "Remote Service"

    @pytest.mark.asyncio
    @respx.mock
    async def test_discover_raises_on_http_error(self) -> None:
        respx.get("https://api.example.com/.well-known/agentdoor.json").mock(
            return_value=httpx.Response(404)
        )
        with pytest.raises(httpx.HTTPStatusError):
            await discover("https://api.example.com")

    @pytest.mark.asyncio
    @respx.mock
    async def test_discover_raises_on_missing_fields(self) -> None:
        respx.get("https://api.example.com/.well-known/agentdoor.json").mock(
            return_value=httpx.Response(200, json={"service_name": "incomplete"})
        )
        with pytest.raises(KeyError):
            await discover("https://api.example.com")
