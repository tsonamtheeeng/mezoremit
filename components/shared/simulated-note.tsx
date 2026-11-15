import { FlaskConical } from "lucide-react";
import { cn } from "@/lib/client/utils";

/** The one label every sandbox surface carries. Persistent, never dismissible. */
export function SimulatedNote({ children, className }: { children?: React.ReactNode; className?: string }) {
  return (
    <div role="note" className={cn("sim-frame flex gap-2.5 rounded-lg px-3 py-2.5 text-sm", className)}>
      <FlaskConical className="mt-0.5 size-4 shrink-0 text-sim" aria-hidden />
      <div>
        <p className="font-semibold text-foreground">Simulation. No money moves.</p>
        <p className="text-muted-foreground">
          {children ?? "Local payouts are a sandbox demo. No bank, no cash pickup, no real currency is involved."}
        </p>
      </div>
    </div>
  );
}

export function SimulatedTag({ className }: { className?: string }) {
  return (
    <span className={cn("sim-frame inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-sim", className)}>
      <FlaskConical className="size-3" aria-hidden />
      Simulated
    </span>
  );
}
