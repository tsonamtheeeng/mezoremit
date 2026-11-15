"use client";

import { useAccount, useSwitchChain } from "wagmi";
import { isSmartAccountConnector } from "@/lib/client/smart-account";
import { mezoTestnet, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { networkState } from "@/lib/client/guard";

type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> };

/** Connected wallet + network state. Falls back to wallet_addEthereumChain when Mezo Testnet isn't in the wallet. */
export function useWallet() {
  const conn = useAccount();
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain();
  const network = networkState(conn.isConnected, conn.chainId);

  async function addMezo(provider: Eip1193) {
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [
        {
          chainId: `0x${MEZO_TESTNET_ID.toString(16)}`,
          chainName: mezoTestnet.name,
          nativeCurrency: mezoTestnet.nativeCurrency,
          rpcUrls: mezoTestnet.rpcUrls.default.http,
          blockExplorerUrls: [mezoTestnet.blockExplorers.default.url],
        },
      ],
    });
  }

  async function switchToMezo() {
    try {
      await switchChainAsync({ chainId: MEZO_TESTNET_ID });
    } catch (err) {
      const provider = (await conn.connector?.getProvider?.()) as Eip1193 | undefined;
      const code = (err as { code?: number; cause?: { code?: number } }).cause?.code ?? (err as { code?: number }).code;
      if (!provider || (code !== 4902 && code !== -32603 && code !== undefined)) throw err;
      await addMezo(provider);
    }
  }

  return {
    address: conn.address,
    chainId: conn.chainId,
    isConnected: conn.isConnected,
    connector: conn.connector,
    /** Mezo Passport Bitcoin wallet: a smart account sends txs; EIP-2612 permits don't work. */
    isSmartAccount: isSmartAccountConnector(conn.connector),
    network,
    isReady: network.kind === "ready",
    isSwitching,
    switchToMezo,
  };
}
