/** Kickoff times are stored in UTC and always shown in the viewer's own zone. */
export function kickoffLabel(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: tz,
  }).format(new Date(iso));
}

export function dayLabel(iso: string, tz?: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: tz,
  }).format(new Date(iso));
}

/**
 * Compact "3h 12m" copy. Returns null once the moment has passed.
 *
 * Resolution tightens as the deadline nears — days out, nobody cares about
 * minutes; inside the last hour, seconds are the whole point.
 */
export function countdown(iso: string, now = Date.now()): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/** True inside the last hour, when a deadline deserves visual urgency. */
export function isUrgent(iso: string, now = Date.now()): boolean {
  const ms = new Date(iso).getTime() - now;
  return ms > 0 && ms < 60 * 60 * 1000;
}

/** Handicaps read as +1.5 / -1.5, never as "1.5". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
