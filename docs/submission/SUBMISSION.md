# MezoRemit: AKINDO submission

- **Product:** MezoRemit
- **Tagline (≤ 50 characters):** Send money across borders. Settle in MUSD.
- **Track:** Payments / consumer
- **Logo:** `docs/submission/mezoremit-logo.png` (1024×1024, transparent)

## Short description

MezoRemit is a remittance app on Mezo. You send MUSD, the Bitcoin-backed dollar, straight to a wallet, or as a claim
link for someone who has no wallet yet. Every fee is shown before you send, recipients claim for free through a gas
relayer, and every step is checked against Mezo before the app marks it done.

## Long description (≤ 1,000 characters)

Sending money home is slow and the fees show up late. MezoRemit settles in MUSD on Mezo. A direct send goes wallet to
wallet. A claim link locks MUSD in its own escrow in the RemittanceManager contract: the sender's browser makes a
one-time key and only its address goes on-chain, the key stays in the link fragment, and the recipient's signed claim
names their wallet, so nobody can redirect the money. The sender can cancel any time before a claim, and after expiry
anyone can refund it to the sender. No admin keys, no pooled funds. Sign in with Mezo Passport (Bitcoin wallets via a
Mezo smart account, or Ethereum wallets). The review screen lists every fee, and local-currency rates are shown as
indicative; Mexico and the Philippines have a clearly simulated payout demo. Live on Mezo Testnet, with a two-wallet
demo run on-chain.

## What we built this wave

- `RemittanceManager` on Mezo Testnet: direct sends, per-transfer claim escrow, EIP-712 claim signatures, cancel and
  expiry refund, refs scoped per sender. 105 Foundry tests including invariants; a 2-pass AI audit, finding fixed.
- Web app: send flow (country, amount, recipient, delivery, review), claim page, tracking timeline, history, received
  money, recipients, notifications, simulated payouts. Mezo Passport, gas relayer for free claims, indexer that only
  trusts confirmed contract events.
- Live: two-wallet run on testnet (25 MUSD claim via relayer, duplicate claim rejected, expiry refund), plus a demo video.

## Next wave

- Host the background worker so expiry refunds and missed events update without a page visit.
- A second factor for claim links (a short code sent separately) and an SMS/email share flow.
- A licensed payout partner pilot for one corridor (Mexico or the Philippines), with KYC, on mainnet MUSD.
- Mobile polish and more corridors, with each country's rules checked first.

## Links

- App: https://mezoremit.vercel.app
- Repo: https://github.com/tsonamtheeeng/mezoremit
- Contract (Mezo Testnet): `0xe722e59e163a8193E9C7072bA9D660f5217A7e95`
  (https://explorer.test.mezo.org/address/0xe722e59e163a8193E9C7072bA9D660f5217A7e95)
- Video: <<VIDEO_URL>>
