"""Tests for agentgate.crypto module."""

from __future__ import annotations

import base64

from agentgate.crypto import generate_keypair, sign_message, verify_signature


class TestGenerateKeypair:
    """Tests for generate_keypair()."""

    def test_returns_two_strings(self) -> None:
        public_key, secret_key = generate_keypair()
        assert isinstance(public_key, str)
        assert isinstance(secret_key, str)

    def test_keys_are_valid_base64(self) -> None:
        public_key, secret_key = generate_keypair()
        # Should not raise
        pub_bytes = base64.b64decode(public_key)
        sec_bytes = base64.b64decode(secret_key)
        # Ed25519 public keys are 32 bytes, secret keys are 32 bytes (seed)
        assert len(pub_bytes) == 32
        assert len(sec_bytes) == 32

    def test_generates_unique_keypairs(self) -> None:
        pub1, sec1 = generate_keypair()
        pub2, sec2 = generate_keypair()
        assert pub1 != pub2
        assert sec1 != sec2


class TestSignMessage:
    """Tests for sign_message()."""

    def test_produces_base64_signature(self) -> None:
        _, secret_key = generate_keypair()
        signature = sign_message("hello", secret_key)
        assert isinstance(signature, str)
        sig_bytes = base64.b64decode(signature)
        # Ed25519 signatures are 64 bytes
        assert len(sig_bytes) == 64

    def test_different_messages_produce_different_signatures(self) -> None:
        _, secret_key = generate_keypair()
        sig1 = sign_message("message one", secret_key)
        sig2 = sign_message("message two", secret_key)
        assert sig1 != sig2

    def test_same_message_same_key_produces_same_signature(self) -> None:
        _, secret_key = generate_keypair()
        sig1 = sign_message("deterministic", secret_key)
        sig2 = sign_message("deterministic", secret_key)
        assert sig1 == sig2


class TestVerifySignature:
    """Tests for verify_signature()."""

    def test_valid_signature_returns_true(self) -> None:
        public_key, secret_key = generate_keypair()
        message = "test message"
        signature = sign_message(message, secret_key)
        assert verify_signature(message, signature, public_key) is True

    def test_wrong_message_returns_false(self) -> None:
        public_key, secret_key = generate_keypair()
        signature = sign_message("original", secret_key)
        assert verify_signature("tampered", signature, public_key) is False

    def test_wrong_key_returns_false(self) -> None:
        _, secret_key = generate_keypair()
        other_public, _ = generate_keypair()
        signature = sign_message("hello", secret_key)
        assert verify_signature("hello", signature, other_public) is False

    def test_invalid_base64_returns_false(self) -> None:
        public_key, _ = generate_keypair()
        assert verify_signature("msg", "not-valid-b64!!!", public_key) is False
