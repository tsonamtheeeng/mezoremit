import { ExternalLink } from "lucide-react";
import { MEZO_TESTNET_ID } from "@/lib/chain/config";
import { SITE } from "@/lib/client/site";
import { cn } from "@/lib/client/utils";

const ext = "inline-flex items-center gap-1 font-medium text-brand-ink underline underline-offset-4";

/** No-wallet guidance. We never create a wallet for anyone. */
export function WalletGuide({ className, compact = false }: { className?: string; compact?: boolean }) {
  return (
    <ol className={cn("space-y-4 text-sm", className)}>
      <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
        <span className="num font-display text-base font-semibold text-muted-foreground">1</span>
        <div>
          <p className="font-medium">Install a wallet</p>
          <p className="text-muted-foreground">
            A Bitcoin wallet (Unisat, OKX or Xverse) or an Ethereum wallet (MetaMask or Rabby). Write down its recovery phrase and keep it private.
          </p>
        </div>
      </li>
      <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
        <span className="num font-display text-base font-semibold text-muted-foreground">2</span>
        <div>
          <p className="font-medium">Add Mezo Testnet</p>
          <p className="text-muted-foreground">
            Bitcoin wallets connect through Mezo Passport, nothing to add. Ethereum wallets: when you connect, we ask your wallet to add network {MEZO_TESTNET_ID}.
            {compact ? null : " You can also add it yourself with RPC https://rpc.test.mezo.org."}
          </p>
        </div>
      </li>
      <li className="grid grid-cols-[1.5rem_1fr] gap-x-3">
        <span className="num font-display text-base font-semibold text-muted-foreground">3</span>
        <div>
          <p className="font-medium">Get testnet BTC and MUSD</p>
          <p className="text-muted-foreground">
            BTC pays the network fee. Using a Bitcoin wallet? Send the BTC to your Mezo account address shown after you connect.{" "}
            <a className={ext} href={SITE.btcFaucetUrl} target="_blank" rel="noreferrer">
              Get testnet BTC <ExternalLink className="size-3" aria-hidden />
            </a>
          </p>
          <p className="mt-1 text-muted-foreground">
            MUSD is what you send. You borrow it against BTC on Mezo.{" "}
            <a className={ext} href={SITE.musdUrl} target="_blank" rel="noreferrer">
              Get testnet MUSD <ExternalLink className="size-3" aria-hidden />
            </a>
          </p>
        </div>
      </li>
    </ol>
  );
}
