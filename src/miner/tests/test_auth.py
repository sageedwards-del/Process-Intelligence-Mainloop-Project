from __future__ import annotations

import json
import time
from collections.abc import Callable
from typing import Any

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import ec, rsa
from fastapi.testclient import TestClient
from pydantic import ValidationError

from tests.conftest import Route
from throughline_miner.config import Settings

SECRET = "super-secret-jwt-token-with-at-least-32-characters"
SUPABASE_URL = "https://project.supabase.co"
ISSUER = f"{SUPABASE_URL}/auth/v1"
JWKS_URL = f"{ISSUER}/.well-known/jwks.json"

EVENT = {"case_id": "c1", "activity": "A", "timestamp": "2026-03-02T09:00:00Z"}


def claims(**overrides: Any) -> dict[str, Any]:
    now = int(time.time())
    return {
        "sub": "8d0f1f5e-0000-4000-8000-000000000001",
        "aud": "authenticated",
        "role": "authenticated",
        "iat": now,
        "exp": now + 3600,
        **overrides,
    }


def hs256(**overrides: Any) -> str:
    return jwt.encode(claims(**overrides), SECRET, algorithm="HS256")


def call(client: TestClient, token: str | None) -> int:
    headers = {"Authorization": f"Bearer {token}"} if token else {}
    resp = client.post("/discover/inductive", json={"events": [EVENT]}, headers=headers)
    status: int = resp.status_code
    return status


@pytest.fixture
def hs_client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client(auth_disabled=False, supabase_jwt_secret=SECRET)


def test_auth_config_is_required() -> None:
    with pytest.raises(ValidationError, match="AUTH_DISABLED"):
        Settings(auth_disabled=False)


def test_health_is_public(hs_client: TestClient) -> None:
    assert hs_client.get("/health").status_code == 200


def test_valid_hs256_token(hs_client: TestClient) -> None:
    assert call(hs_client, hs256()) == 200


@pytest.mark.parametrize(
    "token",
    [
        None,
        "not-a-jwt",
        hs256(exp=int(time.time()) - 3600),
        hs256(aud="anon"),
        jwt.encode(claims(), "a-different-secret-of-sufficient-length!!", algorithm="HS256"),
        jwt.encode(claims(), "", algorithm="none"),
        jwt.encode({k: v for k, v in claims().items() if k != "sub"}, SECRET, algorithm="HS256"),
    ],
    ids=["missing", "garbage", "expired", "anon-audience", "wrong-secret", "alg-none", "no-sub"],
)
def test_rejected_tokens(hs_client: TestClient, token: str | None) -> None:
    resp_status = call(hs_client, token)
    assert resp_status == 401


def test_401_has_www_authenticate(hs_client: TestClient) -> None:
    resp = hs_client.post("/discover/inductive", json={"events": [EVENT]})
    assert resp.headers["www-authenticate"] == "Bearer"


# --- JWKS (asymmetric signing keys) ------------------------------------------------------


@pytest.fixture
def rsa_key() -> rsa.RSAPrivateKey:
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def ec_key() -> ec.EllipticCurvePrivateKey:
    return ec.generate_private_key(ec.SECP256R1())


@pytest.fixture
def jwks_client(
    make_client: Callable[..., TestClient],
    routes: dict[str, Route],
    rsa_key: rsa.RSAPrivateKey,
    ec_key: ec.EllipticCurvePrivateKey,
) -> TestClient:
    rsa_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(rsa_key.public_key()))
    ec_jwk = json.loads(jwt.algorithms.ECAlgorithm.to_jwk(ec_key.public_key()))
    jwks = {
        "keys": [
            {**rsa_jwk, "kid": "rsa-1", "alg": "RS256", "use": "sig"},
            {**ec_jwk, "kid": "ec-1", "alg": "ES256", "use": "sig"},
        ]
    }
    routes[JWKS_URL] = lambda _: httpx.Response(200, json=jwks)
    return make_client(auth_disabled=False, supabase_url=SUPABASE_URL)


def test_valid_jwks_tokens(
    jwks_client: TestClient, rsa_key: rsa.RSAPrivateKey, ec_key: ec.EllipticCurvePrivateKey
) -> None:
    rs = jwt.encode(claims(iss=ISSUER), rsa_key, algorithm="RS256", headers={"kid": "rsa-1"})
    es = jwt.encode(claims(iss=ISSUER), ec_key, algorithm="ES256", headers={"kid": "ec-1"})
    assert call(jwks_client, rs) == 200
    assert call(jwks_client, es) == 200


def test_jwks_rejections(jwks_client: TestClient, rsa_key: rsa.RSAPrivateKey) -> None:
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    wrong_issuer = jwt.encode(
        claims(iss="https://evil.example/auth/v1"), rsa_key, "RS256", headers={"kid": "rsa-1"}
    )
    unknown_kid = jwt.encode(claims(iss=ISSUER), rsa_key, "RS256", headers={"kid": "nope"})
    wrong_key = jwt.encode(claims(iss=ISSUER), other_key, "RS256", headers={"kid": "rsa-1"})
    # SUPABASE_JWT_SECRET is not set, so HS256 is refused outright.
    hs = hs256(iss=ISSUER)

    for token in (wrong_issuer, unknown_kid, wrong_key, hs):
        assert call(jwks_client, token) == 401


def test_production_refuses_unsafe_settings() -> None:
    base = {"environment": "production", "supabase_url": "https://p.supabase.co"}
    with pytest.raises(ValueError, match="EVENTS_URL_ALLOWED_HOSTS"):
        Settings(**base)
    with pytest.raises(ValueError, match="AUTH_DISABLED"):
        Settings(**base, events_url_allowed_hosts="p.supabase.co", auth_disabled=True)
    with pytest.raises(ValueError, match="ALLOW_HTTP_URLS"):
        Settings(**base, events_url_allowed_hosts="p.supabase.co", allow_http_urls=True)
    ok = Settings(**base, events_url_allowed_hosts="p.supabase.co")
    assert ok.allowed_hosts == {"p.supabase.co"}
