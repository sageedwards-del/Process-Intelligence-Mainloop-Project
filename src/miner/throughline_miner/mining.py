"""pm4py algorithms: Inductive Miner discovery and token-replay conformance.

Everything here is CPU-bound and synchronous; the HTTP layer runs it in a worker thread.
"""

from __future__ import annotations

import time
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

import pandas as pd
import pm4py
from lxml import etree, objectify
from pm4py.algo.conformance.tokenreplay import algorithm as token_replay
from pm4py.objects.bpmn.exporter.variants import etree as bpmn_exporter
from pm4py.objects.bpmn.importer.variants import lxml as bpmn_importer
from pm4py.objects.bpmn.obj import BPMN
from pm4py.objects.petri_net.obj import Marking, PetriNet
from pm4py.objects.process_tree.obj import Operator
from pm4py.objects.process_tree.obj import ProcessTree as PMProcessTree

from .errors import InvalidModelError
from .events import ACTIVITY, CASE, TIMESTAMP, case_variants, log_stats
from .layout import apply_layout
from .schemas import (
    CaseFitness,
    ConformanceResponse,
    DiscoverResponse,
    DiscoverStats,
    ProcessTree,
    ProcessTreeNode,
    ReferenceInfo,
    TreeNodeType,
    WeeklyConformance,
)

_OPERATOR_TYPES: dict[Operator, TreeNodeType] = {
    Operator.SEQUENCE: "sequence",
    Operator.XOR: "xor",
    Operator.PARALLEL: "parallel",
    Operator.LOOP: "loop",
    Operator.OR: "or",
    Operator.INTERLEAVING: "interleaving",
    Operator.PARTIALORDER: "partial_order",
}

_KEYS = {"activity_key": ACTIVITY, "case_id_key": CASE, "timestamp_key": TIMESTAMP}


@dataclass(frozen=True)
class PetriModel:
    net: PetriNet
    initial: Marking
    final: Marking


# --- discovery ---------------------------------------------------------------------------


def discover_inductive(df: pd.DataFrame, noise_threshold: float) -> DiscoverResponse:
    started = time.perf_counter()
    tree = pm4py.discover_process_tree_inductive(df, noise_threshold=noise_threshold, **_KEYS)
    return DiscoverResponse(
        bpmn_xml=tree_to_bpmn_xml(tree),
        process_tree=ProcessTree(notation=str(tree), root=_tree_node(tree)),
        stats=DiscoverStats(
            **log_stats(df).model_dump(),
            noise_threshold=noise_threshold,
            duration_ms=_elapsed_ms(started),
        ),
    )


def tree_to_bpmn_xml(tree: PMProcessTree) -> str:
    bpmn = apply_layout(pm4py.convert_to_bpmn(tree))
    xml: bytes = bpmn_exporter.get_xml_string(bpmn)
    return xml.decode("utf-8")


def _tree_node(tree: PMProcessTree) -> ProcessTreeNode:
    if tree.operator is None:
        if tree.label is None:
            return ProcessTreeNode(type="silent")
        return ProcessTreeNode(type="activity", label=tree.label)
    return ProcessTreeNode(
        type=_OPERATOR_TYPES[tree.operator],
        children=[_tree_node(c) for c in tree.children],
    )


# --- reference models --------------------------------------------------------------------


def model_from_bpmn_xml(bpmn_xml: str) -> PetriModel:
    """Parse untrusted BPMN XML (no DTDs, entities or network) into a Petri net."""
    if "<!DOCTYPE" in bpmn_xml[:4096].upper() or "<!ENTITY" in bpmn_xml.upper():
        raise InvalidModelError("BPMN XML must not contain a DOCTYPE or entity declarations.")
    # Same parser pm4py uses (pm4py's importer needs whitespace text nodes kept), hardened.
    parser = etree.XMLParser(
        remove_comments=True, resolve_entities=False, no_network=True, load_dtd=False
    )
    try:
        root = objectify.fromstring(bpmn_xml.encode("utf-8"), parser=parser)  # type: ignore[arg-type]
        bpmn = bpmn_importer.import_xml_tree_from_root(root)
    except etree.XMLSyntaxError as exc:
        raise InvalidModelError(f"`bpmn_xml` is not well-formed XML: {exc}") from exc
    except Exception as exc:  # pm4py raises bare KeyErrors etc. on unsupported BPMN.
        raise InvalidModelError(f"`bpmn_xml` could not be read as BPMN: {exc!r}") from exc
    if not any(isinstance(n, BPMN.Task) and n.get_name() for n in bpmn.get_nodes()):
        raise InvalidModelError("`bpmn_xml` contains no named activities.")
    try:
        net, im, fm = pm4py.convert_to_petri_net(bpmn)
    except Exception as exc:
        raise InvalidModelError(
            f"`bpmn_xml` could not be converted to a Petri net: {exc!r}"
        ) from exc
    return PetriModel(net, im, fm)


