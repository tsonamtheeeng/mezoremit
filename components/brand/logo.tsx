import { cn } from "@/lib/client/utils";

/** The mark: a cobalt tile with an arrow crossing a border line. Plain geometry, no illustration. */
export function Mark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="var(--brand, #2759bc)" />
      <path d="M16 7v18" stroke="var(--brand-foreground, #f7f8fc)" strokeOpacity="0.45" strokeWidth="2" strokeLinecap="round" strokeDasharray="2.5 3" />
      <path d="M8 16h15m-4.5-5 5 5-5 5" fill="none" stroke="var(--brand-foreground, #f7f8fc)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <Mark size={26} />
      <span className="font-display text-[1.0625rem] font-semibold tracking-[-0.02em]">MezoRemit</span>
    </span>
  );
}
