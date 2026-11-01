"""Supabase JWT verification.

- HS256 tokens are checked against `SUPABASE_JWT_SECRET` (Supabase's legacy shared secret).
- RS256/ES256 tokens are checked against the project's JWKS at
  `<SUPABASE_URL>/auth/v1/.well-known/jwks.json` (Supabase's asymmetric signing keys).

The token's own `alg` header picks the path, but only from that fixed allowlist, and each
path needs its own configuration, so a token can never pick a weaker check.
"""

from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from typing import Any

import httpx
import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from .config import Settings

ASYMMETRIC_ALGORITHMS = frozenset({"RS256", "ES256"})
# A token whose `kid` is unknown triggers a JWKS refresh at most this often (key rotation).
_MIN_REFRESH_SECONDS = 30.0

bearer_scheme = HTTPBearer(
    auto_error=False,
    description="The signed-in user's Supabase access token.",
)


class AuthError(Exception):
    pass


@dataclass(frozen=True)
class Principal:
    """The authenticated caller."""

    user_id: str
    role: str | None = None
    email: str | None = None


class JwksCache:
    """Fetches and caches a JWKS document, refreshing on expiry or an unknown `kid`."""

    def __init__(self, url: str, http: httpx.AsyncClient, ttl_seconds: int) -> None:
        self._url = url
        self._http = http
        self._ttl = ttl_seconds
        self._keys: dict[str, jwt.PyJWK] = {}
        self._fetched_at = -float("inf")
        self._lock = asyncio.Lock()

    async def get(self, kid: str) -> jwt.PyJWK:
        now = time.monotonic()
        stale = now - self._fetched_at > self._ttl
        unknown_and_refreshable = (
            kid not in self._keys and now - self._fetched_at > _MIN_REFRESH_SECONDS
        )
        if stale or unknown_and_refreshable:
            await self._refresh()
        key = self._keys.get(kid)
        if key is None:
            raise AuthError("Token signing key is not in the project's JWKS.")
        return key

    async def _refresh(self) -> None:
        async with self._lock:
            try:
                resp = await self._http.get(self._url, timeout=10.0)
                resp.raise_for_status()
                jwk_set = jwt.PyJWKSet.from_dict(resp.json())
            except (httpx.HTTPError, ValueError, jwt.PyJWKSetError) as exc:
                if self._keys:  # keep serving with the last good keys
                    return
                raise AuthError("Could not load the project's JWKS.") from exc
            self._keys = {k.key_id: k for k in jwk_set.keys if k.key_id}
            self._fetched_at = time.monotonic()


class TokenVerifier:
    def __init__(self, settings: Settings, http: httpx.AsyncClient) -> None:
        self._settings = settings
        self._jwks = (
            JwksCache(
                settings.supabase_url.rstrip("/") + "/auth/v1/.well-known/jwks.json",
                http,
                settings.jwks_cache_seconds,
            )
            if settings.supabase_url
            else None
        )

    async def verify(self, token: str) -> Principal:
        try:
            header = jwt.get_unverified_header(token)
        except jwt.PyJWTError as exc:
            raise AuthError("Malformed token.") from exc

        alg = header.get("alg")
        key: Any
        if alg == "HS256":
            if self._settings.supabase_jwt_secret is None:
                raise AuthError("HS256 tokens are not accepted (SUPABASE_JWT_SECRET unset).")
            key = self._settings.supabase_jwt_secret.get_secret_value()
        elif alg in ASYMMETRIC_ALGORITHMS:
            if self._jwks is None:
                raise AuthError(f"{alg} tokens are not accepted (SUPABASE_URL unset).")
            kid = header.get("kid")
            if not isinstance(kid, str):
                raise AuthError("Token has no `kid` header.")
            key = (await self._jwks.get(kid)).key
        else:
            raise AuthError("Unsupported token algorithm.")

        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=[alg],
                audience=self._settings.jwt_audience,
                issuer=self._settings.supabase_issuer,
                options={"require": ["exp", "sub", "aud"]},
                leeway=30,
            )
        except jwt.PyJWTError as exc:
            raise AuthError(f"Invalid token: {exc}") from exc

        return Principal(
            user_id=str(claims["sub"]), role=claims.get("role"), email=claims.get("email")
        )


async def require_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> Principal | None:
    """FastAPI dependency: the verified caller, or None when AUTH_DISABLED=1."""
    settings: Settings = request.app.state.settings
    if settings.auth_disabled:
        return None
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise _unauthorized("Missing bearer token.")
    verifier: TokenVerifier = request.app.state.verifier
    try:
        return await verifier.verify(credentials.credentials)
    except AuthError as exc:
        raise _unauthorized(str(exc)) from exc


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )
