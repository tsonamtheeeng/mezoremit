import { decodeErrorResult, parseAbi, type Hex } from "viem";
import { erc20Abi, remittanceManagerAbi } from "@/lib/chain/abis";
import { ApiClientError } from "./api";

/**
 * Turns wallet, RPC, API and contract errors into one plain sentence a person can act on.
 * Custom errors are decoded with the generated ABIs (plus common OpenZeppelin errors); raw hex never reaches the screen.
 */
export type TxErrorKind = "rejected" | "network" | "revert" | "funds_btc" | "funds_musd" | "rpc" | "api" | "unknown";
export interface TxError {
  kind: TxErrorKind;
  title: string;
  message: string;
  errorName?: string;
}

const OZ_ERRORS = parseAbi([
  "error ReentrancyGuardReentrantCall()",
  "error SafeERC20FailedOperation(address token)",
  "error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)",
  "error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)",
  "error ERC2612ExpiredSignature(uint256 deadline)",
  "error ERC2612InvalidSigner(address signer, address owner)",
  "error ECDSAInvalidSignature()",
  "error ECDSAInvalidSignatureLength(uint256 length)",
  "error ECDSAInvalidSignatureS(bytes32 s)",
]);

/** Plain messages for every custom error a MezoRemit user can hit. */
export const ERROR_MESSAGES: Record<string, string> = {
  AmountTooLarge: "That amount is above the limit for one transfer.",
  DuplicateRef: "This transfer was already sent. Refresh to see its status.",
  InvalidClaimSignature: "This claim link doesn't match the transfer. Ask the sender for a new link.",
  InvalidExpiry: "That expiry time isn't allowed. Pick another one and try again.",
  NotClaimable: "This transfer can't be claimed. It may already be claimed, cancelled or refunded.",
  NotExpired: "This link hasn't expired yet, so it can't be refunded. You can cancel it instead.",
  NotSender: "Only the wallet that sent this transfer can do that.",
  SelfTransfer: "You can't send to your own wallet.",
  TransferExpired: "This claim link has expired. The sender can get the money back.",
  TransferNotFound: "We couldn't find this transfer on Mezo.",
  UnexpectedBalanceChange: "The MUSD transfer didn't add up. Nothing was sent. Try again.",
  ZeroAddress: "Enter a valid wallet address.",
  ZeroAmount: "Enter an amount above zero.",
  ReentrancyGuardReentrantCall: "Another transaction is in progress. Try again.",
  SafeERC20FailedOperation: "The MUSD transfer failed. Check your balance.",
  ERC20InsufficientAllowance: "MezoRemit isn't allowed to move that much MUSD yet. Approve it and try again.",
  ERC20InsufficientBalance: "Your wallet doesn't have enough MUSD for this transfer.",
  ERC2612ExpiredSignature: "The approval signature expired. Sign again.",
  ERC2612InvalidSigner: "The approval signature didn't match this wallet. Sign again.",
  ECDSAInvalidSignature: "This claim link doesn't match the transfer. Ask the sender for a new link.",
  ECDSAInvalidSignatureLength: "This claim link doesn't match the transfer. Ask the sender for a new link.",
  ECDSAInvalidSignatureS: "This claim link doesn't match the transfer. Ask the sender for a new link.",
};

export function messageForError(name: string): string {
  return ERROR_MESSAGES[name] ?? humanizeErrorName(name);
}

/** "TransferExpired" → "Transfer expired." */
export function humanizeErrorName(name: string): string {
  const words = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/\s+/).filter(Boolean);
  if (!words.length) return "The transaction was rejected.";
  return `${words.map((w, i) => (i === 0 ? w : w.toLowerCase())).join(" ")}.`;
}

const ALL_ERRORS = [...remittanceManagerAbi, ...erc20Abi, ...OZ_ERRORS].filter((x) => (x as { type: string }).type === "error");

export function decodeRevertData(data: Hex): { errorName: string; args: readonly unknown[] } | null {
  try {
    const r = decodeErrorResult({ abi: ALL_ERRORS as never, data });
    return { errorName: r.errorName, args: (r.args ?? []) as readonly unknown[] };
  } catch {
    return null;
  }
}

type Loose = {
  name?: string;
  code?: number | string;
  message?: string;
  shortMessage?: string;
  details?: string;
  reason?: string;
  data?: unknown;
  raw?: unknown;
  cause?: unknown;
};

function links(err: unknown): Loose[] {
  const out: Loose[] = [];
  const seen = new Set<unknown>();
  let cur: unknown = err;
  while (cur && typeof cur === "object" && !seen.has(cur) && out.length < 12) {
    seen.add(cur);
    out.push(cur as Loose);
    cur = (cur as Loose).cause;
  }
  return out;
}

function text(e: Loose) {
  return [e.shortMessage, e.details, e.message, e.reason].filter((s): s is string => typeof s === "string").join("\n");
}

