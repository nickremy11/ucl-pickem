import { useEffect, useState } from "react";

/**
 * Re-renders on an interval so countdowns actually tick.
 *
 * A pick deadline that sits frozen at "3h 12m" while a match is minutes from
 * kickoff is worse than no timer at all — it reads as live information and
 * isn't. Ticks stop when the tab is hidden, since nobody is reading them.
 */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | undefined;

    const start = () => {
      stop();
      setNow(Date.now());
      timer = setInterval(() => setNow(Date.now()), intervalMs);
    };
    const stop = () => {
      if (timer) clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs]);

  return now;
}
