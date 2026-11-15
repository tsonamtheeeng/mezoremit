"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useConfig } from "wagmi";
import type { Address, Hex } from "viem";
import { ArrowLeft, CircleCheck, Info } from "lucide-react";
import { toast } from "sonner";
import type { Country, DeliveryMethod, Quote, Recipient, Transfer } from "@/lib/api-types";
import { CLAIM_EXPIRY_OPTIONS, isDeployed, MEZO_TESTNET_ID, type ClaimExpiryKey } from "@/lib/chain/config";
import { buildClaimLink, newClaimKey, transferRef } from "@/lib/chain/claim";
import { checkAmount } from "@/lib/client/amount";
import { errorMessage } from "@/lib/client/api";
import { forgetClaimKey, loadClaimKey, saveClaimKey } from "@/lib/client/claim-store";
import { BTC_FEE_HELP } from "@/lib/client/errors";
import { btc, currencyTag, musd, musdNumber } from "@/lib/client/format";
import {
  checkName,
  checkNote,
  checkWallet,
  deliveryOptions,
  expiresAtFor,
  isDemoExpiry,
  loadShowNamePref,
  methodFor,
  newIdempotencyKey,
  quoteSecondsLeft,
  unixNow,
  type SendStep,
} from "@/lib/client/send";
import { appOrigin, SITE } from "@/lib/client/site";
import { waitForTransferStatus } from "@/lib/client/poll";
import { fundTransfer } from "@/lib/client/writes";
import { cn } from "@/lib/client/utils";
import { confirmTransfer, createTransfer, markShared, reportFunding, requestQuote, useCountries, useRecipients, useSaveRecipient, useTransfer } from "@/hooks/use-api";
import { useAuth } from "@/hooks/use-auth";
import { useBtcBalance, useMusdBalance } from "@/hooks/use-musd";
import { useNow } from "@/hooks/use-now";
import { useTx } from "@/hooks/use-tx";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/shared/states";
import { SimulatedNote, SimulatedTag } from "@/components/shared/simulated-note";
import { TxPanel } from "@/components/shared/tx-panel";
import { ReviewSummary } from "@/components/transfer/review-summary";
import { ClaimLinkPanel } from "@/components/transfer/claim-link-panel";
import { Choice } from "./choice";
import { Stepper } from "./stepper";

type RecipientChoice =
  | { mode: "saved"; id: string }
  | { mode: "new"; name: string; wallet: string; save: boolean }
  | { mode: "link"; name: string; save: boolean };

type Phase = "form" | "send" | "done";

function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  if (!children) return null;
  return (
    <p id={id} role="alert" className="mt-1.5 text-[0.8125rem] text-bad">
      {children}
    </p>
  );
}

function StepHeading({ title, body }: { title: string; body?: string }) {
  return (
    <div className="mb-5">
      <h2 className="font-display text-xl font-semibold tracking-[-0.02em]">{title}</h2>
      {body ? <p className="mt-1 text-sm text-muted-foreground">{body}</p> : null}
    </div>
  );
}

