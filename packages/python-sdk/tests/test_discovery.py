"""Tests for agentgate.discovery module."""

from __future__ import annotations

import pytest

from agentgate.discovery import DiscoveryDocument, ScopeDefinition, parse_discovery_document


class TestParseDiscoveryDocument:
    """Tests for parse_discovery_document()."""

    def _minimal_doc(self) -> dict:
        return {
            "agentgate_version": "0.1",
            "service_name": "Test Service",
        }

    def test_parses_minimal_document(self) -> None:
        doc = parse_discovery_document(self._minimal_doc())
        assert isinstance(doc, DiscoveryDocument)
        assert doc.agentgate_version == "0.1"
        assert doc.service_name == "Test Service"

    def test_default_endpoints(self) -> None:
        doc = parse_discovery_document(self._minimal_doc())
        assert doc.registration_endpoint == "/agentgate/register"
        assert doc.verification_endpoint == "/agentgate/register/verify"
        assert doc.auth_endpoint == "/agentgate/auth"

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
            parse_discovery_document({"agentgate_version": "0.1"})

    def test_empty_scopes(self) -> None:
        data = {**self._minimal_doc(), "scopes": []}
        doc = parse_discovery_document(data)
        assert doc.scopes == []
