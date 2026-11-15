"use client";

import { useEffect, useState } from "react";

/** Current time in ms, re-rendering every `everyMs`. Used for countdowns and expiry checks. */
export function useNow(everyMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [everyMs]);
  return now;
}
