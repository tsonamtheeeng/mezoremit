# MezoRemit — Contracts

`contracts/src/RemittanceManager.sol` implements the FROZEN `contracts/src/interfaces/IRemittanceManager.sol`
(solc 0.8.28, EVM cancun, OZ 5.4). One contract, one token (MUSD), no admin.

## 1. Surface

Constructor: `constructor(IERC20 token, uint64 minExpiry)` — reverts `ZeroAddress` (token 0) or
`InvalidExpiry` (`minExpiry == 0` or `> MAX_EXPIRY`). EIP-712 domain: name `"MezoRemit"`, version `"1"`,
`chainId = block.chainid`, `verifyingContract = address(this)`.

| Function | Who | Effect |
|---|---|---|
| `sendDirect(recipient, amount, ref)` | anyone | `transferFrom(sender → recipient)`; record `Direct/Completed`, `settledAt = now`; `DirectTransferSent` |
| `sendDirectWithPermit(…, deadline, v, r, s)` | anyone | `try permit {} catch {}`, then as above |
| `createClaimable(claimSigner, amount, expiresAt, ref)` | anyone | pull into escrow; record `Claimable/Funded`; `totalEscrowed += amount`; `ClaimableCreated` |
| `createClaimableWithPermit(…, deadline, v, r, s)` | anyone | `try permit {} catch {}`, then as above |
| `claimTransfer(id, recipient, signature)` | anyone (recipient or relayer) | verify claim-key EIP-712 sig over `Claim(id, recipient)`; `Claimed`; pay `recipient`; `TransferClaimed(…, submitter = msg.sender)` |
| `cancelTransfer(id)` | sender only | `Funded` claimable (before **or** after expiry) → `Cancelled`; refund sender; `TransferCancelled` |
| `refundExpiredTransfer(id)` | anyone | `Funded` claimable with `now >= expiresAt` → `Refunded`; funds to **sender**; `TransferRefunded(…, caller)` |

Views: `token()`, `MIN_EXPIRY()` (immutable), `MAX_EXPIRY()` = 90 days, `MAX_AMOUNT()` = 10,000,000 MUSD,
`nextTransferId()` (starts at 1), `totalEscrowed()`, `transferIdByRef(sender, ref)` (0 = unknown; refs are unique per sender),
`getTransfer(id)`, `getTransferStatus(id)`, `isClaimable(id)`, `claimDigest(id, recipient)`.
Extras beyond the interface: `CLAIM_TYPEHASH`, `DOMAIN_SEPARATOR()`, `eip712Domain()` (ERC-5267, from OZ).

### Checks, in order

- **sendDirect**: `recipient != 0` (`ZeroAddress`) · `recipient != msg.sender && recipient != manager`
  (`SelfTransfer`) · `amount != 0` (`ZeroAmount`) · `amount <= MAX_AMOUNT` (`AmountTooLarge`) · ref
  (`DuplicateRef`) · after transfer, recipient balance delta == amount (`UnexpectedBalanceChange`).
- **createClaimable**: `claimSigner != 0` (`ZeroAddress`) · amount checks · `expiresAt > now` and
  `MIN_EXPIRY <= expiresAt - now <= MAX_EXPIRY` (`InvalidExpiry`) · ref (`DuplicateRef`) · manager balance
  delta == amount (`UnexpectedBalanceChange`).
- **claimTransfer**: exists (`TransferNotFound`) · Claimable + Funded (`NotClaimable`) · `now < expiresAt`
  (`TransferExpired`) · `recipient != 0` (`ZeroAddress`) · `recipient != manager` (`SelfTransfer`) ·
  `ECDSA.tryRecover(claimDigest(id, recipient), sig)` returns `NoError` and equals `claimSigner`
  (`InvalidClaimSignature` — covers wrong key, wrong recipient, wrong id/contract/chain, high-s malleable
  sigs, bad `v`, any length other than 65, and the all-zero signature).
