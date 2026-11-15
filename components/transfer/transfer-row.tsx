import Link from "next/link";
import { ArrowDownLeft, ArrowUpRight, ChevronRight } from "lucide-react";
import type { Transfer } from "@/lib/api-types";
import { musd, relativeTime, shortAddress } from "@/lib/client/format";
import { methodLabel } from "@/lib/client/status";
import { StatusText } from "@/components/shared/status-badge";

export function counterpartyLabel(t: Transfer): string {
  if (t.role === "recipient") return t.senderDisplayName ?? `From ${shortAddress(t.senderAddress)}`;
  if (t.recipient?.displayName) return t.recipient.displayName;
  if (t.recipient?.walletAddress) return shortAddress(t.recipient.walletAddress);
  return t.method === "claim" ? "Claim link" : "Recipient";
}

export function TransferRow({ t }: { t: Transfer }) {
  const incoming = t.role === "recipient";
  const Icon = incoming ? ArrowDownLeft : ArrowUpRight;
  return (
    <li>
      <Link href={`/transfers/${t.id}`} className="group flex items-center gap-3 px-4 py-3.5 hover:bg-surface focus-visible:bg-surface">
        <span className={`flex size-9 shrink-0 items-center justify-center rounded-full ${incoming ? "bg-ok-soft text-ok" : "bg-brand-soft text-brand-ink"}`}>
          <Icon className="size-4" aria-hidden />
          <span className="sr-only">{incoming ? "Received" : "Sent"}</span>
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{counterpartyLabel(t)}</span>
          <span className="block text-[0.8125rem] text-muted-foreground">
            {methodLabel(t.method)} · {t.destinationCountry} · <time dateTime={t.createdAt}>{relativeTime(t.createdAt)}</time>
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="num block text-sm font-semibold">
            {incoming ? "+" : ""}
            {musd(t.amount)}
          </span>
          <StatusText status={t.status} className="justify-end" />
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden />
      </Link>
    </li>
  );
}

export function TransferList({ transfers }: { transfers: Transfer[] }) {
  return (
    <ul className="divide-y overflow-hidden rounded-xl border bg-card">
      {transfers.map((t) => (
        <TransferRow key={t.id} t={t} />
      ))}
    </ul>
  );
}
