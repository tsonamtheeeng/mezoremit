"use client";

import { useBalance, useReadContract } from "wagmi";
import type { Address } from "viem";
import { erc20Abi } from "@/lib/chain/abis";
import { contracts, MEZO_TESTNET_ID } from "@/lib/chain/config";

/** Live MUSD balance of `owner` on Mezo Testnet. */
export function useMusdBalance(owner: Address | undefined) {
  return useReadContract({
    address: contracts.musd,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: owner ? [owner] : undefined,
    chainId: MEZO_TESTNET_ID,
    query: { enabled: Boolean(owner), refetchInterval: 15_000 },
  });
}

/** Live BTC balance (pays the network fee). */
export function useBtcBalance(owner: Address | undefined) {
  return useBalance({ address: owner, chainId: MEZO_TESTNET_ID, query: { enabled: Boolean(owner), refetchInterval: 20_000 } });
}
