import { ExternalLink } from "lucide-react";
import { explorerAddress, explorerTx } from "@/lib/chain/config";
import { shortAddress, shortHash } from "@/lib/client/format";
import { cn } from "@/lib/client/utils";
import { CopyButton } from "./copy-button";

export function AddressText({
  address,
  link = true,
  copy = true,
  className,
}: {
  address: string | null | undefined;
  link?: boolean;
  copy?: boolean;
  className?: string;
}) {
  if (!address) return <span className="text-muted-foreground">--</span>;
  const body = <span className="font-mono text-[0.8125rem]">{shortAddress(address)}</span>;
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} title={address}>
      {link ? (
        <a href={explorerAddress(address)} target="_blank" rel="noreferrer" className="underline-offset-4 hover:underline">
          {body}
          <span className="sr-only"> (opens the Mezo explorer)</span>
        </a>
      ) : (
        body
      )}
      {copy ? <CopyButton value={address} label="Copy full address" /> : null}
    </span>
  );
}

export function TxLink({ hash, label, className }: { hash: string | null | undefined; label?: string; className?: string }) {
  if (!hash) return null;
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noreferrer"
      className={cn("inline-flex items-center gap-1 text-[0.8125rem] font-medium text-brand-ink underline-offset-4 hover:underline", className)}
    >
      <span className={label ? undefined : "font-mono"}>{label ?? shortHash(hash)}</span>
      <ExternalLink className="size-3.5" aria-hidden />
      <span className="sr-only">(opens the Mezo explorer)</span>
    </a>
  );
}
