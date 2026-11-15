import type { PayoutStatus, TimelineEntry, Transfer, TransferMethod, TransferStatus } from "@/lib/api-types";

/** Visual tone for a status. Every tone is always paired with words, never colour alone. */
export type Tone = "ok" | "pending" | "warn" | "bad" | "idle";

export interface StatusCopy {
  label: string;
  tone: Tone;
  /** One plain sentence, from the sender's point of view. */
  sender: string;
  /** One plain sentence, from the recipient's point of view. */
  recipient: string;
}

export const STATUS_COPY: Record<TransferStatus, StatusCopy> = {
  awaiting_funding: {
    label: "Not sent yet",
    tone: "idle",
    sender: "You started this transfer but haven't sent the MUSD from your wallet yet.",
    recipient: "The sender hasn't sent the money yet.",
  },
  funding_submitted: {
    label: "Confirming",
    tone: "pending",
    sender: "Your transaction is on its way. We're waiting for Mezo to confirm it.",
    recipient: "The sender's transaction is waiting for Mezo to confirm it.",
  },
  awaiting_claim: {
    label: "Ready to claim",
    tone: "pending",
    sender: "The MUSD is locked on Mezo. Your recipient can claim it with the link you shared.",
    recipient: "The money is ready. Open the claim link to receive it.",
  },
  claim_submitted: {
    label: "Claiming",
    tone: "pending",
    sender: "Your recipient is claiming the money. Waiting for Mezo to confirm.",
    recipient: "Your claim is on its way. Waiting for Mezo to confirm.",
  },
  claimed: {
    label: "Claimed",
    tone: "ok",
    sender: "Your recipient claimed the MUSD. It's in their wallet on Mezo.",
    recipient: "You claimed this MUSD. It's in your wallet on Mezo.",
  },
  completed: {
    label: "Delivered",
    tone: "ok",
    sender: "The MUSD arrived in your recipient's wallet on Mezo.",
    recipient: "This MUSD arrived in your wallet on Mezo.",
  },
  expired: {
    label: "Expired",
    tone: "warn",
    sender: "Nobody claimed this before the link expired. Get your MUSD back with a refund.",
    recipient: "This link expired before it was claimed. The sender can get the money back.",
  },
  cancelled: {
    label: "Cancelled",
    tone: "idle",
    sender: "You cancelled this transfer. The MUSD went back to your wallet.",
    recipient: "The sender cancelled this transfer.",
  },
  refunded: {
    label: "Refunded",
    tone: "idle",
    sender: "The MUSD went back to your wallet after the link expired.",
    recipient: "This transfer expired and the money went back to the sender.",
  },
  failed: {
    label: "Failed",
    tone: "bad",
    sender: "The transaction didn't go through, so no MUSD left your wallet. You can start again.",
    recipient: "The sender's transaction didn't go through.",
  },
};

export function statusCopy(status: TransferStatus): StatusCopy {
  return STATUS_COPY[status] ?? { label: status, tone: "idle", sender: "", recipient: "" };
}

export const PAYOUT_COPY: Record<PayoutStatus, { label: string; tone: Tone; text: string }> = {
  requested: { label: "Requested", tone: "pending", text: "The simulated provider received the request." },
  processing: { label: "Processing", tone: "pending", text: "The simulated provider is processing it." },
  completed: { label: "Completed (simulated)", tone: "ok", text: "The simulation finished. No real money moved." },
  failed: { label: "Failed (simulated)", tone: "bad", text: "The simulated payout failed. No real money moved." },
  cancelled: { label: "Cancelled", tone: "idle", text: "The simulated payout was cancelled." },
};

/** Statuses that still change on their own, so screens keep polling. */
export const MOVING_STATUSES: ReadonlySet<TransferStatus> = new Set(["funding_submitted", "claim_submitted"]);
export const isMoving = (s: TransferStatus) => MOVING_STATUSES.has(s);

/** The funding step is finished (success) for this method. */
export function isFunded(method: TransferMethod, status: TransferStatus): boolean {
  if (method === "direct") return status === "completed";
  return ["awaiting_claim", "claim_submitted", "claimed", "expired", "cancelled", "refunded"].includes(status);
}

