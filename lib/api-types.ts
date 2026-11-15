// FROZEN. HTTP contract between web UI and API routes. Amounts are decimal strings of MUSD base units (18 dec)
// unless the field name ends in `Display`. Timestamps are ISO-8601 strings. Addresses are lowercase hex.

export type TransferMethod = "direct" | "claim";

/** Off-chain lifecycle. On-chain settlement and fiat payout are SEPARATE (see PayoutStatus). */
export type TransferStatus =
  | "awaiting_funding" // created in app, no tx yet
  | "funding_submitted" // client reported a tx hash; not yet verified on-chain
  | "awaiting_claim" // claim: escrow verified on-chain (ClaimableCreated, confirmed), before expiry
  | "claim_submitted" // claim tx reported (by relayer or recipient), not yet verified
  | "claimed" // claim: TransferClaimed verified
  | "completed" // direct: DirectTransferSent verified
  | "expired" // claim: funded, expiry passed, not yet refunded (derived from chain time)
  | "cancelled" // TransferCancelled verified
  | "refunded" // TransferRefunded verified
  | "failed"; // funding tx reverted / never landed (abandoned after timeout)

export type PayoutStatus = "requested" | "processing" | "completed" | "failed" | "cancelled";

export type DeliveryMethod = "mezo_wallet" | "claim_link" | "local_payout_sandbox";

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

// ------------------------------------------------------------------ auth
export interface NonceRequest { address: string }
export interface NonceResponse { nonce: string; message: string }
export interface VerifyRequest { address: string; message: string; signature: string }
export interface MeResponse {
  user: { id: string; address: string; displayName: string | null; email: string | null; emailNotifications: boolean; createdAt: string } | null;
}
export interface UpdateSettingsRequest { displayName?: string | null; email?: string | null; emailNotifications?: boolean }

// ------------------------------------------------------------------ countries / corridors
export interface Country {
  code: string; // ISO 3166-1 alpha-2
  name: string;
  currency: string; // ISO 4217
  /** "onchain_only": MUSD settlement only. "sandbox_payout": a labelled simulated payout is demoable. */
  support: "onchain_only" | "sandbox_payout";
  note?: string;
}
export interface CountriesResponse { countries: Country[] }

