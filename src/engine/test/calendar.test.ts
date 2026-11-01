import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORK_CALENDAR,
  analyzeBottlenecks,
  buildLog,
  validateWorkCalendar,
  workingMs,
  type WorkCalendar,
} from "../src/index.js";
import { H, T0, trace } from "./fixtures.js";

// T0 is Monday 5 Jan 2026, 09:00 UTC.
const at = (hoursFromT0: number) => T0 + hoursFromT0 * H;
const cal = DEFAULT_WORK_CALENDAR; // Mon–Fri, 9–17 UTC

describe("workingMs", () => {
  it("counts only hours inside the working day", () => {
    expect(workingMs(at(1), at(5), cal)).toBe(4 * H);
    expect(workingMs(at(7), at(25), cal)).toBe(2 * H); // Mon 16:00 → Tue 10:00
    expect(workingMs(at(-2), at(0), cal)).toBe(0); // 07:00 → 09:00
  });

  it("skips weekends", () => {
    expect(workingMs(at(103), at(169), cal)).toBe(2 * H); // Fri 16:00 → Mon 10:00 is 66 calendar hours
    expect(workingMs(at(0), at(7 * 24), cal)).toBe(40 * H); // a full week
  });

  it("skips holidays and applies the UTC offset", () => {
    expect(workingMs(at(0), at(32), { ...cal, holidays: ["2026-01-05"] })).toBe(8 * H);
    // CET: 08:30 UTC is 09:30 local, 16:30 UTC is 17:30 local -> 09:30–17:00
    const cet: WorkCalendar = { ...cal, utcOffsetMinutes: 60 };
    expect(workingMs(at(-0.5), at(7.5), cet)).toBe(7.5 * H);
  });

  it("returns 0 for empty or reversed intervals", () => {
    expect(workingMs(at(5), at(5), cal)).toBe(0);
    expect(workingMs(at(5), at(1), cal)).toBe(0);
  });

  it("rejects calendars it can't represent", () => {
    expect(() => validateWorkCalendar({ ...cal, startHour: 22, endHour: 6 })).toThrow();
    expect(() => validateWorkCalendar({ ...cal, workDays: [0] })).toThrow();
    expect(() => validateWorkCalendar(cal)).not.toThrow();
  });
});

describe("analyzeBottlenecks with a work calendar", () => {
  // Fast: Mon 09:00 → 15:00 (6 h, 6 working h). Weekend: Fri 16:00 → Mon 10:00 (66 h, 2 working h).
  // Slow: Tue 09:00 → Fri 09:00 (72 h, 24 working h).
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const [approver, submit, approve] =
      i % 3 === 0 ? ["Fast", 0, 6] : i % 3 === 1 ? ["Weekend", 103, 169] : ["Slow", 24, 96];
    rows.push(...trace(`c${i}`, [["Submit", submit, "Clerk"], ["Approve", approve, approver]]));
  }
  const log = buildLog(rows);
  const cost = { currency: "EUR", hourlyRate: 60, handlingMinutes: {}, defaultHandlingMinutes: 10, delayCostPerCaseDay: 24 };

  it("lets weekends hide a slow approver in calendar time", () => {
    const report = analyzeBottlenecks(log, cost, { minResourceExecutions: 5 });
    expect(report.waitBasis).toBe("calendar");
    expect(report.resources).toEqual([]); // 72 h vs a 66 h median looks normal
    expect(report.edges[0]!.workingWait).toBeUndefined();
  });

  it("finds the slow approver in working time and keeps delay cost on calendar time", () => {
    const report = analyzeBottlenecks(log, cost, { minResourceExecutions: 5, calendar: cal });
    expect(report.waitBasis).toBe("working");
    expect(report.resources).toHaveLength(1);
    const slow = report.resources[0]!;
    expect(slow).toMatchObject({ id: "resource:Approve@Slow", medianWaitHours: 24, activityMedianWaitHours: 6 });
    expect(slow.slowdown).toBe(4);
    expect(slow.excessWaitHours).toBe(180); // 10 × (24 − 6) working hours
    expect(slow.delayCost).toBe(60); // 10 × (72 − 66) calendar hours = 2.5 days × 24 EUR
  });

  it("reports working-time waits per edge", () => {
    const report = analyzeBottlenecks(log, cost, { calendar: cal });
    const edge = report.edges.find((e) => e.id === "edge:Submit → Approve")!;
    expect(edge.totalWaitHours).toBe(10 * (6 + 66 + 72));
    expect(edge.workingWait!.total / H).toBe(10 * (6 + 2 + 24));
  });

  it("rejects an invalid calendar", () => {
    expect(() => analyzeBottlenecks(log, cost, { calendar: { ...cal, startHour: 18 } })).toThrow();
  });
});
