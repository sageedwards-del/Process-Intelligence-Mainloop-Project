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

  it("warns when day/month order is a guess", () => {
    const t: Table = { headers: ["c", "a", "d"], rows: [["1", "A", "01/02/2026"], ["1", "B", "03/04/2026"]] };
    const r = ingestTable(t, { caseId: "c", activity: "a", timestamp: "d", resource: null, attributes: [], timestampFormat: "dmy" }).report;
    expect(r.issues.find((i) => i.id === "ambiguous-dates")?.severity).toBe("warning");
  });
});
