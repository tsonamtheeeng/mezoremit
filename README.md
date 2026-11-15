# MezoRemit

**Send money across borders. Settle in MUSD.**

MezoRemit is a peer-to-peer international money transfer app built on MUSD, the Bitcoin-backed dollar on Mezo.
You can send MUSD straight to a wallet. You can also send a secure **claim link** to someone who doesn't have a wallet yet.
They open the link, connect a wallet through **Mezo Passport** (a Bitcoin wallet such as Unisat, OKX or Xverse, or an Ethereum wallet) and claim the exact amount. They don't need BTC for the network fee, because a relayer can pay it.

> Testnet MVP (Mezo Testnet, chain 31611). Test funds only. MezoRemit is not a licensed money transmitter.
> Local-currency payout is a **labelled simulation**: no provider today can pay out Mezo-testnet MUSD (see
> [docs/FIAT_AND_CORRIDORS.md](docs/FIAT_AND_CORRIDORS.md)). This code has not been audited by a third party.

## Status

| | |
|---|---|
| Contracts | `RemittanceManager` — 104 Foundry tests (unit, fuzz, stateful invariants, reentrancy, cross-language EIP-712 vector) |
| Web + API + worker | 115 Vitest tests (58 server, 57 UI), `tsc`, `eslint`, `next build` clean |
| Testnet deploy | `RemittanceManager` [`0xe722…7e95`](https://explorer.test.mezo.org/address/0xe722e59e163a8193E9C7072bA9D660f5217A7e95) (block 16756115) |
| Live URL | https://mezoremit.vercel.app (Vercel + Supabase Postgres, own `mezoremit` schema). Gas relayer on. Worker not hosted yet |
| Two-wallet demo | Run on testnet 2026-11-13: 25 MUSD claim via relayer (exact delta), duplicate claim reverts, expiry refund. Video: [demo/](demo/README.md) |

## How it works

```
 Sender (wallet A)                    Mezo Testnet                         Recipient (wallet B)
 ─────────────────                    ─────────────                        ────────────────────
 pick country, amount, recipient
 review: amount · fee 0 · receives
 browser makes a one-time claim key ──► createClaimable(claimSigner,      
                                        amount, expiresAt, ref)  escrow
 share link  /claim/<id>#k=<key>  ─────────────────────────────────────►  opens link, connects wallet B
                                                                          key signs Claim(id, walletB)
                                       claimTransfer(id, B, sig) ◄──────  relayer (or B) submits
                                       MUSD ──────────────────────────►   exact amount lands in B
 indexer verifies events ──► both dashboards update, explorer links on both sides
```

- **Direct transfer:** `sendDirect` moves MUSD from A to B in one transaction. MezoRemit never holds the funds.
- **Claimable transfer:** each transfer is escrowed separately. Only the claim key's *address* is stored on-chain. The
  private key lives in the URL fragment, which browsers never send to a server.
  - The claim signature names the recipient, so neither the relayer nor someone watching pending transactions can redirect the funds.
  - The sender can cancel any time before a claim. After expiry, anyone can trigger the refund, and it always goes back to the sender.
- **No admin keys, no pooled custody, no fees in the contract.** On testnet the service fee is 0 MUSD, and the network fee is paid in BTC.
- **The chain is the source of truth.** A transfer only becomes `completed` or `claimed` after the indexer or receipt verifier has seen
  confirmed `RemittanceManager` events. Fiat payout status is tracked separately and is never inferred from on-chain settlement.

**Trust assumption:** the claim link is a bearer instrument. Whoever opens it first can claim. Share it privately, and cancel if it leaks.

## Repo map

| Path | What |
|---|---|
| `contracts/` | Foundry: `src/RemittanceManager.sol`, frozen `src/interfaces/IRemittanceManager.sol`, tests, `script/Deploy.s.sol` |
| `lib/chain/` | chain config (single source of addresses), claim-key/link helpers, ABIs |
| `lib/server/` | auth (SIWE), recipients (AES-GCM contact refs), quotes + provider adapters, transfers, indexer, relayer, payouts, notifications |
| `app/api/` | route handlers (see [docs/API.md](docs/API.md)) |
| `app/`, `components/` | web app: landing, send flow, claim page, tracking, dashboards, history, recipients, payouts (sandbox), settings, notifications, help |
| `worker/` | indexer + reconciliation + expiry sweep + sandbox payout driver + email delivery (Render) |
| `scripts/demo-testnet.ts` | reproducible two-wallet end-to-end demo against the deployed app |

Docs: [ARCHITECTURE](docs/ARCHITECTURE.md) · [CONTRACTS](docs/CONTRACTS.md) · [API](docs/API.md) ·
[OPERATIONS](docs/OPERATIONS.md) · [DESIGN](docs/DESIGN.md) · [FIAT_AND_CORRIDORS](docs/FIAT_AND_CORRIDORS.md)

## Local setup

```bash
npm install
cp .env.example .env.local          # leave DATABASE_URL empty → embedded PGlite
(cd contracts && forge test)        # contracts
npm test                            # web + server tests
npm run dev                         # http://localhost:3000
```
With PGlite, run only one process. To index events, use `POST /api/indexer/sync` or point `DATABASE_URL` at Postgres and run `npm run worker`.

## Deploy (Mezo Testnet)

```bash
cd contracts
echo "DEPLOYER_PRIVATE_KEY=0x…" > .env          # gitignored; needs a little testnet BTC
source .env && forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --legacy
cat deployments/31611.json                      # → NEXT_PUBLIC_MANAGER_ADDRESS, NEXT_PUBLIC_DEPLOY_BLOCK
cd .. && node scripts/export-abi.mjs
```
Then set up hosting (details in [docs/OPERATIONS.md](docs/OPERATIONS.md)):
- **Neon Postgres:** create a database and use its connection string as `DATABASE_URL`.
- **Vercel (web):** set the `NEXT_PUBLIC_*` values, `SESSION_SECRET`, `RECIPIENT_DATA_KEY` and `INDEXER_SECRET`, plus `RELAYER_PRIVATE_KEY` if you want the relayer.
- **Render (worker):** deploy from `render.yaml`.

### Two-wallet demo

```bash
SENDER_PRIVATE_KEY=0x… RECIPIENT_PRIVATE_KEY=0x… API_BASE_URL=https://<app> npm run demo:testnet
```
The script runs these steps:
1. Signs in both wallets.
2. Creates a recipient and a quote.
3. Funds a **25 MUSD** claim transfer from wallet A.
4. Waits for the indexer, then claims it into wallet B and checks that B's balance went up by exactly 25 MUSD.
5. Checks that a duplicate claim reverts.
6. Creates a short-expiry transfer, lets it expire and refunds it to A.
7. Sends one direct transfer.

It writes the tx hashes and explorer links to `docs/demo-run.json`. Wallet A needs about 55 MUSD and some testnet BTC
([faucet](https://faucet.test.mezo.org); MUSD is borrowed at [testnet.mezo.org](https://testnet.mezo.org)).

## Corridors and fiat

- **Mexico and Philippines:** recommended pilots. The app shows a *sandbox* payout lifecycle, labelled "Simulated — no money moved". It only advances through HMAC-signed webhooks.
- **India and others:** MUSD to a wallet only.
- **Nepal:** excluded, because Nepal Rastra Bank prohibits crypto transactions.

On-ramp and off-ramp are provider-agnostic interfaces (`lib/server/providers`). Banxa is the only provider found with Mezo MUSD
support, and only for on-ramp on mainnet. Exchange rates are live reference rates (open.er-api.com, with Frankfurter as fallback) and are always labelled *indicative*.

## Business model and users

- **Target users:** migrant workers sending home, international freelancers and remote workers, crypto-native communities, and small businesses paying contractors.
- **Revenue later:** a transparent transfer fee, a disclosed FX margin through licensed payout partners, partner revenue share, and business/API accounts. Every fee is shown before the user confirms.

## Known limitations and roadmap

- Not yet deployed. No live URL and no demo-run hashes until the deploy step above is done.
- No real fiat payout. A real-money pilot needs a licensed partner, KYC/AML and sanctions screening, and legal review
  (FinCEN MSB, state MTLs, destination-country rules). See `docs/FIAT_AND_CORRIDORS.md`.
- The claim link is a bearer instrument. An optional second factor (for example, a code sent separately) is future work.
- If the sender loses the claim key before sharing it, it can't be recovered. The sender can cancel or refund instead.
- No third-party audit has been done.
