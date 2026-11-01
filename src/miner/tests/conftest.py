from __future__ import annotations

import csv
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from throughline_miner.config import Settings
from throughline_miner.main import create_app

FIXTURES = Path(__file__).parent / "fixtures"
INVOICE_CSV = FIXTURES / "invoice_approval.csv"

HAPPY_VARIANT = ["Receive Invoice", "Check Invoice", "Approve", "Pay"]
HAPPY_CASES = {"INV-1001", "INV-1002", "INV-1004", "INV-1006"}
REWORK_CASES = {"INV-1003", "INV-1005", "INV-1007"}

STORAGE_HOST = "project.supabase.co"
EVENTS_URL = f"https://{STORAGE_HOST}/storage/v1/object/sign/logs/invoice.csv?token=signed"

Route = Callable[[httpx.Request], httpx.Response]


@pytest.fixture
def invoice_csv_bytes() -> bytes:
    return INVOICE_CSV.read_bytes()


@pytest.fixture
def invoice_events() -> list[dict[str, Any]]:
    """The fixture CSV as contract JSON events."""
    with INVOICE_CSV.open(newline="") as fh:
        rows = list(csv.DictReader(fh))
    for row in rows:
        row["amount"] = float(row["amount"])
    return rows


@pytest.fixture
def routes(invoice_csv_bytes: bytes) -> dict[str, Route]:
    """Outbound HTTP handled by the mock transport, keyed by URL without query."""
    return {
        f"https://{STORAGE_HOST}/storage/v1/object/sign/logs/invoice.csv": lambda _: httpx.Response(
            200, content=invoice_csv_bytes, headers={"content-type": "text/csv"}
        )
    }


@pytest.fixture
def transport(routes: dict[str, Route]) -> httpx.MockTransport:
    def handler(request: httpx.Request) -> httpx.Response:
        url = str(request.url.copy_with(query=None))
        if url in routes:
            return routes[url](request)
        return httpx.Response(404)

    return httpx.MockTransport(handler)


@pytest.fixture
def make_client(transport: httpx.MockTransport) -> Iterator[Callable[..., TestClient]]:
    clients: list[TestClient] = []

    def factory(**overrides: Any) -> TestClient:
        settings = Settings(**{"auth_disabled": True, **overrides})
        client = TestClient(create_app(settings, http_transport=transport))
        client.__enter__()  # run the lifespan
        clients.append(client)
        return client

    yield factory
    for client in clients:
        client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[..., TestClient]) -> TestClient:
    return make_client()