def model_from_happy_variants(
    df: pd.DataFrame, happy_variants: Sequence[Sequence[str]]
) -> tuple[PetriModel, ReferenceInfo]:
    """Discover a reference model from the cases whose variant is a happy variant."""
    wanted = {tuple(v) for v in happy_variants}
    variants = case_variants(df)
    matching = variants[variants.isin(wanted)]
    if matching.empty:
        raise InvalidModelError("No case follows any of the `happy_variants`.")
    seen = set(matching.unique())
    unmatched = [list(v) for v in dict.fromkeys(tuple(v) for v in happy_variants) if v not in seen]

    reference_log = df[df[CASE].isin(matching.index)]
    tree = pm4py.discover_process_tree_inductive(reference_log, noise_threshold=0.0, **_KEYS)
    net, im, fm = pm4py.convert_to_petri_net(tree)
    info = ReferenceInfo(
        source="happy_variants",
        bpmn_xml=tree_to_bpmn_xml(tree),
        matched_cases=len(matching),
        unmatched_variants=unmatched,
    )
    return PetriModel(net, im, fm), info


# --- conformance -------------------------------------------------------------------------


def replay(df: pd.DataFrame, model: PetriModel, reference: ReferenceInfo) -> ConformanceResponse:
    started = time.perf_counter()
    log = pm4py.convert_to_event_log(df, **_KEYS)
    results: list[dict[str, Any]] = token_replay.apply(log, model.net, model.initial, model.final)
    model_labels = {t.label for t in model.net.transitions if t.label is not None}
    starts = df.groupby(CASE, sort=False)[TIMESTAMP].min()

    cases: list[CaseFitness] = []
    for trace, r in zip(log, results, strict=True):
        case_id = str(trace.attributes["concept:name"])
        start: pd.Timestamp = starts[case_id]
        year, week, _ = start.isocalendar()
        unknown = [e[ACTIVITY] for e in trace if e[ACTIVITY] not in model_labels]
        problems = [t.label for t in r["transitions_with_problems"] if t.label is not None]
        cases.append(
            CaseFitness(
                case_id=case_id,
                fitness=min(1.0, max(0.0, float(r["trace_fitness"]))),
                is_fit=bool(r["trace_is_fit"]),
                case_start=start.to_pydatetime(),
                iso_week=f"{year}-W{week:02d}",
                missing_tokens=int(r["missing_tokens"]),
                consumed_tokens=int(r["consumed_tokens"]),
                remaining_tokens=int(r["remaining_tokens"]),
                produced_tokens=int(r["produced_tokens"]),
                deviating_activities=list(dict.fromkeys(unknown + problems)),
            )
        )

    n = len(cases)
    fit = sum(c.is_fit for c in cases)
    return ConformanceResponse(
        num_cases=n,
        num_fit_cases=fit,
        conformance_rate=fit / n,
        average_fitness=sum(c.fitness for c in cases) / n,
        log_fitness=_log_fitness(results),
        cases=cases,
        weekly=_weekly(cases),
        reference=reference,
        duration_ms=_elapsed_ms(started),
    )


def _log_fitness(results: list[dict[str, Any]]) -> float:
    """pm4py's token-based log fitness: aggregate missing/remaining over all traces."""
    missing = sum(int(r["missing_tokens"]) for r in results)
    consumed = sum(int(r["consumed_tokens"]) for r in results)
    remaining = sum(int(r["remaining_tokens"]) for r in results)
    produced = sum(int(r["produced_tokens"]) for r in results)
    if consumed == 0 or produced == 0:
        return 1.0
    return 0.5 * (1 - missing / consumed) + 0.5 * (1 - remaining / produced)


def _weekly(cases: list[CaseFitness]) -> list[WeeklyConformance]:
    frame = pd.DataFrame(
        {
            "iso_week": [c.iso_week for c in cases],
            "fit": [c.is_fit for c in cases],
            "fitness": [c.fitness for c in cases],
        }
    )
    weeks = []
    for iso_week, g in frame.groupby("iso_week", sort=True):
        year, week = str(iso_week).split("-W")
        weeks.append(
            WeeklyConformance(
                iso_week=str(iso_week),
                week_start=pd.Timestamp.fromisocalendar(int(year), int(week), 1).date(),
                num_cases=len(g),
                num_fit_cases=int(g["fit"].sum()),
                conformance_rate=float(g["fit"].mean()),
                average_fitness=float(g["fitness"].mean()),
            )
        )
    return weeks


def _elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)
