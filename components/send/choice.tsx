import type { ReactNode } from "react";
import { cn } from "@/lib/client/utils";

/** Accessible radio "card" built on a native radio input (keyboard + screen readers for free). */
export function Choice({
  name,
  value,
  checked,
  onChange,
  title,
  body,
  aside,
  disabled,
}: {
  name: string;
  value: string;
  checked: boolean;
  onChange: (v: string) => void;
  title: ReactNode;
  body?: ReactNode;
  aside?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <label
      className={cn(
        "relative flex cursor-pointer items-start gap-3 rounded-xl border bg-card px-4 py-3.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
        checked ? "border-brand bg-brand-soft/50" : "hover:border-input",
        disabled && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-1 size-4 shrink-0 accent-[var(--brand)]"
      />
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{title}</span>
        {body ? <span className="mt-0.5 block text-[0.8125rem] text-muted-foreground">{body}</span> : null}
      </span>
      {aside ? <span className="shrink-0">{aside}</span> : null}
    </label>
  );
}
