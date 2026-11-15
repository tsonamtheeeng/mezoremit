import type { TransferStatus } from "@/lib/api-types";
import { statusCopy, type Tone } from "@/lib/client/status";
import { cn } from "@/lib/client/utils";

export const TONE_CLASS: Record<Tone, string> = {
  ok: "text-ok",
  pending: "text-brand-ink",
  warn: "text-warn",
  bad: "text-bad",
  idle: "text-muted-foreground",
};

const DOT: Record<Tone, string> = {
  ok: "bg-ok",
  pending: "bg-brand",
  warn: "bg-warn",
  bad: "bg-bad",
  idle: "bg-idle",
};

/** Status as a word with a small semantic dot. Not a pill: it sits in text. */
export function StatusText({ status, className }: { status: TransferStatus; className?: string }) {
  const c = statusCopy(status);
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[0.8125rem] font-medium", TONE_CLASS[c.tone], className)}>
      <span className={cn("size-1.5 rounded-full", DOT[c.tone])} aria-hidden />
      {c.label}
    </span>
  );
}

export function ToneText({ tone, children, className }: { tone: Tone; children: React.ReactNode; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-[0.8125rem] font-medium", TONE_CLASS[tone], className)}>
      <span className={cn("size-1.5 rounded-full", DOT[tone])} aria-hidden />
      {children}
    </span>
  );
}
