"use client";

import { useCallback, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Hash } from "viem";
import { describeTxError, type TxError } from "@/lib/client/errors";
import type { WriteHooks } from "@/lib/client/writes";

/**
 * idle       → nothing started
 * wallet     → waiting for the person in their wallet (signature or transaction)
 * submitted  → sent; waiting for Mezo Testnet to include it (hash known, explorer link shown)
 * verifying  → included on Mezo; waiting for MezoRemit to verify and update the transfer
 * confirmed  → done
 * error      → failed or cancelled (plain reason)
 */
export type TxPhase = "idle" | "wallet" | "submitted" | "verifying" | "confirmed" | "error";

export interface TxState {
  phase: TxPhase;
  label: string;
  hash?: Hash;
  error?: TxError;
  /** e.g. "Step 1 of 2" */
  progress?: string;
  ask?: "signature" | "transaction" | "none";
  /** Confirmed on-chain, but the app couldn't record it yet. */
  recordError?: string;
}

export const IDLE_TX: TxState = { phase: "idle", label: "" };

export function useTx() {
  const qc = useQueryClient();
  const [state, setState] = useState<TxState>(IDLE_TX);
  const busy = useRef(false);

  const reset = useCallback(() => {
    if (!busy.current) setState(IDLE_TX);
  }, []);

  /**
   * Run a wallet action. `fn` gets hooks that move the state (wallet → submitted).
   * `after` runs once the tx is included (record with the API, poll); its failure is shown as a soft warning.
   */
  const run = useCallback(
    async <T extends { hash: Hash }>(
      label: string,
      fn: (hooks: WriteHooks & { onStep: (s: string) => void }) => Promise<T>,
      after?: (res: T) => Promise<unknown>,
    ): Promise<T | null> => {
      if (busy.current) return null;
      busy.current = true;
      let progress: string | undefined;
      let hash: Hash | undefined;
      setState({ phase: "wallet", label, ask: "transaction" });
      try {
        const res = await fn({
          onStep: (s) => {
            progress = s;
          },
          onWallet: (l, ask) => setState({ phase: "wallet", label: l, ask, progress }),
          onSubmitted: (l, h) => {
            hash = h;
            setState({ phase: "submitted", label: l, hash: h, progress });
          },
        });
        hash = res.hash;
        if (after) {
          setState({ phase: "verifying", label, hash, progress });
          try {
            await after(res);
          } catch (err) {
            setState({ phase: "confirmed", label, hash, progress, recordError: describeTxError(err).message });
            busy.current = false;
            void qc.invalidateQueries({ queryKey: ["api"] });
            return res;
          }
        }
        setState({ phase: "confirmed", label, hash, progress });
        busy.current = false;
        void qc.invalidateQueries({ queryKey: ["api"] });
        return res;
      } catch (err) {
        busy.current = false;
        const failedHash = (err as { hash?: Hash } | null)?.hash ?? hash;
        setState({ phase: "error", label, hash: failedHash, error: describeTxError(err), progress });
        return null;
      }
    },
    [qc],
  );

  return { state, setState, run, reset, isBusy: state.phase === "wallet" || state.phase === "submitted" || state.phase === "verifying" };
}

export type UseTx = ReturnType<typeof useTx>;
