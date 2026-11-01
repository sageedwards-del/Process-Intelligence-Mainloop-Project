"""The event contract: parse CSV or JSON events into a pm4py-ready DataFrame.

Contract (shared with the TypeScript engine): `case_id`, `activity`, `timestamp` (ISO 8601
with a UTC offset), optional `resource`, and any extra columns as attributes. Inside the
service they become pm4py's standard XES keys.
"""

from __future__ import annotations

import io
import re
from collections.abc import Iterable, Sequence

import httpx
import pandas as pd

from .config import Settings
from .errors import EventsUrlError, InvalidEventsError, PayloadTooLargeError, UpstreamFetchError
from .schemas import Event, LogStats

# pm4py's standard attribute keys.
CASE = "case:concept:name"
ACTIVITY = "concept:name"
TIMESTAMP = "time:timestamp"
RESOURCE = "org:resource"

CONTRACT_TO_PM4PY = {
    "case_id": CASE,
    "activity": ACTIVITY,
    "timestamp": TIMESTAMP,
    "resource": RESOURCE,
}
REQUIRED_COLUMNS = ("case_id", "activity", "timestamp")

# A trailing UTC offset: `Z`, `+01:00`, `-0500` or `+01`.
_OFFSET_RE = re.compile(r"(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$")
_MAX_ROWS_IN_ERROR = 5


def from_events(events: Sequence[Event], settings: Settings) -> pd.DataFrame:
    """Build a pm4py DataFrame from validated inline events."""
    _check_count(len(events), settings)
    rows = [
        {
            "case_id": e.case_id,
            "activity": e.activity,
            "timestamp": e.timestamp,
            "resource": e.resource,
            **(e.model_extra or {}),
        }
        for e in events
    ]
    df = pd.DataFrame.from_records(rows)
    if df.empty:
        raise InvalidEventsError("No events were provided.")
    # Pydantic has already required an offset on every timestamp.
    df["timestamp"] = pd.to_datetime(df["timestamp"], utc=True)
    if df["resource"].isna().all():
        df = df.drop(columns=["resource"])
    return _to_pm4py(df)


def from_csv(data: bytes, settings: Settings) -> pd.DataFrame:
    """Parse a CSV in the event contract into a pm4py DataFrame."""
    try:
        df = pd.read_csv(
            io.BytesIO(data),
            encoding="utf-8-sig",
            dtype={"case_id": str, "activity": str, "timestamp": str, "resource": str},
        )
    except (pd.errors.ParserError, pd.errors.EmptyDataError, UnicodeDecodeError) as exc:
        raise InvalidEventsError(f"Could not parse the events CSV: {exc}") from exc

    _check_count(len(df), settings)
    missing = [c for c in REQUIRED_COLUMNS if c not in df.columns]
    if missing:
        raise InvalidEventsError(f"The events CSV is missing required columns: {missing}.")
    if df.empty:
        raise InvalidEventsError("The events CSV has no rows.")

    for col in REQUIRED_COLUMNS:
        df[col] = df[col].str.strip()
    _require_values(df, REQUIRED_COLUMNS, first_line=2)

    naive = ~df["timestamp"].str.contains(_OFFSET_RE)
    if naive.any():
        raise InvalidEventsError(
            "Timestamps must be ISO 8601 with a UTC offset (e.g. 2026-03-02T09:00:00+00:00). "
            f"CSV lines without one: {_lines(df.index[naive], first_line=2)}."
        )
    parsed = pd.to_datetime(df["timestamp"], utc=True, format="ISO8601", errors="coerce")
    bad = parsed.isna()
    if bad.any():
        raise InvalidEventsError(
            f"Unparseable timestamps on CSV lines {_lines(df.index[bad], first_line=2)}."
        )
    df["timestamp"] = parsed
    return _to_pm4py(df)


