// Claim-link endpoints. GET is public and returns ONLY on-chain-public data + status (ClaimInfo): never the
// sender's name, note, recipient-book data, or contact reference. The note / opted-in sender name need a
// claim-key proof (view). The relay endpoint pays claim gas from the relayer hot wallet after verifying the
// EIP-712 claim signature off-chain, so a bad request never costs gas.

import { formatEther, isAddress, recoverMessageAddress, recoverTypedDataAddress, type Address, type Hex } from "viem";
import type { ClaimInfo, ClaimViewResponse, RelayClaimResponse } from "@/lib/api-types";
import { claimDomain, claimTypes, viewProofMessage } from "@/lib/chain/claim";
import { contracts, isDeployed } from "@/lib/chain/config";
import type { Sql } from "./db";
import { big, isoOrNull, strOrNull } from "./db/rows";
import { isTransientError, type ChainAdapter, type RelayerAdapter } from "./chain";
import { confirmTransferTx } from "./confirm";
import { audit } from "./audit";
import { addSeconds, clock } from "./clock";
import { HttpError, notFound, unavailable } from "./errors";
import { addTimeline } from "./indexer";
import { rateLimit } from "./ratelimit";
import { projectStatus } from "./status";

export const VIEW_PROOF_MAX_SKEW_SEC = 600;
export const RELAY_INFLIGHT_SEC = 300;
/** Gas budget for one claimTransfer (EIP-712 recover + escrow state write + one ERC-20 transfer). An ESTIMATE used
 *  only to decide whether the relayer can afford a claim (×2 safety margin); override with RELAYER_MIN_BALANCE_WEI. */
export const CLAIM_GAS_ESTIMATE = 250_000n;

type Row = Record<string, unknown>;
const lc = (v: unknown) => String(v ?? "").toLowerCase();

async function claimRow(sql: Sql, id: string): Promise<Row> {
  const [t] = await sql<Row>`
    SELECT t.*, c.recipient_wallet AS claimed_by, u.display_name AS sender_name
    FROM transfers t JOIN users u ON u.id = t.sender_user_id LEFT JOIN claims c ON c.transfer_id = t.id
    WHERE t.id = ${id} AND t.method = 'claim'`;
  if (!t) throw notFound("Claim link not found");
  return t;
}

// ---------------------------------------------------------------- relayer availability

let cache: { at: number; ok: boolean; balance: bigint | null } | null = null;
export function resetRelayerCacheForTests() {
  cache = null;
}

export async function relayerState(chain: ChainAdapter, relayer: RelayerAdapter | null): Promise<{ available: boolean; balance: bigint | null }> {
  if (!relayer || !isDeployed) return { available: false, balance: null };
  if (cache && Date.now() - cache.at < 30_000) return { available: cache.ok, balance: cache.balance };
  try {
    const [balance, gasPrice] = await Promise.all([chain.nativeBalanceOf(relayer.address), chain.getGasPrice()]);
    const override = process.env.RELAYER_MIN_BALANCE_WEI;
    const min = override && /^\d+$/.test(override) ? BigInt(override) : gasPrice * CLAIM_GAS_ESTIMATE * 2n;
    cache = { at: Date.now(), ok: balance >= min && balance > 0n, balance };
  } catch {
    cache = { at: Date.now(), ok: false, balance: null };
  }
  return { available: cache.ok, balance: cache.balance };
}

export const formatBtc = (wei: bigint | null) => (wei === null ? null : formatEther(wei));

// ---------------------------------------------------------------- public info

export async function getClaimInfo(sql: Sql, chain: ChainAdapter, relayer: RelayerAdapter | null, id: string): Promise<ClaimInfo> {
  let t = await claimRow(sql, id);
  // Self-heal without waiting for the worker: a funding (or claim) tx the client reported is re-checked against
  // its receipt right here, using the same verifier as /confirm. Otherwise a link opened before the indexer runs
  // would show "funding" and hide the free (relayed) claim.
  const pendingTx =
    t.chain_status === null && t.funding_tx_hash ? { hash: String(t.funding_tx_hash), purpose: "funding" as const }
    : t.status === "claim_submitted" && t.claim_submitted_tx ? { hash: String(t.claim_submitted_tx), purpose: "claim" as const }
    : null;
  if (pendingTx) {
    const r = await confirmTransferTx(sql, chain, String(t.id), pendingTx.hash as Hex, pendingTx.purpose).catch(() => null);
    if (r === "confirmed" || r === "reverted") t = await claimRow(sql, id);
  }
  const status = projectStatus(t as never, clock.now());
  const { available } = await relayerState(chain, relayer);
  return {
    transferId: String(t.id),
    chainTransferId: t.chain_transfer_id === null ? null : big(t.chain_transfer_id).toString(),
    senderAddress: String(t.sender_address).toLowerCase(),
    status,
    amount: big(t.amount).toString(),
    expiresAt: isoOrNull(t.expires_at),
    claimSigner: strOrNull(t.claim_signer),
    claimedBy: strOrNull(t.claimed_by) ?? (t.chain_status === "claimed" ? strOrNull(t.recipient_wallet) : null),
    settlementTxHash: strOrNull(t.settlement_tx_hash),
    fundingTxHash: t.chain_status ? strOrNull(t.funding_tx_hash) : null,
    relayAvailable: available && status === "awaiting_claim",
  };
}

