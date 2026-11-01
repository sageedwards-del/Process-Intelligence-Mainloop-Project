"""The TypeScript engine and pm4py must discover the same directly-follows graph.

`npm run datagen` writes the engine's DFG for the Meridian sample to
data/sample/meridian-invoices.dfg.json (kept current by src/datagen/test/dfgContract.test.ts).
This test discovers the DFG from the same CSV with pm4py and compares frequencies, start and
end activities, and wait statistics in calendar and business hours.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pm4py
import pytest

from throughline_miner.config import Settings
from throughline_miner.events import from_csv

SAMPLE = Path(__file__).resolve().parents[3] / "data" / "sample"
STATS = ("min", "max", "mean", "median")


@pytest.fixture(scope="module")
def contract() -> dict[str, Any]:
    data: dict[str, Any] = json.loads((SAMPLE / "meridian-invoices.dfg.json").read_text())
    return data


@pytest.fixture(scope="module")
def df() -> Any:
    return from_csv((SAMPLE / "meridian-invoices.csv").read_bytes(), Settings(auth_disabled=True))


def _edges(contract: dict[str, Any]) -> dict[tuple[str, str], dict[str, Any]]:
    return {(e["from"], e["to"]): e for e in contract["edges"]}


def test_frequencies_and_endpoints_match(contract: dict[str, Any], df: Any) -> None:
    dfg, start, end = pm4py.discover_dfg(df)
    assert {k: e["frequency"] for k, e in _edges(contract).items()} == dict(dfg)
    assert contract["start"] == dict(start)
    assert contract["end"] == dict(end)
    assert contract["caseCount"] == df["case:concept:name"].nunique()
    assert contract["eventCount"] == len(df)


def test_calendar_waits_match(contract: dict[str, Any], df: Any) -> None:
    perf, _, _ = pm4py.discover_performance_dfg(df)
    edges = _edges(contract)
    assert set(edges) == set(perf)
    for key, edge in edges.items():
        for stat in STATS:
            assert edge["seconds"][stat] == pytest.approx(perf[key][stat], rel=1e-9), (key, stat)
        assert edge["seconds"]["total"] == pytest.approx(perf[key]["sum"], rel=1e-9), key


def test_business_hour_waits_match(contract: dict[str, Any], df: Any) -> None:
    # pm4py's default business-hour slots are Monday-Friday, 07:00-17:00 UTC.
    assert contract["workCalendar"] == {
        "workDays": [1, 2, 3, 4, 5],
        "startHour": 7,
        "endHour": 17,
        "utcOffsetMinutes": 0,
    }
    perf, _, _ = pm4py.discover_performance_dfg(df, business_hours=True)
    for key, edge in _edges(contract).items():
        for stat in STATS:
            expected = pytest.approx(perf[key][stat], rel=1e-9)
            assert edge["workingSeconds"][stat] == expected, (key, stat)
