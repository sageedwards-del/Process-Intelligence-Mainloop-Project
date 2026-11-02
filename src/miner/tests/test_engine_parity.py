"""The TypeScript engine and pm4py must discover the same directly-follows graph.

`npm run datagen` writes the engine's DFG for the Meridian sample to
data/sample/meridian-invoices.dfg.json (kept current by src/datagen/test/dfgContract.test.ts).
This test discovers the DFG from the same CSV with pm4py and compares frequencies, start and
end activities, and wait statistics in calendar and business hours.

The same checks run on data/sample/same-timestamp.csv: date-only and batch timestamps in a
shuffled file, so events sharing a timestamp are ordered by file position in both tools.
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


LOGS = ("meridian-invoices", "same-timestamp")


@pytest.fixture(scope="module", params=LOGS)
def log_name(request: pytest.FixtureRequest) -> str:
    name: str = request.param
    return name


@pytest.fixture(scope="module")
def contract(log_name: str) -> dict[str, Any]:
    data: dict[str, Any] = json.loads((SAMPLE / f"{log_name}.dfg.json").read_text())
    return data


@pytest.fixture(scope="module")
def df(log_name: str) -> Any:
    return from_csv((SAMPLE / f"{log_name}.csv").read_bytes(), Settings(auth_disabled=True))


def test_tie_fixture_has_ties(log_name: str, df: Any) -> None:
    if log_name != "same-timestamp":
        pytest.skip("only the tie fixture must contain ties")
    tied = df.duplicated(["case:concept:name", "time:timestamp"], keep=False)
    assert tied.sum() > 500
    assert (df["time:timestamp"].dt.strftime("%H:%M:%S") == "00:00:00").mean() > 0.2


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
