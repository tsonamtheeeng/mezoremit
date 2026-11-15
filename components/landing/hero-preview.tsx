"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import type { TimelineEntry } from "@/lib/api-types";
import { Timeline } from "@/components/transfer/timeline";
import { StatusText } from "@/components/shared/status-badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useMounted } from "@/hooks/use-mounted";

/** A real <Timeline> rendered with clearly labelled example entries. */
export function HeroPreview() {
  const reduce = useReducedMotion();
  const mounted = useMounted();
  // Times are relative to page load so the example never looks stale.
  const [base] = useState(() => Date.now() - 6 * 60_000);
  const at = (m: number) => new Date(base + m * 60_000).toISOString();
  const entries: TimelineEntry[] = [
    { kind: "created", at: at(0), txHash: null, source: "app" },
    { kind: "funded", at: at(1), txHash: null, source: "chain" },
    { kind: "link_shared", at: at(2), txHash: null, source: "app" },
    { kind: "claimed", at: at(5), txHash: null, source: "chain" },
  ];
  return (
    <motion.figure
      initial={reduce ? false : { opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
      className="rounded-xl border bg-card p-5 shadow-panel sm:p-6"
    >
      <div className="mb-5 flex items-baseline justify-between gap-4 border-b pb-4">
        <div>
          <p className="text-[0.8125rem] text-muted-foreground">Claim link to Manila</p>
          <p className="num font-display text-2xl font-semibold tracking-[-0.03em]">25.00 MUSD</p>
          <p className="num mt-0.5 text-[0.8125rem] text-muted-foreground">about ₱1,450.00 PHP at the reference rate</p>
        </div>
        <StatusText status="claimed" />
      </div>
      {mounted ? <Timeline entries={entries} role="sender" legend={false} /> : <Skeleton className="h-56 w-full" />}
      <figcaption className="mt-4 text-[0.8125rem] text-muted-foreground">Example of the tracking page. Your own transfers show real data.</figcaption>
    </motion.figure>
  );
}
