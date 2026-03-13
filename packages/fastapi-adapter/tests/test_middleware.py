"""Tests for the AgentDoor FastAPI middleware.

Uses FastAPI TestClient (backed by httpx) to exercise the full
registration, verification, and authentication flow.
"""

from __future__ import annotations

import base64
import time

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from nacl.signing import SigningKey

from agentdoor_fastapi import AgentDoor, AgentDoorConfig, AgentContext


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _generate_keypair() -> tuple[str, str, SigningKey]:
    """Generate an Ed25519 keypair and return (pub_b64, sec_b64, signing_key)."""
    signing_key = SigningKey.generate()
    pub_b64 = base64.b64encode(signing_key.verify_key.encode()).decode()
    sec_b64 = base64.b64encode(signing_key.encode()).decode()
    return pub_b64, sec_b64, signing_key


def _sign(message: str, signing_key: SigningKey) -> str:
    """Sign a message and return the base64-encoded signature."""
    signed = signing_key.sign(message.encode("utf-8"))
    return base64.b64encode(signed.signature).decode()


def _create_app(config: AgentDoorConfig | None = None) -> tuple[FastAPI, AgentDoor]:
    """Create a test FastAPI app with AgentDoor mounted."""
    app = FastAPI()
    cfg = config or AgentDoorConfig(
        service_name="Test Service",
        scopes=[
            {"name": "read", "description": "Read access"},
            {"name": "write", "description": "Write access"},
        ],
        token_ttl_seconds=3600,
    )
    gate = AgentDoor(app, config=cfg)

    @app.get("/protected")
    async def protected(agent: AgentContext = Depends(gate.agent_required())):
        return {"agent_id": agent.agent_id, "agent_name": agent.agent_name}

    @app.get("/read-only")
    async def read_only(
        agent: AgentContext = Depends(gate.agent_required(scopes=["read"]))
    ):
        return {"ok": True}

    return app, gate


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestDiscovery:
    """Tests for GET /.well-known/agentdoor.json."""

    def test_returns_discovery_document(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        resp = client.get("/.well-known/agentdoor.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["service_name"] == "Test Service"
        assert data["agentdoor_version"] == "0.1"
        assert data["registration_endpoint"] == "/agentdoor/register"
        assert data["verification_endpoint"] == "/agentdoor/register/verify"
        assert data["auth_endpoint"] == "/agentdoor/auth"
        assert len(data["scopes"]) == 2

    def test_token_ttl_in_discovery(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        resp = client.get("/.well-known/agentdoor.json")
        assert resp.json()["token_ttl_seconds"] == 3600


class TestRegistration:
    """Tests for the registration flow."""

    def test_register_returns_challenge(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, _ = _generate_keypair()

        resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read"],
        })
        assert resp.status_code == 200
        data = resp.json()
        assert "registration_id" in data
        assert "challenge" in data

    def test_register_invalid_scopes(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, _ = _generate_keypair()

        resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["nonexistent"],
        })
        assert resp.status_code == 400
        assert "Invalid scopes" in resp.json()["detail"]

    def test_register_duplicate_key(self) -> None:
        """Registering same public key twice returns 409."""
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()

        # First registration + verify
        reg_resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read"],
        })
        reg_data = reg_resp.json()
        challenge = reg_data["challenge"]
        signature = _sign(challenge, signing_key)
        client.post("/agentdoor/register/verify", json={
            "registration_id": reg_data["registration_id"],
            "challenge": challenge,
            "signature": signature,
        })

        # Second registration with same key
        resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent-2",
            "public_key": pub,
            "scopes": ["read"],
        })
        assert resp.status_code == 409