// ---------------------------------------------------------------- view (claim-key proof)

export async function viewClaim(sql: Sql, id: string, input: { issuedAt: number; signature: string }, ipKey: string): Promise<ClaimViewResponse> {
  await rateLimit(sql, `claimview:${id}:${ipKey}`, 20, 600);
  const t = await claimRow(sql, id);
  const nowSec = Math.floor(clock.now().getTime() / 1000);
  if (!Number.isInteger(input.issuedAt) || Math.abs(nowSec - input.issuedAt) > VIEW_PROOF_MAX_SKEW_SEC) {
    throw new HttpError(401, "proof_stale", "This proof is too old or from the future. Reload the claim page.");
  }
  if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) throw new HttpError(401, "invalid_proof", "Invalid claim-link proof");
  let signer: string;
  try {
    signer = await recoverMessageAddress({ message: viewProofMessage(String(t.id), input.issuedAt), signature: input.signature as Hex });
  } catch {
    throw new HttpError(401, "invalid_proof", "Invalid claim-link proof");
  }
  if (!t.claim_signer || lc(signer) !== lc(t.claim_signer)) throw new HttpError(401, "invalid_proof", "Invalid claim-link proof");
  return {
    senderDisplayName: t.show_sender_name && t.sender_name ? String(t.sender_name) : null,
    note: strOrNull(t.note),
    destinationCountry: String(t.destination_country),
  };
}

// ---------------------------------------------------------------- relay

async function recordRejected(sql: Sql, transferId: string, recipient: string, ipKey: string, error: string) {
  await sql`INSERT INTO relay_attempts (transfer_id, recipient, status, error, ip_hash, created_at)
            VALUES (${transferId}, ${recipient}, 'rejected', ${error}, ${ipKey}, ${clock.now()})`;
}

