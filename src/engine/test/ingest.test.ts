import { describe, expect, it } from "vitest";
import { buildLog, detectTimestampFormat, guessMapping, ingestTable, parseTimestamp, type Table } from "../src/index.ts";

const T = (iso: string) => Date.parse(iso);

describe("parseTimestamp", () => {
  it("reads ISO 8601 with and without a zone", () => {
    expect(parseTimestamp("2026-03-02T09:00:00Z", "iso")).toEqual({ t: T("2026-03-02T09:00:00Z"), dateOnly: false, hasZone: true });
    expect(parseTimestamp("2026-03-02T10:00:00+01:00", "iso")!.t).toBe(T("2026-03-02T09:00:00Z"));
    expect(parseTimestamp("2026-03-02 09:00:00.250", "iso")).toEqual({ t: T("2026-03-02T09:00:00.250Z"), dateOnly: false, hasZone: false });
    expect(parseTimestamp("2026-03-02", "iso")).toMatchObject({ t: T("2026-03-02T00:00:00Z"), dateOnly: true });
  });

  it("reads day-first and month-first dates, including AM/PM", () => {
    expect(parseTimestamp("13/02/2026 14:30", "dmy")!.t).toBe(T("2026-02-13T14:30:00Z"));
    expect(parseTimestamp("02/13/2026 2:30 PM", "mdy")!.t).toBe(T("2026-02-13T14:30:00Z"));
    expect(parseTimestamp("13.02.26", "dmy")).toMatchObject({ t: T("2026-02-13T00:00:00Z"), dateOnly: true });
  });

  it("rejects impossible or mismatched values", () => {
    expect(parseTimestamp("31/02/2026", "dmy")).toBeNull();
    expect(parseTimestamp("13/02/2026", "mdy")).toBeNull();
    expect(parseTimestamp("yesterday", "iso")).toBeNull();
    expect(parseTimestamp("", "iso")).toBeNull();
  });

  it("reads Unix epochs", () => {
    expect(parseTimestamp("1772442000", "epoch-s")!.t).toBe(1772442000000);
    expect(parseTimestamp("1772442000000", "epoch-ms")!.t).toBe(1772442000000);
  });
});

describe("detectTimestampFormat", () => {
  it("prefers the format that parses the data", () => {
    expect(detectTimestampFormat(["2026-03-02T09:00:00Z", "2026-03-03"]).format).toBe("iso");
    expect(detectTimestampFormat(["13/02/2026", "01/03/2026"])).toMatchObject({ format: "dmy", ambiguous: false });
    expect(detectTimestampFormat(["02/13/2026", "03/01/2026"])).toMatchObject({ format: "mdy", ambiguous: false });
  });

  it("flags day/month order it can't confirm", () => {
    expect(detectTimestampFormat(["01/02/2026", "03/04/2026"])).toMatchObject({ format: "dmy", ambiguous: true });
  });
});

describe("guessMapping", () => {
  const rows = [
    ["INV-1", "Receive", "2026-03-02T09:00:00Z", "ann", "Acme", "1200"],
    ["INV-1", "Approve", "2026-03-02T11:00:00Z", "bob", "Acme", "1200"],
    ["INV-2", "Receive", "2026-03-03T09:00:00Z", "ann", "Globex", "80"],
  ];

  it("recognises common header names", () => {
    const m = guessMapping({ headers: ["case_id", "activity", "timestamp", "resource", "vendor", "amount"], rows });
    expect(m).toEqual({
      caseId: "case_id",
      activity: "activity",
      timestamp: "timestamp",
      resource: "resource",
      attributes: ["vendor", "amount"],
      timestampFormat: "iso",
      eventId: null,
      lifecycle: null,
    });
  });

  it("recognises XES attribute names", () => {
    const m = guessMapping({ headers: ["case:concept:name", "concept:name", "time:timestamp", "org:resource", "vendor", "cost"], rows });
    expect(m).toMatchObject({ caseId: "case:concept:name", activity: "concept:name", timestamp: "time:timestamp", resource: "org:resource" });
  });

  it("finds the timestamp by its values when the header doesn't say", () => {
    const m = guessMapping({ headers: ["A", "B", "C", "D", "E", "F"], rows });
    expect(m.timestamp).toBe("C");
    expect(m.caseId).toBe("");
    expect(m.activity).toBe("");
  });
});