- **cancelTransfer**: exists · Claimable + Funded · `msg.sender == sender` (`NotSender`).
- **refundExpiredTransfer**: exists · Claimable + Funded · `now >= expiresAt` (`NotExpired`).

### Design decisions

- **`ref` must be non-zero and unique across both kinds.** `bytes32(0)` is reserved because it is what an
  unknown lookup looks like; a zero ref reverts `DuplicateRef` (the interface has no dedicated error).
  The app always uses `keccak256("mezoremit:transfer:" + uuid)` (`lib/chain/claim.ts#transferRef`).
- **The manager is never a recipient** (direct or claim) — `SelfTransfer`. Funds sent there would be
  unrecoverable and break escrow accounting.
- **`getTransfer` on an unknown id returns the zero struct** (`Kind.None`, `Status.None`); it does not revert.
  `getTransferStatus` returns `None`, `isClaimable` returns false.
- **Permit failures are swallowed** (`try/catch`) so a griefer who front-runs the permit (consuming the nonce)
  cannot block the transfer; if the allowance is insufficient, `transferFrom` reverts with the token's own
  error. Tokens without permit work the same way with a prior `approve`.
- **Fee-on-transfer / deflationary tokens are rejected** by balance-delta checks. MUSD is a plain ERC-20.
- Expired-but-Funded is not a stored status: `expired` is derived (`now >= expiresAt`), matching
  `docs/ARCHITECTURE.md` §3. After expiry only `cancelTransfer` (sender) and `refundExpiredTransfer`
  (anyone) work; both pay the sender.
- `claimSigner` may equal the sender, and the same `claimSigner` may be reused across transfers — signatures
  are still bound to `transferId`, so this is safe (the app uses a fresh key per transfer anyway).

## 2. State machine

```
                    sendDirect ──────────────────────────────▶ Completed (Direct)  [terminal]

createClaimable ──▶ Funded ──claimTransfer (now < expiresAt, valid sig)──▶ Claimed    [terminal]
                       │ ──cancelTransfer (sender, any time)────────────▶ Cancelled  [terminal]
                       └ ──refundExpiredTransfer (anyone, now ≥ expiresAt)▶ Refunded [terminal]
```

Every settling write is checks → effects (status, recipient, settledAt, totalEscrowed) → single token
transfer → event, under `nonReentrant`. No loops anywhere.

## 3. Invariants and the tests that prove them