export async function relayClaim(
  sql: Sql,
  chain: ChainAdapter,
  relayer: RelayerAdapter | null,
  id: string,
  input: { recipient: string; signature: string },
  ipKey: string,
): Promise<RelayClaimResponse> {
  await rateLimit(sql, `relay:ip:${ipKey}`, 5, 600);
  await rateLimit(sql, `relay:t:${id}`, 10, 3600);
  const t = await claimRow(sql, id);
  if (!isAddress(input.recipient, { strict: false }) || /^0x0{40}$/i.test(input.recipient)) throw new HttpError(400, "invalid_recipient", "Invalid recipient wallet");
  const recipient = input.recipient.toLowerCase() as Address;
  if (!/^0x[0-9a-fA-F]{130}$/.test(input.signature)) throw new HttpError(400, "invalid_claim_signature", "Invalid claim signature");
  const signature = input.signature as Hex;
  if (!relayer) throw unavailable("relay_unavailable", "Gas relay is not available. Claim from your own wallet instead.");
  const state = await relayerState(chain, relayer);
  if (!state.available) throw unavailable("relay_unavailable", "Gas relay is not available right now. Claim from your own wallet instead.");

  // ---- preflight (reads only; nothing is sent until every check passes)
  let chainId: bigint;
  try {
    chainId = t.chain_transfer_id !== null ? big(t.chain_transfer_id) : await chain.transferIdByRef(String(t.sender_address) as Address, String(t.ref) as Hex);
    if (chainId === 0n) {
      await recordRejected(sql, id, recipient, ipKey, "not_funded");
      throw new HttpError(409, "not_funded", "This transfer is not funded on Mezo yet");
    }
    const ct = await chain.getTransfer(chainId);
    if (lc(ct.ref) !== lc(t.ref)) throw new HttpError(409, "not_funded", "This transfer is not funded on Mezo yet");
    const claimable = await chain.isClaimable(chainId);
    if (!claimable || ct.status !== "funded" || Number(ct.expiresAt) <= Math.floor(clock.now().getTime() / 1000)) {
      await recordRejected(sql, id, recipient, ipKey, `not_claimable:${ct.status}`);
      throw new HttpError(409, "not_claimable", ct.status === "claimed" ? "This transfer was already claimed" : "This transfer can no longer be claimed");
    }
    let signer: string;
    try {
      signer = await recoverTypedDataAddress({
        domain: claimDomain(contracts.manager),
        types: claimTypes,
        primaryType: "Claim",
        message: { transferId: chainId, recipient },
        signature,
      });
    } catch {
      signer = "";
    }
    if (lc(signer) !== lc(ct.claimSigner)) {
      await recordRejected(sql, id, recipient, ipKey, "invalid_claim_signature");
      throw new HttpError(400, "invalid_claim_signature", "The claim signature does not match this claim link");
    }
  } catch (e) {
    if (isTransientError(e)) throw unavailable("chain_unavailable", "Mezo RPC is unreachable right now. Try again shortly.");
    throw e;
  }

  // ---- one in-flight relay per transfer (reservation row, under a row lock on the transfer)
  const attemptId = await sql.begin(async (tx) => {
    await tx`SELECT id FROM transfers WHERE id = ${id} FOR UPDATE`;
    const [busy] = await tx`SELECT id FROM relay_attempts WHERE transfer_id = ${id} AND status = 'submitted' AND created_at > ${addSeconds(clock.now(), -RELAY_INFLIGHT_SEC)}`;
    if (busy) throw new HttpError(409, "relay_in_progress", "A claim for this link is already being submitted");
    const [row] = await tx<{ id: string }>`INSERT INTO relay_attempts (transfer_id, recipient, status, ip_hash, created_at)
      VALUES (${id}, ${recipient}, 'submitted', ${ipKey}, ${clock.now()}) RETURNING id`;
    return String(row.id);
  });

  try {
    await relayer.simulateClaim(chainId, recipient, signature);
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0].slice(0, 200);
    await sql`UPDATE relay_attempts SET status = 'rejected', error = ${`simulation_failed: ${msg}`} WHERE id = ${attemptId}`;
    if (isTransientError(e)) throw unavailable("chain_unavailable", "Mezo RPC is unreachable right now. Try again shortly.");
    throw new HttpError(409, "claim_would_fail", "This claim would fail on-chain, so it was not sent");
  }
  let txHash: Hex;
  try {
    txHash = await relayer.sendClaim(chainId, recipient, signature);
  } catch (e) {
    const msg = (e as Error).message.split("\n")[0].slice(0, 200);
    await sql`UPDATE relay_attempts SET status = 'rejected', error = ${`send_failed: ${msg}`} WHERE id = ${attemptId}`;
    throw new HttpError(502, "relay_failed", "The relayer could not submit the claim. Try again or claim from your own wallet.");
  }
  const h = txHash.toLowerCase();
  await sql.begin(async (tx) => {
    await tx`UPDATE relay_attempts SET tx_hash = ${h} WHERE id = ${attemptId}`;
    const rows = await tx`UPDATE transfers SET status = 'claim_submitted', claim_submitted_tx = ${h}, updated_at = ${clock.now()}
                          WHERE id = ${id} AND status = 'awaiting_claim' RETURNING id`;
    if (rows.length) await addTimeline(tx, { transferId: id, kind: "claim_submitted", source: "app", txHash: h, detail: "Submitted by the MezoRemit gas relayer" });
    await audit(tx, "relayer", "relay_submitted", id, { chainTransferId: chainId.toString(), recipient, txHash: h });
  });
  return { txHash: txHash };
}

/** Recipient-paid claim: tx hint only (status claim_submitted), then a fast receipt check. */
export async function reportClaimTx(sql: Sql, chain: ChainAdapter, relayer: RelayerAdapter | null, id: string, txHash: Hex, ipKey: string): Promise<ClaimInfo> {
  await rateLimit(sql, `claimtx:${id}:${ipKey}`, 10, 600);
  await claimRow(sql, id);
  const h = txHash.toLowerCase();
  await sql.begin(async (tx) => {
    const rows = await tx`UPDATE transfers SET status = 'claim_submitted', claim_submitted_tx = ${h}, updated_at = ${clock.now()}
                          WHERE id = ${id} AND status = 'awaiting_claim' AND chain_status = 'funded' RETURNING id`;
    if (rows.length) await addTimeline(tx, { transferId: id, kind: "claim_submitted", source: "app", txHash: h, detail: "Submitted from the recipient's wallet" });
  });
  try {
    await confirmTransferTx(sql, chain, id, h as Hex, "claim");
  } catch (e) {
    if (!isTransientError(e)) console.warn("[claims] fast confirm failed", (e as Error).message);
  }
  return getClaimInfo(sql, chain, relayer, id);
}
