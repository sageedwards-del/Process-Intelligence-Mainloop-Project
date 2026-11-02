import { describe, expect, it } from "vitest";
import {
  WAIT_BATCH,
  WAIT_HUMAN,
  WAIT_INSTANT,
  WAIT_SCHEDULED,
  analyzeBottlenecks,
  buildLog,
  classifyWaits,
  detectWaitContext,
  discoverWorkCalendar,
  parseAnalysisSettings,
  type RawEvent,
  type WorkCalendar,
} from "../src/index.ts";

const H = 3_600_000;
const D = 24 * H;
const MON = Date.UTC(2026, 0, 5); // Monday 5 Jan 2026, 00:00 UTC
const ALWAYS: WorkCalendar = { workDays: [1, 2, 3, 4, 5, 6, 7], startHour: 0, endHour: 24, utcOffsetMinutes: 0 };

describe("discoverWorkCalendar", () => {
  it("learns working hours and days from when people act, centred on midday local", () => {
    // People work 07:00–15:59 UTC on weekdays (08–17 in a UTC+1 office).
    const times: number[] = [];
    for (let day = 0; day < 28; day++) {
      if (day % 7 >= 5) continue;
      for (let h = 7; h < 16; h++) for (let k = 0; k < 3; k++) times.push(MON + day * D + h * H + k * 600_000);
    }
    const { calendar, source } = discoverWorkCalendar(times);
    expect(source).toBe("discovered");
    expect(calendar.workDays).toEqual([1, 2, 3, 4, 5]);
    // Nine active hours centred on 13:00 local: 08:00–17:00 with UTC+1 (rounded).
    expect(calendar.endHour - calendar.startHour).toBe(9);
    expect(calendar.startHour + calendar.utcOffsetMinutes / -60).toBe(7);
  });

  it("falls back to Monday–Friday 9–17 with too few events", () => {
    expect(discoverWorkCalendar([MON]).source).toBe("default");
  });
});

/** Cases with a submit by a person, then a step whose timing the test controls. */
function log(next: (i: number, submitted: number) => RawEvent[], cases = 30): ReturnType<typeof buildLog> {
  const rows: RawEvent[] = [];
  for (let i = 0; i < cases; i++) {
    const submitted = MON + (i % 5) * D + 9 * H + i * 7 * 60_000; // spread over a week's mornings
    rows.push({ caseId: `c${i}`, activity: "Submit", timestamp: submitted, resource: `clerk${i % 3}` });
    rows.push(...next(i, submitted));
  }
  return buildLog(rows);
}

describe("classifyWaits", () => {
  it("reads steps recorded at local midnight as planned dates", () => {
    // Trips start on a date entered by the employee: 23:00 UTC is midnight in UTC+1.
    const l = log((i, s) => [{ caseId: `c${i}`, activity: "Start trip", timestamp: Math.floor(s / D) * D + (3 + (i % 4)) * D + 23 * H, resource: "employee" }]);
    const cls = classifyWaits(l, { calendar: { ...ALWAYS, utcOffsetMinutes: 60 } });
    expect(cls.scheduled).toEqual([expect.objectContaining({ activity: "Start trip", source: "detected" })]);
    expect(cls.kinds.every((k) => k[1] === WAIT_SCHEDULED)).toBe(true);
  });

  it("reads a step done for many cases at once as a batch, and its runs", () => {
    // Payment runs at 10:00 on Tuesdays and Thursdays: this week's two and next Tuesday's.
    const run = (s: number) => {
      let t = Math.floor(s / D) * D + 10 * H;
      while (t <= s || ![2, 4].includes(new Date(t).getUTCDay())) t += D;
      return t;
    };
    const l = log((i, s) => [{ caseId: `c${i}`, activity: "Pay", timestamp: run(s), resource: "Payment Run" }]);
    const cls = classifyWaits(l, { calendar: ALWAYS });
    expect(cls.scheduled).toEqual([]); // 10:00 isn't midnight: a job, not a date
    expect(cls.kinds.every((k) => k[1] === WAIT_BATCH)).toBe(true);
    expect(cls.batches).toEqual([expect.objectContaining({ id: "batch:Pay@Payment Run", events: 30, runs: 3, casesPerRun: 10 })]);
    expect(cls.systemResources).toEqual([expect.objectContaining({ resource: "Payment Run", source: "batches" })]);
  });

  it("keeps a batch a batch when the log is filtered, by reusing the full log's context", () => {
    const l = log((i, s) => [{ caseId: `c${i}`, activity: "Pay", timestamp: Math.floor(s / D) * D + 8 * D + 10 * H, resource: "Payment Run" }]);
    const two = { ...l, cases: l.cases.slice(0, 2) };
    expect(classifyWaits(two, { calendar: ALWAYS }).kinds.every((k) => k[1] === WAIT_HUMAN)).toBe(true);
    const ctx = detectWaitContext(l, { calendar: ALWAYS });
    expect(classifyWaits(two, {}, ctx).kinds.every((k) => k[1] === WAIT_BATCH)).toBe(true);
  });

  it("tells automatic steps from human ones, and honours overrides", () => {
    const l = log((i, s) => [{ caseId: `c${i}`, activity: "Approve", timestamp: s + (i % 2 ? 5_000 : 3 * H + i * 60_000), resource: `boss${i % 4}` }]);
    const cls = classifyWaits(l, { calendar: ALWAYS });
    expect(cls.kinds.filter((k) => k[1] === WAIT_INSTANT)).toHaveLength(15);
    expect(cls.kinds.filter((k) => k[1] === WAIT_HUMAN)).toHaveLength(15);
    const forced = classifyWaits(l, { calendar: ALWAYS, scheduledActivities: ["Approve"], systemResources: ["boss0"] });
    expect(forced.kinds.every((k) => k[1] === WAIT_SCHEDULED)).toBe(true);
    expect(forced.systemResources.map((r) => r.resource)).toEqual(["boss0"]);
  });

  it("finds no date steps in a date-only log, where every step looks like one", () => {
    const rows: RawEvent[] = [];
    for (let i = 0; i < 40; i++) {
      rows.push({ caseId: `c${i}`, activity: "A", timestamp: MON + i * D });
      rows.push({ caseId: `c${i}`, activity: "B", timestamp: MON + (i + 2) * D });
    }
    expect(classifyWaits(buildLog(rows)).scheduled).toEqual([]);
  });
});

