import { DAY_MS, HOUR_MS } from "./stats.ts";

/**
 * Working hours used to measure waits in business time. A case waiting from
 * Friday 16:00 to Monday 10:00 has waited 66 calendar hours but only 2 working
 * hours (with 9–17 days), which is the fairer number when judging people or
 * queues. Money still accrues on calendar time, so delay costs keep using it.
 */
export interface WorkCalendar {
  /** ISO weekdays worked: 1 = Monday … 7 = Sunday. */
  workDays: number[];
  /** Local start and end of the working day, in hours (e.g. 9 and 17.5). */
  startHour: number;
  endHour: number;
  /** Local time minus UTC, in minutes (60 for CET). Daylight saving is not modelled. */
  utcOffsetMinutes: number;
  /** Local dates ("YYYY-MM-DD") that are not worked. */
  holidays?: string[];
}

export const DEFAULT_WORK_CALENDAR: WorkCalendar = {
  workDays: [1, 2, 3, 4, 5],
  startHour: 9,
  endHour: 17,
  utcOffsetMinutes: 0,
};

/** Throws if the calendar can't be used (e.g. a night shift crossing midnight). */
export function validateWorkCalendar(cal: WorkCalendar): void {
  if (!(cal.startHour >= 0 && cal.endHour <= 24 && cal.startHour < cal.endHour)) {
    throw new Error(`Working day must satisfy 0 <= start < end <= 24 (got ${cal.startHour}–${cal.endHour})`);
  }
  if (cal.workDays.length === 0 || cal.workDays.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) {
    throw new Error("workDays must list ISO weekdays 1–7");
  }
}

/** Working milliseconds between two instants (0 if `to` <= `from`). */
export function workingMs(from: number, to: number, cal: WorkCalendar): number {
  if (to <= from) return 0;
  const offset = cal.utcOffsetMinutes * 60_000;
  const lo = from + offset;
  const hi = to + offset;
  const open = cal.startHour * HOUR_MS;
  const close = cal.endHour * HOUR_MS;
  const holidays = cal.holidays?.length ? new Set(cal.holidays) : null;
  let total = 0;
  for (let day = Math.floor(lo / DAY_MS) * DAY_MS; day < hi; day += DAY_MS) {
    // 1 Jan 1970 was a Thursday (ISO 4). Avoids allocating a Date per day in hot loops.
    const weekday = ((((Math.floor(day / DAY_MS) + 3) % 7) + 7) % 7) + 1;
    if (!cal.workDays.includes(weekday)) continue;
    if (holidays?.has(new Date(day).toISOString().slice(0, 10))) continue;
    const start = Math.max(lo, day + open);
    const end = Math.min(hi, day + close);
    if (end > start) total += end - start;
  }
  return total;
}
