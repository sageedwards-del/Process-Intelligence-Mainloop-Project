from __future__ import annotations

from typing import Any

from fastapi.testclient import TestClient

from tests.conftest import EVENTS_URL, HAPPY_CASES, HAPPY_VARIANT, REWORK_CASES


def replay(client: TestClient, events: list[dict[str, Any]], **reference: Any) -> dict[str, Any]:
    resp = client.post("/conformance/token-replay", json={"events": events, **reference})
    assert resp.status_code == 200, resp.text
    body: dict[str, Any] = resp.json()
    return body


def test_happy_cases_fit_and_rework_cases_do_not(
    client: TestClient, invoice_events: list[dict[str, Any]]
) -> None:
    body = replay(client, invoice_events, happy_variants=[HAPPY_VARIANT])

    by_case = {c["case_id"]: c for c in body["cases"]}
    assert set(by_case) == HAPPY_CASES | REWORK_CASES
    for case_id in HAPPY_CASES:
        assert by_case[case_id]["fitness"] == 1.0
        assert by_case[case_id]["is_fit"] is True
        assert by_case[case_id]["deviating_activities"] == []
    for case_id in REWORK_CASES:
        assert by_case[case_id]["fitness"] < 1.0
        assert by_case[case_id]["is_fit"] is False
        assert {"Price Change", "Re-invoice"} <= set(by_case[case_id]["deviating_activities"])

    # Two rework loops deviate more than one.
    assert by_case["INV-1007"]["fitness"] < by_case["INV-1003"]["fitness"]


def test_overall_and_weekly_rates(client: TestClient, invoice_events: list[dict[str, Any]]) -> None:
    body = replay(client, invoice_events, happy_variants=[HAPPY_VARIANT])

    assert body["num_cases"] == 7
    assert body["num_fit_cases"] == 4
    assert body["conformance_rate"] == 4 / 7
    assert 0 < body["log_fitness"] < 1
    assert 0 < body["average_fitness"] < 1

    weekly = {w["iso_week"]: w for w in body["weekly"]}
    assert list(weekly) == ["2026-W10", "2026-W11"]
    assert weekly["2026-W10"]["week_start"] == "2026-03-02"
    # W10: INV-1001, INV-1002 (happy), INV-1003 (rework).
    assert (weekly["2026-W10"]["num_cases"], weekly["2026-W10"]["num_fit_cases"]) == (3, 2)
    # W11: INV-1004, INV-1006 (happy), INV-1005, INV-1007 (rework).
    assert (weekly["2026-W11"]["num_cases"], weekly["2026-W11"]["num_fit_cases"]) == (4, 2)
    assert weekly["2026-W11"]["conformance_rate"] == 0.5


def test_reference_info_for_happy_variants(
    client: TestClient, invoice_events: list[dict[str, Any]]
) -> None:
    never_seen = ["Receive Invoice", "Pay"]
    body = replay(client, invoice_events, happy_variants=[HAPPY_VARIANT, never_seen])

    reference = body["reference"]
    assert reference["source"] == "happy_variants"
    assert reference["matched_cases"] == len(HAPPY_CASES)
    assert reference["unmatched_variants"] == [never_seen]
    assert reference["bpmn_xml"].lstrip().startswith("<?xml")


def test_bpmn_reference_gives_the_same_result(
    client: TestClient, invoice_events: list[dict[str, Any]]
) -> None:
    from_variants = replay(client, invoice_events, happy_variants=[HAPPY_VARIANT])
    bpmn_xml = from_variants["reference"]["bpmn_xml"]

    from_bpmn = replay(client, invoice_events, bpmn_xml=bpmn_xml)

    assert from_bpmn["reference"] == {
        "source": "bpmn_xml",
        "bpmn_xml": None,
        "matched_cases": None,
        "unmatched_variants": [],
    }
    fitness = {c["case_id"]: c["fitness"] for c in from_bpmn["cases"]}
    assert fitness == {c["case_id"]: c["fitness"] for c in from_variants["cases"]}


def test_discovered_model_as_reference_fits_everything(
    client: TestClient, invoice_events: list[dict[str, Any]]
) -> None:
    discovered = client.post("/discover/inductive", json={"events": invoice_events}).json()
    body = replay(client, invoice_events, bpmn_xml=discovered["bpmn_xml"])
    assert body["conformance_rate"] == 1.0


def test_events_url_source(client: TestClient) -> None:
    resp = client.post(
        "/conformance/token-replay",
        json={"events_url": EVENTS_URL, "happy_variants": [HAPPY_VARIANT]},
    )
    assert resp.status_code == 200
    assert resp.json()["num_fit_cases"] == 4


def test_exactly_one_reference(client: TestClient, invoice_events: list[dict[str, Any]]) -> None:
    neither = client.post("/conformance/token-replay", json={"events": invoice_events})
    both = client.post(
        "/conformance/token-replay",
        json={"events": invoice_events, "bpmn_xml": "<x/>", "happy_variants": [HAPPY_VARIANT]},
    )
    empty_variant = client.post(
        "/conformance/token-replay", json={"events": invoice_events, "happy_variants": [[]]}
    )
    assert neither.status_code == both.status_code == empty_variant.status_code == 422


def test_unmatched_happy_variants(client: TestClient, invoice_events: list[dict[str, Any]]) -> None:
    resp = client.post(
        "/conformance/token-replay",
        json={"events": invoice_events, "happy_variants": [["Pay", "Receive Invoice"]]},
    )
    assert resp.status_code == 422
    assert "No case follows" in resp.json()["detail"]


def test_bpmn_with_doctype_is_refused(
    client: TestClient, invoice_events: list[dict[str, Any]]
) -> None:
    xxe = (
        '<?xml version="1.0"?><!DOCTYPE d [<!ENTITY x SYSTEM "file:///etc/passwd">]>'
        '<definitions xmlns="http://www.omg.org/spec/BPMN/20100524/MODEL">&x;</definitions>'
    )
    resp = client.post(
        "/conformance/token-replay", json={"events": invoice_events, "bpmn_xml": xxe}
    )
    assert resp.status_code == 422
    assert "DOCTYPE" in resp.json()["detail"]


def test_malformed_bpmn(client: TestClient, invoice_events: list[dict[str, Any]]) -> None:
    for bad in ["<definitions", "<definitions/>"]:
        resp = client.post(
            "/conformance/token-replay", json={"events": invoice_events, "bpmn_xml": bad}
        )
        assert resp.status_code == 422, bad
