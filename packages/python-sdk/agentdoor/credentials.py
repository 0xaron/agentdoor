"""Credential storage for AgentDoor agent identities and tokens.

Provides both in-memory and file-based credential stores for persisting
agent keypairs, API keys, and authentication tokens across sessions.
"""

from __future__ import annotations

import json
import os
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any


@dataclass
class Credential:
    """Stored credential for an agent identity on a specific service."""

    service_url: str
    agent_id: str
    public_key: str
    secret_key: str
    api_key: str | None = None
    token: str | None = None
    token_expires_at: float | None = None
    scopes: list[str] = field(default_factory=list)

    def is_token_valid(self, now: float | None = None) -> bool:
        """Check whether the current token is still valid.

        Args:
            now: The current unix timestamp.  If ``None``, ``time.time()``
                is used.

        Returns:
            ``True`` if a token is present and has not expired.
        """
        if self.token is None or self.token_expires_at is None:
            return False
        if now is None:
            import time
            now = time.time()
        # Add a small buffer (30 seconds) to avoid using nearly-expired tokens
        return now < (self.token_expires_at - 30)

    def to_dict(self) -> dict[str, Any]:
        """Serialize the credential to a plain dictionary."""
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> Credential:
        """Deserialize a credential from a plain dictionary."""
        return cls(**{k: v for k, v in data.items() if k in cls.__dataclass_fields__})


class CredentialStore(ABC):
    """Abstract base class for credential stores."""

    @abstractmethod
    def get(self, service_url: str) -> Credential | None:
        """Retrieve a credential for the given service URL.

        Args:
            service_url: The base URL of the service.

        Returns:
            The stored Credential, or ``None`` if not found.
        """
        ...

    @abstractmethod
    def save(self, credential: Credential) -> None:
        """Persist a credential.

        Args:
            credential: The credential to store.
        """
        ...

    @abstractmethod
    def delete(self, service_url: str) -> None:
        """Remove a stored credential.

        Args:
            service_url: The base URL of the service whose credential
                should be deleted.
        """
        ...

    @abstractmethod
    def list_services(self) -> list[str]:
        """Return a list of all service URLs with stored credentials."""
        ...


class InMemoryCredentialStore(CredentialStore):
    """In-memory credential store.  Data is lost when the process exits."""

    def __init__(self) -> None:
        self._store: dict[str, Credential] = {}

    def get(self, service_url: str) -> Credential | None:
        return self._store.get(self._normalize(service_url))

    def save(self, credential: Credential) -> None:
        self._store[self._normalize(credential.service_url)] = credential

    def delete(self, service_url: str) -> None:
        self._store.pop(self._normalize(service_url), None)

    def list_services(self) -> list[str]:
        return list(self._store.keys())

    @staticmethod
    def _normalize(url: str) -> str:
        return url.rstrip("/")


class FileCredentialStore(CredentialStore):
    """File-based credential store.

    Persists credentials to ``~/.agentdoor/credentials.json`` by default.
    The file is created with restricted permissions (600) to protect
    secret key material.
    """

    DEFAULT_PATH = Path.home() / ".agentdoor" / "credentials.json"

    def __init__(self, path: str | Path | None = None) -> None:
        self._path = Path(path) if path else self.DEFAULT_PATH
        self._cache: dict[str, Credential] | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def get(self, service_url: str) -> Credential | None:
        data = self._load()
        return data.get(self._normalize(service_url))

    def save(self, credential: Credential) -> None:
        data = self._load()
        data[self._normalize(credential.service_url)] = credential
        self._flush(data)

    def delete(self, service_url: str) -> None:
        data = self._load()
        data.pop(self._normalize(service_url), None)
        self._flush(data)

    def list_services(self) -> list[str]:
        return list(self._load().keys())

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _load(self) -> dict[str, Credential]:
        if self._cache is not None:
            return self._cache

        if not self._path.exists():
            self._cache = {}
            return self._cache

        with open(self._path, "r") as fh:
            raw: dict[str, Any] = json.load(fh)

        self._cache = {
            url: Credential.from_dict(cred_data)
            for url, cred_data in raw.items()
        }
        return self._cache

    def _flush(self, data: dict[str, Credential]) -> None:
        self._cache = data
        self._path.parent.mkdir(parents=True, exist_ok=True)

        serializable = {url: cred.to_dict() for url, cred in data.items()}
        with open(self._path, "w") as fh:
            json.dump(serializable, fh, indent=2)

        # Restrict permissions to owner-only read/write
        try:
            os.chmod(self._path, 0o600)
        except OSError:
            pass  # Silently ignore on platforms that don't support chmod

    @staticmethod
    def _normalize(url: str) -> str:
        return url.rstrip("/")