class TestVerification:
    """Tests for the verification endpoint."""

    def test_full_registration_flow(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()

        # Step 1: Register
        reg_resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read"],
        })
        assert reg_resp.status_code == 200
        reg_data = reg_resp.json()

        # Step 2: Sign challenge and verify
        challenge = reg_data["challenge"]
        signature = _sign(challenge, signing_key)

        verify_resp = client.post("/agentdoor/register/verify", json={
            "registration_id": reg_data["registration_id"],
            "challenge": challenge,
            "signature": signature,
        })
        assert verify_resp.status_code == 200
        verify_data = verify_resp.json()
        assert "agent_id" in verify_data

    def test_verify_invalid_registration_id(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)

        resp = client.post("/agentdoor/register/verify", json={
            "registration_id": "nonexistent",
            "challenge": "whatever",
            "signature": "whatever",
        })
        assert resp.status_code == 404

    def test_verify_wrong_signature(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()

        # Register
        reg_resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read"],
        })
        reg_data = reg_resp.json()

        # Sign wrong message
        wrong_signature = _sign("wrong-message", signing_key)

        verify_resp = client.post("/agentdoor/register/verify", json={
            "registration_id": reg_data["registration_id"],
            "challenge": reg_data["challenge"],
            "signature": wrong_signature,
        })
        assert verify_resp.status_code == 401

    def test_verify_challenge_mismatch(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()

        reg_resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read"],
        })
        reg_data = reg_resp.json()

        # Send wrong challenge
        signature = _sign("wrong-challenge", signing_key)
        verify_resp = client.post("/agentdoor/register/verify", json={
            "registration_id": reg_data["registration_id"],
            "challenge": "wrong-challenge",
            "signature": signature,
        })
        assert verify_resp.status_code == 400


