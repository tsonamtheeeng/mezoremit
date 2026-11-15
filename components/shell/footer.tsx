import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { AddressText } from "@/components/shared/address";
import { contracts, EXPLORER, isDeployed, MEZO_TESTNET_ID } from "@/lib/chain/config";
import { COUNTRIES } from "@/lib/corridors";
import { currencySymbol } from "@/lib/client/format";
import { SITE } from "@/lib/client/site";

const CURRENCIES = [...new Set(COUNTRIES.map((c) => c.currency))];

export function Footer() {
  return (
    <footer className="mt-auto border-t bg-surface">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 text-sm sm:px-6 md:grid-cols-[1.3fr_0.8fr_0.8fr_1.3fr]">
        <div className="space-y-4">
          <Logo />
          <p className="max-w-xs text-muted-foreground">
            A testnet demo. Test MUSD has no value. Local-currency payouts are simulated and no real money moves.
          </p>
          <ul aria-label="Currencies" className="flex max-w-xs flex-wrap gap-1.5">
            {CURRENCIES.map((cur) => (
              <li key={cur} className="num rounded-md border bg-card px-2 py-1 text-[0.75rem] text-muted-foreground">
                <span className="font-medium text-foreground">{currencySymbol(cur)}</span> {cur}
              </li>
            ))}
          </ul>
        </div>
        <nav aria-label="Product" className="space-y-2">
          <p className="font-medium">Product</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li><Link className="hover:text-foreground" href="/send">Send money</Link></li>
            <li><Link className="hover:text-foreground" href="/#how-it-works">How it works</Link></li>
            <li><Link className="hover:text-foreground" href="/#pricing">Pricing</Link></li>
            <li><Link className="hover:text-foreground" href="/help">Help</Link></li>
          </ul>
        </nav>
        <nav aria-label="Mezo" className="space-y-2">
          <p className="font-medium">Mezo Testnet</p>
          <ul className="space-y-1.5 text-muted-foreground">
            <li><a className="hover:text-foreground" href={SITE.btcFaucetUrl} target="_blank" rel="noreferrer">Testnet BTC</a></li>
            <li><a className="hover:text-foreground" href={SITE.musdUrl} target="_blank" rel="noreferrer">Testnet MUSD</a></li>
            <li><a className="hover:text-foreground" href={EXPLORER} target="_blank" rel="noreferrer">Explorer</a></li>
            <li><a className="hover:text-foreground" href={SITE.docsUrl} target="_blank" rel="noreferrer">Mezo docs</a></li>
          </ul>
        </nav>
        <div className="space-y-2">
          <p className="font-medium">Testnet contracts</p>
          <dl className="space-y-2.5 text-muted-foreground">
            <div>
              <dt className="text-[0.75rem]">RemittanceManager</dt>
              <dd className="text-foreground">
                {isDeployed ? <AddressText address={contracts.manager} /> : <span className="text-muted-foreground">Not deployed</span>}
              </dd>
            </div>
            <div>
              <dt className="text-[0.75rem]">MUSD token</dt>
              <dd className="text-foreground">
                <AddressText address={contracts.musd} />
              </dd>
            </div>
            <div>
              <dt className="text-[0.75rem]">Network</dt>
              <dd className="num text-foreground">Mezo Testnet · chain {MEZO_TESTNET_ID}</dd>
            </div>
          </dl>
        </div>
      </div>
    </footer>
  );
}
