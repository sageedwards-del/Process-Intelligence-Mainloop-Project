"""XES import: read .xes / .xes.gz and normalise to the event contract."""

from __future__ import annotations

import gzip
import math
import os
import re
import tempfile
import zlib
from datetime import datetime
from typing import Any, Literal

import pandas as pd
import pm4py

from .config import Settings
from .errors import InvalidEventsError, PayloadTooLargeError
from .events import ACTIVITY, CASE, RESOURCE, TIMESTAMP
from .schemas import Event, ImportResponse, ImportStats, JsonScalar

LIFECYCLE = "lifecycle:transition"
_GZIP_MAGIC = b"\x1f\x8b"
_DTD_RE = re.compile(rb"<!(?:DOCTYPE|ENTITY)", re.IGNORECASE)
_CHUNK = 1024 * 1024

LifecycleMode = Literal["complete", "all"]


def decompress_if_gzip(data: bytes, settings: Settings) -> bytes:
    """Gunzip `data` when it starts with the gzip magic, enforcing the uncompressed limit."""
    if not data.startswith(_GZIP_MAGIC):
        return data
    limit = settings.max_xes_uncompressed_bytes
    out = bytearray()
    inflater = zlib.decompressobj(wbits=16 + zlib.MAX_WBITS)  # gzip framing
    try:
        view = memoryview(data)
        for i in range(0, len(view), _CHUNK):
            # max_length caps each step's output, so a zip bomb never inflates in one go.
            pending = view[i : i + _CHUNK].tobytes()
            while pending:
                out.extend(inflater.decompress(pending, _CHUNK))
                if len(out) > limit:
                    raise PayloadTooLargeError(
                        f"Decompressed XES exceeds {limit} bytes (MAX_XES_UNCOMPRESSED_BYTES)."
                    )
                pending = inflater.unconsumed_tail
        out.extend(inflater.flush())
    except (zlib.error, gzip.BadGzipFile, EOFError) as exc:
        raise InvalidEventsError(f"The .xes.gz file is not valid gzip: {exc}") from exc
    if len(out) > limit:
        raise PayloadTooLargeError(
            f"Decompressed XES exceeds {limit} bytes (MAX_XES_UNCOMPRESSED_BYTES)."
        )
    return bytes(out)


def import_xes(data: bytes, settings: Settings, lifecycle: LifecycleMode) -> ImportResponse:
    """Parse XES bytes (plain or gzipped) into contract events."""
    xml = decompress_if_gzip(data, settings)
    if _DTD_RE.search(xml):
        # pm4py parses with lxml; refusing DTDs rules out entity expansion and XXE.
        raise InvalidEventsError("XES files with a DOCTYPE or entity declarations are refused.")

    fd, path = tempfile.mkstemp(suffix=".xes")
    try:
        with os.fdopen(fd, "wb") as fh:
            fh.write(xml)
        df = pm4py.read_xes(path)
    except InvalidEventsError:
        raise
    except Exception as exc:  # pm4py surfaces lxml and parsing errors as many types.
        raise InvalidEventsError(f"Could not read the XES file: {exc!r}") from exc
    finally:
        os.unlink(path)
    return normalise(df, settings, lifecycle)


def normalise(df: pd.DataFrame, settings: Settings, lifecycle: LifecycleMode) -> ImportResponse:
    """Map a pm4py DataFrame to contract events (the inverse of `events._to_pm4py`)."""
    df = df[[c for c in df.columns if not str(c).startswith("@@")]]

    lifecycle_filtered = 0
    if lifecycle == "complete" and LIFECYCLE in df.columns:
        keep = df[LIFECYCLE].isna() | (df[LIFECYCLE].astype(str).str.lower() == "complete")
        lifecycle_filtered = int((~keep).sum())
        df = df[keep]

    required = [c for c in (CASE, ACTIVITY, TIMESTAMP) if c in df.columns]
    if len(required) < 3:
        raise InvalidEventsError(
            "The XES log needs case ids (trace concept:name), activities (event "
            "concept:name) and timestamps (time:timestamp)."
        )
    complete = df[required].notna().all(axis=1)
    dropped = int((~complete).sum())
    df = df[complete]
    if df.empty:
        raise InvalidEventsError("The XES log contains no usable events.")
    if len(df) > settings.max_events:
        raise PayloadTooLargeError(
            f"{len(df)} events exceeds the limit of {settings.max_events} (MAX_EVENTS)."
        )

    df = df.assign(**{TIMESTAMP: pd.to_datetime(df[TIMESTAMP], utc=True)})
    df = df.sort_values([CASE, TIMESTAMP], kind="stable")

    rename = _attribute_names(df.columns)
    events = [
        Event(
            case_id=str(row[CASE]),
            activity=str(row[ACTIVITY]),
            timestamp=row[TIMESTAMP].to_pydatetime(),
            resource=_resource(row.get(RESOURCE)),
            **{rename[k]: _scalar(v) for k, v in row.items() if k in rename},
        )
        for row in df.to_dict("records")
    ]
    return ImportResponse(
        events=events,
        stats=ImportStats(
            num_events=len(events),
            num_cases=int(df[CASE].nunique()),
            num_activities=int(df[ACTIVITY].nunique()),
            dropped_events=dropped,
            lifecycle_filtered_events=lifecycle_filtered,
            attributes=sorted(rename.values()),
        ),
    )


def _attribute_names(columns: pd.Index) -> dict[Any, str]:
    """Extra XES attributes and their contract names.

    Trace attributes (`case:x`) lose their prefix unless that would collide with an event
    attribute or a contract field.
    """
    standard = {CASE, ACTIVITY, TIMESTAMP, RESOURCE}
    extras = [c for c in columns if c not in standard]
    taken = {"case_id", "activity", "timestamp", "resource"} | {
        str(c) for c in extras if not str(c).startswith("case:")
    }
    names: dict[Any, str] = {}
    for c in extras:
        name = str(c)
        short = name.removeprefix("case:")
        names[c] = short if name.startswith("case:") and short not in taken else name
        if name in {"case_id", "activity", "timestamp", "resource"}:
            names[c] = f"xes:{name}"
    return names


def _resource(value: Any) -> str | None:
    scalar = _scalar(value)
    return None if scalar is None else str(scalar)


def _scalar(value: Any) -> JsonScalar:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, pd.Timestamp | datetime):
        return None if pd.isna(value) else value.isoformat()
    if value is pd.NaT or value is pd.NA:
        return None
    if isinstance(value, str | bool | int | float):
        return value
    if hasattr(value, "item"):  # numpy scalars
        item = value.item()
        return item if isinstance(item, str | bool | int | float) else str(item)
    return str(value)
