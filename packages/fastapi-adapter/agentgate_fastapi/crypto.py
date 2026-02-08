"""Ed25519 verification helpers for the AgentGate FastAPI adapter.

Provides server-side signature verification using PyNaCl.
"""

from __future__ import annotations

import base64

from nacl.exceptions import BadSignatureError
from nacl.signing import VerifyKey


def verify_signature(message: str, signature_b64: str, public_key_b64: str) -> bool:
    """Verify an Ed25519 signature against a message and public key.

    Args:
        message: The original message that was signed.
        signature_b64: The base64-encoded signature.
        public_key_b64: The base64-encoded Ed25519 public key.

    Returns:
        ``True`` if the signature is valid, ``False`` otherwise.
    """
    try:
        public_key_bytes = base64.b64decode(public_key_b64)
        signature_bytes = base64.b64decode(signature_b64)
        verify_key = VerifyKey(public_key_bytes)
        verify_key.verify(message.encode("utf-8"), signature_bytes)
        return True
    except (BadSignatureError, Exception):
        return False


def is_timestamp_valid(timestamp: str, max_drift_seconds: int = 300) -> bool:
    """Check whether a signed timestamp is within acceptable drift.

    Args:
        timestamp: Unix timestamp as a string.
        max_drift_seconds: Maximum allowed clock drift in seconds.
            Defaults to 300 (5 minutes).

    Returns:
        ``True`` if the timestamp is within the acceptable window.
    """
    import time

    try:
        ts = int(timestamp)
    except (ValueError, TypeError):
        return False

    now = int(time.time())
    return abs(now - ts) <= max_drift_seconds
