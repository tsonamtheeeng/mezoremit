"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/client/utils";

export async function copyText(value: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    toast.error("Couldn't copy. Select the text and copy it yourself.");
    return false;
  }
}

export function CopyButton({
  value,
  label = "Copy",
  text,
  className,
  onCopied,
  variant = "outline",
}: {
  value: string;
  label?: string;
  text?: string;
  className?: string;
  onCopied?: () => void;
  variant?: "outline" | "default" | "secondary";
}) {
  const [done, setDone] = useState(false);
  async function copy() {
    if (await copyText(value)) {
      setDone(true);
      onCopied?.();
      setTimeout(() => setDone(false), 1600);
    }
  }
  if (text) {
    return (
      <Button type="button" variant={variant} onClick={copy} className={className}>
        {done ? <Check aria-hidden /> : <Copy aria-hidden />}
        <span aria-live="polite">{done ? "Copied" : text}</span>
      </Button>
    );
  }
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={done ? "Copied" : label}
      className={cn(
        "inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
        className,
      )}
    >
      {done ? <Check className="size-3.5" aria-hidden /> : <Copy className="size-3.5" aria-hidden />}
    </button>
  );
}
