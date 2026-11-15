export const SITE = {
  name: "MezoRemit",
  tagline: "Send money across borders. Settle in MUSD.",
  description:
    "Send MUSD across borders on Mezo. Clear fees, simple claim links, and settlement anyone can check on the explorer. Testnet only.",
  url: (process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000").replace(/\/+$/, ""),
  btcFaucetUrl: "https://faucet.test.mezo.org",
  musdUrl: "https://testnet.mezo.org",
  docsUrl: "https://mezo.org/docs",
  rateAttributionUrl: "https://www.exchangerate-api.com",
} as const;

/** Origin used to build claim links. In the browser, the current origin wins so links match where the app runs. */
export function appOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  return SITE.url;
}
