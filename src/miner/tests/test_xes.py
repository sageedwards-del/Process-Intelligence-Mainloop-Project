from __future__ import annotations

import gzip
from collections.abc import Callable
from pathlib import Path
from typing import Any

import pandas as pd
import pm4py
import pytest
from fastapi.testclient import TestClient

from throughline_miner.config import Settings
from throughline_miner.events import ACTIVITY, CASE, TIMESTAMP, from_csv

SETTINGS = Settings(auth_disabled=True)


@pytest.fixture
def invoice_df(invoice_csv_bytes: bytes) -> pd.DataFrame:
    return from_csv(invoice_csv_bytes, SETTINGS)


@pytest.fixture
def invoice_xes(tmp_path: Path, invoice_df: pd.DataFrame) -> Path:
    path = tmp_path / "invoice.xes"
    pm4py.write_xes(invoice_df, str(path), case_id_key=CASE)
    return path


def upload(client: TestClient, name: str, data: bytes, **params: str) -> Any:
    return client.post(
        "/import/xes", files={"file": (name, data, "application/xml")}, params=params
    )


def normalised(events: list[dict[str, Any]]) -> list[tuple[Any, ...]]:
    return sorted(
        (
            e["case_id"],
            e["activity"],
            pd.Timestamp(e["timestamp"]),
            e.get("resource"),
            float(e["amount"]),
            e["vendor"],
        )
        for e in events
    )


@pytest.mark.parametrize("compress", [False, True], ids=["xes", "xes.gz"])
def test_xes_round_trip(
    client: TestClient,
    invoice_xes: Path,
    invoice_events: list[dict[str, Any]],
    compress: bool,
) -> None:
    data = invoice_xes.read_bytes()
    name = "invoice.xes"
    if compress:
        data, name = gzip.compress(data), "invoice.xes.gz"

    resp = upload(client, name, data)

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert normalised(body["events"]) == normalised(invoice_events)
    assert body["stats"]["num_events"] == 40
    assert body["stats"]["num_cases"] == 7
    assert body["stats"]["num_activities"] == 6
    assert body["stats"]["dropped_events"] == 0
    assert {"amount", "vendor"} <= set(body["stats"]["attributes"])
    # Timestamps come back as ISO 8601 with an offset.
    assert body["events"][0]["timestamp"].endswith("Z")


def test_imported_events_feed_the_other_endpoints(client: TestClient, invoice_xes: Path) -> None:
    events = upload(client, "invoice.xes", invoice_xes.read_bytes()).json()["events"]
    resp = client.post("/discover/inductive", json={"events": events})
    assert resp.status_code == 200
    assert resp.json()["stats"]["num_variants"] == 3


def test_trace_attributes_lose_their_prefix(client: TestClient, tmp_path: Path) -> None:
    df = pd.DataFrame(
        {
            CASE: ["c1", "c1"],
            ACTIVITY: ["A", "B"],
            TIMESTAMP: pd.to_datetime(["2026-03-02T09:00:00Z", "2026-03-02T10:00:00Z"]),
            "case:department": ["Finance", "Finance"],
        }
    )
    path = tmp_path / "attrs.xes"
    pm4py.write_xes(df, str(path), case_id_key=CASE)

    events = upload(client, "attrs.xes", path.read_bytes()).json()["events"]

    assert [e["department"] for e in events] == ["Finance", "Finance"]


def test_lifecycle_filter(client: TestClient, tmp_path: Path) -> None:
    df = pd.DataFrame(
        {
            CASE: ["c1"] * 4,
            ACTIVITY: ["A", "A", "B", "B"],
            TIMESTAMP: pd.to_datetime(
                [
                    "2026-03-02T09:00:00Z",
                    "2026-03-02T09:30:00Z",
                    "2026-03-02T10:00:00Z",
                    "2026-03-02T10:30:00Z",
                ]
            ),
            "lifecycle:transition": ["start", "complete", "start", "complete"],
        }
    )
    path = tmp_path / "lifecycle.xes"
    pm4py.write_xes(df, str(path), case_id_key=CASE)
    data = path.read_bytes()

    complete = upload(client, "lifecycle.xes", data).json()
    every = upload(client, "lifecycle.xes", data, lifecycle="all").json()

    assert complete["stats"]["num_events"] == 2
    assert complete["stats"]["lifecycle_filtered_events"] == 2
    assert every["stats"]["num_events"] == 4


def test_lifecycle_all_keeps_transitions_and_event_ids(client: TestClient, tmp_path: Path) -> None:
    # The web app imports with lifecycle=all so start/complete pairs and event ids survive.
    df = pd.DataFrame(
        {
            CASE: ["c1", "c1", "c1"],
            ACTIVITY: ["A", "A", "B"],
            TIMESTAMP: pd.to_datetime(
                ["2026-03-02T09:00:00Z", "2026-03-02T09:30:00Z", "2026-03-02T10:00:00Z"]
            ),
            "lifecycle:transition": ["start", "complete", "complete"],
            "identity:id": ["e1", "e2", "e3"],
        }
    )
    path = tmp_path / "ids.xes"
    pm4py.write_xes(df, str(path), case_id_key=CASE)

    body = upload(client, "ids.xes", path.read_bytes(), lifecycle="all").json()

    assert [(e["lifecycle:transition"], e["identity:id"]) for e in body["events"]] == [
        ("start", "e1"),
        ("complete", "e2"),
        ("complete", "e3"),
    ]
    assert {"lifecycle:transition", "identity:id"} <= set(body["stats"]["attributes"])


def test_doctype_is_refused(client: TestClient) -> None:
    xxe = (
        b'<?xml version="1.0"?><!DOCTYPE log [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
        b'<log><trace><string key="concept:name" value="&x;"/></trace></log>'
    )
    resp = upload(client, "evil.xes", xxe)
    assert resp.status_code == 422
    assert "DOCTYPE" in resp.json()["detail"]


def test_gzip_bomb_is_capped(make_client: Callable[..., TestClient]) -> None:
    client = make_client(max_xes_uncompressed_bytes=64 * 1024)
    bomb = gzip.compress(b"<log>" + b" " * (10 * 1024 * 1024) + b"</log>")
    assert len(bomb) < 64 * 1024

    resp = upload(client, "bomb.xes.gz", bomb)

    assert resp.status_code == 413


def test_upload_size_is_capped(make_client: Callable[..., TestClient], invoice_xes: Path) -> None:
    client = make_client(max_payload_bytes=4096)
    assert upload(client, "invoice.xes", invoice_xes.read_bytes()).status_code == 413


@pytest.mark.parametrize(
    "data", [b"not xml at all", b"\x1f\x8bnot gzip", b"<log></log>"], ids=["text", "gz", "empty"]
)
def test_invalid_files(client: TestClient, data: bytes) -> None:
    assert upload(client, "bad.xes", data).status_code == 422
