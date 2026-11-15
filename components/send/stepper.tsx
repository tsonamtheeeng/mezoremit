import { SEND_STEPS, stepIndex, type SendStep } from "@/lib/client/send";
import { cn } from "@/lib/client/utils";

export function Stepper({ step }: { step: SendStep }) {
  const i = stepIndex(step);
  return (
    <nav aria-label="Send money steps" className="mb-8">
      <p className="text-[0.8125rem] text-muted-foreground sm:hidden">
        Step {i + 1} of {SEND_STEPS.length}: <span className="font-medium text-foreground">{SEND_STEPS[i].label}</span>
      </p>
      <ol className="mt-2 grid grid-cols-5 gap-1.5 sm:mt-0 sm:gap-3">
        {SEND_STEPS.map((s, j) => (
          <li key={s.id} aria-current={j === i ? "step" : undefined}>
            <span className={cn("block h-1 rounded-full", j <= i ? "bg-brand" : "bg-border")} aria-hidden />
            <span className={cn("mt-2 hidden text-[0.8125rem] sm:block", j === i ? "font-medium text-foreground" : "text-muted-foreground")}>
              {s.label}
              {j < i ? <span className="sr-only"> (done)</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
