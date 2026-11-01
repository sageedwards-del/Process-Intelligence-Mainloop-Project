from __future__ import annotations

from collections.abc import Callable
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from lxml import etree

from tests.conftest import EVENTS_URL, STORAGE_HOST, Route

BPMN_NS = {
    "bpmn": "http://www.omg.org/spec/BPMN/20100524/MODEL",
    "bpmndi": "http://www.omg.org/spec/BPMN/20100524/DI",
    "omgdc": "http://www.omg.org/spec/DD/20100524/DC",
    "omgdi": "http://www.omg.org/spec/DD/20100524/DI",
}
ACTIVITIES = {"Receive Invoice", "Check Invoice", "Approve", "Price Change", "Re-invoice", "Pay"}


def num(el: etree._Element, attr: str) -> float:
    value = el.get(attr)
    assert value is not None, f"missing {attr}"
    return float(value)


def parse_bpmn(xml: str) -> etree._Element:
    return etree.fromstring(xml.encode("utf-8"), etree.XMLParser(resolve_entities=False))


def test_health(client: TestClient) -> None:
    resp = client.get("/health")
    assert resp.status_code == 200
    body = resp.json()
    assert body["status"] == "ok"
    assert body["pm4py_version"] == "2.7.23.11"


def test_inductive_miner_returns_bpmn_that_parses(
    client: TestClient, invoice_events: list[dict[str, Any]]
) -> None:
    resp = client.post("/discover/inductive", json={"events": invoice_events})

    assert resp.status_code == 200, resp.text
    body = resp.json()
    root = parse_bpmn(body["bpmn_xml"])
    assert etree.QName(root).localname == "definitions"

    tasks = {t.get("name") for t in root.iterfind(".//bpmn:task", BPMN_NS)}
    assert tasks == ACTIVITIES
    assert root.find(".//bpmn:startEvent", BPMN_NS) is not None
    assert root.find(".//bpmn:endEvent", BPMN_NS) is not None


def test_bpmn_has_diagram_layout_for_bpmn_js(
    client: TestClient, invoice_events: list[dict[str, Any]]
) -> None:
    body = client.post("/discover/inductive", json={"events": invoice_events}).json()
    root = parse_bpmn(body["bpmn_xml"])

    process = root.find("bpmn:process", BPMN_NS)
    assert process is not None
    flow_nodes = [
        el.get("id")
        for el in process
        if etree.QName(el).localname not in {"sequenceFlow", "laneSet"}
    ]
    shapes = {s.get("bpmnElement"): s for s in root.iterfind(".//bpmndi:BPMNShape", BPMN_NS)}
    assert set(flow_nodes) <= set(shapes)
    for shape in shapes.values():
        bounds = shape.find("omgdc:Bounds", BPMN_NS)
        assert bounds is not None
        assert num(bounds, "x") >= 0
        assert num(bounds, "y") >= 0
        assert num(bounds, "width") > 0

    flows = {f.get("id") for f in root.iterfind(".//bpmn:sequenceFlow", BPMN_NS)}
    edges = list(root.iterfind(".//bpmndi:BPMNEdge", BPMN_NS))
    assert {e.get("bpmnElement") for e in edges} == flows
    for edge in edges:
        waypoints = edge.findall("omgdi:waypoint", BPMN_NS)
        assert len(waypoints) >= 2
        assert all(num(w, "x") >= 0 and num(w, "y") >= 0 for w in waypoints)

    # Task shapes must not overlap each other.
    boxes = [
        tuple(num(b, k) for k in ("x", "y", "width", "height"))
        for b in root.iterfind(".//bpmndi:BPMNShape/omgdc:Bounds", BPMN_NS)
    ]
    for i, (x1, y1, w1, h1) in enumerate(boxes):
        for x2, y2, w2, h2 in boxes[i + 1 :]:
            assert x1 + w1 <= x2 or x2 + w2 <= x1 or y1 + h1 <= y2 or y2 + h2 <= y1


def test_process_tree_and_stats(client: TestClient, invoice_events: list[dict[str, Any]]) -> None:
    body = client.post("/discover/inductive", json={"events": invoice_events}).json()

    tree = body["process_tree"]
    assert tree["root"]["type"] == "sequence"
    labels = [c.get("label") for c in tree["root"]["children"]]
    assert labels[0] == "Receive Invoice"
    assert labels[-2:] == ["Approve", "Pay"]
    assert tree["root"]["children"][1]["type"] == "loop"
    assert "Price Change" in tree["notation"]

    stats = body["stats"]
    assert stats["num_cases"] == 7
    assert stats["num_events"] == 40
    assert stats["num_activities"] == 6
    assert stats["num_variants"] == 3
    assert stats["start_activities"] == {"Receive Invoice": 7}
    assert stats["end_activities"] == {"Pay": 7}
    assert stats["activities"]["Check Invoice"] == 11
    assert stats["noise_threshold"] == 0.0