describe("analyzeBottlenecks wait breakdown", () => {
  it("splits each transition's wait into queue, off-hours, batch and planned time that add up", () => {
    const l = log((i, s) => [
      { caseId: `c${i}`, activity: "Approve", timestamp: s + (i % 2 ? 5_000 : 30 * H + i * 60_000), resource: `boss${i % 4}` },
      { caseId: `c${i}`, activity: "Start trip", timestamp: Math.floor(s / D) * D + 9 * D + 23 * H, resource: "employee" },
    ]);
    const report = analyzeBottlenecks(l, undefined, { settings: { calendar: { workDays: [1, 2, 3, 4, 5], startHour: 8, endHour: 17, utcOffsetMinutes: 60 } } });
    for (const e of report.edges) {
      const b = e.breakdown;
      expect(b.queueHours + b.offHoursHours + b.batchHours + b.scheduledHours).toBeCloseTo(e.totalWaitHours, 6);
    }
    const approve = report.edges.find((e) => e.to === "Approve")!;
    expect(approve).toMatchObject({ kind: "queue", automaticShare: 0.5 });
    expect(approve.breakdown.offHoursHours).toBeGreaterThan(0);
    const trip = report.edges.find((e) => e.to === "Start trip")!;
    expect(trip).toMatchObject({ kind: "scheduled", excessWaitHours: 0, delayCost: 0 });
  });

  it("sets a few stuck cases apart, so they can't outrank a step that is slow every day", () => {
    // 40 approvals: 38 take 1–38 h, 2 are forgotten for 1,000 h.
    const l = log((i, s) => [{ caseId: `c${i}`, activity: "Approve", timestamp: s + (i < 38 ? (i + 1) * H : 1000 * H) + i * 1000, resource: `boss${i % 4}` }], 40);
    const [edge] = analyzeBottlenecks(l, undefined, { settings: { calendar: ALWAYS } }).edges;
    expect(edge!.stuckCount).toBe(2);
    const p75 = edge!.targetHours;
    // Each wait counts up to the 95th percentile; the forgotten cases' remainder is stuck time.
    expect(edge!.excessWaitHours).toBeLessThan(2 * (1000 - p75));
    const waits = Array.from({ length: 40 }, (_, i) => (i < 38 ? i + 1 : 1000) + (i * 1000) / H);
    const beyondNormal = waits.reduce((sum, w) => sum + Math.max(0, w - p75), 0);
    expect(edge!.excessWaitHours + edge!.stuckHours).toBeCloseTo(beyondNormal, 6);
    expect(edge!.stuckHours).toBeGreaterThan(1500);
  });

  it("never prices a planned wait, even when a time rule is broken", () => {
    const l = log((i, s) => [
      { caseId: `c${i}`, activity: "Start trip", timestamp: Math.floor(s / D) * D + 20 * D + 23 * H, resource: "employee", attrs: { amount: 1000 } },
    ]);
    const report = analyzeBottlenecks(
      l,
      { currency: "EUR", hourlyRate: 50, handlingMinutes: {}, defaultHandlingMinutes: 10, delayCostPerCaseDay: 5, ruleImpacts: { late: { category: "time", perViolation: 10 } } },
      { settings: { calendar: { ...ALWAYS, utcOffsetMinutes: 60 } }, rules: [{ id: "late", name: "Within a week", type: "sla", from: "Submit", to: "Start trip", maxHours: 168 }] },
    );
    expect(report.edges.every((e) => e.delayCost === 0)).toBe(true);
  });
});

describe("parseAnalysisSettings", () => {
  it("keeps valid choices and drops anything else", () => {
    expect(
      parseAnalysisSettings({
        scheduledActivities: ["Start trip", 3, ""],
        notScheduled: "End trip",
        systemResources: ["batch_06"],
        normalWaitPercentile: 0.9,
        calendar: { workDays: [1, 2, 3, 4, 5], startHour: 8, endHour: 17, utcOffsetMinutes: 60 },
        extra: true,
      }),
    ).toEqual({
      scheduledActivities: ["Start trip"],
      systemResources: ["batch_06"],
      normalWaitPercentile: 0.9,
      calendar: { workDays: [1, 2, 3, 4, 5], startHour: 8, endHour: 17, utcOffsetMinutes: 60 },
    });
    expect(parseAnalysisSettings({ normalWaitPercentile: 2, calendar: { startHour: 20, endHour: 4 } })).toEqual({});
    expect(parseAnalysisSettings(null)).toEqual({});
  });
});
