"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useConfig } from "wagmi";
import type { Hex } from "viem";
import { Landmark, Link2 } from "lucide-react";
import { toast } from "sonner";
import type { Transfer } from "@/lib/api-types";
import { buildClaimLink } from "@/lib/chain/claim";
import { forgetClaimKey, loadClaimKey } from "@/lib/client/claim-store";
import { currencyTag, formatDateTime, localMoney, musd, relativeTime } from "@/lib/client/format";
import { methodLabel, PAYOUT_COPY, senderActions, statusCopy } from "@/lib/client/status";
import { appOrigin } from "@/lib/client/site";
import { build, executeWrite } from "@/lib/client/writes";
import { waitForTransferStatus } from "@/lib/client/poll";
import { confirmTransfer, markShared, useCountries, useTransfer } from "@/hooks/use-api";
import { useTx } from "@/hooks/use-tx";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressText, TxLink } from "@/components/shared/address";
import { QueryError } from "@/components/shared/states";
import { StatusText, ToneText } from "@/components/shared/status-badge";
import { SimulatedNote } from "@/components/shared/simulated-note";
import { TxPanel } from "@/components/shared/tx-panel";
import { Timeline } from "./timeline";
import { ClaimLinkPanel } from "./claim-link-panel";

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2.5">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm">{children}</dd>
    </div>
  );
}

const noopSubscribe = () => () => {};

