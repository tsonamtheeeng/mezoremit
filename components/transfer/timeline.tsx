import { CircleCheck, CircleDot, FlaskConical } from "lucide-react";
import type { TimelineEntry, Transfer } from "@/lib/api-types";
import { formatDateTime } from "@/lib/client/format";
import { sourceLabel, splitTimeline, timelineTitle } from "@/lib/client/status";
import { cn } from "@/lib/client/utils";
import { TxLink } from "@/components/shared/address";

function SourceIcon({ source }: { source: TimelineEntry["source"] }) {
  if (source === "chain") return <CircleCheck className="size-5 text-ok" aria-hidden />;
  if (source === "sandbox") return <FlaskConical className="size-5 text-sim" aria-hidden />;
  return <CircleDot className="size-5 text-idle" aria-hidden />;
}

function Step({ e, role, last }: { e: TimelineEntry; role: Transfer["role"]; last: boolean }) {
  const src = sourceLabel(e.source);
  return (
    <li className="relative grid grid-cols-[1.25rem_1fr] gap-x-3 pb-5 last:pb-0" data-source={e.source}>
      {!last ? (
        <span
          aria-hidden
          className={cn("absolute top-6 bottom-0 left-[0.6rem] w-px", e.source === "sandbox" ? "border-l border-dashed border-sim/60" : "bg-border")}
        />
      ) : null}
      <span className="mt-0.5 bg-background">
        <SourceIcon source={e.source} />
      </span>
      <div className={cn("min-w-0", e.source === "sandbox" && "sim-frame -mt-1 rounded-lg px-3 py-2")}>
        <p className="text-sm font-medium">{timelineTitle(e, role)}</p>
        <p className="text-[0.8125rem] text-muted-foreground">
          <time dateTime={e.at}>{formatDateTime(e.at)}</time>
          <span aria-hidden> · </span>
          <span className={cn(e.source === "chain" && "font-medium text-ok", e.source === "sandbox" && "font-semibold text-sim")} title={src.long}>
            {src.short}
          </span>
        </p>
        {e.detail ? <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">{e.detail}</p> : null}
        {e.source === "chain" && e.txHash ? <TxLink hash={e.txHash} label="Check on the explorer" className="mt-0.5" /> : null}
      </div>
    </li>
  );
}

/** Rendered exactly from Transfer.timeline. MUSD settlement and the simulated payout are separate lists. */
export function Timeline({ entries, role = "sender", legend = true }: { entries: TimelineEntry[]; role?: Transfer["role"]; legend?: boolean }) {
  const { settlement, payout } = splitTimeline(entries);
  return (
    <div className="space-y-6">
      <section aria-labelledby="tl-settle">
        <h3 id="tl-settle" className="mb-3 text-sm font-semibold">
          MUSD on Mezo
        </h3>
        {settlement.length ? (
          <ol>
            {settlement.map((e, i) => (
              <Step key={`${e.kind}-${e.at}-${i}`} e={e} role={role} last={i === settlement.length - 1} />
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No steps yet.</p>
        )}
      </section>
      {payout.length ? (
        <section aria-labelledby="tl-payout">
          <h3 id="tl-payout" className="mb-1 text-sm font-semibold">
            Local payout (simulated)
          </h3>
          <p className="mb-3 text-[0.8125rem] text-muted-foreground">A sandbox demo. No bank was involved and no money moved.</p>
          <ol>
            {payout.map((e, i) => (
              <Step key={`${e.kind}-${e.at}-${i}`} e={e} role={role} last={i === payout.length - 1} />
            ))}
          </ol>
        </section>
      ) : null}
      {legend ? (
      <dl className="grid gap-1.5 border-t pt-4 text-[0.8125rem] text-muted-foreground sm:grid-cols-3">
        {(["chain", "app", "sandbox"] as const).map((s) => (
          <div key={s} className="flex items-start gap-2">
            <dt className="mt-px shrink-0">
              <SourceIcon source={s} />
            </dt>
            <dd>
              <span className="font-medium text-foreground">{sourceLabel(s).short}.</span> {sourceLabel(s).long}
            </dd>
          </div>
        ))}
      </dl>
      ) : null}
    </div>
  );
}