describe("ingestTable", () => {
  const table: Table = {
    headers: ["case", "activity", "time", "user", "amount"],
    rows: [
      ["1", "Receive", "2026-03-02 09:00", "ann", "1200"], // line 2
      ["1", "Approve", "2026-03-02 10:00", "bob", "1200"],
      ["1", "approve ", "2026-03-02 10:00", "bob", "1200"], // same time, name variant
      ["1", "Approve", "2026-03-02 10:00", "bob", "1200"], // duplicate of line 3
      ["2", "Receive", "not a date", "ann", "80"], // line 6: unreadable
      ["", "Receive", "2026-03-02 09:00", "ann", "80"], // line 7: no case
      ["3", "Receive", "2026-03-04 09:00", "", ""], // single-event case, empty attrs
    ],
  };
  const mapping = { caseId: "case", activity: "activity", timestamp: "time", resource: "user", attributes: ["amount"], timestampFormat: "iso" as const };
  const { events, report } = ingestTable(table, mapping);
  const issue = (id: string) => report.issues.find((i) => i.id === id);

  it("keeps usable rows and types attribute values", () => {
    expect(events).toHaveLength(5);
    expect(events[0]).toEqual({ caseId: "1", activity: "Receive", timestamp: T("2026-03-02T09:00:00Z"), resource: "ann", attrs: { amount: 1200 } });
    expect(events[4]).toEqual({ caseId: "3", activity: "Receive", timestamp: T("2026-03-04T09:00:00Z"), attrs: { amount: null } });
    expect(report).toMatchObject({ rows: 7, eventsKept: 5, cases: 2, resources: 2 });
  });

  it("reports dropped rows with their file line numbers, errors first", () => {
    expect(issue("missing-values")).toMatchObject({ severity: "error", count: 1, examples: [7] });
    expect(issue("unparseable-timestamps")).toMatchObject({ severity: "error", count: 1, examples: [6] });
    expect(report.issues[0]!.severity).toBe("error");
  });

  it("flags duplicates, shared timestamps, single-event cases and name variants", () => {
    expect(issue("duplicate-events")!.count).toBe(1);
    expect(issue("same-timestamp")!.count).toBe(3);
    expect(issue("single-event-cases")).toMatchObject({ count: 1, examples: ["3"] });
    expect(issue("activity-variants")!.examples).toEqual(["Approve / approve"]);
    expect(issue("no-timezone")!.count).toBe(5);
  });

  it("produces events the engine can build a log from", () => {
    const log = buildLog(events);
    expect(log.cases.map((c) => c.id)).toEqual(["1", "3"]);
  });

  it("warns when timestamps carry no time of day", () => {
    const dates: Table = { headers: ["c", "a", "d"], rows: [["1", "A", "2026-03-02"], ["1", "B", "2026-03-04"]] };
    const r = ingestTable(dates, { caseId: "c", activity: "a", timestamp: "d", resource: null, attributes: [], timestampFormat: "iso" }).report;
    expect(r.issues.map((i) => i.id)).toContain("date-only");
    expect(r.issues.map((i) => i.id)).not.toContain("same-timestamp");
  });

  it("reads long decimals as numbers but keeps long integer IDs as text", () => {
    const t: Table = { headers: ["c", "a", "d", "x"], rows: [["1", "A", "2026-03-02T09:00Z", "26.85120450862128"], ["2", "A", "2026-03-02T09:00Z", "4006130000123456"]] };
    const r = ingestTable(t, { caseId: "c", activity: "a", timestamp: "d", resource: null, attributes: ["x"], timestampFormat: "iso" });
    expect(r.events.map((e) => e.attrs!.x)).toEqual([26.85120450862128, "4006130000123456"]);
  });

  it("reads placeholders such as UNKNOWN as missing and reports them", () => {
    const t: Table = {
      headers: ["c", "a", "d", "who", "ref"],
      rows: [
        ["1", "A", "2026-03-02T09:00Z", "UNDEFINED", "UNKNOWN"],
        ["2", "A", "2026-03-02T10:00Z", "ann", "unknown"],
        ["3", "A", "2026-03-02T11:00Z", "ann", "N/A"],
        ["4", "A", "2026-03-02T12:00Z", "ann", "R-7"],
      ],
    };
    const r = ingestTable(t, { caseId: "c", activity: "a", timestamp: "d", resource: "who", attributes: ["ref"], timestampFormat: "iso" });
    expect(r.events.map((e) => [e.resource ?? null, e.attrs!.ref])).toEqual([
      [null, null],
      ["ann", null],
      ["ann", null],
      ["ann", "R-7"],
    ]);
    expect(r.report.issues.find((i) => i.id === "placeholder-values")).toMatchObject({
      severity: "info",
      count: 4,
      examples: ["who: UNDEFINED (1)", "ref: UNKNOWN (1)", "ref: unknown (1)", "ref: N/A (1)"],
    });
  });

  it("flags events dated far outside the log's main period", () => {
    const rows = Array.from({ length: 200 }, (_, i) => [`c${i}`, "A", `2018-03-${String((i % 28) + 1).padStart(2, "0")}T09:00Z`]);
    rows.push(["c0", "B", "2001-01-24T09:00Z"], ["c1", "B", "2018-12-30T09:00Z"]);
    const r = ingestTable({ headers: ["c", "a", "d"], rows }, { caseId: "c", activity: "a", timestamp: "d", resource: null, attributes: [], timestampFormat: "iso" });
    expect(r.report.issues.find((i) => i.id === "outlier-timestamps")).toMatchObject({ severity: "warning", count: 1, examples: ["c0 (2001-01-24)"] });
  });

  it("counts duplicates by event ID when one is mapped, else rows identical in every column", () => {
    const rows = [
      ["1", "Receipt", "2026-03-02T09:00Z", "e1"],
      ["1", "Receipt", "2026-03-02T09:00Z", "e2"], // same second, different item
      ["1", "Receipt", "2026-03-02T09:00Z", "e2"], // a real copy
    ];
    const t: Table = { headers: ["c", "a", "d", "id"], rows };
    const base = { caseId: "c", activity: "a", timestamp: "d", resource: null, attributes: [], timestampFormat: "iso" as const };
    const byId = ingestTable(t, { ...base, eventId: "id" }).report.issues.find((i) => i.id === "duplicate-events");
    expect(byId).toMatchObject({ severity: "warning", count: 1, examples: ["e2"] });
    const noId = ingestTable(t, base).report.issues.find((i) => i.id === "duplicate-events");
    expect(noId).toMatchObject({ severity: "info", count: 2, title: "Rows identical in every column" });
    // Same-second repeats of one step don't make its order doubtful.
    expect(ingestTable(t, base).report.issues.find((i) => i.id === "same-timestamp")).toBeUndefined();
  });

  it("reports batch runs: the same step by the same resource for several cases at once", () => {
    const rows = ["1", "2", "3", "4"].flatMap((c) => [
      [c, "Approve", `2026-03-02T0${c}:00Z`, "ann"],
      [c, "Pay", "2026-03-03T22:59Z", "SYSTEM"],
    ]);
    const r = ingestTable({ headers: ["c", "a", "d", "who"], rows }, { caseId: "c", activity: "a", timestamp: "d", resource: "who", attributes: [], timestampFormat: "iso" });
    expect(r.report.issues.find((i) => i.id === "batched-steps")).toMatchObject({ count: 4, examples: ["Pay by SYSTEM: 4 cases at 2026-03-03 22:59"] });
  });

  it("reads a lifecycle column and reports what it paired", () => {
    const t: Table = {
      headers: ["case_id", "activity", "timestamp", "lifecycle:transition"],
      rows: [
        ["1", "Check", "2026-03-02T09:00Z", "start"],
        ["1", "Check", "2026-03-02T09:20Z", "complete"],
        ["1", "Pay", "2026-03-02T10:00Z", "schedule"],
        ["1", "Pay", "2026-03-02T11:00Z", "start"],
        ["2", "Check", "2026-03-02T09:00Z", "ate_abort"],
      ],
    };
    const m = guessMapping(t);
    expect(m.lifecycle).toBe("lifecycle:transition");
    const r = ingestTable(t, m);
    expect(r.events.map((e) => e.lifecycle)).toEqual(["start", "complete", "other", "start", "abort"]);
    const counts = Object.fromEntries(r.report.issues.map((i) => [i.id, i.count]));
    expect(counts).toMatchObject({ "lifecycle-paired": 1, "lifecycle-open-starts": 1, "lifecycle-other": 1 });
    const log = buildLog(r.events);
    expect(log.cases[0]!.events.map((e) => e.p)).toEqual([20 * 60_000]);
  });

  it("guesses an event ID column only when its values are unique", () => {
    const rows = [["1", "A", "2026-03-02T09:00Z", "x1"], ["1", "B", "2026-03-02T10:00Z", "x2"]];
    expect(guessMapping({ headers: ["case_id", "activity", "timestamp", "event_id"], rows }).eventId).toBe("event_id");
    const dup = [["1", "A", "2026-03-02T09:00Z", "x1"], ["1", "B", "2026-03-02T10:00Z", "x1"]];
    expect(guessMapping({ headers: ["case_id", "activity", "timestamp", "event_id"], rows: dup }).eventId).toBeNull();
  });

  it("warns when day/month order is a guess", () => {
    const t: Table = { headers: ["c", "a", "d"], rows: [["1", "A", "01/02/2026"], ["1", "B", "03/04/2026"]] };
    const r = ingestTable(t, { caseId: "c", activity: "a", timestamp: "d", resource: null, attributes: [], timestampFormat: "dmy" }).report;
    expect(r.issues.find((i) => i.id === "ambiguous-dates")?.severity).toBe("warning");
  });
});
