// Notification copy for transfer/payout events. Plain, short, and never containing claim links, keys, notes or
// contact references. Every call is deduped by "<transfer|payout>:<type>:<user>".

import type { Sql } from "./db";
import { formatMusd } from "./money";
import { notify, type NotificationType } from "./notify";
import { userIdByWallet } from "./users";

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

export interface TransferForMessage {
  id: string;
  sender_user_id: string;
  sender_address: string;
  method: string;
  amount: unknown;
  recipient_wallet: string | null;
  recipient_name?: string | null;
  sender_name?: string | null;
  show_sender_name?: boolean;
}

async function loadForMessage(tx: Sql, transferId: string): Promise<TransferForMessage | null> {
  const [t] = await tx<TransferForMessage>`
    SELECT t.id, t.sender_user_id, t.sender_address, t.method, t.amount, t.recipient_wallet, t.show_sender_name,
           r.display_name AS recipient_name, u.display_name AS sender_name
    FROM transfers t
    LEFT JOIN recipients r ON r.id = t.recipient_id
    JOIN users u ON u.id = t.sender_user_id
    WHERE t.id = ${transferId}`;
  return t ?? null;
}

type SenderEvent = "transfer_funded" | "transfer_delivered" | "transfer_claimed" | "transfer_expired" | "transfer_cancelled" | "transfer_refunded";

function senderCopy(type: SenderEvent, t: TransferForMessage): { title: string; body: string } {
  const amt = `${formatMusd(String(t.amount))} MUSD`;
  const to = t.recipient_name ? ` to ${t.recipient_name}` : t.recipient_wallet ? ` to ${short(t.recipient_wallet)}` : "";
  switch (type) {
    case "transfer_funded":
      return { title: "Funds received on Mezo", body: `Your ${amt} transfer${to} is ready to claim. Share the claim link privately.` };
    case "transfer_delivered":
      return { title: "Transfer delivered", body: `${amt} reached the recipient's wallet${to ? to.replace(" to", ",") : ""}.` };
    case "transfer_claimed":
      return { title: "Transfer claimed", body: `Your ${amt} transfer${to} was claimed.` };
    case "transfer_expired":
      return { title: "Claim link expired", body: `Your ${amt} transfer${to} was not claimed in time. You can get the funds back.` };
    case "transfer_cancelled":
      return { title: "Transfer cancelled", body: `Your ${amt} transfer${to} was cancelled and the funds returned to your wallet.` };
    case "transfer_refunded":
      return { title: "Transfer refunded", body: `Your ${amt} transfer${to} expired and was refunded to your wallet.` };
  }
}

export async function notifySender(tx: Sql, transferId: string, type: SenderEvent): Promise<void> {
  const t = await loadForMessage(tx, transferId);
  if (!t) return;
  const { title, body } = senderCopy(type, t);
  await notify(tx, { userId: t.sender_user_id, transferId, type, title, body, dedupeKey: `${transferId}:${type}:${t.sender_user_id}` });
}

/** Recipient side: only if a user with that wallet exists (others get it backfilled on first sign-in). */
export async function notifyRecipientReceived(tx: Sql, transferId: string, wallet: string | null, knownUserId?: string): Promise<void> {
  const t = await loadForMessage(tx, transferId);
  if (!t) return;
  const userId = knownUserId ?? (await userIdByWallet(tx, wallet ?? t.recipient_wallet));
  if (!userId || userId === t.sender_user_id) return;
  const from = t.show_sender_name && t.sender_name ? t.sender_name : short(t.sender_address);
  await notify(tx, {
    userId,
    transferId,
    type: "transfer_received",
    title: "You received MUSD",
    body: `${formatMusd(String(t.amount))} MUSD from ${from} is in your wallet on Mezo.`,
    dedupeKey: `${transferId}:transfer_received:${userId}`,
  });
}

export async function backfillReceivedNotifications(tx: Sql, userId: string, wallet: string): Promise<number> {
  const rows = await tx<{ id: string }>`
    SELECT id FROM transfers WHERE recipient_wallet = ${wallet.toLowerCase()} AND status IN ('completed', 'claimed')
    ORDER BY created_at DESC LIMIT 50`;
  for (const r of rows) await notifyRecipientReceived(tx, r.id, wallet, userId);
  return rows.length;
}

export async function notifyPayout(
  tx: Sql,
  p: { payoutId: string; transferId: string; userId: string; currency: string; amount: string },
  type: Extract<NotificationType, "payout_requested" | "payout_completed" | "payout_failed">,
): Promise<void> {
  const what = `${p.amount} ${p.currency}`;
  const copy = {
    payout_requested: { title: "Payout requested (simulated)", body: `Simulated payout of ${what} requested. This is a sandbox: no money moves.` },
    payout_completed: { title: "Payout completed (simulated)", body: `Simulated payout of ${what} completed. This is a sandbox: no money moved.` },
    payout_failed: { title: "Payout failed (simulated)", body: `Simulated payout of ${what} failed. This is a sandbox: no money moved. Your MUSD is still in your wallet.` },
  }[type];
  await notify(tx, { userId: p.userId, transferId: p.transferId, type, ...copy, dedupeKey: `payout:${p.payoutId}:${type}:${p.userId}` });
}
