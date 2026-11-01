"""Runtime configuration, read from environment variables."""

from __future__ import annotations

from pydantic import Field, SecretStr, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

MIB = 1024 * 1024


class Settings(BaseSettings):
    """Service settings. Every field maps to the upper-cased environment variable."""

    model_config = SettingsConfigDict(extra="ignore", frozen=True)

    # --- auth -----------------------------------------------------------------------
    auth_disabled: bool = Field(
        default=False,
        description="AUTH_DISABLED=1 skips JWT verification. Local development and tests only.",
    )
    supabase_url: str | None = Field(
        default=None,
        description="Supabase project URL. Enables JWKS verification (RS256/ES256) "
        "and pins the token issuer to <SUPABASE_URL>/auth/v1.",
    )
    supabase_jwt_secret: SecretStr | None = Field(
        default=None,
        description="Supabase legacy JWT secret, used for HS256 tokens.",
    )
    jwt_audience: str = Field(
        default="authenticated",
        description="Required `aud` claim. Supabase issues `authenticated` for signed-in users.",
    )
    jwks_cache_seconds: int = Field(default=600, ge=0)

    # --- limits ---------------------------------------------------------------------
    max_events: int = Field(
        default=250_000, ge=1, description="Maximum events accepted per request."
    )
    max_payload_bytes: int = Field(
        default=50 * MIB,
        ge=1024,
        description="Maximum request body, downloaded CSV or uploaded XES file size in bytes.",
    )
    max_xes_uncompressed_bytes: int = Field(
        default=512 * MIB,
        ge=1024,
        description="Maximum size of an .xes.gz upload after decompression.",
    )

    # --- events_url fetching ----------------------------------------------------------
    events_url_allowed_hosts: str = Field(
        default="",
        description="Comma-separated host allowlist for `events_url` (e.g. "
        "`abcd.supabase.co`). Empty allows any https host.",
    )
    fetch_timeout_seconds: float = Field(default=30.0, gt=0)

    # --- misc -----------------------------------------------------------------------
    source_url: str | None = Field(
        default=None,
        description="Public URL of this service's source code, reported by /health. "
        "pm4py is AGPL-3.0, so a network deployment must offer its source.",
    )

    @property
    def allowed_hosts(self) -> frozenset[str]:
        return frozenset(
            h.strip().lower() for h in self.events_url_allowed_hosts.split(",") if h.strip()
        )

    @property
    def supabase_issuer(self) -> str | None:
        if self.supabase_url is None:
            return None
        return self.supabase_url.rstrip("/") + "/auth/v1"

    @model_validator(mode="after")
    def _auth_is_configured(self) -> Settings:
        if (
            not self.auth_disabled
            and self.supabase_url is None
            and self.supabase_jwt_secret is None
        ):
            raise ValueError(
                "Auth is enabled but neither SUPABASE_URL nor SUPABASE_JWT_SECRET is set. "
                "Set one of them, or AUTH_DISABLED=1 for local development."
            )
        return self
