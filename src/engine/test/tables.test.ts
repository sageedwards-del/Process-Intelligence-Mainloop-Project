import { describe, expect, it } from "vitest";
import { ingestTable, spreadsheetDateToString, tableFromGrid, tableFromRecords, xesMapping } from "../src/index.ts";

// Readers hand dates over as Dates whose UTC fields are the cell's wall clock.
const wall = (iso: string) => new Date(`${iso}Z`);

describe("spreadsheetDateToString", () => {
  it("writes the wall-clock time without an offset", () => {
    expect(spreadsheetDateToString(wall("2026-03-02T09:05:07"))).toBe("2026-03-02T09:05:07");
    expect(spreadsheetDateToString(wall("2026-03-02T09:05:07.250"))).toBe("2026-03-02T09:05:07.250");
    expect(spreadsheetDateToString(wall("2026-03-02T00:00:00"), true)).toBe("2026-03-02");
  });

  it("undoes a reader flooring the serial a millisecond short", () => {
    // Serial 46083.416666… (2026-03-02 10:00) floored to whole milliseconds.
    expect(spreadsheetDateToString(new Date(wall("2026-03-02T10:00:00").getTime() - 1))).toBe("2026-03-02T10:00:00");
    expect(spreadsheetDateToString(new Date(wall("2026-03-02T10:00:00").getTime() + 1))).toBe("2026-03-02T10:00:00");
    expect(spreadsheetDateToString(new Date(wall("2026-03-02T10:00:00").getTime() - 2))).toBe("2026-03-02T09:59:59.998");
  });

  it("returns empty for an invalid date", () => {
    expect(spreadsheetDateToString(new Date(Number.NaN))).toBe("");
  });
});

describe("tableFromGrid", () => {
  it("uses the first non-empty row as headers and drops empty rows and trailing columns", () => {
    const table = tableFromGrid([
      [null, null, null],
      ["Case", "Activity", "", null],
      ["C1", "Receive", null, ""],
      [null, "", null],
      ["C1", "Approve", 12.5, null],
    ]);
    expect(table.headers).toEqual(["Case", "Activity", "Column 3"]);
    expect(table.rows).toEqual([
      ["C1", "Receive", ""],
      ["C1", "Approve", "12.5"],
    ]);
  });

  it("makes repeated headers unique", () => {
    expect(tableFromGrid([["Date", "Date", "Date"], ["a", "b", "c"]]).headers).toEqual(["Date", "Date (2)", "Date (3)"]);
  });

  it("writes date columns as timestamps, or as dates when every value is midnight", () => {
    const table = tableFromGrid([
      ["Case", "Done", "Due", "Paid"],
      ["C1", wall("2026-03-02T09:00:00"), wall("2026-03-05T00:00:00"), true],
      ["C1", wall("2026-03-03T00:00:00"), wall("2026-03-06T00:00:00"), false],
    ]);
    expect(table.rows).toEqual([
      ["C1", "2026-03-02T09:00:00", "2026-03-05", "true"],
      ["C1", "2026-03-03T00:00:00", "2026-03-06", "false"],
    ]);
  });

  it("feeds the CSV path: mapping guesses and the quality report work unchanged", () => {
    const table = tableFromGrid([
      ["Case ID", "Activity", "Timestamp", "Resource"],
      ["C1", "Receive", wall("2026-03-02T09:00:00"), "ana"],
      ["C1", "Approve", wall("2026-03-02T11:30:00"), "ben"],
      ["C2", "Receive", wall("2026-03-03T08:00:00"), "ana"],
      ["C2", "Approve", wall("2026-03-04T10:00:00"), "ben"],
    ]);
    const { events, report } = ingestTable(table, {
      caseId: "Case ID",
      activity: "Activity",
      timestamp: "Timestamp",
      resource: "Resource",
      attributes: [],
      timestampFormat: "iso",
    });
    expect(events).toHaveLength(4);
    expect(events[1]!.timestamp).toBe(Date.UTC(2026, 2, 2, 11, 30));
    expect(report.issues.map((i) => i.id)).toContain("no-timezone");
  });

  it("returns an empty table for an empty sheet", () => {
    expect(tableFromGrid([[], [null, ""]])).toEqual({ headers: [], rows: [] });
  });
});

describe("tableFromRecords and xesMapping", () => {
  // The shape the miner's POST /import/xes returns with lifecycle=all.
  const events = [
    { case_id: "A1", activity: "W_Call", timestamp: "2016-01-01T09:00:00Z", resource: "User_1", "lifecycle:transition": "start", EventID: "e1", amount: 5000 },
    { case_id: "A1", activity: "W_Call", timestamp: "2016-01-01T09:20:00Z", resource: "User_1", "lifecycle:transition": "complete", EventID: "e2", amount: 5000 },
    { case_id: "A1", activity: "O_Sent", timestamp: "2016-01-02T10:00:00Z", resource: null, "lifecycle:transition": "complete", EventID: "e3", amount: 5000, accepted: true },
    { case_id: "A2", activity: "W_Call", timestamp: "2016-01-03T09:00:00Z", resource: "User_2", "lifecycle:transition": "complete", EventID: "e4", amount: 800 },
  ];

  it("puts the leading columns first and every other key after, blank where missing", () => {
    const table = tableFromRecords(events, ["case_id", "activity", "timestamp", "resource"]);
    expect(table.headers).toEqual(["case_id", "activity", "timestamp", "resource", "lifecycle:transition", "EventID", "amount", "accepted"]);
    expect(table.rows[2]).toEqual(["A1", "O_Sent", "2016-01-02T10:00:00Z", "", "complete", "e3", "5000", "true"]);
    expect(table.rows[0]![7]).toBe("");
  });

  it("maps the standard columns, lifecycle and event id, keeping the rest as attributes", () => {
    const table = tableFromRecords(events, ["case_id", "activity", "timestamp", "resource"]);
    const mapping = xesMapping(table);
    expect(mapping).toEqual({
      caseId: "case_id",
      activity: "activity",
      timestamp: "timestamp",
      resource: "resource",
      attributes: ["amount", "accepted"],
      timestampFormat: "iso",
      eventId: "EventID",
      lifecycle: "lifecycle:transition",
    });
    const { events: out, report } = ingestTable(table, mapping);
    expect(out[0]).toMatchObject({ lifecycle: "start", eventId: "e1", timestamp: Date.UTC(2016, 0, 1, 9) });
    expect(report.issues.map((i) => i.id)).toContain("lifecycle-paired");
  });

  it("finds identity:id and leaves resource and lifecycle out when the log has none", () => {
    const table = tableFromRecords(
      [
        { case_id: "c1", activity: "A", timestamp: "2026-03-02T09:00:00Z", "identity:id": "u1" },
        { case_id: "c1", activity: "B", timestamp: "2026-03-02T10:00:00Z", "identity:id": "u2" },
      ],
      ["case_id", "activity", "timestamp", "resource"],
    );
    expect(xesMapping(table)).toMatchObject({ resource: null, lifecycle: null, eventId: "identity:id", attributes: [] });
  });
});
