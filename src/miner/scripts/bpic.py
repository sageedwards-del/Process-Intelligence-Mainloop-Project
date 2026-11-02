"""Download the public BPI Challenge logs and convert them to the CSV event contract.

    uv run python scripts/bpic.py download   # into data/external/bpic/ (gitignored)
    uv run python scripts/bpic.py convert    # .xes(.gz) -> <name>.csv next to it

The logs are not committed. BPIC 2020 is CC BY-NC 4.0, so it can't sit in this MIT
repository; BPIC 2019 is CC BY 4.0 but 729 MB. Each file is fetched from 4TU.ResearchData
(its file listing API) and, when 4TU is unreachable, from a GitHub LFS mirror. Either way the
bytes are checked against the MD5 that 4TU publishes for the file, so a mirror copy is
accepted only if it is identical to 4TU's.

Conversion reads the XES with pm4py, keeps every lifecycle event in a `lifecycle` column and the
XES event id as `event_id`, renames other columns the way `POST /import/xes` does
(throughline_miner.xes) and writes timestamps as ISO 8601 UTC.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import re
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx
import pandas as pd
import pm4py

from throughline_miner.events import ACTIVITY, CASE, RESOURCE, TIMESTAMP
from throughline_miner.xes import LIFECYCLE, _attribute_names

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "data" / "external" / "bpic"
FOURTU_API = "https://data.4tu.nl/v2/articles/{uuid}/files"
MIRROR = "https://media.githubusercontent.com/media/Gength/generalization_analysis/main/data"


@dataclass(frozen=True)
class Dataset:
    name: str
    title: str
    doi: str
    licence: str
    # 4TU.ResearchData dataset UUID and the file's name there.
    uuid: str
    file: str
    size: int
    # MD5 published by 4TU for the file; for BPIC 2019 that is the uncompressed .xes.
    md5: str
    md5_of_uncompressed: bool
    mirror: str
    # Columns to leave out of the CSV (regexes on the converted names).
    drop: tuple[str, ...] = field(default=())


DATASETS = (
    Dataset(
        name="bpic2020-domestic",
        title="BPI Challenge 2020: Domestic Declarations",
        doi="10.4121/uuid:3f422315-ed9d-4882-891f-e180b5b4feb5",
        licence="CC BY-NC 4.0",
        uuid="6a0a26d2-82d0-4018-b1cd-89afb0e8627f",
        file="DomesticDeclarations.xes.gz",
        size=933_930,
        md5="6a78c39491498363ce4788e0e8ca75ef",
        md5_of_uncompressed=False,
        mirror=f"{MIRROR}/BPI-Challenge_2020/DomesticDeclarations.xes.gz",
        drop=(r"^xes:id$",),
    ),
    Dataset(
        name="bpic2020-permit",
        title="BPI Challenge 2020: Travel Permit Data",
        doi="10.4121/uuid:ea03d361-a7cd-4f5e-83d8-5fbdf0362550",
        licence="CC BY-NC 4.0",
        uuid="db35afac-2133-40f3-a565-2dc77a9329a3",
        file="PermitLog.xes.gz",
        size=1_938_192,
        md5="b6e9ff00d946f6ad4c91eb6fb550aee4",
        md5_of_uncompressed=False,
        mirror=f"{MIRROR}/BPI-Challenge_2020/PermitLog.xes.gz",
        # Per-declaration columns (dec_id_0 … RequestedAmount_16) are mostly empty.
        drop=(r"^xes:id$", r"_\d+$"),
    ),
    Dataset(
        name="bpic2020-request-for-payment",
        title="BPI Challenge 2020: Request For Payment",
        doi="10.4121/uuid:895b26fb-6f25-46eb-9e48-0dca26fcd030",
        licence="CC BY-NC 4.0",
        uuid="a6f651a7-5ce0-4bc6-8be1-a7747effa1cc",
        file="RequestForPayment.xes.gz",
        size=696_896,
        md5="2eb4dd20e70b8de4e32cc3c239bde7f2",
        md5_of_uncompressed=False,
        mirror=f"{MIRROR}/BPI-Challenge_2020/RequestForPayment.xes.gz",
    ),
    Dataset(
        name="bpic2020-prepaid-travel-cost",
        title="BPI Challenge 2020: Prepaid Travel Costs",
        doi="10.4121/uuid:5d2fe5e1-f91f-4a3b-ad9b-9e4126870165",
        licence="CC BY-NC 4.0",
        uuid="fb84cf2d-166f-4de2-87be-62ee317077e5",
        file="PrepaidTravelCost.xes.gz",
        size=370_047,
        md5="b6ab8ee749e2954f09a4fef030960598",
        md5_of_uncompressed=False,
        mirror=f"{MIRROR}/BPI-Challenge_2020/PrepaidTravelCost.xes.gz",
    ),
    Dataset(
        name="bpic2019",
        title="BPI Challenge 2019",
        doi="10.4121/uuid:d06aff4b-79f0-45e6-8ec8-e19730c248f1",
        licence="CC BY 4.0",
        uuid="35ed7122-966a-484e-a0e1-749b64e3366d",
        file="BPI_Challenge_2019.xes",
        size=728_558_522,
        md5="4eb909242351193a61e1c15b9c3cc814",
        md5_of_uncompressed=True,
        # The mirror holds the same file gzipped (16.9 MB); it is unpacked and checked.
        mirror=f"{MIRROR}/BPI-Challenge_2019/BPI_Challenge_2019.xes.gz",
    ),
    # Cost validation (docs/validation.md). The MD5s are 4TU's, as published through
    # figshare (4TU's storage backend: api.figshare.com/v2/articles/12696884 and 12688355).
    Dataset(
        name="bpic2017",
        title="BPI Challenge 2017 (loan applications, with lifecycle start/complete)",
        doi="10.4121/uuid:5f3067df-f10b-45da-b98b-86ae4c7a310b",
        licence="4TU General Terms of Use",
        uuid="5f3067df-f10b-45da-b98b-86ae4c7a310b",
        file="BPI Challenge 2017.xes.gz",
        size=29_658_747,
        md5="10b37a2f78e870d78406198403ff13d2",
        md5_of_uncompressed=False,
        mirror=f"{MIRROR}/BPI-Challenge_2017/BPI%20Challenge%202017.xes.gz",
    ),
    Dataset(
        name="bpic2018",
        title="BPI Challenge 2018 (EU direct payments, amounts and penalties)",
        doi="10.4121/uuid:3301445f-95e8-4ff0-98a4-901f1f204972",
        licence="CC0",
        uuid="3301445f-95e8-4ff0-98a4-901f1f204972",
        file="BPI Challenge 2018.xes.gz",
        size=158_270_992,
        md5="66e54ddaa6b50d81a0166766d6f7a5d4",
        md5_of_uncompressed=False,
        mirror=f"{MIRROR}/BPI-Challenge_2018/BPI%20Challenge%202018.xes.gz",
    ),
)


def local_path(ds: Dataset) -> Path:
    return OUT / ds.file


def md5_of(path: Path) -> str:
    h = hashlib.md5(usedforsecurity=False)
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _fourtu_url(ds: Dataset, client: httpx.Client) -> str:
    resp = client.get(FOURTU_API.format(uuid=ds.uuid), timeout=30)
    resp.raise_for_status()
    for f in resp.json():
        if f.get("name") == ds.file:
            return str(f["download_url"])
    raise LookupError(f"{ds.file} is not listed in 4TU dataset {ds.uuid}")


def _fetch(url: str, dest: Path, client: httpx.Client) -> None:
    tmp = dest.with_suffix(dest.suffix + ".part")
    with client.stream("GET", url, timeout=120, follow_redirects=True) as resp:
        resp.raise_for_status()
        with tmp.open("wb") as fh:
            for chunk in resp.iter_bytes(1 << 20):
                fh.write(chunk)
    tmp.replace(dest)


def download(ds: Dataset, client: httpx.Client) -> str:
    """Fetch one file into OUT unless a verified copy is there. Returns where it came from."""
    dest = local_path(ds)
    if dest.exists() and md5_of(dest) == ds.md5:
        return "cached"
    OUT.mkdir(parents=True, exist_ok=True)
    try:
        _fetch(_fourtu_url(ds, client), dest, client)
        source = "4TU.ResearchData"
    except (httpx.HTTPError, LookupError, ValueError) as exc:
        print(f"  4TU unavailable for {ds.file} ({type(exc).__name__}); trying the mirror")
        if ds.mirror.endswith(".gz") and not ds.file.endswith(".gz"):
            packed = dest.with_suffix(dest.suffix + ".gz")
            _fetch(ds.mirror, packed, client)
            with gzip.open(packed, "rb") as src, dest.open("wb") as out:
                for chunk in iter(lambda: src.read(1 << 20), b""):
                    out.write(chunk)
            packed.unlink()
        else:
            _fetch(ds.mirror, dest, client)
        source = "mirror"
    got = md5_of(dest)
    if got != ds.md5 or dest.stat().st_size != ds.size:
        dest.unlink()
        raise SystemExit(f"{ds.file}: MD5 {got} does not match 4TU's {ds.md5}; file removed.")
    return source


def convert(ds: Dataset) -> Path:
    """XES -> CSV in the event contract (case_id, activity, timestamp, resource, ...)."""
    df = pm4py.read_xes(str(local_path(ds)))
    df = df[[c for c in df.columns if not str(c).startswith("@@")]]
    # Every lifecycle event is kept (start, suspend, resume, complete...), so the
    # upload can pair starts with completions and measure processing time.
    lifecycle = df.pop(LIFECYCLE).astype(str).str.lower() if LIFECYCLE in df.columns else None
    rename = _attribute_names(df.columns)
    # The XES event id lets the upload tell a double export from items recorded together.
    rename = {c: ("event_id" if n == "id" else n) for c, n in rename.items()}
    drop = [c for c, n in rename.items() if any(re.search(p, n) for p in ds.drop)]
    df = df.drop(columns=drop)
    rename = {c: n for c, n in rename.items() if c not in drop}

    out = pd.DataFrame(
        {
            "case_id": df[CASE].astype(str),
            "activity": df[ACTIVITY].astype(str),
            "timestamp": pd.to_datetime(df[TIMESTAMP], utc=True).dt.strftime(
                "%Y-%m-%dT%H:%M:%S.%fZ"
            ),
            "resource": df[RESOURCE] if RESOURCE in df.columns else None,
        }
    )
    # Microseconds -> milliseconds, the engine's resolution.
    out["timestamp"] = out["timestamp"].str.replace(r"(\.\d{3})\d{3}Z$", r"\1Z", regex=True)
    if lifecycle is not None:
        out["lifecycle"] = lifecycle.replace("nan", "complete")
    for col, name in rename.items():
        out[name] = df[col]
    path = OUT / f"{ds.name}.csv"
    out.to_csv(path, index=False)
    return path


def main(argv: list[str]) -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("command", choices=("download", "convert", "all"))
    parser.add_argument("--only", nargs="*", help="dataset names (default: all)")
    args = parser.parse_args(argv)
    chosen = [d for d in DATASETS if not args.only or d.name in args.only]

    if args.command in ("download", "all"):
        with httpx.Client(headers={"User-Agent": "throughline-validation"}) as client:
            for ds in chosen:
                print(f"{ds.file} ({ds.licence}, doi:{ds.doi}): {download(ds, client)}, MD5 ok")
    if args.command in ("convert", "all"):
        for ds in chosen:
            t = time.perf_counter()
            path = convert(ds)
            print(f"{path.relative_to(ROOT)} written in {time.perf_counter() - t:.1f} s")


if __name__ == "__main__":
    main(sys.argv[1:])