async def fetch_csv(url: str, http: httpx.AsyncClient, settings: Settings) -> bytes:
    """Download `events_url`, enforcing https, the host allowlist and the size limit.

    Error messages never include the URL: a signed URL is a bearer credential.
    """
    parsed = httpx.URL(url)
    if parsed.scheme != "https":
        raise EventsUrlError("`events_url` must use https.")
    if settings.allowed_hosts and parsed.host.lower() not in settings.allowed_hosts:
        raise EventsUrlError(f"`events_url` host {parsed.host!r} is not allowed.")

    limit = settings.max_payload_bytes
    try:
        async with http.stream(
            "GET", url, timeout=settings.fetch_timeout_seconds, follow_redirects=False
        ) as resp:
            if resp.status_code != httpx.codes.OK:
                raise UpstreamFetchError(f"Fetching `events_url` returned HTTP {resp.status_code}.")
            declared = resp.headers.get("content-length")
            if declared and declared.isdigit() and int(declared) > limit:
                raise PayloadTooLargeError(f"`events_url` content exceeds {limit} bytes.")
            buf = bytearray()
            async for chunk in resp.aiter_bytes():
                buf.extend(chunk)
                if len(buf) > limit:
                    raise PayloadTooLargeError(f"`events_url` content exceeds {limit} bytes.")
    except httpx.HTTPError as exc:
        raise UpstreamFetchError(f"Fetching `events_url` failed ({type(exc).__name__}).") from exc
    return bytes(buf)


def log_stats(df: pd.DataFrame) -> LogStats:
    """Summary statistics of a pm4py DataFrame (sorted by case, then timestamp)."""
    by_case = df.groupby(CASE, sort=False)[ACTIVITY]
    return LogStats(
        num_cases=int(df[CASE].nunique()),
        num_events=len(df),
        num_activities=int(df[ACTIVITY].nunique()),
        num_variants=int(by_case.agg(tuple).nunique()),
        first_timestamp=df[TIMESTAMP].min().to_pydatetime(),
        last_timestamp=df[TIMESTAMP].max().to_pydatetime(),
        activities=_counts(df[ACTIVITY]),
        start_activities=_counts(by_case.first()),
        end_activities=_counts(by_case.last()),
    )


def case_variants(df: pd.DataFrame) -> pd.Series:
    """Activity sequence (a tuple) per case id."""
    return df.groupby(CASE, sort=False)[ACTIVITY].agg(tuple)


# --- helpers -----------------------------------------------------------------------------


def _to_pm4py(df: pd.DataFrame) -> pd.DataFrame:
    """Rename contract columns to pm4py keys and sort by case, then time."""
    clashes = [c for c in df.columns if c in CONTRACT_TO_PM4PY.values() or c.startswith("@@")]
    if clashes:
        raise InvalidEventsError(f"Attribute names reserved by the miner: {clashes}.")
    df = df.rename(columns=CONTRACT_TO_PM4PY)
    df[CASE] = df[CASE].astype(str)
    df[ACTIVITY] = df[ACTIVITY].astype(str)
    # Stable sort keeps the input order of events that share a timestamp.
    return df.sort_values([CASE, TIMESTAMP], kind="stable").reset_index(drop=True)


def _check_count(n: int, settings: Settings) -> None:
    if n > settings.max_events:
        raise PayloadTooLargeError(
            f"{n} events exceeds the limit of {settings.max_events} (MAX_EVENTS)."
        )


def _require_values(df: pd.DataFrame, columns: Iterable[str], first_line: int) -> None:
    for col in columns:
        blank = df[col].isna() | (df[col] == "")
        if blank.any():
            raise InvalidEventsError(
                f"`{col}` is empty on CSV lines {_lines(df.index[blank], first_line)}."
            )


def _lines(index: pd.Index, first_line: int) -> str:
    lines = [str(int(i) + first_line) for i in index[:_MAX_ROWS_IN_ERROR]]
    more = len(index) - _MAX_ROWS_IN_ERROR
    return ", ".join(lines) + (f" and {more} more" if more > 0 else "")


def _counts(values: pd.Series) -> dict[str, int]:
    return {str(k): int(v) for k, v in values.value_counts().items()}
