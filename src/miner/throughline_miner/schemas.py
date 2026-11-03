"""Request and response models. These are the service's public contract and its OpenAPI."""

from __future__ import annotations

from datetime import date, datetime
from typing import Literal, Self

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, HttpUrl, model_validator

JsonScalar = str | int | float | bool | None


class Event(BaseModel):
    """One event, in the contract shared with the TypeScript engine.

    Fields other than the four named ones are kept as case/event attributes. Their values
    must be JSON scalars.
    """

    model_config = ConfigDict(
        extra="allow",
        json_schema_extra={
            "example": {
                "case_id": "INV-1001",
                "activity": "Approve",
                "timestamp": "2026-03-03T10:00:00+00:00",
                "resource": "eng.manager",
                "amount": 1200.0,
            }
        },
    )
    __pydantic_extra__: dict[str, JsonScalar] = Field(init=False)

    case_id: str = Field(min_length=1)
    activity: str = Field(min_length=1)
    timestamp: AwareDatetime = Field(description="ISO 8601 with a UTC offset.")
    resource: str | None = None


class EventSource(BaseModel):
    """Exactly one of `events_url` or `events`."""

    events_url: HttpUrl | None = Field(
        default=None,
        description="Signed https URL to a CSV in the event contract (e.g. a Supabase "
        "Storage signed URL). Fetched by the worker; never logged.",
    )
    events: list[Event] | None = Field(default=None, description="Inline events.")

    @model_validator(mode="after")
    def _exactly_one_source(self) -> Self:
        if (self.events_url is None) == (self.events is None):
            raise ValueError("Provide exactly one of `events_url` or `events`.")
        return self


class DiscoverRequest(EventSource):
    noise_threshold: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Inductive Miner infrequent (IMf) noise threshold. 0 keeps every "
        "behaviour (perfect fitness); higher values filter infrequent paths.",
    )


class ConformanceRequest(EventSource):
    """Events plus a reference model: exactly one of `bpmn_xml` or `happy_variants`."""

    bpmn_xml: str | None = Field(default=None, description="BPMN 2.0 XML of the reference.")
    happy_variants: list[list[str]] | None = Field(
        default=None,
        min_length=1,
        description="Activity sequences that define the intended process. The reference "
        "model is discovered (Inductive Miner, no noise filtering) from the cases whose "
        "variant is one of these.",
        examples=[[["Receive Invoice", "Check Invoice", "Approve", "Pay"]]],
    )

    @model_validator(mode="after")
    def _exactly_one_reference(self) -> Self:
        if (self.bpmn_xml is None) == (self.happy_variants is None):
            raise ValueError("Provide exactly one of `bpmn_xml` or `happy_variants`.")
        if self.happy_variants is not None and any(
            not v or any(not a for a in v) for v in self.happy_variants
        ):
            raise ValueError("Each happy variant must be a non-empty list of activity names.")
        return self


# --- discovery ---------------------------------------------------------------------------

TreeNodeType = Literal[
    "activity",
    "silent",
    "sequence",
    "xor",
    "parallel",
    "loop",
    "or",
    "interleaving",
    "partial_order",
]


class ProcessTreeNode(BaseModel):
    type: TreeNodeType
    label: str | None = Field(default=None, description="Activity name, for `activity` nodes.")
    children: list[ProcessTreeNode] = Field(default_factory=list)


class ProcessTree(BaseModel):
    notation: str = Field(description="pm4py's textual notation, e.g. `->( 'A', X( 'B', tau ) )`.")
    root: ProcessTreeNode


class LogStats(BaseModel):
    num_cases: int
    num_events: int
    num_activities: int
    num_variants: int
    first_timestamp: datetime
    last_timestamp: datetime
    activities: dict[str, int] = Field(description="Event count per activity.")
    start_activities: dict[str, int]
    end_activities: dict[str, int]


class DiscoverStats(LogStats):
    noise_threshold: float
    duration_ms: int


class DiscoverResponse(BaseModel):
    bpmn_xml: str = Field(description="BPMN 2.0 XML with diagram interchange, for bpmn-js.")
    process_tree: ProcessTree
    stats: DiscoverStats


# --- conformance -------------------------------------------------------------------------


class CaseFitness(BaseModel):
    case_id: str
    fitness: float = Field(ge=0.0, le=1.0)
    is_fit: bool = Field(
        description="True when the case replays without missing or remaining tokens."
    )
    case_start: datetime
    iso_week: str = Field(description="ISO week of the case start, in UTC, e.g. `2026-W10`.")
    missing_tokens: int
    consumed_tokens: int
    remaining_tokens: int
    produced_tokens: int
    deviating_activities: list[str] = Field(
        description="Activities in the case that the model does not have, or that fired "
        "without being enabled."
    )


class WeeklyConformance(BaseModel):
    iso_week: str
    week_start: date = Field(description="Monday of the ISO week.")
    num_cases: int
    num_fit_cases: int
    conformance_rate: float
    average_fitness: float


class ReferenceInfo(BaseModel):
    source: Literal["bpmn_xml", "happy_variants"]
    bpmn_xml: str | None = Field(
        default=None,
        description="The discovered reference model, when it came from `happy_variants`.",
    )
    matched_cases: int | None = None
    unmatched_variants: list[list[str]] = Field(default_factory=list)


class ConformanceResponse(BaseModel):
    num_cases: int
    num_fit_cases: int
    conformance_rate: float = Field(description="Share of cases with fitness 1.0.")
    average_fitness: float = Field(description="Mean of per-case fitness.")
    log_fitness: float = Field(description="pm4py's token-based log fitness.")
    cases: list[CaseFitness]
    weekly: list[WeeklyConformance] = Field(
        description="Conformance by ISO week (UTC) of case start, oldest first."
    )
    reference: ReferenceInfo
    duration_ms: int


# --- XES import --------------------------------------------------------------------------


class ImportStats(BaseModel):
    num_events: int
    num_cases: int
    num_activities: int
    dropped_events: int = Field(description="Events without a case id, activity or timestamp.")
    lifecycle_filtered_events: int = Field(
        description="Non-`complete` lifecycle events removed by `lifecycle=complete`."
    )
    attributes: list[str] = Field(description="Extra attribute names present on events.")


class ImportResponse(BaseModel):
    events: list[Event]
    stats: ImportStats


class XesUrlImportRequest(BaseModel):
    """XES by signed URL, with the result written back to storage.

    Keeps large files and large results off any proxy in between (Vercel functions cap
    request and response bodies at 4.5 MB).
    """

    xes_url: HttpUrl = Field(description="Signed URL of an .xes or .xes.gz file. Never logged.")
    result_url: HttpUrl = Field(
        description="Signed upload URL. The worker PUTs the `ImportResponse` there as gzipped "
        "JSON (content type application/gzip). Never logged."
    )
    lifecycle: Literal["complete", "all"] = "complete"


class XesUrlImportResponse(BaseModel):
    stats: ImportStats
    result_bytes: int = Field(description="Size of the gzipped JSON written to `result_url`.")


class HealthResponse(BaseModel):
    status: Literal["ok"]
    version: str
    pm4py_version: str
    source_url: str | None = None
