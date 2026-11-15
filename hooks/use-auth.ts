"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSignMessage } from "wagmi";
import type { Hex } from "viem";
import type { MeResponse, NonceResponse } from "@/lib/api-types";
import { api } from "@/lib/client/api";
import { useWallet } from "./use-wallet";
import { qk, useMe } from "./use-api";

/**
 * Sign in with Ethereum: POST /api/auth/nonce → personal_sign → POST /api/auth/verify.
 * `signedIn` is true only when the session wallet is the connected wallet.
 */
export function useAuth() {
  const w = useWallet();
  const me = useMe();
  const qc = useQueryClient();
  const { signMessageAsync } = useSignMessage();

  const user = me.data?.user ?? null;
  const sessionAddress = user?.address ?? null;
  const signedIn = Boolean(w.address && sessionAddress && sessionAddress.toLowerCase() === w.address.toLowerCase());

  const signIn = useMutation({
    mutationFn: async () => {
      if (!w.address) throw new Error("Connect a wallet first.");
      const address = w.address.toLowerCase();
      const { message } = await api<NonceResponse>("/api/auth/nonce", { method: "POST", json: { address } });
      const signature = (await signMessageAsync({ message })) as Hex;
      await api<unknown>("/api/auth/verify", { method: "POST", json: { address, message, signature } });
      return api<MeResponse>("/api/auth/me");
    },
    onSuccess: async (res) => {
      qc.setQueryData<MeResponse>(qk.me, res);
      await qc.invalidateQueries({ queryKey: ["api"], predicate: (q) => q.queryKey[1] !== "me" });
    },
  });

  const signOut = useMutation({
    mutationFn: () => api<unknown>("/api/auth/logout", { method: "POST", json: {} }),
    onSettled: () => {
      qc.setQueryData<MeResponse>(qk.me, { user: null });
      qc.removeQueries({ queryKey: ["api"], predicate: (q) => !["me", "countries", "claim"].includes(String(q.queryKey[1])) });
    },
  });

  return {
    wallet: w,
    user,
    sessionAddress,
    sessionLoading: me.isLoading,
    sessionError: me.isError && !me.data,
    signedIn,
    mismatch: Boolean(w.address && sessionAddress && !signedIn),
    signIn,
    signOut,
  };
}
