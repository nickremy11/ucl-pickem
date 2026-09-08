/**
 * Timezone helpers.
 *
 * Workers cron triggers fire on UTC. Scheduling "Monday 8:00 AM ET" as a fixed
 * UTC hour silently drifts by an hour twice a year when the US changes clocks,
 * which would move the odds lock relative to team-news releases. So the hourly
 * cron instead asks `Intl` what the wall clock actually reads in the
 * competition timezone. Never hardcode a UTC offset for ET.
 */

export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0 = Sunday, 1 = Monday, ... 6 = Saturday */
  weekday: number;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    // h23 rather than hour12:false — the latter can yield "24" for midnight.
    hourCycle: "h23",
  }).formatToParts(date);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";

  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: Math.max(0, WEEKDAYS.indexOf(get("weekday"))),
  };
}

/** True when the wall clock in `timeZone` reads the given weekday and hour. */
export function isWeekdayHour(
  date: Date,
  timeZone: string,
  weekday: number,
  hour: number,
): boolean {
  const p = zonedParts(date, timeZone);
  return p.weekday === weekday && p.hour === hour;
}

/** True when the wall clock in `timeZone` reads the given hour, any day. */
export function isHour(date: Date, timeZone: string, hour: number): boolean {
  return zonedParts(date, timeZone).hour === hour;
}

/** `YYYY-MM-DD` as seen in `timeZone` — used to key once-per-day cron guards. */
export function zonedDateKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

export const MONDAY = 1;
export const SECOND = 1000;
export const MINUTE = 60 * SECOND;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;
