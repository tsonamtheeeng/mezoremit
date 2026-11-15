import type { Hex } from "viem";

/**
 * Sender-side claim-key storage. The key lives in memory during the send flow and in this tab's
 * sessionStorage (keyed by transfer id) so the sender can copy the link again until they close the tab.
 * It is never sent to the server, never put in localStorage, and can be removed at any time.
 */
const PREFIX = "mezoremit:claimkey:";

function store(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

export function saveClaimKey(transferId: string, key: Hex): boolean {
  try {
    store()?.setItem(PREFIX + transferId, key);
    return true;
  } catch {
    return false;
  }
}

export function loadClaimKey(transferId: string): Hex | null {
  try {
    const v = store()?.getItem(PREFIX + transferId) ?? null;
    return v && /^0x[0-9a-f]{64}$/i.test(v) ? (v as Hex) : null;
  } catch {
    return null;
  }
}

export function forgetClaimKey(transferId: string): void {
  try {
    store()?.removeItem(PREFIX + transferId);
  } catch {
    /* storage unavailable */
  }
}