function revert(name: string): TxError {
  if (name === "ERC20InsufficientBalance") return { kind: "funds_musd", title: "Not enough MUSD", message: ERROR_MESSAGES[name], errorName: name };
  return { kind: "revert", title: "Transaction rejected", message: messageForError(name), errorName: name };
}

export const BTC_FEE_HELP = "Network fees on Mezo are paid in BTC. Add a little testnet BTC from the faucet, then try again.";

export function describeTxError(err: unknown): TxError {
  if (err == null) return { kind: "unknown", title: "Something went wrong", message: "Please try again." };
  if (typeof err === "string") return { kind: "unknown", title: "Something went wrong", message: err };
  if (err instanceof ApiClientError) {
    return { kind: "api", title: err.status === 0 ? "Can't reach MezoRemit" : "MezoRemit couldn't do that", message: err.message };
  }
  const chain = links(err);

  for (const e of chain) {
    if (e.name === "WrongNetworkError" || e.name === "ChainMismatchError") {
      return { kind: "network", title: "Wrong network", message: "Switch your wallet to Mezo Testnet and try again." };
    }
    if (
      e.name === "UserRejectedRequestError" ||
      e.code === 4001 ||
      e.code === "ACTION_REJECTED" ||
      /user (rejected|denied)|rejected the request|request rejected|denied (transaction|message) signature|user cancelled/i.test(text(e))
    ) {
      return { kind: "rejected", title: "Cancelled in your wallet", message: "You cancelled the request. Nothing was sent." };
    }
  }

  for (const e of chain) {
    const d = e.data as { errorName?: string; args?: readonly unknown[] } | undefined;
    if (d && typeof d === "object" && typeof d.errorName === "string") {
      if (d.errorName === "Error" && typeof d.args?.[0] === "string") return { kind: "revert", title: "Transaction rejected", message: d.args[0] };
      if (d.errorName === "Panic") return { kind: "revert", title: "Transaction rejected", message: "The contract hit an internal check." };
      return revert(d.errorName);
    }
    for (const candidate of [e.raw, e.data]) {
      if (typeof candidate === "string" && /^0x[0-9a-fA-F]{8}/.test(candidate)) {
        const dec = decodeRevertData(candidate as Hex);
        if (dec) return revert(dec.errorName);
      }
    }
  }

  const all = chain.map(text).join("\n");
  const hex = /0x[0-9a-fA-F]{8,}/.exec(all);
  if (hex) {
    const dec = decodeRevertData(hex[0] as Hex);
    if (dec) return revert(dec.errorName);
  }
  const named = /(?:reverted with (?:the following )?(?:custom )?(?:error|reason)?:?|Error:)\s*'?([A-Z][A-Za-z0-9]+)\(/.exec(all);
  if (named && ERROR_MESSAGES[named[1]]) return revert(named[1]);

  if (/transfer amount exceeds balance|insufficient balance for transfer/i.test(all)) {
    return { kind: "funds_musd", title: "Not enough MUSD", message: "Your wallet doesn't have enough MUSD for this transfer." };
  }
  if (/insufficient funds|exceeds the balance of the account|gas required exceeds|exceeds balance/i.test(all)) {
    return { kind: "funds_btc", title: "Not enough BTC for the network fee", message: BTC_FEE_HELP };
  }
  if (/nonce too low|replacement transaction underpriced|already known/i.test(all)) {
    return { kind: "rpc", title: "Another transaction is pending", message: "Wait for the pending transaction in your wallet, then try again." };
  }
  if (/timeout|timed out|took too long/i.test(all)) {
    return { kind: "rpc", title: "Mezo is slow right now", message: "We didn't hear back in time. Check the explorer before trying again." };
  }
  if (/fetch failed|failed to fetch|network error|HTTP request failed/i.test(all)) {
    return { kind: "rpc", title: "Can't reach Mezo Testnet", message: "Check your connection and try again." };
  }
  if (/chain mismatch|does not match the target chain/i.test(all)) {
    return { kind: "network", title: "Wrong network", message: "Switch your wallet to Mezo Testnet and try again." };
  }
  if (/not connected/i.test(all)) return { kind: "unknown", title: "Wallet not connected", message: "Connect your wallet and try again." };
  if (/method not (found|supported)|does not support|unsupported|not implemented/i.test(all)) {
    return { kind: "unknown", title: "Not supported by this wallet", message: "Your wallet doesn't support this request." };
  }
  if (/reverted/i.test(all)) return { kind: "revert", title: "Transaction rejected", message: "The transaction was reverted. Nothing was sent." };
  const first = chain[0];
  const msg = first?.shortMessage || first?.message;
  return { kind: "unknown", title: "Something went wrong", message: msg && msg.length < 160 ? msg : "Please try again." };
}

/** True when a signing failure means "this wallet can't do permits", so we fall back to approve. */
export function isPermitUnsupported(err: unknown): boolean {
  const e = describeTxError(err);
  if (e.kind === "rejected" || e.kind === "network" || e.kind === "funds_btc") return false;
  return true;
}