function SenderActions({ t }: { t: Transfer }) {
  const config = useConfig();
  const w = useWallet();
  const tx = useTx();
  const [forgotten, setForgotten] = useState(false);
  const stored = useSyncExternalStore(noopSubscribe, () => loadClaimKey(t.id), () => null);
  const key: Hex | null = forgotten ? null : stored;
  const [showLink, setShowLink] = useState(false);
  const [confirming, setConfirming] = useState<null | "cancel" | "refund">(null);
  const a = senderActions(t);

  const link = useMemo(() => (key ? buildClaimLink(appOrigin(), t.id, key) : null), [key, t.id]);

  async function act(kind: "cancel" | "refund") {
    if (!t.chainTransferId) return;
    const id = BigInt(t.chainTransferId);
    const spec = kind === "cancel" ? build.cancelTransfer(id) : build.refundExpiredTransfer(id);
    const target = kind === "cancel" ? "cancelled" : "refunded";
    const res = await tx.run(spec.label, (hooks) => executeWrite(config, spec, hooks), async () => {
      await confirmTransfer(t.id).catch(() => undefined);
      await waitForTransferStatus(t.id, [target], { timeoutMs: 60_000 });
    });
    if (res) {
      forgetClaimKey(t.id);
      setForgotten(true);
      setConfirming(null);
    }
  }

  if (!a.cancel && !a.refund && !a.copyLink && !a.resumeFunding) return null;

  return (
    <section aria-labelledby="actions-h" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
      <h2 id="actions-h" className="font-semibold">
        What you can do
      </h2>

      {a.resumeFunding ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">You haven&apos;t sent the MUSD yet. Nothing has left your wallet.</p>
          <Button asChild>
            <Link href={`/send?resume=${t.id}`}>Finish sending</Link>
          </Button>
        </div>
      ) : null}

      {a.copyLink ? (
        link ? (
          showLink ? (
            <ClaimLinkPanel
              link={link}
              amountText={musd(t.amount)}
              onShared={(ch) => markShared(t.id, ch).catch(() => undefined)}
              onForget={() => {
                forgetClaimKey(t.id);
                setForgotten(true);
                toast.success("Removed from this browser");
              }}
            />
          ) : (
            <Button variant="outline" onClick={() => setShowLink(true)}>
              <Link2 aria-hidden /> Show claim link again
            </Button>
          )
        ) : (
          <p className="text-sm text-muted-foreground">
            The claim link isn&apos;t stored in this browser, so we can&apos;t show it again. If you lost it, cancel the transfer to get your MUSD back.
          </p>
        )
      ) : null}

      {a.cancel || a.refund ? (
        <div className="space-y-3 border-t pt-4">
          {confirming ? (
            <div role="group" aria-label="Confirm" className="space-y-3">
              <p className="text-sm">
                {confirming === "cancel"
                  ? `Cancel and return ${musd(t.amount)} to your wallet? The claim link stops working.`
                  : `Refund ${musd(t.amount)} to your wallet? The link has expired, so it can't be claimed anymore.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button variant={confirming === "cancel" ? "destructive" : "default"} disabled={tx.isBusy || !w.isReady} onClick={() => act(confirming)}>
                  {confirming === "cancel" ? "Yes, cancel transfer" : "Yes, refund me"}
                </Button>
                <Button variant="ghost" disabled={tx.isBusy} onClick={() => setConfirming(null)}>
                  Keep it
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {a.refund ? <Button onClick={() => setConfirming("refund")}>Refund to my wallet</Button> : null}
              {a.cancel ? (
                <Button variant="outline" onClick={() => setConfirming("cancel")}>
                  Cancel transfer
                </Button>
              ) : null}
            </div>
          )}
          {!w.isReady && confirming ? (
            <p className="text-[0.8125rem] text-warn">Connect your wallet on Mezo Testnet to do this.</p>
          ) : null}
          <TxPanel state={tx.state} />
          <p className="text-[0.8125rem] text-muted-foreground">You pay a small network fee in BTC. The MUSD always goes back to the wallet that sent it.</p>
        </div>
      ) : null}
    </section>
  );
}

export function TransferDetail({ id }: { id: string }) {
  const q = useTransfer(id);
  const countries = useCountries();

  if (q.isLoading) {
    return (
      <div className="space-y-4" aria-busy="true">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-72" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }
  if (q.isError || !q.data) return <QueryError error={q.error} what="this transfer" onRetry={() => q.refetch()} />;

  const t = q.data.transfer;
  const c = statusCopy(t.status);
  const country = countries.data?.countries.find((x) => x.code === t.destinationCountry);
  const isRecipient = t.role === "recipient";
  const received = t.status === "claimed" || t.status === "completed";

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_22rem]">
      <div className="space-y-6">
        <div>
          <p className="text-sm text-muted-foreground">
            {isRecipient ? "Received" : "Sent"} {relativeTime(t.createdAt)}
            {t.recipient?.displayName && !isRecipient ? ` to ${t.recipient.displayName}` : ""}
          </p>
          <h1 className="num mt-1 font-display text-3xl font-semibold tracking-[-0.03em] sm:text-4xl">{musd(t.amount)}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <StatusText status={t.status} />
          </div>
          <p className="mt-2 max-w-prose text-sm" aria-live="polite">
            {isRecipient ? c.recipient : c.sender}
          </p>
        </div>

        <div className="flex gap-2.5 rounded-lg bg-surface px-3 py-2.5 text-[0.8125rem] text-muted-foreground">
          <Landmark className="mt-0.5 size-4 shrink-0" aria-hidden />
          <p>
            This is a transfer of <strong className="font-medium text-foreground">MUSD on Mezo</strong>, a digital dollar. It is not a bank transfer, and no local currency is
            paid out unless a payout is listed separately below.
          </p>
        </div>

        {t.role === "sender" ? <SenderActions t={t} /> : null}

        <section aria-labelledby="timeline-h" className="rounded-xl border bg-card p-4 sm:p-5">
          <h2 id="timeline-h" className="mb-4 font-semibold">
            Tracking
          </h2>
          <Timeline entries={t.timeline} role={t.role} />
        </section>
      </div>

      <aside className="space-y-6">
        <dl className="divide-y rounded-xl border bg-card px-4">
          <Detail label="Delivery">{methodLabel(t.method)}</Detail>
          <Detail label="Destination">{country?.name ?? t.destinationCountry}</Detail>
          <Detail label="From">
            <AddressText address={t.senderAddress} />
          </Detail>
          <Detail label="To">
            {t.recipient?.walletAddress ? <AddressText address={t.recipient.walletAddress} /> : <span className="text-muted-foreground">{t.method === "claim" ? "Whoever claims the link" : "--"}</span>}
          </Detail>
          <Detail label="Service fee">{musd(t.fee)}</Detail>
          {t.expiresAt ? <Detail label="Link expires">{formatDateTime(t.expiresAt)}</Detail> : null}
          {t.fundingTxHash ? (
            <Detail label="Funding transaction">
              <TxLink hash={t.fundingTxHash} />
            </Detail>
          ) : null}
          {t.settlementTxHash ? (
            <Detail label={t.status === "cancelled" ? "Cancel transaction" : t.status === "refunded" ? "Refund transaction" : "Claim transaction"}>
              <TxLink hash={t.settlementTxHash} />
            </Detail>
          ) : null}
          {t.chainTransferId ? <Detail label="On-chain id">{`#${t.chainTransferId}`}</Detail> : null}
        </dl>

        {t.quote?.recipientAmountLocal ? (
          <div className="rounded-xl bg-surface px-4 py-3 text-[0.8125rem] text-muted-foreground">
            When sent, {musd(t.amount)} was about <span className="num font-medium text-foreground">{localMoney(t.quote.recipientAmountLocal, t.quote.destinationCurrency)}</span>{" "}
            (indicative, not paid out).
          </div>
        ) : null}

        {t.payout ? (
          <section aria-labelledby="payout-h" className="space-y-3">
            <h2 id="payout-h" className="font-semibold">
              Local payout
            </h2>
            <SimulatedNote />
            <dl className="divide-y rounded-xl border bg-card px-4">
              <Detail label="Status">
                <ToneText tone={PAYOUT_COPY[t.payout.status].tone}>{PAYOUT_COPY[t.payout.status].label}</ToneText>
              </Detail>
              <Detail label="Amount (simulated)">{localMoney(t.payout.payoutAmount, t.payout.destinationCurrency)}</Detail>
            </dl>
            {isRecipient ? (
              <Button asChild variant="outline" size="sm">
                <Link href={`/payouts/${t.id}`}>Open payout</Link>
              </Button>
            ) : null}
          </section>
        ) : isRecipient && received && country?.support === "sandbox_payout" ? (
          <section className="space-y-2 rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Cash out options</h2>
            <p className="text-sm text-muted-foreground">Try a simulated payout to {currencyTag(country.currency)}. No real money moves.</p>
            <Button asChild variant="outline" size="sm">
              <Link href={`/payouts/${t.id}`}>See options (simulated)</Link>
            </Button>
          </section>
        ) : null}
      </aside>
    </div>
  );
}
