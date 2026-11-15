import { MEZO_TESTNET_ID } from "@/lib/chain/config";

export type NetworkState =
  | { kind: "disconnected" }
  | { kind: "wrong-network"; chainId: number | undefined }
  | { kind: "ready"; chainId: number };

/** What the wallet needs before any write. Pure, so it is unit tested. */
export function networkState(isConnected: boolean, chainId: number | undefined, expected: number = MEZO_TESTNET_ID): NetworkState {
  if (!isConnected) return { kind: "disconnected" };
  if (chainId !== expected) return { kind: "wrong-network", chainId };
  return { kind: "ready", chainId };
}

export class WrongNetworkError extends Error {
  constructor(public readonly actual: number | undefined, public readonly expected: number = MEZO_TESTNET_ID) {
    super(`Wrong network: connected to ${actual ?? "unknown"}, expected ${expected}`);
    this.name = "WrongNetworkError";
  }
}

export function assertChain(actual: number | undefined, expected: number = MEZO_TESTNET_ID): void {
  if (actual !== expected) throw new WrongNetworkError(actual, expected);
}
