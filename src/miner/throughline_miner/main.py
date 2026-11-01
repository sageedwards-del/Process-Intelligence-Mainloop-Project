"""HTTP layer: the FastAPI app, its routes and error mapping.

Run with `uvicorn --factory throughline_miner.main:create_app`.
"""

from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

import httpx
import pandas as pd
from fastapi import Depends, FastAPI, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from . import __version__, events, mining, xes
from .auth import Principal, TokenVerifier, require_user
from .config import Settings
from .errors import MinerError, PayloadTooLargeError
from .schemas import (
    ConformanceRequest,
    ConformanceResponse,
    DiscoverRequest,
    DiscoverResponse,
    EventSource,
    HealthResponse,
    ImportResponse,
    ReferenceInfo,
)

logger = logging.getLogger("throughline_miner")

User = Annotated[Principal | None, Depends(require_user)]


def create_app(
    settings: Settings | None = None,
    http_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Build the app. Tests pass `settings` and a mock `http_transport`."""
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        async with httpx.AsyncClient(
            transport=http_transport, headers={"User-Agent": f"throughline-miner/{__version__}"}
        ) as http:
            app.state.http = http
            app.state.verifier = TokenVerifier(settings, http)
            if settings.auth_disabled:
                logger.warning("AUTH_DISABLED=1: requests are not authenticated.")
            yield

    app = FastAPI(
        title="Throughline miner",
        version=__version__,
        summary="Process-mining worker for Throughline, built on pm4py.",
        description=(
            "Inductive Miner discovery, token-replay conformance and XES import. "
            "Called by the Throughline Next.js server with the user's Supabase access token."
        ),
        lifespan=lifespan,
    )
    app.state.settings = settings
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_payload_bytes)

    @app.exception_handler(MinerError)
    async def _miner_error(_: Request, exc: MinerError) -> JSONResponse:
        return JSONResponse(status_code=exc.status_code, content={"detail": str(exc)})

    @app.get("/health", tags=["meta"])
    async def health() -> HealthResponse:
        """Liveness probe. Unauthenticated."""
        import pm4py

        return HealthResponse(
            status="ok",
            version=__version__,
            pm4py_version=pm4py.__version__,
            source_url=settings.source_url,
        )

    @app.post("/discover/inductive", tags=["mining"], responses=_ERRORS)
    async def discover_inductive(
        body: DiscoverRequest, request: Request, _: User
    ) -> DiscoverResponse:
        """Discover a process model with the Inductive Miner (IMf when `noise_threshold` > 0).

        Returns BPMN 2.0 XML with diagram layout (render it with bpmn-js), the process tree,
        and log statistics.
        """
        df = await _load_events(body, request)
        return await run_in_threadpool(mining.discover_inductive, df, body.noise_threshold)

    @app.post("/conformance/token-replay", tags=["mining"], responses=_ERRORS)
    async def conformance_token_replay(
        body: ConformanceRequest, request: Request, _: User
    ) -> ConformanceResponse:
        """Replay every case on a reference model and report fitness.

        The reference is either `bpmn_xml` or `happy_variants` (a model is discovered from
        the cases that follow one of those activity sequences). Weekly rates group cases by
        the ISO week, in UTC, of their first event.
        """
        df = await _load_events(body, request)

        def run() -> ConformanceResponse:
            # The request model guarantees exactly one of the two references.
            if body.happy_variants is not None:
                model, reference = mining.model_from_happy_variants(df, body.happy_variants)
            else:
                model = mining.model_from_bpmn_xml(body.bpmn_xml or "")
                reference = ReferenceInfo(source="bpmn_xml")
            return mining.replay(df, model, reference)

        return await run_in_threadpool(run)

    @app.post("/import/xes", tags=["import"], responses=_ERRORS)
    async def import_xes(
        _: User,
        file: Annotated[UploadFile, File(description="An .xes or .xes.gz event log.")],
        lifecycle: Annotated[
            xes.LifecycleMode,
            Query(
                description="`complete` keeps only events whose lifecycle:transition is "
                "complete (or absent), as most mining tools do. `all` keeps every event."
            ),
        ] = "complete",
    ) -> ImportResponse:
        """Import an XES log and return its events in the Throughline event contract."""
        data = await _read_upload(file, settings.max_payload_bytes)
        return await run_in_threadpool(xes.import_xes, data, settings, lifecycle)

    return app


_ERRORS: dict[int | str, dict[str, str]] = {
    400: {"description": "Bad `events_url` (not https or not an allowed host)."},
    401: {"description": "Missing or invalid Supabase access token."},
    413: {"description": "Body, file or event count over the configured limit."},
    422: {"description": "Events or reference model do not satisfy the contract."},
    502: {"description": "Fetching `events_url` failed."},
}


async def _load_events(body: EventSource, request: Request) -> pd.DataFrame:
    settings: Settings = request.app.state.settings
    # The request model guarantees exactly one of the two sources.
    if body.events_url is None:
        return await run_in_threadpool(events.from_events, body.events or [], settings)
    data = await events.fetch_csv(str(body.events_url), request.app.state.http, settings)
    return await run_in_threadpool(events.from_csv, data, settings)


async def _read_upload(file: UploadFile, limit: int) -> bytes:
    buf = bytearray()
    while chunk := await file.read(1024 * 1024):
        buf.extend(chunk)
        if len(buf) > limit:
            raise PayloadTooLargeError(f"Upload exceeds {limit} bytes (MAX_PAYLOAD_BYTES).")
    return bytes(buf)


class BodySizeLimitMiddleware:
    """Reject request bodies over `max_bytes` with 413, whether or not Content-Length is set."""

    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        too_large = JSONResponse(
            status_code=413,
            content={"detail": f"Request body exceeds {self.max_bytes} bytes (MAX_PAYLOAD_BYTES)."},
        )
        for name, value in scope.get("headers", []):
            if name == b"content-length" and value.isdigit() and int(value) > self.max_bytes:
                await too_large(scope, receive, send)
                return

        received = 0
        response_started = False

        async def limited_receive() -> Message:
            nonlocal received
            message = await receive()
            if message["type"] == "http.request":
                received += len(message.get("body", b""))
                if received > self.max_bytes:
                    raise _BodyTooLarge(self.max_bytes)
            return message

        async def tracking_send(message: Message) -> None:
            nonlocal response_started
            if message["type"] == "http.response.start":
                response_started = True
            await send(message)

        try:
            await self.app(scope, limited_receive, tracking_send)
        except _BodyTooLarge:
            if not response_started:
                await too_large(scope, receive, send)


class _BodyTooLarge(StarletteHTTPException):
    """Raised mid-stream. An HTTPException so FastAPI's body parsing re-raises it as is."""

    def __init__(self, max_bytes: int) -> None:
        super().__init__(
            status_code=413,
            detail=f"Request body exceeds {max_bytes} bytes (MAX_PAYLOAD_BYTES).",
        )
