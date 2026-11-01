"""The event contract: CSV/JSON parsing and validation."""

from __future__ import annotations

from typing import Any

import pandas as pd
import pytest

from throughline_miner.config import Settings
from throughline_miner.errors import InvalidEventsError, PayloadTooLargeError
from throughline_miner.events import ACTIVITY, CASE, RESOURCE, TIMESTAMP, from_csv, from_events
from throughline_miner.schemas import Event

SETTINGS = Settings(auth_disabled=True)
HEADER = "case_id,activity,timestamp,resource\n"


def test_csv_maps_contract_to_pm4py_keys(invoice_csv_bytes: bytes) -> None:
    df = from_csv(invoice_csv_bytes, SETTINGS)

    assert {CASE, ACTIVITY, TIMESTAMP, RESOURCE, "amount", "vendor"} <= set(df.columns)
    assert len(df) == 40
    assert str(df[TIMESTAMP].dt.tz) == "UTC"
    # -05:00 offsets are converted, not dropped.
    first_1002 = df[df[CASE] == "INV-1002"][TIMESTAMP].iloc[0]
    assert first_1002 == pd.Timestamp("2026-03-03T13:15:00Z")


def test_csv_and_json_give_the_same_frame(
    invoice_csv_bytes: bytes, invoice_events: list[dict[str, Any]]
) -> None:
    from_file = from_csv(invoice_csv_bytes, SETTINGS)
    from_json = from_events([Event.model_validate(e) for e in invoice_events], SETTINGS)

    cols = [CASE, ACTIVITY, TIMESTAMP, RESOURCE]
    pd.testing.assert_frame_equal(from_file[cols], from_json[cols], check_dtype=False)


@pytest.mark.parametrize(
    "ts", ["2026-03-02T09:00:00Z", "2026-03-02T09:00:00+0100", "2026-03-02T09:00:00.123-05:00"]
)
def test_accepted_offsets(ts: str) -> None:
    df = from_csv(f"{HEADER}c1,A,{ts},r\n".encode(), SETTINGS)
    assert len(df) == 1


def test_timestamps_without_offset_are_rejected() -> None:
    data = f"{HEADER}c1,A,2026-03-02T09:00:00+00:00,r\nc1,B,2026-03-02T10:00:00,r\n".encode()
    with pytest.raises(InvalidEventsError, match="lines without one: 3"):
        from_csv(data, SETTINGS)


def test_unparseable_timestamps_are_rejected() -> None:
    data = f"{HEADER}c1,A,yesterday+01:00,r\n".encode()
    with pytest.raises(InvalidEventsError, match="Unparseable"):
        from_csv(data, SETTINGS)


def test_missing_columns_are_rejected() -> None:
    with pytest.raises(InvalidEventsError, match="activity"):
        from_csv(b"case_id,timestamp\nc1,2026-03-02T09:00:00Z\n", SETTINGS)


def test_blank_required_values_are_rejected() -> None:
    data = f"{HEADER}c1,,2026-03-02T09:00:00Z,r\n".encode()
    with pytest.raises(InvalidEventsError, match="`activity` is empty on CSV lines 2"):
        from_csv(data, SETTINGS)


def test_reserved_attribute_names_are_rejected() -> None:
    event = Event.model_validate(
        {"case_id": "c", "activity": "A", "timestamp": "2026-03-02T09:00:00Z", "concept:name": "x"}
    )
    with pytest.raises(InvalidEventsError, match="reserved"):
        from_events([event], SETTINGS)


def test_json_events_require_an_offset() -> None:
    with pytest.raises(ValueError, match="timezone"):
        Event.model_validate({"case_id": "c", "activity": "A", "timestamp": "2026-03-02T09:00:00"})


def test_event_count_limit(invoice_csv_bytes: bytes) -> None:
    with pytest.raises(PayloadTooLargeError):
        from_csv(invoice_csv_bytes, Settings(auth_disabled=True, max_events=39))


def test_events_sorted_by_case_then_time_stably() -> None:
    data = (
        f"{HEADER}"
        "c2,B,2026-03-02T10:00:00Z,r\n"
        "c1,Y,2026-03-02T09:00:00Z,r\n"
        "c1,X,2026-03-02T09:00:00Z,r\n"
        "c1,W,2026-03-02T08:00:00Z,r\n"
    ).encode()
    df = from_csv(data, SETTINGS)
    assert df[ACTIVITY].tolist() == ["W", "Y", "X", "B"]