export function isFinal(status: TransferStatus): boolean {
  return ["claimed", "completed", "cancelled", "refunded", "failed"].includes(status);
}

/** Sender-side actions available right now. Pure, so it is unit tested. */
export function senderActions(t: Pick<Transfer, "method" | "status" | "chainTransferId" | "role">) {
  const mine = t.role === "sender";
  const claim = t.method === "claim";
  const onChain = Boolean(t.chainTransferId);
  return {
    cancel: mine && claim && onChain && (t.status === "awaiting_claim" || t.status === "expired"),
    refund: claim && onChain && t.status === "expired",
    copyLink: mine && claim && (t.status === "awaiting_claim" || t.status === "awaiting_funding" || t.status === "funding_submitted"),
    resumeFunding: mine && t.status === "awaiting_funding",
  };
}

// ------------------------------------------------------------------ timeline

export type TimelineSource = TimelineEntry["source"];

export const SOURCE_LABEL: Record<TimelineSource, { short: string; long: string }> = {
  chain: { short: "Verified on Mezo", long: "Confirmed on the Mezo blockchain. Anyone can check it on the explorer." },
  app: { short: "Recorded by MezoRemit", long: "Recorded by the MezoRemit app. Not an on-chain event." },
  sandbox: { short: "Simulated", long: "Simulation only. No real money moved and no bank was involved." },
};

export function sourceLabel(source: TimelineSource): { short: string; long: string } {
  return SOURCE_LABEL[source] ?? SOURCE_LABEL.app;
}

const KIND_TITLE: Record<TimelineEntry["kind"], string> = {
  created: "Transfer created",
  funding_submitted: "Transaction sent from your wallet",
  funded: "Funds received on Mezo",
  delivered: "MUSD delivered on Mezo",
  link_shared: "Claim link shared",
  claim_submitted: "Claim sent",
  claimed: "MUSD claimed on Mezo",
  expired: "Claim link expired",
  cancelled: "Transfer cancelled, MUSD returned",
  refunded: "Refunded to sender",
  failed: "Transaction failed",
  payout_requested: "Local payout requested",
  payout_processing: "Local payout processing",
  payout_completed: "Local payout completed",
  payout_failed: "Local payout failed",
};

/** Title for a timeline step. Sandbox steps always say they are simulated. */
export function timelineTitle(e: Pick<TimelineEntry, "kind" | "source">, role: Transfer["role"] = "sender"): string {
  let title = KIND_TITLE[e.kind] ?? e.kind;
  if (e.kind === "funding_submitted" && role !== "sender") title = "Transaction sent by the sender";
  if (e.source === "sandbox" && !/simulat/i.test(title)) title = `${title} (simulated)`;
  return title;
}

/** Payout steps are about local currency; they must never read like MUSD settlement. */
export const isPayoutKind = (k: TimelineEntry["kind"]) => k.startsWith("payout_");

/** Split the timeline into the MUSD settlement part and the (sandbox) payout part, preserving order. */
export function splitTimeline(entries: TimelineEntry[]): { settlement: TimelineEntry[]; payout: TimelineEntry[] } {
  const sorted = [...entries].sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return { settlement: sorted.filter((e) => !isPayoutKind(e.kind)), payout: sorted.filter((e) => isPayoutKind(e.kind)) };
}

export function methodLabel(m: TransferMethod): string {
  return m === "claim" ? "Claim link" : "Mezo wallet";
}

export type StepState = "done" | "current" | "todo" | "failed";

/** Simulated payout lifecycle as three steps. Pure, so it is unit tested. */
export function payoutSteps(status: PayoutStatus): { id: string; label: string; state: StepState }[] {
  const table: Record<PayoutStatus, [StepState, StepState, StepState]> = {
    requested: ["current", "todo", "todo"],
    processing: ["done", "current", "todo"],
    completed: ["done", "done", "done"],
    failed: ["done", "done", "failed"],
    cancelled: ["done", "todo", "failed"],
  };
  const end = status === "failed" ? "Failed" : status === "cancelled" ? "Cancelled" : "Completed";
  const [a, b, c] = table[status] ?? table.requested;
  return [
    { id: "requested", label: "Requested", state: a },
    { id: "processing", label: "Processing", state: b },
    { id: "end", label: end, state: c },
  ];
}