class TestAuthentication:
    """Tests for the auth endpoint."""

    def _register_agent(
        self, client: TestClient, signing_key: SigningKey, pub: str
    ) -> dict:
        """Helper: run the full registration flow and return verify data."""
        reg_resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read", "write"],
        })
        reg_data = reg_resp.json()
        challenge = reg_data["challenge"]
        signature = _sign(challenge, signing_key)
        verify_resp = client.post("/agentdoor/register/verify", json={
            "registration_id": reg_data["registration_id"],
            "challenge": challenge,
            "signature": signature,
        })
        return verify_resp.json()

    def test_auth_returns_token(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()
        agent_data = self._register_agent(client, signing_key, pub)

        timestamp = str(int(time.time()))
        signature = _sign(timestamp, signing_key)

        auth_resp = client.post("/agentdoor/auth", json={
            "agent_id": agent_data["agent_id"],
            "timestamp": timestamp,
            "signature": signature,
        })
        assert auth_resp.status_code == 200
        auth_data = auth_resp.json()
        assert "token" in auth_data
        assert auth_data["expires_in"] == 3600

    def test_auth_stale_timestamp(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()
        agent_data = self._register_agent(client, signing_key, pub)

        # Timestamp from 10 minutes ago (outside 5-minute window)
        stale_timestamp = str(int(time.time()) - 600)
        signature = _sign(stale_timestamp, signing_key)

        auth_resp = client.post("/agentdoor/auth", json={
            "agent_id": agent_data["agent_id"],
            "timestamp": stale_timestamp,
            "signature": signature,
        })
        assert auth_resp.status_code == 401

    def test_auth_unknown_agent(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        _, _, signing_key = _generate_keypair()

        timestamp = str(int(time.time()))
        signature = _sign(timestamp, signing_key)

        auth_resp = client.post("/agentdoor/auth", json={
            "agent_id": "nonexistent",
            "timestamp": timestamp,
            "signature": signature,
        })
        assert auth_resp.status_code == 401

    def test_auth_wrong_signature(self) -> None:
        """Auth with a different key's signature is rejected."""
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()
        agent_data = self._register_agent(client, signing_key, pub)

        # Sign with a different key
        _, _, wrong_key = _generate_keypair()
        timestamp = str(int(time.time()))
        signature = _sign(timestamp, wrong_key)

        auth_resp = client.post("/agentdoor/auth", json={
            "agent_id": agent_data["agent_id"],
            "timestamp": timestamp,
            "signature": signature,
        })
        assert auth_resp.status_code == 401


class TestProtectedRoutes:
    """Tests for agent_required dependency on protected routes."""

    def _get_token(
        self, client: TestClient, signing_key: SigningKey, pub: str
    ) -> str:
        """Helper: register + authenticate and return a bearer token."""
        reg_resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read", "write"],
        })
        reg_data = reg_resp.json()
        challenge = reg_data["challenge"]
        sig = _sign(challenge, signing_key)
        verify_resp = client.post("/agentdoor/register/verify", json={
            "registration_id": reg_data["registration_id"],
            "challenge": challenge,
            "signature": sig,
        })
        verify_data = verify_resp.json()

        timestamp = str(int(time.time()))
        ts_sig = _sign(timestamp, signing_key)
        auth_resp = client.post("/agentdoor/auth", json={
            "agent_id": verify_data["agent_id"],
            "timestamp": timestamp,
            "signature": ts_sig,
        })
        return auth_resp.json()["token"]

    def test_protected_route_with_valid_token(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()
        token = self._get_token(client, signing_key, pub)

        resp = client.get("/protected", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        data = resp.json()
        assert "agent_id" in data
        assert data["agent_name"] == "test-agent"

    def test_protected_route_without_token(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)

        resp = client.get("/protected")
        assert resp.status_code == 401

    def test_protected_route_with_invalid_token(self) -> None:
        app, _ = _create_app()
        client = TestClient(app)

        resp = client.get(
            "/protected",
            headers={"Authorization": "Bearer invalid-token"},
        )
        assert resp.status_code == 401

    def test_scope_enforcement(self) -> None:
        """Agent with read+write scopes can access read-only route."""
        app, _ = _create_app()
        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()
        token = self._get_token(client, signing_key, pub)

        resp = client.get(
            "/read-only",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 200

    def test_scope_enforcement_missing_scope(self) -> None:
        """Agent missing a required scope gets 403."""
        app = FastAPI()
        cfg = AgentDoorConfig(
            service_name="Test",
            scopes=[
                {"name": "read", "description": "Read"},
                {"name": "admin", "description": "Admin"},
            ],
        )
        gate = AgentDoor(app, config=cfg)

        @app.get("/admin-only")
        async def admin_only(
            agent: AgentContext = Depends(gate.agent_required(scopes=["admin"]))
        ):
            return {"ok": True}

        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()

        # Register with only "read" scope
        reg_resp = client.post("/agentdoor/register", json={
            "agent_name": "limited-agent",
            "public_key": pub,
            "scopes": ["read"],
        })
        reg_data = reg_resp.json()
        challenge = reg_data["challenge"]
        sig = _sign(challenge, signing_key)
        verify_resp = client.post("/agentdoor/register/verify", json={
            "registration_id": reg_data["registration_id"],
            "challenge": challenge,
            "signature": sig,
        })
        verify_data = verify_resp.json()

        timestamp = str(int(time.time()))
        ts_sig = _sign(timestamp, signing_key)
        auth_resp = client.post("/agentdoor/auth", json={
            "agent_id": verify_data["agent_id"],
            "timestamp": timestamp,
            "signature": ts_sig,
        })
        token = auth_resp.json()["token"]

        resp = client.get(
            "/admin-only",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 403
        assert "admin" in resp.json()["detail"]

    def test_expired_token_rejected(self) -> None:
        """An expired token should return 401."""
        app = FastAPI()
        cfg = AgentDoorConfig(
            service_name="Test",
            scopes=[{"name": "read", "description": "Read"}],
            token_ttl_seconds=0,  # Tokens expire immediately
        )
        gate = AgentDoor(app, config=cfg)

        @app.get("/protected")
        async def protected(
            agent: AgentContext = Depends(gate.agent_required())
        ):
            return {"ok": True}

        client = TestClient(app)
        pub, _, signing_key = _generate_keypair()

        # Full registration
        reg_resp = client.post("/agentdoor/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read"],
        })
        reg_data = reg_resp.json()
        challenge = reg_data["challenge"]
        sig = _sign(challenge, signing_key)
        verify_resp = client.post("/agentdoor/register/verify", json={
            "registration_id": reg_data["registration_id"],
            "challenge": challenge,
            "signature": sig,
        })
        verify_data = verify_resp.json()

        timestamp = str(int(time.time()))
        ts_sig = _sign(timestamp, signing_key)
        auth_resp = client.post("/agentdoor/auth", json={
            "agent_id": verify_data["agent_id"],
            "timestamp": timestamp,
            "signature": ts_sig,
        })
        token = auth_resp.json()["token"]

        # Wait for token to expire (TTL is 0)
        time.sleep(0.1)

        resp = client.get(
            "/protected",
            headers={"Authorization": f"Bearer {token}"},
        )
        assert resp.status_code == 401


class TestCustomRoutePrefix:
    """Tests for custom route prefix configuration."""

    def test_custom_prefix(self) -> None:
        """Routes should use the custom prefix."""
        app = FastAPI()
        cfg = AgentDoorConfig(
            service_name="Custom",
            scopes=[{"name": "read", "description": "Read"}],
            route_prefix="/custom/auth",
        )
        AgentDoor(app, config=cfg)

        client = TestClient(app)

        # Discovery should reflect custom prefix
        resp = client.get("/.well-known/agentdoor.json")
        assert resp.status_code == 200
        data = resp.json()
        assert data["registration_endpoint"] == "/custom/auth/register"
        assert data["auth_endpoint"] == "/custom/auth/auth"

        # Register should work at custom path
        pub, _, _ = _generate_keypair()
        reg_resp = client.post("/custom/auth/register", json={
            "agent_name": "test-agent",
            "public_key": pub,
            "scopes": ["read"],
        })
        assert reg_resp.status_code == 200


class TestMountRoutes:
    """Tests for mount_routes=False."""

    def test_no_routes_mounted(self) -> None:
        """When mount_routes=False, no routes should be added."""
        app = FastAPI()
        gate = AgentDoor(
            app,
            config=AgentDoorConfig(service_name="Test"),
            mount_routes=False,
        )

        client = TestClient(app)

        # Discovery route should not exist
        resp = client.get("/.well-known/agentdoor.json")
        assert resp.status_code == 404

        # But engine should still be accessible
        assert gate.engine is not None


class TestEngine:
    """Tests for the AgentEngine directly (no HTTP)."""

    @pytest.mark.asyncio
    async def test_engine_start_registration(self) -> None:
        from agentdoor_fastapi.engine import AgentEngine

        engine = AgentEngine(AgentDoorConfig(service_name="Test"))
        pub, _, _ = _generate_keypair()
        pending = await engine.start_registration("bot", pub)
        assert pending.registration_id.startswith("reg_")
        assert pending.challenge

    @pytest.mark.asyncio
    async def test_engine_full_flow(self) -> None:
        from agentdoor_fastapi.engine import AgentEngine

        engine = AgentEngine(AgentDoorConfig(service_name="Test"))
        pub, _, signing_key = _generate_keypair()

        # Register
        pending = await engine.start_registration("bot", pub)

        # Verify
        sig = _sign(pending.challenge, signing_key)
        agent = await engine.verify_registration(
            pending.registration_id, pending.challenge, sig
        )
        assert agent.agent_id.startswith("agent_")

        # Issue token
        ts = str(int(time.time()))
        ts_sig = _sign(ts, signing_key)
        token_record = await engine.issue_token(agent.agent_id, ts, ts_sig)
        assert token_record.token.startswith("agt_")

        # Validate token
        tr, ar = await engine.validate_token(token_record.token)
        assert tr.agent_id == agent.agent_id
        assert ar.agent_name == "bot"

    @pytest.mark.asyncio
    async def test_engine_update_metadata(self) -> None:
        from agentdoor_fastapi.engine import AgentEngine

        engine = AgentEngine(AgentDoorConfig(service_name="Test"))
        pub, _, signing_key = _generate_keypair()

        pending = await engine.start_registration("bot", pub)
        sig = _sign(pending.challenge, signing_key)
        agent = await engine.verify_registration(
            pending.registration_id, pending.challenge, sig
        )

        await engine.update_agent_metadata(
            agent.agent_id, {"friday_user_id": "uuid-123"}
        )

        updated = await engine.store.get_agent(agent.agent_id)
        assert updated is not None
        assert updated.metadata["friday_user_id"] == "uuid-123"