// ------------------------------------------------------------------ recipients (owner-scoped, private)
export interface Recipient {
  id: string;
  displayName: string;
  country: string;
  walletAddress: string | null;
  preferredDeliveryMethod: DeliveryMethod;
  /** Decrypted only for the owner. Never on-chain, never in public endpoints. */
  contactReference: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface RecipientInput {
  displayName: string; // 1..80
  country: string;
  walletAddress?: string | null;
  preferredDeliveryMethod: DeliveryMethod;
  contactReference?: string | null; // 0..200, free text e.g. "WhatsApp +977…", encrypted at rest
}
export interface RecipientsResponse { recipients: Recipient[] }

// ------------------------------------------------------------------ quotes
export interface Quote {
  id: string;
  /** "indicative": reference data, NOT executable. "executable": a provider locked it (none in this MVP). */
  kind: "indicative" | "executable";
  sourceCurrency: "MUSD";
  sourceAmount: string; // MUSD base units
  destinationCurrency: string; // ISO 4217 (e.g. "USD", "INR", "NPR")
  /** Mid-market reference rate (1 USD -> dest), from `rateSource`. MUSD assumed ≈ 1 USD (stated in UI). */
  referenceRate: string; // decimal string
  /** Rate the payout provider would apply. Sandbox provider = reference rate minus disclosed markup. */
  providerRate: string | null;
  fxMarkupBps: number;
  serviceFee: string; // MUSD base units (MVP: "0")
  networkFeeNote: string; // e.g. "Paid in BTC gas by the sender; ~<0.0001 BTC" — no invented numbers
  recipientAmountMusd: string; // base units, what lands on Mezo
  recipientAmountLocal: string | null; // decimal string in destinationCurrency, null if on-chain only
  provider: string; // provider id, e.g. "sandbox" | "onchain"
  providerLabel: string; // e.g. "MezoRemit Sandbox (simulated)"
  rateSource: string; // e.g. "open.er-api.com"
  rateTimestamp: string;
  expiresAt: string;
  createdAt: string;
}
export interface QuoteRequest { amount: string; destinationCountry: string; deliveryMethod: DeliveryMethod }
export interface QuoteResponse { quote: Quote }

// ------------------------------------------------------------------ transfers
export interface TimelineEntry {
  kind:
    | "created"
    | "funding_submitted"
    | "funded" // escrow confirmed on Mezo (claim) — "Funds received on Mezo"
    | "delivered" // direct transfer confirmed on Mezo
    | "link_shared" // sender copied/shared the claim link (self-reported by sender's client)
    | "claim_submitted"
    | "claimed"
    | "expired"
    | "cancelled"
    | "refunded"
    | "failed"
    | "payout_requested"
    | "payout_processing"
    | "payout_completed"
    | "payout_failed";
  at: string;
  txHash: string | null;
  /** "chain" = verified from a confirmed event; "app" = app-recorded; "sandbox" = simulated provider. */
  source: "chain" | "app" | "sandbox";
  detail?: string;
}

export interface Transfer {
  id: string; // app uuid; also the claim-link path segment
  ref: string; // bytes32 = transferRef(id)
  chainTransferId: string | null;
  method: TransferMethod;
  status: TransferStatus;
  /** perspective of the caller */
  role: "sender" | "recipient" | "public";
  senderAddress: string;
  senderDisplayName: string | null; // only if sender opted in (shown on claim page)
  recipient: { id: string | null; displayName: string | null; walletAddress: string | null } | null;
  claimSigner: string | null;
  destinationCountry: string;
  amount: string;
  fee: string;
  quote: Quote | null;
  note: string | null; // sender's private note to recipient; revealed on claim page only with link proof
  expiresAt: string | null;
  fundingTxHash: string | null;
  settlementTxHash: string | null; // claim / cancel / refund tx
  createdAt: string;
  fundedAt: string | null;
  settledAt: string | null;
  timeline: TimelineEntry[];
  payout: PayoutRequest | null;
}

export interface CreateTransferRequest {
  method: TransferMethod;
  amount: string; // base units
  destinationCountry: string;
  recipientId?: string | null;
  /** direct: required (or from recipient). claim: must be omitted. */
  recipientWallet?: string | null;
  /** claim only: address of the browser-generated claim key. */
  claimSigner?: string | null;
  /** claim only: absolute unix seconds. */
  expiresAt?: number | null;
  quoteId?: string | null;
  note?: string | null; // 0..280
  showSenderName?: boolean;
  /** Client-generated idempotency key; same key → same transfer returned. */
  idempotencyKey: string;
}
export interface TransferResponse { transfer: Transfer }
/** GET /api/transfers?role=all|sent|received&cursor=… (status filtering is client-side). */
export interface TransfersResponse { transfers: Transfer[]; nextCursor: string | null }
export interface SubmitTxRequest { txHash: string }
export interface MarkSharedRequest { channel: "copy" | "share_sheet" | "qr" }

// ------------------------------------------------------------------ claims (public, link-holder)
/** GET /api/claims/:id — public, no auth: only data already public on-chain + status. No names/notes. */
export interface ClaimInfo {
  transferId: string;
  chainTransferId: string | null;
  /** Funding wallet. Public on-chain; needed to look up the transfer by ref (refs are unique per sender). */
  senderAddress: string;
  status: TransferStatus;
  amount: string;
  expiresAt: string | null;
  claimSigner: string | null;
  claimedBy: string | null;
  settlementTxHash: string | null;
  fundingTxHash: string | null;
  relayAvailable: boolean; // server can pay the claim gas
}
/** POST /api/claims/:id/view — body signed by the claim key proves link possession. */
export interface ClaimViewRequest { issuedAt: number; signature: string }
export interface ClaimViewResponse { senderDisplayName: string | null; note: string | null; destinationCountry: string }
/** POST /api/claims/:id/relay — server submits claimTransfer(id, recipient, signature), paying gas. */
export interface RelayClaimRequest { recipient: string; signature: string }
export interface RelayClaimResponse { txHash: string }
export interface ReportClaimRequest { txHash: string }

// ------------------------------------------------------------------ dashboards
export interface SenderDashboard {
  totals: { sentCompleted: string; transfers: number; pending: number; completed: number; refunded: number; failed: number };
  recent: Transfer[];
  recipients: Recipient[];
}
export interface RecipientDashboard {
  totals: { received: string; transfers: number };
  received: Transfer[]; // direct to me + claimed by me
  musdBalance: string | null; // live balanceOf, null if RPC failed
}

// ------------------------------------------------------------------ payouts (sandbox only in MVP)
export interface PayoutOption {
  provider: string;
  providerLabel: string;
  simulated: boolean;
  country: string;
  currency: string;
  methods: string[]; // e.g. ["bank_account (simulated)"]
  kycRequired: boolean;
  note: string;
}
export interface PayoutOptionsResponse { options: PayoutOption[] }
export interface PayoutRequest {
  id: string;
  transferId: string;
  provider: string;
  simulated: boolean;
  destinationCurrency: string;
  payoutAmount: string; // decimal string, local currency
  providerReference: string | null;
  status: PayoutStatus;
  statusDetail: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface CreatePayoutRequest { transferId: string; provider: string; quoteId?: string | null }

// ------------------------------------------------------------------ notifications
export interface Notification {
  id: string;
  transferId: string | null;
  type:
    | "transfer_created"
    | "transfer_funded"
    | "transfer_delivered"
    | "transfer_claimed"
    | "transfer_received"
    | "transfer_expired"
    | "transfer_cancelled"
    | "transfer_refunded"
    | "payout_requested"
    | "payout_completed"
    | "payout_failed";
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
  /** Email delivery, only if configured. "sent" means the provider accepted it — not that it was read. */
  email: { status: "not_configured" | "queued" | "sent" | "failed" } | null;
}
/** POST /api/notifications/read body: { ids?: string[] } — omitted ids marks all read; returns { updated }. */
export interface NotificationsResponse { notifications: Notification[]; unread: number }

// ------------------------------------------------------------------ health
export interface HealthResponse {
  ok: boolean;
  chainId: number | null;
  latestBlock: string | null;
  indexer: { lastBlock: string | null; lagBlocks: number | null; updatedAt: string | null };
  deployed: boolean;
  db: "postgres" | "pglite" | "error";
  relayer: { enabled: boolean; address: string | null; balanceBtc: string | null };
}
