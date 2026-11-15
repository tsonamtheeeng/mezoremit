// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Permit.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IRemittanceManager} from "./interfaces/IRemittanceManager.sol";

/// @title RemittanceManager — MUSD direct sends and claim-link escrow for MezoRemit on Mezo.
/// @notice Implements the FROZEN {IRemittanceManager}. One id space (starting at 1) and one lifecycle for
///         two transfer kinds:
///          - Direct:    sender -> recipient in the same tx, no custody, recorded as Completed.
///          - Claimable: amount escrowed here per transfer; released only to the `recipient` signed (EIP-712
///                       `Claim(uint256 transferId,address recipient)`, domain "MezoRemit"/"1") by the
///                       transfer's `claimSigner`, before `expiresAt`. The sender can cancel any time while
///                       Funded; after expiry anyone can refund it to the sender.
/// @dev    No owner, admin, pause, fee or upgradeability. The token is immutable.
///         Design decisions (documented in docs/CONTRACTS.md):
///          - `ref` must be non-zero and unique per sender across both kinds; `bytes32(0)` is reserved, so a zero
///            ref reverts {DuplicateRef}. Uniqueness is scoped to `msg.sender` so nobody can take a pending
///            transfer's ref first (copied from the mempool) and make the sender's transaction revert.
///          - The manager itself is rejected as a direct or claim recipient ({SelfTransfer}): funds sent there
///            would be unrecoverable and would break `balanceOf(this) >= totalEscrowed` accounting.
///          - `getTransfer` on an unknown id returns the zero struct (Kind.None / Status.None); it never reverts.
///          - Fee-on-transfer / rebasing-on-transfer tokens are rejected by balance-delta checks.
contract RemittanceManager is IRemittanceManager, ReentrancyGuard, EIP712 {
    using SafeERC20 for IERC20;

    /// @notice EIP-712 typehash of `Claim(uint256 transferId,address recipient)`.
    bytes32 public constant CLAIM_TYPEHASH = keccak256("Claim(uint256 transferId,address recipient)");

    /// @inheritdoc IRemittanceManager
    uint64 public constant MAX_EXPIRY = 90 days;
    /// @inheritdoc IRemittanceManager
    uint256 public constant MAX_AMOUNT = 10_000_000e18;
    /// @inheritdoc IRemittanceManager
    uint64 public immutable MIN_EXPIRY;

    IERC20 private immutable _token;

    /// @inheritdoc IRemittanceManager
    uint256 public nextTransferId = 1;
    /// @inheritdoc IRemittanceManager
    uint256 public totalEscrowed;
    /// @inheritdoc IRemittanceManager
    mapping(address sender => mapping(bytes32 ref => uint256 transferId)) public transferIdByRef;

    mapping(uint256 transferId => Transfer) private _transfers;

    /// @param token_     the settlement token (MUSD). Must be a plain ERC-20 (no fee-on-transfer).
    /// @param minExpiry  minimum claim window in seconds; 0 < minExpiry <= MAX_EXPIRY.
    constructor(IERC20 token_, uint64 minExpiry) EIP712("MezoRemit", "1") {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (minExpiry == 0 || minExpiry > MAX_EXPIRY) revert InvalidExpiry();
        _token = token_;
        MIN_EXPIRY = minExpiry;
    }

    // ================================================================== writes

    /// @inheritdoc IRemittanceManager
    function sendDirect(address recipient, uint256 amount, bytes32 ref)
        external
        nonReentrant
        returns (uint256 transferId)
    {
        return _sendDirect(recipient, amount, ref);
    }

    /// @inheritdoc IRemittanceManager
    /// @dev The permit call is wrapped in try/catch so a front-run permit (nonce already consumed) cannot grief
    ///      the transfer; if the resulting allowance is insufficient, `transferFrom` reverts on its own.
    function sendDirectWithPermit(
        address recipient,
        uint256 amount,
        bytes32 ref,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 transferId) {
        _tryPermit(amount, deadline, v, r, s);
        return _sendDirect(recipient, amount, ref);
    }

    /// @inheritdoc IRemittanceManager
    function createClaimable(address claimSigner, uint256 amount, uint64 expiresAt, bytes32 ref)
        external
        nonReentrant
        returns (uint256 transferId)
    {
        return _createClaimable(claimSigner, amount, expiresAt, ref);
    }

    /// @inheritdoc IRemittanceManager
    /// @dev Same front-run-safe permit handling as {sendDirectWithPermit}.
    function createClaimableWithPermit(
        address claimSigner,
        uint256 amount,
        uint64 expiresAt,
        bytes32 ref,
        uint256 deadline,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant returns (uint256 transferId) {
        _tryPermit(amount, deadline, v, r, s);
        return _createClaimable(claimSigner, amount, expiresAt, ref);
    }

    /// @inheritdoc IRemittanceManager
    /// @dev Only 65-byte, low-s, non-zero-address ECDSA signatures are accepted (OZ `tryRecover`).
    function claimTransfer(uint256 transferId, address recipient, bytes calldata signature) external nonReentrant {
        Transfer storage t = _funded(transferId);
        if (block.timestamp >= t.expiresAt) revert TransferExpired();
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == address(this)) revert SelfTransfer();

        (address signer, ECDSA.RecoverError err,) = ECDSA.tryRecover(_claimDigest(transferId, recipient), signature);
        if (err != ECDSA.RecoverError.NoError || signer != t.claimSigner) revert InvalidClaimSignature();

        uint256 amount = t.amount;
        t.status = Status.Claimed;
        t.recipient = recipient;
        t.settledAt = uint64(block.timestamp);
        totalEscrowed -= amount;

        _token.safeTransfer(recipient, amount);
        emit TransferClaimed(transferId, recipient, amount, msg.sender);
    }

    /// @inheritdoc IRemittanceManager
    function cancelTransfer(uint256 transferId) external nonReentrant {
        Transfer storage t = _funded(transferId);
        if (msg.sender != t.sender) revert NotSender();

        uint256 amount = t.amount;
        t.status = Status.Cancelled;
        t.settledAt = uint64(block.timestamp);
        totalEscrowed -= amount;

        _token.safeTransfer(t.sender, amount);
        emit TransferCancelled(transferId, t.sender, amount);
    }

    /// @inheritdoc IRemittanceManager
    function refundExpiredTransfer(uint256 transferId) external nonReentrant {
        Transfer storage t = _funded(transferId);
        if (block.timestamp < t.expiresAt) revert NotExpired();

        uint256 amount = t.amount;
        address sender = t.sender;
        t.status = Status.Refunded;
        t.settledAt = uint64(block.timestamp);
        totalEscrowed -= amount;

        _token.safeTransfer(sender, amount);
        emit TransferRefunded(transferId, sender, amount, msg.sender);
    }

    // ================================================================== views

    /// @inheritdoc IRemittanceManager
    function token() external view returns (address) {
        return address(_token);
    }

    /// @inheritdoc IRemittanceManager
    /// @dev Unknown ids return the zero struct (kind None, status None) instead of reverting.
    function getTransfer(uint256 transferId) external view returns (Transfer memory) {
        return _transfers[transferId];
    }

    /// @inheritdoc IRemittanceManager
    function getTransferStatus(uint256 transferId) external view returns (Status) {
        return _transfers[transferId].status;
    }

    /// @inheritdoc IRemittanceManager
    function isClaimable(uint256 transferId) external view returns (bool) {
        Transfer storage t = _transfers[transferId];
        return t.kind == Kind.Claimable && t.status == Status.Funded && block.timestamp < t.expiresAt;
    }

    /// @inheritdoc IRemittanceManager
    function claimDigest(uint256 transferId, address recipient) external view returns (bytes32) {
        return _claimDigest(transferId, recipient);
    }

    /// @notice The EIP-712 domain separator ("MezoRemit", "1", block.chainid, address(this)).
    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ================================================================== internals

    function _sendDirect(address recipient, uint256 amount, bytes32 ref) private returns (uint256 transferId) {
        if (recipient == address(0)) revert ZeroAddress();
        if (recipient == msg.sender || recipient == address(this)) revert SelfTransfer();
        _checkAmount(amount);
        transferId = _register(ref);

        _transfers[transferId] = Transfer({
            sender: msg.sender,
            kind: Kind.Direct,
            status: Status.Completed,
            createdAt: uint64(block.timestamp),
            expiresAt: 0,
            settledAt: uint64(block.timestamp),
            recipient: recipient,
            claimSigner: address(0),
            amount: amount,
            ref: ref
        });

        uint256 before = _token.balanceOf(recipient);
        _token.safeTransferFrom(msg.sender, recipient, amount);
        if (_token.balanceOf(recipient) - before != amount) revert UnexpectedBalanceChange();

        emit DirectTransferSent(transferId, msg.sender, recipient, amount, ref);
    }

    function _createClaimable(address claimSigner, uint256 amount, uint64 expiresAt, bytes32 ref)
        private
        returns (uint256 transferId)
    {
        if (claimSigner == address(0)) revert ZeroAddress();
        _checkAmount(amount);
        if (expiresAt <= block.timestamp) revert InvalidExpiry();
        uint256 window = expiresAt - block.timestamp;
        if (window < MIN_EXPIRY || window > MAX_EXPIRY) revert InvalidExpiry();
        transferId = _register(ref);

        _transfers[transferId] = Transfer({
            sender: msg.sender,
            kind: Kind.Claimable,
            status: Status.Funded,
            createdAt: uint64(block.timestamp),
            expiresAt: expiresAt,
            settledAt: 0,
            recipient: address(0),
            claimSigner: claimSigner,
            amount: amount,
            ref: ref
        });
        totalEscrowed += amount;

        uint256 before = _token.balanceOf(address(this));
        _token.safeTransferFrom(msg.sender, address(this), amount);
        if (_token.balanceOf(address(this)) - before != amount) revert UnexpectedBalanceChange();

        emit ClaimableCreated(transferId, msg.sender, claimSigner, amount, expiresAt, ref);
    }

    /// @dev Allocates the next id and binds (msg.sender, ref) to it. Zero refs are reserved; reuse by the same
    ///      sender reverts. Another sender's use of the same ref is a separate entry and cannot block this one.
    function _register(bytes32 ref) private returns (uint256 transferId) {
        if (ref == bytes32(0) || transferIdByRef[msg.sender][ref] != 0) revert DuplicateRef();
        transferId = nextTransferId++;
        transferIdByRef[msg.sender][ref] = transferId;
    }

    function _checkAmount(uint256 amount) private pure {
        if (amount == 0) revert ZeroAmount();
        if (amount > MAX_AMOUNT) revert AmountTooLarge();
    }

    /// @dev Loads a transfer that must exist and be a Funded claimable.
    function _funded(uint256 transferId) private view returns (Transfer storage t) {
        t = _transfers[transferId];
        if (t.kind == Kind.None) revert TransferNotFound();
        if (t.kind != Kind.Claimable || t.status != Status.Funded) revert NotClaimable();
    }

    function _claimDigest(uint256 transferId, address recipient) private view returns (bytes32) {
        return _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, transferId, recipient)));
    }

    function _tryPermit(uint256 amount, uint256 deadline, uint8 v, bytes32 r, bytes32 s) private {
        try IERC20Permit(address(_token)).permit(msg.sender, address(this), amount, deadline, v, r, s) {} catch {}
    }
}
