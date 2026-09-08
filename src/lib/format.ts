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

/** Compact "locks in 3h 12m" copy. Returns null once the moment has passed. */
export function countdown(iso: string, now = Date.now()): string | null {
  const ms = new Date(iso).getTime() - now;
  if (ms <= 0) return null;

  const mins = Math.floor(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const minutes = mins % 60;

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/** Handicaps read as +1.5 / -1.5, never as "1.5". */
export function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}
