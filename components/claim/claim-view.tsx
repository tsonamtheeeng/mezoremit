"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useConfig, useReadContract } from "wagmi";
import { waitForTransactionReceipt } from "@wagmi/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Address, Hash } from "viem";
import { CircleAlert, CircleCheck, Clock, Gift, Undo2 } from "lucide-react";
import type { ClaimInfo, ClaimViewResponse, RelayClaimResponse } from "@/lib/api-types";
import { remittanceManagerAbi } from "@/lib/chain/abis";
import { contracts, isDeployed, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { signClaim, signViewProof, transferRef } from "@/lib/chain/claim";
import { api, isNotFound } from "@/lib/client/api";
import { chainStatusName, deriveClaimState, INVALID_COPY, readKeyFromHash, type ChainTransferView, type ClaimPageState, type KeyRead } from "@/lib/client/claim-state";
import { currencyTag, formatDateTime, musd, relativeTime } from "@/lib/client/format";
import { SITE } from "@/lib/client/site";
import { build, executeWrite } from "@/lib/client/writes";
import { qk, useClaimInfo, useCountries } from "@/hooks/use-api";
import { useBtcBalance } from "@/hooks/use-musd";
import { useMounted } from "@/hooks/use-mounted";
import { useNow } from "@/hooks/use-now";
import { useTx } from "@/hooks/use-tx";
import { useWallet } from "@/hooks/use-wallet";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AddressText, TxLink } from "@/components/shared/address";
import { TxPanel } from "@/components/shared/tx-panel";
import { ConnectDialog, hasInjectedWallet } from "@/components/wallet/connect-dialog";
import { WalletGuide } from "@/components/wallet/wallet-guide";

/** Presentational part of the claim page: one block per state. Exported for tests. */
export function ClaimStateNotice({ state, amount, expiresAt }: { state: ClaimPageState; amount: string | null; expiresAt: string | null }) {
  const amt = amount ? musd(amount) : "This money";
  switch (state.kind) {
    case "loading":
      return (
        <div className="space-y-3" aria-busy="true" aria-label="Loading">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-64" />
          <Skeleton className="h-4 w-full" />
        </div>
      );
    case "invalid":
      return (
        <Notice icon={<CircleAlert className="size-6 text-bad" aria-hidden />} title={INVALID_COPY[state.reason].title}>
          {INVALID_COPY[state.reason].body}
        </Notice>
      );
    case "unavailable":
      return (
        <Notice icon={<CircleAlert className="size-6 text-warn" aria-hidden />} title="We can't check this link right now">
          Neither MezoRemit nor Mezo Testnet answered. Your money is safe. Try again in a minute.
        </Notice>
      );
    case "not_funded":
      return (
        <Notice icon={<Clock className="size-6 text-muted-foreground" aria-hidden />} title="Not sent yet">
          The sender created this link but hasn&apos;t sent the money yet. Check back soon, or ask them.
        </Notice>
      );
    case "expired":
      return (
        <Notice icon={<Clock className="size-6 text-warn" aria-hidden />} title="This link has expired">
          {amt} wasn&apos;t claimed in time{expiresAt ? ` (it expired ${relativeTime(expiresAt)})` : ""}. The sender can get it back. Ask them to send a new link.
        </Notice>
      );
    case "claim_pending":
      return (
        <Notice icon={<Clock className="size-6 text-brand" aria-hidden />} title="Claim in progress">
          Someone has just claimed {amt}. Waiting for Mezo to confirm.
        </Notice>
      );
    case "claimed":
      return (
        <Notice icon={<CircleCheck className="size-6 text-ok" aria-hidden />} title="Already claimed">
          <span className="block">
            {amt} was claimed{state.claimedBy ? " by " : "."}
            {state.claimedBy ? <AddressText address={state.claimedBy} /> : null}
          </span>
          {state.txHash ? <TxLink hash={state.txHash} label="See it on the explorer" className="mt-1" /> : null}
          <span className="mt-2 block">If that wasn&apos;t you, contact the sender. Whoever opens a claim link first can claim it.</span>
        </Notice>
      );
    case "cancelled":
      return (
        <Notice icon={<Undo2 className="size-6 text-muted-foreground" aria-hidden />} title="The sender cancelled this transfer">
          The money went back to them. {state.txHash ? <TxLink hash={state.txHash} label="See it on the explorer" /> : null}
        </Notice>
      );
    case "refunded":
      return (
        <Notice icon={<Undo2 className="size-6 text-muted-foreground" aria-hidden />} title="Returned to the sender">
          This link expired and the money went back to the sender. {state.txHash ? <TxLink hash={state.txHash} label="See it on the explorer" /> : null}
        </Notice>
      );
    case "claimable":
      return null;
  }
}