export function SendFlow({ resumeId }: { resumeId?: string | null }) {
  const config = useConfig();
  const auth = useAuth();
  const self = auth.wallet.address;
  const countriesQ = useCountries();
  const recipientsQ = useRecipients();
  const saveRecipient = useSaveRecipient();
  const balanceQ = useMusdBalance(self);
  const btcQ = useBtcBalance(self);
  const tx = useTx();
  const now = useNow(1000);

  const [phase, setPhase] = useState<Phase>("form");
  const [step, setStep] = useState<SendStep>("country");
  const [countryCode, setCountryCode] = useState("");
  const [amountRaw, setAmountRaw] = useState("");
  const [amountTouched, setAmountTouched] = useState(false);
  const [rc, setRc] = useState<RecipientChoice | null>(null);
  const [rcErrors, setRcErrors] = useState<{ name?: string; wallet?: string; pick?: string }>({});
  const [deliveryPick, setDelivery] = useState<DeliveryMethod | null>(null);
  const [expiryKey, setExpiryKey] = useState<ClaimExpiryKey>("7d");
  const [note, setNote] = useState("");
  // SendFlow only mounts client-side (behind AuthGate), so storage can seed state directly.
  const [showName, setShowName] = useState(() => loadShowNamePref());
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [transfer, setTransfer] = useState<Transfer | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [shared, setShared] = useState(false);

  // The claim key lives in memory, bound to the idempotency key of this attempt.
  const attempt = useRef<{ idem: string; key: { privateKey: Hex; claimSigner: Address } | null } | null>(null);
  const [memKey, setMemKey] = useState<Hex | null>(null);
  const headingRef = useRef<HTMLDivElement>(null);

  const countries = countriesQ.data?.countries ?? [];
  const country: Country | null = countries.find((c) => c.code === countryCode) ?? null;
  const recipients = recipientsQ.data?.recipients ?? [];
  const savedRecipient: Recipient | null = rc?.mode === "saved" ? (recipients.find((r) => r.id === rc.id) ?? null) : null;
  const recipientWallet = rc?.mode === "saved" ? savedRecipient?.walletAddress ?? null : rc?.mode === "new" ? rc.wallet.trim() || null : null;
  const hasWallet = Boolean(recipientWallet);
  const balance = (balanceQ.data as bigint | undefined) ?? null;
  const amountCheck = checkAmount(amountRaw, balance);
  const amount = amountCheck.ok ? amountCheck.value : 0n;
  const options = deliveryOptions(country, hasWallet);
  // A delivery choice that no longer fits the recipient (e.g. wallet removed) is dropped, not kept stale.
  const delivery = deliveryPick && options.some((o) => o.id === deliveryPick) ? deliveryPick : null;
  const method = delivery ? methodFor(delivery, hasWallet) : null;
  const recipientLabel =
    rc?.mode === "saved" ? savedRecipient?.displayName ?? "Saved recipient" : rc?.mode === "new" ? rc.name.trim() : rc?.mode === "link" ? rc.name.trim() || "Whoever opens the link" : "";

  // ------------------------------------------------------------ resume an unfunded transfer
  const resumeQ = useTransfer(resumeId ?? null);
  const resumeT = resumeQ.data?.transfer;
  const resumed = !transfer && resumeT && resumeT.role === "sender" && resumeT.status === "awaiting_funding" ? resumeT : null;
  const current = transfer ?? resumed;
  const view: Phase = transfer ? phase : resumed ? "send" : phase;
  const claimKey: Hex | null = memKey ?? (current?.method === "claim" ? loadClaimKey(current.id) : null);

  function go(s: SendStep) {
    setStep(s);
    requestAnimationFrame(() => headingRef.current?.focus());
  }

  // ------------------------------------------------------------ quote
  async function fetchQuote() {
    if (!delivery || !amountCheck.ok || !countryCode) return;
    setQuoteLoading(true);
    setQuoteError(null);
    try {
      const { quote: q } = await requestQuote({ amount: amount.toString(), destinationCountry: countryCode, deliveryMethod: delivery });
      setQuote(q);
    } catch (e) {
      setQuote(null);
      setQuoteError(`Couldn't get today's rate (${errorMessage(e)}). You can still send. The local amount is only a guide.`);
    } finally {
      setQuoteLoading(false);
    }
  }

  const secondsLeft = quoteSecondsLeft(quote?.expiresAt, now);

  // ------------------------------------------------------------ step validation
  function nextFromRecipient() {
    if (!rc) return setRcErrors({ pick: "Choose who you're sending to." });
    if (rc.mode === "saved") {
      if (!savedRecipient) return setRcErrors({ pick: "Choose who you're sending to." });
      if (savedRecipient.walletAddress) {
        const w = checkWallet(savedRecipient.walletAddress, self);
        if (!w.ok) return setRcErrors({ pick: w.message });
      }
    }
    if (rc.mode === "new") {
      const n = checkName(rc.name);
      const w = checkWallet(rc.wallet, self);
      if (n || !w.ok) return setRcErrors({ name: n ?? undefined, wallet: w.ok ? undefined : w.message });
    }
    if (rc.mode === "link" && rc.save) {
      const n = checkName(rc.name);
      if (n) return setRcErrors({ name: n });
    }
    setRcErrors({});
    go("delivery");
  }

  function resetAttempt() {
    attempt.current = null;
    setQuote(null);
  }

  // ------------------------------------------------------------ create + fund
  async function confirmAndSend() {
    if (!method || !delivery || !amountCheck.ok || !country) return;
    if (!isDeployed) {
      toast.error("Sending is turned off", { description: "The MezoRemit contract isn't deployed on Mezo Testnet yet." });
      return;
    }
    const noteErr = checkNote(note);
    if (noteErr) return toast.error(noteErr);
    setCreateError(null);
    setCreating(true);
    try {
      if (!attempt.current) attempt.current = { idem: newIdempotencyKey(), key: null };
      // Claim key is generated in this browser BEFORE the transfer exists; only its address goes to the API.
      if (method === "claim" && !attempt.current.key) attempt.current.key = newClaimKey();

      let recipientId: string | null = rc?.mode === "saved" ? rc.id : null;
      if ((rc?.mode === "new" || rc?.mode === "link") && rc.save) {
        try {
          const res = await saveRecipient.mutateAsync({
            input: {
              displayName: rc.name.trim(),
              country: country.code,
              walletAddress: rc.mode === "new" ? rc.wallet.trim().toLowerCase() : null,
              preferredDeliveryMethod: delivery,
            },
          });
          recipientId = res.recipient.id;
          setRc({ mode: "saved", id: res.recipient.id });
        } catch (e) {
          toast.warning("Couldn't save this recipient", { description: `${errorMessage(e)} The transfer will still go ahead.` });
        }
      }

      const now0 = unixNow();
      const quoteOk = quote && secondsLeft !== null && secondsLeft > 0;
      const { transfer: t } = await createTransfer({
        method,
        amount: amount.toString(),
        destinationCountry: country.code,
        recipientId,
        recipientWallet: method === "direct" ? recipientWallet?.toLowerCase() ?? null : null,
        claimSigner: method === "claim" ? attempt.current.key!.claimSigner.toLowerCase() : null,
        expiresAt: method === "claim" ? expiresAtFor(expiryKey, now0) : null,
        quoteId: quoteOk ? quote.id : null,
        note: note.trim() || null,
        showSenderName: showName,
        idempotencyKey: attempt.current.idem,
      });
      if (method === "claim" && attempt.current.key) {
        setMemKey(attempt.current.key.privateKey);
        saveClaimKey(t.id, attempt.current.key.privateKey);
      }
      setTransfer(t);
      setPhase("send");
      void fund(t);
    } catch (e) {
      setCreateError(errorMessage(e));
    } finally {
      setCreating(false);
    }
  }

  async function fund(t: Transfer) {
    if (!self) return;
    setTransfer(t);
    const amt = BigInt(t.amount);
    const ref = transferRef(t.id);
    if (t.ref && t.ref.toLowerCase() !== ref.toLowerCase()) {
      tx.setState({ phase: "error", label: "Send MUSD", error: { kind: "api", title: "Transfer mismatch", message: "This transfer's reference doesn't match. Start a new transfer." } });
      return;
    }
    if (balance !== null && amt > balance) {
      tx.setState({ phase: "error", label: "Send MUSD", error: { kind: "funds_musd", title: "Not enough MUSD", message: "Your wallet doesn't have enough MUSD for this transfer." } });
      return;
    }
    const btcBal = btcQ.data?.value;
    if (btcBal !== undefined && btcBal === 0n) {
      tx.setState({ phase: "error", label: "Send MUSD", error: { kind: "funds_btc", title: "No BTC for the network fee", message: BTC_FEE_HELP } });
      return;
    }
    const plan =
      t.method === "direct"
        ? { kind: "direct" as const, recipient: (t.recipient?.walletAddress ?? recipientWallet) as Address, amount: amt, ref }
        : {
            kind: "claim" as const,
            claimSigner: t.claimSigner as Address,
            amount: amt,
            expiresAt: BigInt(t.expiresAt ? Math.floor(new Date(t.expiresAt).getTime() / 1000) : expiresAtFor(expiryKey, unixNow())),
            ref,
          };
    if (plan.kind === "direct" && !plan.recipient) {
      tx.setState({ phase: "error", label: "Send MUSD", error: { kind: "api", title: "No recipient wallet", message: "This transfer has no wallet to send to." } });
      return;
    }
    const label = t.method === "claim" ? "Lock MUSD for the claim link" : "Send MUSD";
    const res = await tx.run(
      label,
      (hooks) =>
        fundTransfer(config, plan, {
          ...hooks,
          onSubmitted: (l, hash) => {
            hooks.onSubmitted?.(l, hash);
            // Only the funding call is reported, not the approve step.
            if (l === label) reportFunding(t.id, hash).catch(() => reportFunding(t.id, hash).catch(() => undefined));
          },
        }),
      async () => {
        await confirmTransfer(t.id).catch(() => undefined);
        const done = await waitForTransferStatus(t.id, t.method === "claim" ? ["awaiting_claim", "claimed"] : ["completed"]);
        setTransfer(done);
        if (done.status === "failed") throw new Error("MezoRemit marked this transfer as failed. Check the explorer.");
      },
    );
    if (res) setPhase("done");
  }

  // ------------------------------------------------------------ render

  if (resumeId && resumeQ.isLoading) return <Skeleton className="h-64 w-full" />;
  if (resumeId && resumeT && !resumed && !transfer) {
    return (
      <div className="space-y-3">
        <p>This transfer has already been sent.</p>
        <Button asChild variant="outline">
          <Link href={`/transfers/${resumeId}`}>Track transfer</Link>
        </Button>
      </div>
    );
  }

  if (view === "done" && transfer) {
    return (
      <Done
        transfer={transfer}
        claimKey={claimKey}
        shared={shared}
        onShared={(ch) => {
          setShared(true);
          markShared(transfer.id, ch).catch(() => undefined);
        }}
      />
    );
  }

  if (view === "send" && current) {
    const transfer = current;
    const claimMissing = transfer.method === "claim" && !claimKey;
    return (
      <div className="space-y-6">
        <div ref={headingRef} tabIndex={-1} className="outline-none">
          <StepHeading
            title={transfer.method === "claim" ? "Lock the MUSD on Mezo" : "Send the MUSD"}
            body={
              transfer.method === "claim"
                ? "Your wallet sends the MUSD into a lock on Mezo. Only the claim link can release it, and you can cancel any time before it's claimed."
                : "Your wallet sends the MUSD straight to your recipient on Mezo."
            }
          />
        </div>
        <dl className="grid grid-cols-2 gap-4 rounded-xl border bg-card p-4 text-sm">
          <div>
            <dt className="text-muted-foreground">Amount</dt>
            <dd className="num font-display text-lg font-semibold">{musd(transfer.amount)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Network fee</dt>
            <dd>Paid in BTC{btcQ.data ? <span className="block text-[0.8125rem] text-muted-foreground">You have {btc(btcQ.data.value)}</span> : null}</dd>
          </div>
        </dl>
        {claimMissing ? (
          <div role="alert" className="rounded-xl border border-warn/40 bg-warn-soft p-4 text-sm">
            <p className="font-medium">The claim link for this transfer isn&apos;t in this browser tab.</p>
            <p className="mt-1 text-muted-foreground">
              It was only kept in the tab where you created it. Nothing was sent, so start a new transfer instead.
            </p>
            <Button asChild className="mt-3" variant="outline">
              <Link href="/send">Start a new transfer</Link>
            </Button>
          </div>
        ) : (
          <>
            <TxPanel
              state={tx.state}
              description={
                <>
                  Your wallet will ask you to <strong className="font-medium text-foreground">sign an approval</strong> (free) and then{" "}
                  <strong className="font-medium text-foreground">confirm one transaction</strong>. Some wallets ask for two transactions instead.
                </>
              }
            />
            <div className="flex flex-wrap gap-3">
              {tx.state.phase === "idle" || tx.state.phase === "error" ? (
                <Button size="lg" onClick={() => fund(transfer)} disabled={!auth.wallet.isReady}>
                  {tx.state.phase === "error" ? "Try again" : "Open wallet"}
                </Button>
              ) : null}
              {!auth.wallet.isReady ? (
                <Button size="lg" variant="outline" onClick={() => auth.wallet.switchToMezo().catch(() => undefined)}>
                  Switch to Mezo Testnet
                </Button>
              ) : null}
              {tx.state.phase === "confirmed" ? (
                <Button size="lg" onClick={() => setPhase("done")}>
                  Continue
                </Button>
              ) : null}
              <Button asChild variant="ghost" size="lg">
                <Link href={`/transfers/${transfer.id}`}>Track transfer</Link>
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  // ------------------------------------------------------------ form steps
  return (
    <div>
      <Stepper step={step} />
      {step !== "country" ? (
        <button
          type="button"
          onClick={() => go(step === "amount" ? "country" : step === "recipient" ? "amount" : step === "delivery" ? "recipient" : "delivery")}
          className="-ml-2 mb-3 inline-flex cursor-pointer items-center gap-1 rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <ArrowLeft className="size-4" aria-hidden /> Back
        </button>
      ) : null}

      <div ref={headingRef} tabIndex={-1} className="outline-none">
        {step === "country" ? (
          <section aria-labelledby="h-country">
            <div id="h-country">
              <StepHeading title="Where are you sending money?" body="Your recipient gets MUSD on Mezo in every country. Some countries also have a simulated local payout demo." />
            </div>
            {countriesQ.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : countriesQ.isError ? (
              <QueryError error={countriesQ.error} what="the country list" onRetry={() => countriesQ.refetch()} />
            ) : (
              <fieldset className="space-y-2">
                <legend className="sr-only">Destination country</legend>
                {countries.map((c) => (
                  <Choice
                    key={c.code}
                    name="country"
                    value={c.code}
                    checked={countryCode === c.code}
                    onChange={(v) => {
                      setCountryCode(v);
                      resetAttempt();
                    }}
                    title={`${c.name} (${currencyTag(c.currency)})`}
                    body={c.support === "sandbox_payout" ? "MUSD on Mezo. Local payout: sandbox demo only." : c.note ?? "MUSD on Mezo only."}
                  />
                ))}
              </fieldset>
            )}
            <div className="mt-6">
              <Button size="lg" disabled={!country} onClick={() => go("amount")}>
                Continue
              </Button>
            </div>
          </section>
        ) : null}

        {step === "amount" ? (
          <section aria-labelledby="h-amount">
            <div id="h-amount">
              <StepHeading title="How much?" body={`Enter the amount in MUSD. ${country ? `Your recipient is in ${country.name}.` : ""}`} />
            </div>
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setAmountTouched(true);
                if (amountCheck.ok) go("recipient");
              }}
            >
              <Label htmlFor="amount">You send</Label>
              <div className="relative mt-1.5">
                <Input
                  id="amount"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="0.00"
                  value={amountRaw}
                  onChange={(e) => {
                    setAmountRaw(e.target.value);
                    resetAttempt();
                  }}
                  onBlur={() => setAmountTouched(true)}
                  aria-invalid={amountTouched && !amountCheck.ok}
                  aria-describedby="amount-help amount-error"
                  className="num h-14 pr-20 font-display text-2xl font-semibold md:text-2xl"
                />
                <span className="pointer-events-none absolute inset-y-0 right-4 flex items-center text-sm font-semibold text-muted-foreground">MUSD</span>
              </div>
              <div id="amount-help" className="mt-2 flex flex-wrap items-center gap-x-3 text-[0.8125rem] text-muted-foreground">
                {balanceQ.isLoading ? (
                  <span>Checking your balance…</span>
                ) : balance !== null ? (
                  <>
                    <span className="num">You have {musd(balance)}</span>
                    {balance > 0n ? (
                      <button
                        type="button"
                        className="cursor-pointer font-medium text-brand-ink underline underline-offset-4"
                        onClick={() => {
                          setAmountRaw(musdNumber(balance - (balance % 10n ** 16n), 2).replace(/,/g, ""));
                          setAmountTouched(true);
                        }}
                      >
                        Send all
                      </button>
                    ) : (
                      <a href={SITE.musdUrl} target="_blank" rel="noreferrer" className="font-medium text-brand-ink underline underline-offset-4">
                        Get testnet MUSD
                      </a>
                    )}
                  </>
                ) : (
                  <span>Couldn&apos;t read your balance right now.</span>
                )}
              </div>
              <FieldError id="amount-error">{amountTouched && !amountCheck.ok ? amountCheck.message : null}</FieldError>
              <div className="mt-6">
                <Button size="lg" type="submit">
                  Continue
                </Button>
              </div>
            </form>
          </section>
        ) : null}

        {step === "recipient" ? (
          <section aria-labelledby="h-recipient">
            <div id="h-recipient">
              <StepHeading title="Who are you sending to?" />
            </div>
            <fieldset className="space-y-2">
              <legend className="sr-only">Recipient</legend>
              {recipientsQ.isLoading ? <Skeleton className="h-16 w-full" /> : null}
              {recipientsQ.isError ? <QueryError error={recipientsQ.error} what="your recipients" onRetry={() => recipientsQ.refetch()} /> : null}
              {recipients.length ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium">Saved recipients</p>
                  {[...recipients]
                    .sort((a, b) => Number(b.country === countryCode) - Number(a.country === countryCode))
                    .map((r) => (
                      <Choice
                        key={r.id}
                        name="recipient"
                        value={`saved:${r.id}`}
                        checked={rc?.mode === "saved" && rc.id === r.id}
                        onChange={() => {
                          setRc({ mode: "saved", id: r.id });
                          setRcErrors({});
                          resetAttempt();
                        }}
                        title={r.displayName}
                        body={r.walletAddress ? `Wallet ${r.walletAddress.slice(0, 6)}…${r.walletAddress.slice(-4)}` : "No wallet saved. You'll send a claim link."}
                        aside={r.country !== countryCode ? <span className="text-xs text-muted-foreground">{r.country}</span> : undefined}
                      />
                    ))}
                  <p className="pt-3 text-sm font-medium">Or</p>
                </div>
              ) : null}
              <Choice
                name="recipient"
                value="new"
                checked={rc?.mode === "new"}
                onChange={() => {
                  setRc({ mode: "new", name: "", wallet: "", save: true });
                  setRcErrors({});
                  resetAttempt();
                }}
                title="Someone new, I have their wallet address"
              />
              <Choice
                name="recipient"
                value="link"
                checked={rc?.mode === "link"}
                onChange={() => {
                  setRc({ mode: "link", name: "", save: false });
                  setRcErrors({});
                  resetAttempt();
                }}
                title="I don't know their wallet"
                body="Send a claim link instead. They can set up a wallet when they open it."
              />
            </fieldset>
            <FieldError id="rc-pick">{rcErrors.pick}</FieldError>

            {rc?.mode === "new" ? (
              <div className="mt-5 space-y-4 rounded-xl border bg-card p-4">
                <div>
                  <Label htmlFor="r-name">Their name</Label>
                  <Input
                    id="r-name"
                    className="mt-1.5"
                    autoComplete="off"
                    value={rc.name}
                    onChange={(e) => setRc({ ...rc, name: e.target.value })}
                    aria-invalid={Boolean(rcErrors.name)}
                    aria-describedby="r-name-error"
                  />
                  <FieldError id="r-name-error">{rcErrors.name}</FieldError>
                </div>
                <div>
                  <Label htmlFor="r-wallet">Their Mezo wallet address</Label>
                  <Input
                    id="r-wallet"
                    className="mt-1.5 font-mono text-[0.8125rem]"
                    autoComplete="off"
                    spellCheck={false}
                    placeholder="0x…"
                    value={rc.wallet}
                    onChange={(e) => setRc({ ...rc, wallet: e.target.value })}
                    aria-invalid={Boolean(rcErrors.wallet)}
                    aria-describedby="r-wallet-help r-wallet-error"
                  />
                  <p id="r-wallet-help" className="mt-1.5 text-[0.8125rem] text-muted-foreground">
                    Double-check it. Money sent to the wrong address can&apos;t be returned.
                  </p>
                  <FieldError id="r-wallet-error">{rcErrors.wallet}</FieldError>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={rc.save} onCheckedChange={(v) => setRc({ ...rc, save: v === true })} />
                  Save to my recipients
                </label>
              </div>
            ) : null}

            {rc?.mode === "link" ? (
              <div className="mt-5 space-y-4 rounded-xl border bg-card p-4">
                <div>
                  <Label htmlFor="l-name">Who is it for? (optional, only you see this)</Label>
                  <Input id="l-name" className="mt-1.5" value={rc.name} onChange={(e) => setRc({ ...rc, name: e.target.value })} aria-describedby="l-name-error" />
                  <FieldError id="l-name-error">{rcErrors.name}</FieldError>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <Checkbox checked={rc.save} onCheckedChange={(v) => setRc({ ...rc, save: v === true })} />
                  Save to my recipients
                </label>
              </div>
            ) : null}

            <div className="mt-6">
              <Button size="lg" onClick={nextFromRecipient}>
                Continue
              </Button>
            </div>
          </section>
        ) : null}

        {step === "delivery" ? (
          <section aria-labelledby="h-delivery">
            <div id="h-delivery">
              <StepHeading title="How should they get it?" body="Every option settles in MUSD on Mezo." />
            </div>
            <fieldset className="space-y-2">
              <legend className="sr-only">Delivery method</legend>
              {options.map((o) => (
                <Choice
                  key={o.id}
                  name="delivery"
                  value={o.id}
                  checked={delivery === o.id}
                  onChange={(v) => {
                    setDelivery(v as DeliveryMethod);
                    resetAttempt();
                  }}
                  title={
                    <span className="inline-flex items-center gap-2">
                      {o.title}
                      {o.simulated ? <SimulatedTag /> : null}
                    </span>
                  }
                  body={o.body}
                />
              ))}
            </fieldset>
            {delivery === "local_payout_sandbox" ? <SimulatedNote className="mt-4" /> : null}
            {method === "claim" ? (
              <fieldset className="mt-6">
                <legend className="text-sm font-medium">The link expires after</legend>
                <p className="mt-0.5 text-[0.8125rem] text-muted-foreground">If nobody claims it in time, you can get the MUSD back.</p>
                <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {(Object.keys(CLAIM_EXPIRY_OPTIONS) as ClaimExpiryKey[]).map((k) => (
                    <label
                      key={k}
                      className={cn(
                        "flex cursor-pointer items-center gap-2 rounded-lg border bg-card px-3 py-2.5 text-sm has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-brand",
                        expiryKey === k ? "border-brand bg-brand-soft/50 font-medium" : "hover:border-input",
                      )}
                    >
                      <input type="radio" name="expiry" value={k} checked={expiryKey === k} onChange={() => setExpiryKey(k)} className="size-4 accent-[var(--brand)]" />
                      <span>{isDemoExpiry(k) ? <>10 minutes <span className="block text-xs font-normal text-muted-foreground">testnet demo</span></> : CLAIM_EXPIRY_OPTIONS[k].label}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <div className="mt-6">
              <Button
                size="lg"
                disabled={!delivery}
                onClick={() => {
                  go("review");
                  void fetchQuote();
                }}
              >
                Review
              </Button>
            </div>
          </section>
        ) : null}

        {step === "review" && delivery ? (
          <section aria-labelledby="h-review">
            <div id="h-review">
              <StepHeading title="Check the details" />
            </div>
            <ReviewSummary
              recipientLabel={recipientLabel || "Recipient"}
              country={country}
              countryCode={countryCode}
              delivery={delivery}
              amount={amount}
              quote={quote}
              quoteLoading={quoteLoading}
              quoteError={quoteError}
              quoteSecondsLeft={secondsLeft}
              onRefreshQuote={fetchQuote}
              expiryLabel={method === "claim" ? CLAIM_EXPIRY_OPTIONS[expiryKey].label : null}
            />
            <div className="mt-5 space-y-4">
              <div>
                <Label htmlFor="note">Message for your recipient (optional)</Label>
                <Textarea id="note" className="mt-1.5" rows={2} maxLength={280} value={note} onChange={(e) => setNote(e.target.value)} aria-describedby="note-help" />
                <p id="note-help" className="mt-1 text-[0.8125rem] text-muted-foreground">
                  {method === "claim" ? "Only someone with the claim link can read it." : "Your recipient sees it in MezoRemit."} {280 - note.length} characters left.
                </p>
              </div>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox className="mt-0.5" checked={showName} onCheckedChange={(v) => setShowName(v === true)} />
                <span>
                  Show my name to the recipient
                  <span className="block text-[0.8125rem] text-muted-foreground">
                    {auth.user?.displayName ? `They'll see "${auth.user.displayName}".` : "Add a display name in Settings first, or they'll see your wallet address only."}
                  </span>
                </span>
              </label>
            </div>
            {method === "claim" ? (
              <div className="mt-5 flex gap-2.5 rounded-lg bg-surface px-3 py-2.5 text-[0.8125rem] text-muted-foreground">
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                <p>
                  We create the claim link&apos;s secret in this browser. It never reaches our servers, so keep the link safe once you have it.
                </p>
              </div>
            ) : null}
            {createError ? (
              <p role="alert" className="mt-4 text-sm text-bad">
                Couldn&apos;t start the transfer. {createError}
              </p>
            ) : null}
            {!isDeployed ? (
              <p role="status" className="mt-4 text-sm text-warn">
                Sending is turned off until the MezoRemit contract is deployed on Mezo Testnet.
              </p>
            ) : null}
            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Button size="lg" onClick={confirmAndSend} disabled={creating || !isDeployed || !auth.wallet.isReady}>
                {creating ? "Starting…" : `Send ${musd(amount)}`}
              </Button>
              {!auth.wallet.isReady ? (
                <Button size="lg" variant="outline" onClick={() => auth.wallet.switchToMezo().catch(() => undefined)}>
                  Switch to Mezo Testnet ({MEZO_TESTNET_ID})
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}

function Done({
  transfer,
  claimKey,
  shared,
  onShared,
}: {
  transfer: Transfer;
  claimKey: Hex | null;
  shared: boolean;
  onShared: (ch: "copy" | "share_sheet" | "qr") => void;
}) {
  const [key, setKey] = useState<Hex | null>(claimKey);
  const link = useMemo(() => (key ? buildClaimLink(appOrigin(), transfer.id, key) : null), [key, transfer.id]);
  const isClaim = transfer.method === "claim";
  const verified = isClaim ? transfer.status === "awaiting_claim" : transfer.status === "completed";

  return (
    <div className="space-y-6">
      <div className="flex items-start gap-3">
        <CircleCheck className="mt-1 size-7 shrink-0 text-ok" aria-hidden />
        <div>
          <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">
            {isClaim ? `${musd(transfer.amount)} is ready to claim` : `${musd(transfer.amount)} sent`}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground" role="status">
            {verified
              ? isClaim
                ? "The MUSD is locked on Mezo. Send the link below to your recipient."
                : "It's in your recipient's wallet on Mezo."
              : "Your transaction is on Mezo. We're still verifying it, and the tracking page will update."}
          </p>
        </div>
      </div>

      {isClaim && link ? (
        <ClaimLinkPanel
          link={link}
          amountText={musd(transfer.amount)}
          onShared={onShared}
          onForget={() => {
            forgetClaimKey(transfer.id);
            setKey(null);
            toast.success("Removed from this browser");
          }}
        />
      ) : isClaim ? (
        <p className="rounded-lg bg-surface px-3 py-2.5 text-sm text-muted-foreground">
          The link was removed from this browser. If you didn&apos;t save it, cancel the transfer from the tracking page to get your MUSD back.
        </p>
      ) : null}

      {isClaim && !shared && link ? (
        <p className="text-[0.8125rem] text-muted-foreground">Copy or share the link before you leave this page.</p>
      ) : null}

      <div className="flex flex-wrap gap-3">
        <Button asChild size="lg" variant={isClaim && link ? "outline" : "default"}>
          <Link href={`/transfers/${transfer.id}`}>Track transfer</Link>
        </Button>
        <Button asChild size="lg" variant="ghost">
          <Link href="/send">Send another</Link>
        </Button>
      </div>
    </div>
  );
}
