// FROZEN. Single source of chain + contract configuration. Never hardcode addresses elsewhere.
import { defineChain, type Address } from "viem";

export const MEZO_TESTNET_ID = 31611 as const;

export const mezoTestnet = defineChain({
  id: MEZO_TESTNET_ID,
  name: "Mezo Testnet",
  nativeCurrency: { name: "Bitcoin", symbol: "BTC", decimals: 18 },
  rpcUrls: {
    default: {
      http: [process.env.NEXT_PUBLIC_MEZO_RPC_URL || "https://rpc.test.mezo.org"],
      webSocket: ["wss://rpc-ws.test.mezo.org"],
    },
  },
  blockExplorers: { default: { name: "Mezo Explorer", url: "https://explorer.test.mezo.org" } },
  testnet: true,
});

/** Verified live 2026-11-10 on chain 31611 (block ~16.69M): name "Mezo USD", symbol MUSD, 18 decimals,
 *  EIP-2612 permit (domain "Mezo USD" / "1", verified 2026-11-09). Listed in the official contracts reference. */
export const MUSD_TESTNET: Address = "0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503";
export const MUSD_DECIMALS = 18 as const;
export const MUSD_SYMBOL = "MUSD" as const;
export const MUSD_PERMIT_DOMAIN = { name: "Mezo USD", version: "1" } as const;

const ZERO = "0x0000000000000000000000000000000000000000" as Address;
function addr(v: string | undefined): Address {
  return v && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v as Address) : ZERO;
}

/** Deployed RemittanceManager. Filled from env after `forge script Deploy` (contracts/deployments/31611.json). */
export const contracts = {
  musd: addr(process.env.NEXT_PUBLIC_MUSD_ADDRESS) === ZERO ? MUSD_TESTNET : addr(process.env.NEXT_PUBLIC_MUSD_ADDRESS),
  manager: addr(process.env.NEXT_PUBLIC_MANAGER_ADDRESS),
  /** Block the manager was deployed at; the indexer starts here. */
  deployBlock: BigInt(process.env.NEXT_PUBLIC_DEPLOY_BLOCK || "0"),
} as const;

export const isDeployed = contracts.manager !== ZERO;

export const EXPLORER = "https://explorer.test.mezo.org";
export const explorerTx = (hash: string) => `${EXPLORER}/tx/${hash}`;
export const explorerAddress = (a: string) => `${EXPLORER}/address/${a}`;

/** Must match RemittanceManager. MIN_EXPIRY is a constructor immutable (testnet deploy uses 60s). */
export const MANAGER_LIMITS = {
  TESTNET_MIN_EXPIRY: 60,
  MAX_EXPIRY: 90 * 86400,
  MAX_AMOUNT_MUSD: 10_000_000,
} as const;

/** Claim-link lifetimes offered in the UI. The demo option is always labelled "testnet demo". */
export const CLAIM_EXPIRY_OPTIONS = {
  "1d": { seconds: 86400, label: "24 hours" },
  "7d": { seconds: 7 * 86400, label: "7 days" },
  "30d": { seconds: 30 * 86400, label: "30 days" },
  demo_10m: { seconds: 600, label: "10 minutes (testnet demo)" },
} as const;
export type ClaimExpiryKey = keyof typeof CLAIM_EXPIRY_OPTIONS;

/** On-chain enum order (IRemittanceManager). */
export const CHAIN_KIND = ["none", "direct", "claimable"] as const;
export const CHAIN_STATUS = ["none", "funded", "claimed", "cancelled", "refunded", "completed"] as const;
export type ChainKind = (typeof CHAIN_KIND)[number];
export type ChainStatus = (typeof CHAIN_STATUS)[number];

/** EIP-712 domain of RemittanceManager (OZ EIP712("MezoRemit","1")). */
export const CLAIM_DOMAIN_NAME = "MezoRemit" as const;
export const CLAIM_DOMAIN_VERSION = "1" as const;