function Notice({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3" role="status">
      <div className="mt-1 shrink-0">{icon}</div>
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-[-0.02em]">{title}</h1>
        <div className="mt-2 text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}

function subscribeHash(cb: () => void) {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
}

export function ClaimView({ transferId }: { transferId: string }) {
  const mounted = useMounted();
  const config = useConfig();
  const qc = useQueryClient();
  const w = useWallet();
  const btcQ = useBtcBalance(w.address);
  const tx = useTx();
  const now = useNow(5000);
  const countries = useCountries();
  const [connectOpen, setConnectOpen] = useState(false);
  const [relayFailed, setRelayFailed] = useState(false);
  const [claimedTx, setClaimedTx] = useState<Hash | null>(null);

  // Read the secret from the fragment once, client-side only. It stays in the URL (so a reload works)
  // and is never sent in any request.
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => null);
  const key: KeyRead | null = useMemo(() => (hash === null ? null : readKeyFromHash(hash)), [hash]);

  const info = useClaimInfo(transferId, tx.isBusy);
  const ref = useMemo(() => transferRef(transferId), [transferId]);
  // Refs are unique per sender on-chain, so the lookup needs the funding wallet. The record it returns is then
  // checked against this link's ref below, so a wrong sender can only make the lookup miss, never mislead.
  const senderAddress = info.data?.senderAddress as Address | undefined;
  const idByRef = useReadContract({
    address: contracts.manager,
    abi: remittanceManagerAbi,
    functionName: "transferIdByRef",
    args: senderAddress ? [senderAddress, ref] : undefined,
    chainId: MEZO_TESTNET_ID,
    query: { enabled: isDeployed && Boolean(senderAddress) },
  });
  const chainId = (idByRef.data as bigint | undefined) ?? (info.data?.chainTransferId ? BigInt(info.data.chainTransferId) : undefined);
  const onchain = useReadContract({
    address: contracts.manager,
    abi: remittanceManagerAbi,
    functionName: "getTransfer",
    args: chainId !== undefined ? [chainId] : undefined,
    chainId: MEZO_TESTNET_ID,
    query: { enabled: isDeployed && chainId !== undefined && chainId > 0n, refetchInterval: tx.isBusy ? 4000 : 30_000 },
  });

  const chainView: ChainTransferView | null = useMemo(() => {
    const d = onchain.data as
      | { status: number; claimSigner: string; recipient: string; amount: bigint; expiresAt: bigint | number; ref: string }
      | undefined;
    if (!d || chainId === undefined) return null;
    if (d.ref.toLowerCase() !== ref.toLowerCase()) return null; // not this link's transfer
    return {
      id: chainId,
      status: chainStatusName(d.status),
      claimSigner: d.claimSigner,
      recipient: d.recipient,
      amount: d.amount,
      expiresAt: Number(d.expiresAt),
    };
  }, [onchain.data, chainId, ref]);

  const state = deriveClaimState({
    key: key ?? { ok: false, reason: "missing_key" },
    info: info.data,
    infoLoading: info.isLoading,
    infoNotFound: isNotFound(info.error),
    chain: chainView,
    chainLoading: isDeployed && (idByRef.isLoading || onchain.isLoading),
    nowSec: Math.floor(now / 1000),
  });
  const finalState: ClaimPageState = !mounted || key === null ? { kind: "loading" } : claimedTx ? { kind: "claimed", claimedBy: w.address ?? null, txHash: claimedTx } : state;

  const amount = chainView ? chainView.amount.toString() : info.data?.amount ?? null;
  const expiresAt = chainView?.expiresAt ? new Date(chainView.expiresAt * 1000).toISOString() : info.data?.expiresAt ?? null;
  const validKey = key?.ok ? key.key : null;

  // Link-holder proof → sender name + note. Only for links whose key matched.
  const view = useQuery({
    queryKey: ["api", "claim-view", transferId],
    enabled: Boolean(validKey) && !["invalid", "loading", "unavailable"].includes(state.kind),
    staleTime: Infinity,
    retry: 1,
    queryFn: async () => {
      const issuedAt = Math.floor(Date.now() / 1000);
      const signature = await signViewProof(validKey!, transferId, issuedAt);
      return api<ClaimViewResponse>(`/api/claims/${encodeURIComponent(transferId)}/view`, { method: "POST", json: { issuedAt, signature } });
    },
  });
  const country = countries.data?.countries.find((c) => c.code === view.data?.destinationCountry);

  async function claim(useRelay: boolean) {
    if (!validKey || !w.address || chainId === undefined) return;
    const recipient = w.address as Address;
    const id = chainId;
    const res = await tx.run(
      "Claim MUSD",
      async (hooks) => {
        const signature = await signClaim(validKey, contracts.manager, id, recipient);
        if (useRelay) {
          hooks.onWallet?.("Claim MUSD", "none");
          try {
            const { txHash } = await api<RelayClaimResponse>(`/api/claims/${encodeURIComponent(transferId)}/relay`, {
              method: "POST",
              json: { recipient: recipient.toLowerCase(), signature },
            });
            const hash = txHash as Hash;
            hooks.onSubmitted?.("Claim MUSD", hash);
            const receipt = await waitForTransactionReceipt(config, { hash, chainId: MEZO_TESTNET_ID, timeout: 180_000 });
            if (receipt.status !== "success") throw Object.assign(new Error("The claim was reverted on-chain."), { hash });
            return { hash };
          } catch (e) {
            if (!(e as { hash?: Hash }).hash) setRelayFailed(true);
            throw e;
          }
        }
        const out = await executeWrite(config, build.claimTransfer(id, recipient, signature), {
          ...hooks,
          onSubmitted: (l, hash) => {
            hooks.onSubmitted?.(l, hash);
            api(`/api/claims/${encodeURIComponent(transferId)}/submitted`, { method: "POST", json: { txHash: hash } }).catch(() => undefined);
          },
        });
        return { hash: out.hash };
      },
      async () => {
        const end = Date.now() + 45_000;
        while (Date.now() < end) {
          const r = await api<ClaimInfo>(`/api/claims/${encodeURIComponent(transferId)}`).catch(() => null);
          if (r?.status === "claimed") break;
          await new Promise((s) => setTimeout(s, 2500));
        }
        await qc.invalidateQueries({ queryKey: qk.claim(transferId) });
      },
    );
    if (res) {
      setClaimedTx(res.hash);
      void onchain.refetch();
    }
  }

  // ------------------------------------------------------------ success
  // The connected wallet is the one that claimed: show its success, not "Already claimed… if that wasn't you".
  const claimedByMe =
    finalState.kind === "claimed" && Boolean(w.address) && finalState.claimedBy?.toLowerCase() === w.address?.toLowerCase();
  if (claimedTx || (tx.state.phase === "confirmed" && tx.state.hash) || claimedByMe) {
    const hash = claimedTx ?? tx.state.hash ?? (finalState.kind === "claimed" ? finalState.txHash : null);
    return (
      <div className="space-y-6">
        <div className="flex gap-3" role="status">
          <CircleCheck className="mt-1 size-7 shrink-0 text-ok" aria-hidden />
          <div>
            <h1 className="num font-display text-3xl font-semibold tracking-[-0.03em]">You received {amount ? musd(amount) : "the MUSD"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              It&apos;s in your wallet <AddressText address={w.address} /> on Mezo Testnet.
            </p>
            <TxLink hash={hash} label="See it on the explorer" className="mt-2" />
          </div>
        </div>
        {country?.support === "sandbox_payout" ? (
          <div className="rounded-xl border bg-card p-4">
            <h2 className="font-semibold">Cash out options</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Local payout to {currencyTag(country.currency)} is a sandbox demo. It&apos;s simulated and no real money moves.
            </p>
            <Button asChild variant="outline" size="sm" className="mt-3">
              <Link href={`/payouts/${transferId}`}>See cash out options (simulated)</Link>
            </Button>
          </div>
        ) : null}
        <div className="flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/received">Go to received money</Link>
          </Button>
          <Button asChild variant="ghost">
            <Link href="/help">What is MUSD?</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (finalState.kind !== "claimable") {
    return (
      <div className="space-y-6">
        <ClaimStateNotice state={finalState} amount={amount} expiresAt={expiresAt} />
        {finalState.kind === "unavailable" ? (
          <Button variant="outline" onClick={() => { void info.refetch(); void idByRef.refetch(); }}>
            Try again
          </Button>
        ) : null}
        {finalState.kind !== "loading" ? (
          <p className="text-sm text-muted-foreground">
            Questions? <Link href="/help" className="font-medium text-foreground underline underline-offset-4">Read how claim links work</Link>.
          </p>
        ) : null}
      </div>
    );
  }

  // ------------------------------------------------------------ claimable
  const relay = Boolean(info.data?.relayAvailable) && !relayFailed;
  const noBtc = btcQ.data !== undefined && btcQ.data.value === 0n;

  return (
    <div className="space-y-7">
      <div>
        <p className="inline-flex items-center gap-2 text-sm text-muted-foreground">
          <Gift className="size-4" aria-hidden />
          {view.data?.senderDisplayName ? `${view.data.senderDisplayName} sent you money` : "Someone sent you money"}
        </p>
        <h1 className="num mt-2 font-display text-4xl font-semibold tracking-[-0.03em]">{amount ? musd(amount) : "--"}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          MUSD is a digital dollar on the Mezo network.{expiresAt ? ` Claim it before ${formatDateTime(expiresAt)}.` : ""}
        </p>
        {view.data?.note ? (
          <blockquote className="mt-4 border-l-2 border-brand pl-3 text-sm">
            <p className="whitespace-pre-line">{view.data.note}</p>
            <footer className="mt-1 text-[0.8125rem] text-muted-foreground">Message from the sender</footer>
          </blockquote>
        ) : null}
      </div>

      <section aria-labelledby="claim-steps" className="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
        <h2 id="claim-steps" className="font-semibold">
          {!w.isConnected ? "Connect a wallet to receive it" : !w.isReady ? "Switch to Mezo Testnet" : "Claim to your wallet"}
        </h2>

        {!w.isConnected ? (
          <div className="space-y-4">
            {mounted && !hasInjectedWallet() ? (
              <>
                <p className="text-sm text-muted-foreground">You need your own wallet to receive MUSD. We never create one for you.</p>
                <WalletGuide />
              </>
            ) : (
              <p className="text-sm text-muted-foreground">The MUSD goes to the wallet you connect. You stay in control of it.</p>
            )}
            <Button size="lg" onClick={() => setConnectOpen(true)}>
              Connect wallet
            </Button>
            <ConnectDialog open={connectOpen} onOpenChange={setConnectOpen} />
          </div>
        ) : !w.isReady ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Your wallet is on another network. MezoRemit uses Mezo Testnet ({MEZO_TESTNET_ID}).</p>
            <Button size="lg" disabled={w.isSwitching} onClick={() => w.switchToMezo().catch(() => undefined)}>
              {w.isSwitching ? "Check your wallet…" : "Switch to Mezo Testnet"}
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <dl className="divide-y text-sm">
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-muted-foreground">You receive</dt>
                <dd className="num font-semibold">{amount ? musd(amount) : "--"}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-muted-foreground">To your wallet</dt>
                <dd>
                  <AddressText address={w.address} />
                </dd>
              </div>
              <div className="flex items-baseline justify-between gap-4 py-2">
                <dt className="text-muted-foreground">Network fee</dt>
                <dd className="text-right">{relay ? "Paid by MezoRemit. You pay nothing." : "Paid by you in BTC"}</dd>
              </div>
            </dl>
            {!relay && noBtc ? (
              <p role="alert" className="rounded-lg bg-warn-soft px-3 py-2 text-sm">
                Your wallet has no BTC for the network fee.{" "}
                <a href={SITE.btcFaucetUrl} target="_blank" rel="noreferrer" className="font-medium underline underline-offset-4">
                  Get testnet BTC
                </a>
                , then claim.
              </p>
            ) : null}
            <TxPanel state={tx.state} />
            <div className="flex flex-wrap gap-3">
              <Button size="lg" disabled={tx.isBusy || !isDeployed || chainId === undefined} onClick={() => claim(relay)}>
                {tx.isBusy ? "Claiming…" : tx.state.phase === "error" ? "Try again" : `Claim ${amount ? musd(amount) : ""}`}
              </Button>
              {relayFailed && tx.state.phase === "error" ? (
                <Button size="lg" variant="outline" disabled={tx.isBusy} onClick={() => claim(false)}>
                  Pay the fee myself
                </Button>
              ) : null}
            </div>
            <p className="text-[0.8125rem] text-muted-foreground">
              {relay
                ? "The claim is signed for your wallet only, so nobody else can redirect it."
                : "Your wallet asks you to confirm one transaction. The claim is signed for your wallet only."}
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
