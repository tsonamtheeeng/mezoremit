import { createConfig, http, type Config, type CreateConfigParameters } from "wagmi";
import type { WalletList } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, rabbyWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { mezoTestnet } from "@/lib/chain/config";
import { SITE } from "@/lib/client/site";

const transports = {
  [mezoTestnet.id]: http(mezoTestnet.rpcUrls.default.http[0], { retryCount: 3, retryDelay: 400, timeout: 20_000 }),
};

const walletConnectProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "";

type PassportConfigModule = typeof import("@mezo-org/passport/dist/src/config");

/**
 * Wallet connection goes through Mezo Passport (built on RainbowKit).
 * - Bitcoin wallets (Unisat, OKX, Xverse): the user signs with their Bitcoin key and a Mezo smart account
 *   backed by that key holds the EVM address and sends transactions (connector type "orangekit").
 * - Ethereum wallets connect directly. WalletConnect is listed only when NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID is set.
 * Mezo Testnet is the only chain.
 */
function buildWallets(passport: PassportConfigModule): WalletList {
  const evm = walletConnectProjectId
    ? [metaMaskWallet, rabbyWallet, walletConnectWallet, injectedWallet]
    : [metaMaskWallet, rabbyWallet, injectedWallet];
  return [
    {
      groupName: "Bitcoin wallets",
      wallets: [passport.unisatWalletMezoTestnet, passport.okxWalletMezoTestnet, passport.xverseWalletMezoTestnet],
    },
    { groupName: "Ethereum wallets", wallets: evm },
  ];
}

/** Server render: no connectors. `ssr: true` lets wagmi hydrate the real connection in the browser. */
function serverConfig() {
  return createConfig({ chains: [mezoTestnet], transports, connectors: [], ssr: true });
}

/**
 * Browser: the Passport config, loaded from the deep `config` module because the package root re-exports
 * Passport's UI kit (React 18 only), and its Bitcoin connectors read `window` when created.
 */
function browserConfig(): Config {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const passport = require("@mezo-org/passport/dist/src/config") as PassportConfigModule;
  return passport.getConfig({
    appName: SITE.name,
    appDescription: "Send money across borders. Settle in MUSD.",
    appUrl: SITE.url,
    mezoNetwork: "testnet",
    walletConnectProjectId: walletConnectProjectId || "mezoremit-no-walletconnect",
    wallets: buildWallets(passport),
    chains: [mezoTestnet],
    // Passport types this as Pick<CreateConfigParameters, "transports"> but spreads it into RainbowKit's
    // getDefaultConfig, which expects the transport map itself.
    transports: transports as unknown as Pick<CreateConfigParameters, "transports">,
    ssr: true,
  });
}

export const wagmiConfig: ReturnType<typeof serverConfig> =
  typeof window === "undefined" ? serverConfig() : (browserConfig() as ReturnType<typeof serverConfig>);

export { isSmartAccountConnector } from "./smart-account";

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