| # | Invariant | Proven by |
|---|---|---|
| I1 | Escrow is fully backed: `token.balanceOf(manager) >= totalEscrowed` (== when nobody donates tokens directly) | `invariant_balanceEqualsTotalEscrowedEqualsFundedSum` (Invariant.t.sol), `test_escrowIsPerTransfer` |
| I2 | `totalEscrowed == Σ amount of Funded claimables` | `invariant_balanceEqualsTotalEscrowedEqualsFundedSum` (also vs. a ghost model), `testFuzz_create` |
| I3 | Terminal states are terminal: a settled transfer is never Funded again and each claimable pays out exactly once (incl. under reentrancy) | `invariant_settledNeverFundedAgain`, `test_claim_duplicateReverts`, `test_cancel_twiceReverts`, `test_refund_twiceReverts`, `test_claim_afterCancelReverts`, `test_claim_afterRefundReverts`, `test_cancel_revertsAfterClaim`, `test_refund_revertsAfterClaim/AfterCancel`, `ReentrancyTest.*` |
| I4 | Escrow is released only to the recipient signed by the transfer's claim key; submitter (relayer / front-runner) cannot redirect | `test_frontRun_swappedRecipientFails`, `test_claim_revertsWrongSigner`, `testFuzz_claim_wrongKeyAlwaysFails`, `test_claim_byRelayer`, `testFuzz_claim_anyRecipient`, handler `claim` (asserts success iff right key) |
| I5 | A claim signature is valid for exactly one (transferId, manager, chainId, recipient) — no replay | `test_replay_acrossTransfersFails`, `test_replay_acrossManagersFails`, `test_replay_acrossChainsFails`, `test_wrongDomainName_fails`, `test_tsVector_wrongChainFails` |
| I6 | Only canonical ECDSA signatures are accepted (low-s, v ∈ {27,28}, 65 bytes, non-zero signer) | `test_malleableHighS_rejected`, `test_invalidV_rejected`, `test_badLength_rejected`, `test_zeroSignatureRecoversToZero_rejected` |
| I7 | Claims only while `now < expiresAt`; `isClaimable` agrees exactly | `test_claim_lastSecondBeforeExpiry`, `test_claim_revertsAtExactExpiry`, `test_claim_revertsAfterExpiry`, `invariant_recordShape` |
| I8 | Only the sender can cancel; cancel and refund always pay the original sender, whoever calls | `test_cancel_revertsNonSender`, `test_cancel_beforeExpiry/afterExpiry`, `test_refund_atExactExpiryByAnyone`, handler `cancel`/`refund` |
| I9 | Refunds only at/after expiry | `test_refund_revertsBeforeExpiry`, `test_refund_atExactExpiryByAnyone`, `testFuzz_refund_timing` |
| I10 | Direct transfers never touch custody and are Completed at creation, with exact delivery | `test_sendDirect_happy`, `testFuzz_sendDirect`, `invariant_recordShape`, `test_feeToken_directReverts` |
| I11 | Amounts satisfy `0 < amount <= MAX_AMOUNT` and arrive exactly (fee-on-transfer rejected) | `test_*_revertsZeroAmount`, `test_*_revertsTooLarge`, `test_sendDirect_maxAmountExactlyOk`, `testFuzz_create_amountTooLargeReverts`, `test_feeToken_createReverts` |
| I12 | Expiry window `MIN_EXPIRY <= expiresAt - now <= MAX_EXPIRY` | `test_create_expiryExactlyMinOk/MaxOk`, `test_create_revertsExpiryBelowMin/AboveMax/Now/Past`, `testFuzz_create`, `testFuzz_create_invalidWindowReverts` |
| I13 | Ids are dense from 1 across both kinds; refs are non-zero and unique per sender; `transferIdByRef(t.sender, t.ref) == id`; another sender using the same ref cannot block it | `invariant_idsAndRefsConsistent`, `test_create_idsIncrementSharedWithDirect`, `test_refUniqueAcrossKinds`, `test_refSquatByOtherSenderDoesNotBlock`, `test_*_revertsDuplicateRef`, `test_*_revertsZeroRef` |

The 13 rows above are the engineering invariants. The product brief's 13 non-negotiable invariants map onto them as follows:

| Brief invariant | Covered by |
|---|---|
| 1. No invalid amounts | I11 |
| 2. No claim before funding | create+fund is atomic, so no unfunded on-chain state exists; claim of an unknown id reverts (I3, `TransferNotFound` tests) |
| 3. No double claim | I3 |
| 4. Only the valid claim-key holder can claim | I4, I5, I6 |
| 5. A direct transfer can't be redirected | I10 (recipient fixed in the same tx) |
| 6. A cancelled transfer can't be claimed | I3 (`test_claim_afterCancelReverts`) |
| 7. An expired transfer can't be claimed | I7 |
| 8. Only eligible transfers are refunded | I9 |
| 9. No refund after a claim | I3 (`test_refund_revertsAfterClaim`) |
| 10. Balances fully accounted | I1, I2 |
| 11. No unauthorized withdrawal | I4, I8; no admin/rescue functions exist |
| 12. No unbounded loops | no loops in the contract |
| 13. Events for all state changes | `expectEmit` tests for all five events |
repo); they cover every rule the brief states.