def test_noise_threshold_is_accepted_and_validated(
    client: TestClient, invoice_events: list[dict[str, Any]]
) -> None:
    ok = client.post("/discover/inductive", json={"events": invoice_events, "noise_threshold": 0.4})
    assert ok.status_code == 200
    assert ok.json()["stats"]["noise_threshold"] == 0.4

    bad = client.post("/discover/inductive", json={"events": invoice_events, "noise_threshold": 2})
    assert bad.status_code == 422


def test_events_url_is_fetched(client: TestClient, invoice_events: list[dict[str, Any]]) -> None:
    from_url = client.post("/discover/inductive", json={"events_url": EVENTS_URL})
    inline = client.post("/discover/inductive", json={"events": invoice_events})

    assert from_url.status_code == 200, from_url.text
    assert from_url.json()["process_tree"] == inline.json()["process_tree"]


def test_events_url_must_be_https(client: TestClient) -> None:
    resp = client.post(
        "/discover/inductive", json={"events_url": f"http://{STORAGE_HOST}/invoice.csv"}
    )
    assert resp.status_code == 400
    assert "https" in resp.json()["detail"]


def test_events_url_host_allowlist(make_client: Callable[..., TestClient]) -> None:
    client = make_client(events_url_allowed_hosts="other.supabase.co")
    resp = client.post("/discover/inductive", json={"events_url": EVENTS_URL})
    assert resp.status_code == 400
    assert "not allowed" in resp.json()["detail"]

    allowed = make_client(events_url_allowed_hosts=f"other.supabase.co, {STORAGE_HOST}")
    assert allowed.post("/discover/inductive", json={"events_url": EVENTS_URL}).status_code == 200


def test_events_url_upstream_error_hides_the_signed_url(
    client: TestClient, routes: dict[str, Route]
) -> None:
    url = f"https://{STORAGE_HOST}/expired.csv"
    routes[url] = lambda _: httpx.Response(403)

    resp = client.post("/discover/inductive", json={"events_url": url + "?token=secret"})

    assert resp.status_code == 502
    assert "secret" not in resp.text


def test_events_url_download_size_is_capped(
    make_client: Callable[..., TestClient], routes: dict[str, Route]
) -> None:
    url = f"https://{STORAGE_HOST}/huge.csv"
    routes[url] = lambda _: httpx.Response(200, content=b"x" * 4096)
    client = make_client(max_payload_bytes=2048)

    assert client.post("/discover/inductive", json={"events_url": url}).status_code == 413


@pytest.mark.parametrize(
    "payload",
    [
        {},
        {"events": [], "events_url": EVENTS_URL},
    ],
)
def test_exactly_one_event_source(client: TestClient, payload: dict[str, Any]) -> None:
    assert client.post("/discover/inductive", json=payload).status_code == 422


def test_empty_events_are_rejected(client: TestClient) -> None:
    assert client.post("/discover/inductive", json={"events": []}).status_code == 422


def test_max_events(make_client: Callable[..., TestClient], invoice_events: list[Any]) -> None:
    client = make_client(max_events=10)
    resp = client.post("/discover/inductive", json={"events": invoice_events})
    assert resp.status_code == 413
    assert "MAX_EVENTS" in resp.json()["detail"]


def test_request_body_limit(
    make_client: Callable[..., TestClient], invoice_events: list[Any]
) -> None:
    client = make_client(max_payload_bytes=2048)
    resp = client.post("/discover/inductive", json={"events": invoice_events})
    assert resp.status_code == 413


def test_request_body_limit_without_content_length(
    make_client: Callable[..., TestClient], invoice_events: list[Any]
) -> None:
    import json

    client = make_client(max_payload_bytes=2048)
    body = json.dumps({"events": invoice_events}).encode()

    def chunks() -> Any:
        for i in range(0, len(body), 512):
            yield body[i : i + 512]

    resp = client.post(
        "/discover/inductive", content=chunks(), headers={"content-type": "application/json"}
    )
    assert resp.status_code == 413
