"""API-key RBAC for the Crime Analytics API.

Person-level (offender / co-accused network) endpoints are gated to analyst+ per the
Phase 0 governance split. When no keys are configured (dev) all access is open so the
demo runs without setup; configure CRIME_API_KEYS to enforce.

Keys are never held in plaintext: config stores sha256(key) -> role, and lookup is a
constant-time digest comparison so response timing cannot be used to probe for a
valid key one character at a time.
"""
from __future__ import annotations

import hmac
from typing import Callable

from fastapi import Header, HTTPException, status

from . import config


class Identity(dict):
    """Resolved caller identity: {"role", "authenticated", "mode"}."""

    @property
    def role(self) -> str | None:
        return self["role"]


_OPEN_IDENTITY = Identity(role="admin", authenticated=False, mode="open")


def identify(x_api_key: str | None) -> Identity:
    """Resolve an API key to an Identity. Dev mode (no keys configured) => open."""
    if not config.AUTH_ENABLED:
        return _OPEN_IDENTITY

    presented = config._hash_key(x_api_key or "")
    # Compare against every configured key so the work done - and therefore the
    # response time - does not depend on which key (if any) matched.
    matched: str | None = None
    for known_hash, role in config.API_KEY_HASHES.items():
        if hmac.compare_digest(presented, known_hash):
            matched = role
    if matched is None:
        return Identity(role=None, authenticated=False, mode="enforced")
    return Identity(role=matched, authenticated=True, mode="enforced")


def require_role(min_role: str) -> Callable[..., Identity]:
    """FastAPI dependency factory: require >= min_role (no-op in dev/open mode)."""

    def dependency(
        x_api_key: str | None = Header(default=None, alias="X-API-Key"),
    ) -> Identity:
        who = identify(x_api_key)
        if not config.AUTH_ENABLED:
            return who
        if who.role is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="missing or invalid X-API-Key",
                headers={"WWW-Authenticate": "ApiKey"},
            )
        if config.role_rank(who.role) < config.role_rank(min_role):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"requires role '{min_role}' or higher",
            )
        return who

    return dependency


analyst_required = require_role("analyst")