Cross-language parity (the contract's digest equals what `lib/chain/claim.ts` signs):
`TsCompatTest` deploys the manager at `0x1000…0001` on chain 31611 (`deployCodeTo` + `vm.chainId`) and claims
with a signature produced by viem through the frozen `signClaim` (`contracts/test/fixtures/gen-claim-vector.mts`
→ `claim-vector.json`). `test_claimDigest_matchesRawEip712` / fuzz compare `claimDigest` to a digest computed
in-test from the raw EIP-712 formula. Also checks `transferRef(uuid)` equals the Solidity
`keccak256("mezoremit:transfer:" + uuid)`.
Regenerate the vector: `node_modules/.bin/tsx contracts/test/fixtures/gen-claim-vector.mts`.

Other coverage: insufficient allowance / balance (both kinds), permit happy path (both kinds), permit
front-run (nonce already used) still succeeds, bad permit without allowance reverts, expired permit with prior
approval succeeds, non-permit token, constructor reverts, unknown-id views, events (`expectEmit`) for all five
events. Stateful handler: 4 actors × 4 claim keys, random create/direct/claim/cancel/refund/warp
(128 runs × depth 128).

## 4. Trust assumptions

- **The claim link is a bearer instrument.** Whoever holds the claim key (URL fragment) first can sign a claim
  to any address. Share it privately; if it leaks, the sender should `cancelTransfer` before it is used.
- **Relayers and mempool observers cannot redirect funds**: the recipient is inside the signed struct. A relayer
  can only delay (decline to submit); the recipient can always submit themselves.
- **No admin**: no owner, pause, fee, upgrade, rescue or sweep. Nobody can move escrow except the claim-key
  holder (to their signed recipient) and the sender (cancel / refund — refunds always go to `sender`). Tokens
  sent to the manager by plain `transfer` are not credited to anyone and are stuck (so `balance >=
  totalEscrowed`, not `==`).
- **Token trust**: MUSD is assumed to be a standard ERC-20. A token that could blacklist the manager or
  recipient, or pause, could block payouts; that is outside this contract's control.
- **Time**: expiry uses `block.timestamp`; validator skew of seconds is irrelevant at `MIN_EXPIRY >= 60 s`.
  Exactly at `expiresAt` a transfer is expired (claim reverts, refund works).
- **Sender griefing of a claimer**: the sender can cancel up to the moment of claim (by design — cancel is
  allowed any time while Funded). A recipient's claim tx racing a cancel loses if the cancel lands first.

## 5. Gas (forge `--gas-report`, optimizer 200 runs)

| Call | Typical gas |
|---|---|
| deploy | ~1.85M (9.3 KB runtime) |
| `sendDirect` | ~207k (cold; stores the full record + ref) |
| `sendDirectWithPermit` | ~213–239k |
| `createClaimable` | ~237k (cold) |
| `createClaimableWithPermit` | ~240–262k |
| `claimTransfer` | ~60–70k (warm record; 162k max in tests with hook token) |
| `cancelTransfer` | ~30–60k |
| `refundExpiredTransfer` | ~50k |

The `Transfer` struct shape is frozen by the interface (6 storage slots); most of the create cost is those
cold `SSTORE`s plus the ref mapping. No loops, so every call is O(1).

## 6. Build, test, deploy

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd contracts
forge build
forge test                       # unit + fuzz + invariant + TS-compat
cd .. && node scripts/export-abi.mjs   # regenerates lib/chain/abis.ts; fails if any interface item is missing
```

Deploy (owner only; holds the key — not run by agents):

```bash
cd contracts
# env: DEPLOYER_PRIVATE_KEY (or use --account <keystore>), MUSD (default 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503),
#      MIN_EXPIRY (default 60)
forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --legacy
```

On broadcast the script writes `contracts/deployments/<chainId>.json`:
`{ chainId, manager, musd, minExpiry, deployBlock, deployer }`. `deployBlock` is the block observed before
sending (a safe lower bound for the indexer's backfill); the exact tx hash and block are in
`contracts/broadcast/Deploy.s.sol/<chainId>/run-latest.json`. The script refuses to deploy if `MUSD` has no code
on the target chain (except on local anvil, 31337). Dry runs (no `--broadcast`) do not write the file.
