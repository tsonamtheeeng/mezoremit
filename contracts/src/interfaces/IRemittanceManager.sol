// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title IRemittanceManager — FROZEN interface for MezoRemit settlement on Mezo.
/// @notice Two transfer methods share one id space and one lifecycle:
///  - Direct:    MUSD moves sender -> recipient in the same tx. Record is Completed immediately. No custody.
///  - Claimable: MUSD is escrowed per transfer. The sender's browser generates an ephemeral "claim key";
///               only its address (`claimSigner`) goes on-chain. The private key travels in the claim link
///               fragment. To claim, the link holder signs EIP-712 `Claim(transferId, recipient)` with the
///               claim key; anyone may submit that signature (recipient or a gas relayer), and funds can only
///               go to the signed `recipient`. A front-runner who copies the tx cannot redirect funds.
///  No admin, no pause, no fee, no upgradeability: nobody but the sender (cancel/refund) or the claim-key
///  holder (claim) can move escrowed funds, and refunds always go back to the original sender.
interface IRemittanceManager {
    enum Kind {
        None,
        Direct,
        Claimable
    }

    /// Funded    = claimable and escrowed (may be past expiry: then only cancel/refundExpired work)
    /// Claimed   = claimable paid out to `recipient`
    /// Cancelled = sender reclaimed before a claim
    /// Refunded  = returned to sender after expiry (by anyone)
    /// Completed = direct transfer delivered
    enum Status {
        None,
        Funded,
        Claimed,
        Cancelled,
        Refunded,
        Completed
    }

    struct Transfer {
        address sender;
        Kind kind;
        Status status;
        uint64 createdAt;
        uint64 expiresAt; // 0 for direct
        uint64 settledAt; // claim / cancel / refund / direct time
        address recipient; // direct: fixed at creation; claimable: set on claim, else 0
        address claimSigner; // claimable only, else 0
        uint256 amount; // MUSD base units (18 decimals)
        bytes32 ref; // off-chain reference = keccak256(app transfer uuid); never PII. Unique per sender.
    }

    // ------------------------------------------------------------------ events (indexer contract)
    event DirectTransferSent(
        uint256 indexed transferId, address indexed sender, address indexed recipient, uint256 amount, bytes32 ref
    );
    event ClaimableCreated(
        uint256 indexed transferId,
        address indexed sender,
        address indexed claimSigner,
        uint256 amount,
        uint64 expiresAt,
        bytes32 ref
    );
    event TransferClaimed(uint256 indexed transferId, address indexed recipient, uint256 amount, address submitter);
    event TransferCancelled(uint256 indexed transferId, address indexed sender, uint256 amount);
    event TransferRefunded(uint256 indexed transferId, address indexed sender, uint256 amount, address caller);

    // ------------------------------------------------------------------ errors
    error ZeroAmount();
    error AmountTooLarge();
    error ZeroAddress();
    error SelfTransfer();
    error InvalidExpiry();
    error DuplicateRef();
    error UnexpectedBalanceChange();
    error TransferNotFound();
    error NotClaimable(); // wrong kind, or status != Funded
    error TransferExpired();
    error NotExpired();
    error InvalidClaimSignature();
    error NotSender();

    // ------------------------------------------------------------------ writes
    /// @notice Pull `amount` MUSD from msg.sender and deliver it to `recipient` now.
    function sendDirect(address recipient, uint256 amount, bytes32 ref) external returns (uint256 transferId);

    /// @notice sendDirect with an EIP-2612 permit (permit failure is tolerated if allowance already suffices).
    function sendDirectWithPermit(
        address recipient,
        uint256 amount,
        bytes32 ref,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 transferId);

    /// @notice Create AND fund a claimable transfer atomically (no unfunded on-chain state exists).
    /// @param expiresAt absolute unix time; must satisfy MIN_EXPIRY <= expiresAt - now <= MAX_EXPIRY.
    function createClaimable(address claimSigner, uint256 amount, uint64 expiresAt, bytes32 ref)
        external
        returns (uint256 transferId);

    function createClaimableWithPermit(
        address claimSigner,
        uint256 amount,
        uint64 expiresAt,
        bytes32 ref,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external returns (uint256 transferId);

    /// @notice Release escrow to `recipient`. `signature` = claim key's EIP-712 signature over
    ///         Claim(transferId, recipient). Callable by anyone; only before expiry; once.
    function claimTransfer(uint256 transferId, address recipient, bytes calldata signature) external;

    /// @notice Sender takes back an unclaimed (Funded) claimable transfer, before or after expiry.
    function cancelTransfer(uint256 transferId) external;

    /// @notice After expiry, anyone may return an unclaimed transfer to its sender.
    function refundExpiredTransfer(uint256 transferId) external;

    // ------------------------------------------------------------------ views
    function token() external view returns (address);
    function MIN_EXPIRY() external view returns (uint64);
    function MAX_EXPIRY() external view returns (uint64);
    function MAX_AMOUNT() external view returns (uint256);
    function nextTransferId() external view returns (uint256); // ids start at 1
    function totalEscrowed() external view returns (uint256); // sum of Funded claimable amounts
    /// @notice Refs are scoped to the sender: another caller can never take or block a sender's ref.
    function transferIdByRef(address sender, bytes32 ref) external view returns (uint256); // 0 if unknown
    function getTransfer(uint256 transferId) external view returns (Transfer memory);
    function getTransferStatus(uint256 transferId) external view returns (Status);
    /// @notice true iff claimable, Funded, and block.timestamp < expiresAt
    function isClaimable(uint256 transferId) external view returns (bool);
    /// @notice EIP-712 digest the claim key must sign.
    function claimDigest(uint256 transferId, address recipient) external view returns (bytes32);
}
