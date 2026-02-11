"""Ed25519 cryptographic utilities for AgentDoor authentication.

Uses PyNaCl for Ed25519 keypair generation and message signing.
"""

from __future__ import annotations

import base64

from nacl.signing import SigningKey, VerifyKey


def generate_keypair() -> tuple[str, str]:
    """Generate an Ed25519 keypair.

    Returns:
        A tuple of (public_key_b64, secret_key_b64) where both values
        are base64-encoded strings.
    """
    signing_key = SigningKey.generate()
    public_key_bytes = signing_key.verify_key.encode()
    secret_key_bytes = signing_key.encode()

    public_key_b64 = base64.b64encode(public_key_bytes).decode("ascii")
    secret_key_b64 = base64.b64encode(secret_key_bytes).decode("ascii")

    return public_key_b64, secret_key_b64


def sign_message(message: str, secret_key_b64: str) -> str:
    """Sign a message using an Ed25519 secret key.

    Args:
        message: The message string to sign.
        secret_key_b64: The base64-encoded secret key.

    Returns:
        The base64-encoded signature string.
    """
    secret_key_bytes = base64.b64decode(secret_key_b64)
    signing_key = SigningKey(secret_key_bytes)
    signed = signing_key.sign(message.encode("utf-8"))
    signature_bytes = signed.signature
    return base64.b64encode(signature_bytes).decode("ascii")


def verify_signature(message: str, signature_b64: str, public_key_b64: str) -> bool:
    """Verify an Ed25519 signature.

    Args:
        message: The original message string.
        signature_b64: The base64-encoded signature.
        public_key_b64: The base64-encoded public key.

    Returns:
        True if the signature is valid, False otherwise.
    """
    try:
        public_key_bytes = base64.b64decode(public_key_b64)
        signature_bytes = base64.b64decode(signature_b64)
        verify_key = VerifyKey(public_key_bytes)
        verify_key.verify(message.encode("utf-8"), signature_bytes)
        return True
    except Exception:
        return False
