// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {RemittanceManager} from "../src/RemittanceManager.sol";
import {IRemittanceManager as IRM} from "../src/interfaces/IRemittanceManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";

contract ConstructorAndViewsTest is BaseTest {
    function test_constructor_setsImmutables() public view {
        assertEq(mgr.token(), address(musd));
        assertEq(mgr.MIN_EXPIRY(), MIN);
        assertEq(mgr.MAX_EXPIRY(), 90 days);
        assertEq(mgr.MAX_AMOUNT(), 10_000_000e18);
        assertEq(mgr.nextTransferId(), 1);
        assertEq(mgr.totalEscrowed(), 0);
        assertEq(mgr.CLAIM_TYPEHASH(), keccak256("Claim(uint256 transferId,address recipient)"));
    }

    function test_constructor_revertsZeroToken() public {
        vm.expectRevert(IRM.ZeroAddress.selector);
        new RemittanceManager(IERC20(address(0)), MIN);
    }

    function test_constructor_revertsZeroMinExpiry() public {
        vm.expectRevert(IRM.InvalidExpiry.selector);
        new RemittanceManager(IERC20(address(musd)), 0);
    }

    function test_constructor_revertsMinAboveMax() public {
        vm.expectRevert(IRM.InvalidExpiry.selector);
        new RemittanceManager(IERC20(address(musd)), 90 days + 1);
    }

    function test_constructor_minEqualsMaxAllowed() public {
        RemittanceManager m = new RemittanceManager(IERC20(address(musd)), 90 days);
        assertEq(m.MIN_EXPIRY(), 90 days);
    }

    function test_views_unknownIdReturnsEmpty() public view {
        IRM.Transfer memory t = mgr.getTransfer(42);
        assertEq(t.sender, address(0));
        assertEq(uint8(t.kind), uint8(IRM.Kind.None));
        assertEq(uint8(t.status), uint8(IRM.Status.None));
        assertEq(t.amount, 0);
        assertEq(uint8(mgr.getTransferStatus(42)), uint8(IRM.Status.None));
        assertFalse(mgr.isClaimable(42));
        assertEq(mgr.transferIdByRef(alice, bytes32(uint256(123))), 0);
        assertEq(mgr.transferIdByRef(alice, bytes32(0)), 0);
    }

    function test_views_domainSeparator() public view {
        bytes32 expected = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MezoRemit"),
                keccak256("1"),
                block.chainid,
                address(mgr)
            )
        );
        assertEq(mgr.DOMAIN_SEPARATOR(), expected);
        (, string memory name, string memory version, uint256 chainId, address vc,,) = mgr.eip712Domain();
        assertEq(name, "MezoRemit");
        assertEq(version, "1");
        assertEq(chainId, block.chainid);
        assertEq(vc, address(mgr));
    }
}

contract SendDirectTest is BaseTest {
    function test_sendDirect_happy() public {
        bytes32 ref = _ref(1);
        vm.expectEmit(true, true, true, true, address(mgr));
        emit IRM.DirectTransferSent(1, alice, bob, 100e18, ref);
        vm.prank(alice);
        uint256 id = mgr.sendDirect(bob, 100e18, ref);

        assertEq(id, 1);
        assertEq(mgr.nextTransferId(), 2);
        assertEq(musd.balanceOf(bob), 100e18);
        assertEq(musd.balanceOf(address(mgr)), 0, "no custody");
        assertEq(mgr.totalEscrowed(), 0);
        assertEq(mgr.transferIdByRef(alice, ref), 1);

        IRM.Transfer memory t = mgr.getTransfer(id);
        assertEq(t.sender, alice);
        assertEq(uint8(t.kind), uint8(IRM.Kind.Direct));
        assertEq(uint8(t.status), uint8(IRM.Status.Completed));
        assertEq(t.createdAt, START);
        assertEq(t.settledAt, START);
        assertEq(t.expiresAt, 0);
        assertEq(t.recipient, bob);
        assertEq(t.claimSigner, address(0));
        assertEq(t.amount, 100e18);
        assertEq(t.ref, ref);
        assertFalse(mgr.isClaimable(id));
    }

    function test_sendDirect_maxAmountExactlyOk() public {
        musd.mint(alice, 10_000_000e18);
        vm.prank(alice);
        mgr.sendDirect(bob, 10_000_000e18, _ref(1));
        assertEq(musd.balanceOf(bob), 10_000_000e18);
    }

    function test_sendDirect_revertsZeroRecipient() public {
        vm.prank(alice);
        vm.expectRevert(IRM.ZeroAddress.selector);
        mgr.sendDirect(address(0), 1e18, _ref(1));
    }

    function test_sendDirect_revertsSelf() public {
        vm.prank(alice);
        vm.expectRevert(IRM.SelfTransfer.selector);
        mgr.sendDirect(alice, 1e18, _ref(1));
    }

    function test_sendDirect_revertsToManager() public {
        vm.prank(alice);
        vm.expectRevert(IRM.SelfTransfer.selector);
        mgr.sendDirect(address(mgr), 1e18, _ref(1));
    }

    function test_sendDirect_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IRM.ZeroAmount.selector);
        mgr.sendDirect(bob, 0, _ref(1));
    }

    function test_sendDirect_revertsTooLarge() public {
        vm.prank(alice);
        vm.expectRevert(IRM.AmountTooLarge.selector);
        mgr.sendDirect(bob, 10_000_000e18 + 1, _ref(1));
    }

    function test_sendDirect_revertsZeroRef() public {
        vm.prank(alice);
        vm.expectRevert(IRM.DuplicateRef.selector);
        mgr.sendDirect(bob, 1e18, bytes32(0));
    }

    function test_sendDirect_revertsDuplicateRef() public {
        vm.startPrank(alice);
        mgr.sendDirect(bob, 1e18, _ref(1));
        vm.expectRevert(IRM.DuplicateRef.selector);
        mgr.sendDirect(carol, 1e18, _ref(1));
        vm.stopPrank();
    }

    function test_refUniqueAcrossKinds() public {
        vm.startPrank(alice);
        mgr.sendDirect(bob, 1e18, _ref(7));
        vm.expectRevert(IRM.DuplicateRef.selector);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 1 days), _ref(7));
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 1 days), _ref(8));
        vm.expectRevert(IRM.DuplicateRef.selector);
        mgr.sendDirect(bob, 1e18, _ref(8));
        vm.stopPrank();
    }

    /// Audit fix: another caller who copies a pending ref (e.g. from the mempool) and uses it first with 1 wei
    /// must not block the real sender. Refs are scoped per sender.
    function test_refSquatByOtherSenderDoesNotBlock() public {
        bytes32 ref = _ref(9);
        musd.mint(carol, 2);
        vm.prank(carol);
        musd.approve(address(mgr), type(uint256).max);
        vm.prank(carol); // attacker front-runs with the victim's ref
        uint256 squat = mgr.sendDirect(bob, 1, ref);
        vm.prank(carol);
        uint256 squat2 = mgr.createClaimable(claimSigner, 1, uint64(block.timestamp + 1 days), _ref(10));

        vm.startPrank(alice);
        uint256 real = mgr.sendDirect(bob, 100e18, ref);
        uint256 realClaim = mgr.createClaimable(claimSigner, 50e18, uint64(block.timestamp + 1 days), _ref(10));
        vm.stopPrank();

        assertEq(mgr.transferIdByRef(carol, ref), squat);
        assertEq(mgr.transferIdByRef(alice, ref), real);
        assertEq(mgr.transferIdByRef(carol, _ref(10)), squat2);
        assertEq(mgr.transferIdByRef(alice, _ref(10)), realClaim);
        assertEq(mgr.getTransfer(real).sender, alice);
        assertEq(mgr.getTransfer(real).amount, 100e18);
    }

    function test_sendDirect_revertsInsufficientAllowance() public {
        musd.mint(carol, 10e18);
        vm.prank(carol);
        musd.approve(address(mgr), 5e18);
        vm.prank(carol);
        vm.expectRevert(
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(mgr), 5e18, 10e18)
        );
        mgr.sendDirect(bob, 10e18, _ref(1));
        assertEq(mgr.nextTransferId(), 1, "nothing recorded");
        assertEq(mgr.transferIdByRef(carol, _ref(1)), 0);
    }

    function test_sendDirect_revertsInsufficientBalance() public {
        musd.mint(carol, 1e18);
        vm.prank(carol);
        musd.approve(address(mgr), type(uint256).max);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, carol, 1e18, 2e18));
        mgr.sendDirect(bob, 2e18, _ref(1));
    }

    function testFuzz_sendDirect(uint256 amount, address to) public {
        vm.assume(to != address(0) && to != alice && to != address(mgr));
        amount = bound(amount, 1, 1_000_000e18);
        uint256 before = musd.balanceOf(to);
        vm.prank(alice);
        uint256 id = mgr.sendDirect(to, amount, _ref(1));
        assertEq(musd.balanceOf(to) - before, amount);
        assertEq(mgr.getTransfer(id).amount, amount);
        assertEq(musd.balanceOf(address(mgr)), 0);
    }
}

contract CreateClaimableTest is BaseTest {
    function test_create_happy() public {
        uint64 exp = uint64(block.timestamp + 7 days);
        bytes32 ref = _ref(1);
        vm.expectEmit(true, true, true, true, address(mgr));
        emit IRM.ClaimableCreated(1, alice, claimSigner, 250e18, exp, ref);
        vm.prank(alice);
        uint256 id = mgr.createClaimable(claimSigner, 250e18, exp, ref);

        assertEq(id, 1);
        assertEq(musd.balanceOf(address(mgr)), 250e18);
        assertEq(mgr.totalEscrowed(), 250e18);
        assertEq(mgr.transferIdByRef(alice, ref), 1);
        assertTrue(mgr.isClaimable(id));

        IRM.Transfer memory t = mgr.getTransfer(id);
        assertEq(t.sender, alice);
        assertEq(uint8(t.kind), uint8(IRM.Kind.Claimable));
        assertEq(uint8(t.status), uint8(IRM.Status.Funded));
        assertEq(t.createdAt, START);
        assertEq(t.expiresAt, exp);
        assertEq(t.settledAt, 0);
        assertEq(t.recipient, address(0));
        assertEq(t.claimSigner, claimSigner);
        assertEq(t.amount, 250e18);
        assertEq(t.ref, ref);
    }

    function test_create_idsIncrementSharedWithDirect() public {
        vm.startPrank(alice);
        assertEq(mgr.sendDirect(bob, 1e18, _ref(1)), 1);
        assertEq(mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 1 days), _ref(2)), 2);
        assertEq(mgr.sendDirect(bob, 1e18, _ref(3)), 3);
        vm.stopPrank();
        assertEq(mgr.nextTransferId(), 4);
    }

    function test_create_revertsZeroSigner() public {
        vm.prank(alice);
        vm.expectRevert(IRM.ZeroAddress.selector);
        mgr.createClaimable(address(0), 1e18, uint64(block.timestamp + 1 days), _ref(1));
    }

    function test_create_revertsZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IRM.ZeroAmount.selector);
        mgr.createClaimable(claimSigner, 0, uint64(block.timestamp + 1 days), _ref(1));
    }

    function test_create_revertsTooLarge() public {
        vm.prank(alice);
        vm.expectRevert(IRM.AmountTooLarge.selector);
        mgr.createClaimable(claimSigner, 10_000_000e18 + 1, uint64(block.timestamp + 1 days), _ref(1));
    }

    function test_create_revertsZeroRef() public {
        vm.prank(alice);
        vm.expectRevert(IRM.DuplicateRef.selector);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 1 days), bytes32(0));
    }

    function test_create_revertsDuplicateRef() public {
        vm.startPrank(alice);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 1 days), _ref(1));
        vm.expectRevert(IRM.DuplicateRef.selector);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 1 days), _ref(1));
        vm.stopPrank();
    }

    function test_create_expiryExactlyMinOk() public {
        vm.prank(alice);
        uint256 id = mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + MIN), _ref(1));
        assertEq(mgr.getTransfer(id).expiresAt, block.timestamp + MIN);
    }

    function test_create_expiryExactlyMaxOk() public {
        vm.prank(alice);
        uint256 id = mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 90 days), _ref(1));
        assertEq(mgr.getTransfer(id).expiresAt, block.timestamp + 90 days);
    }

    function test_create_revertsExpiryBelowMin() public {
        vm.prank(alice);
        vm.expectRevert(IRM.InvalidExpiry.selector);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + MIN - 1), _ref(1));
    }

    function test_create_revertsExpiryAboveMax() public {
        vm.prank(alice);
        vm.expectRevert(IRM.InvalidExpiry.selector);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 90 days + 1), _ref(1));
    }

    function test_create_revertsExpiryNow() public {
        vm.prank(alice);
        vm.expectRevert(IRM.InvalidExpiry.selector);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp), _ref(1));
    }

    function test_create_revertsExpiryPast() public {
        vm.prank(alice);
        vm.expectRevert(IRM.InvalidExpiry.selector);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp - 1), _ref(1));
    }

    function test_create_revertsInsufficientAllowance() public {
        musd.mint(carol, 10e18);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(mgr), 0, 10e18));
        mgr.createClaimable(claimSigner, 10e18, uint64(block.timestamp + 1 days), _ref(1));
        assertEq(mgr.totalEscrowed(), 0);
    }

    function test_create_revertsInsufficientBalance() public {
        vm.prank(carol);
        musd.approve(address(mgr), type(uint256).max);
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, carol, 0, 1e18));
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp + 1 days), _ref(1));
    }

    function testFuzz_create(uint256 amount, uint64 window) public {
        amount = bound(amount, 1, 1_000_000e18);
        window = uint64(bound(window, MIN, 90 days));
        vm.prank(alice);
        uint256 id = mgr.createClaimable(claimSigner, amount, uint64(block.timestamp) + window, _ref(1));
        assertEq(mgr.totalEscrowed(), amount);
        assertEq(musd.balanceOf(address(mgr)), amount);
        assertTrue(mgr.isClaimable(id));
    }

    function testFuzz_create_invalidWindowReverts(uint64 window) public {
        vm.assume(window < MIN || window > 90 days);
        window = uint64(bound(window, 0, type(uint64).max - block.timestamp));
        vm.assume(window < MIN || window > 90 days);
        vm.prank(alice);
        vm.expectRevert(IRM.InvalidExpiry.selector);
        mgr.createClaimable(claimSigner, 1e18, uint64(block.timestamp) + window, _ref(1));
    }

    function testFuzz_create_amountTooLargeReverts(uint256 amount) public {
        amount = bound(amount, 10_000_000e18 + 1, type(uint256).max);
        vm.prank(alice);
        vm.expectRevert(IRM.AmountTooLarge.selector);
        mgr.createClaimable(claimSigner, amount, uint64(block.timestamp + 1 days), _ref(1));
    }
}

contract ClaimTest is BaseTest {
    uint256 internal id;
    uint64 internal exp;

    function setUp() public override {
        super.setUp();
        id = _create(100e18);
        exp = mgr.getTransfer(id).expiresAt;
    }

    function test_claim_byRecipient() public {
        bytes memory sig = _sigFor(id, bob);
        vm.expectEmit(true, true, true, true, address(mgr));
        emit IRM.TransferClaimed(id, bob, 100e18, bob);
        vm.prank(bob);
        mgr.claimTransfer(id, bob, sig);
        _assertClaimed(bob);
    }

    function test_claim_byRelayer() public {
        bytes memory sig = _sigFor(id, bob);
        vm.expectEmit(true, true, true, true, address(mgr));
        emit IRM.TransferClaimed(id, bob, 100e18, relayer);
        vm.prank(relayer);
        mgr.claimTransfer(id, bob, sig);
        _assertClaimed(bob);
        assertEq(musd.balanceOf(relayer), 0);
    }

    function test_claim_lastSecondBeforeExpiry() public {
        vm.warp(exp - 1);
        assertTrue(mgr.isClaimable(id));
        mgr.claimTransfer(id, bob, _sigFor(id, bob));
        _assertClaimed(bob);
    }

    function test_claim_revertsAtExactExpiry() public {
        vm.warp(exp);
        assertFalse(mgr.isClaimable(id));
        bytes memory sig = _sigFor(id, bob);
        vm.expectRevert(IRM.TransferExpired.selector);
        mgr.claimTransfer(id, bob, sig);
    }

    function test_claim_revertsAfterExpiry() public {
        vm.warp(exp + 30 days);
        bytes memory sig = _sigFor(id, bob);
        vm.expectRevert(IRM.TransferExpired.selector);
        mgr.claimTransfer(id, bob, sig);
    }

    function test_claim_revertsUnknownId() public {
        bytes memory sig = _sigFor(99, bob);
        vm.expectRevert(IRM.TransferNotFound.selector);
        mgr.claimTransfer(99, bob, sig);
        vm.expectRevert(IRM.TransferNotFound.selector);
        mgr.claimTransfer(0, bob, sig);
    }

    function test_claim_revertsOnDirect() public {
        vm.prank(alice);
        uint256 d = mgr.sendDirect(bob, 1e18, _ref(100));
        bytes memory sig = _sigFor(d, bob);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.claimTransfer(d, bob, sig);
    }

    function test_claim_revertsZeroRecipient() public {
        bytes memory sig = _sigFor(id, address(0));
        vm.expectRevert(IRM.ZeroAddress.selector);
        mgr.claimTransfer(id, address(0), sig);
    }

    function test_claim_revertsManagerAsRecipient() public {
        bytes memory sig = _sigFor(id, address(mgr));
        vm.expectRevert(IRM.SelfTransfer.selector);
        mgr.claimTransfer(id, address(mgr), sig);
    }

    function test_claim_revertsWrongSigner() public {
        bytes memory sig = _sign(0xBAD, mgr.claimDigest(id, bob));
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, sig);
    }

    function test_claim_duplicateReverts() public {
        bytes memory sig = _sigFor(id, bob);
        mgr.claimTransfer(id, bob, sig);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.claimTransfer(id, bob, sig);
        assertEq(musd.balanceOf(bob), 100e18);
    }

    function test_claim_afterCancelReverts() public {
        bytes memory sig = _sigFor(id, bob);
        vm.prank(alice);
        mgr.cancelTransfer(id);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.claimTransfer(id, bob, sig);
    }

    function test_claim_afterRefundReverts() public {
        bytes memory sig = _sigFor(id, bob);
        vm.warp(exp);
        mgr.refundExpiredTransfer(id);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.claimTransfer(id, bob, sig);
    }

    function testFuzz_claim_anyRecipient(address to, address submitter) public {
        vm.assume(to != address(0) && to != address(mgr));
        uint256 before = musd.balanceOf(to);
        bytes memory sig = _sigFor(id, to);
        vm.prank(submitter);
        mgr.claimTransfer(id, to, sig);
        assertEq(musd.balanceOf(to) - before, 100e18);
        assertEq(mgr.totalEscrowed(), 0);
    }

    function testFuzz_claim_wrongKeyAlwaysFails(uint256 pk) public {
        pk = bound(pk, 1, 115792089237316195423570985008687907852837564279074904382605163141518161494336);
        vm.assume(pk != claimPk);
        bytes memory sig = _sign(pk, mgr.claimDigest(id, bob));
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, sig);
    }

    function _assertClaimed(address to) internal view {
        IRM.Transfer memory t = mgr.getTransfer(id);
        assertEq(uint8(t.status), uint8(IRM.Status.Claimed));
        assertEq(t.recipient, to);
        assertEq(t.settledAt, block.timestamp);
        assertEq(musd.balanceOf(to), 100e18);
        assertEq(musd.balanceOf(address(mgr)), 0);
        assertEq(mgr.totalEscrowed(), 0);
        assertFalse(mgr.isClaimable(id));
    }
}

contract CancelTest is BaseTest {
    uint256 internal id;
    uint64 internal exp;

    function setUp() public override {
        super.setUp();
        id = _create(100e18);
        exp = mgr.getTransfer(id).expiresAt;
    }

    function test_cancel_beforeExpiry() public {
        uint256 before = musd.balanceOf(alice);
        vm.warp(block.timestamp + 10);
        vm.expectEmit(true, true, true, true, address(mgr));
        emit IRM.TransferCancelled(id, alice, 100e18);
        vm.prank(alice);
        mgr.cancelTransfer(id);
        _assertCancelled(before);
    }

    function test_cancel_afterExpiry() public {
        uint256 before = musd.balanceOf(alice);
        vm.warp(exp + 1 days);
        vm.prank(alice);
        mgr.cancelTransfer(id);
        _assertCancelled(before);
    }

    function test_cancel_revertsNonSender() public {
        vm.prank(bob);
        vm.expectRevert(IRM.NotSender.selector);
        mgr.cancelTransfer(id);
        vm.prank(claimSigner);
        vm.expectRevert(IRM.NotSender.selector);
        mgr.cancelTransfer(id);
    }

    function test_cancel_revertsUnknown() public {
        vm.prank(alice);
        vm.expectRevert(IRM.TransferNotFound.selector);
        mgr.cancelTransfer(77);
    }

    function test_cancel_revertsDirect() public {
        vm.prank(alice);
        uint256 d = mgr.sendDirect(bob, 1e18, _ref(100));
        vm.prank(alice);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.cancelTransfer(d);
    }

    function test_cancel_revertsAfterClaim() public {
        mgr.claimTransfer(id, bob, _sigFor(id, bob));
        vm.prank(alice);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.cancelTransfer(id);
    }

    function test_cancel_twiceReverts() public {
        vm.startPrank(alice);
        mgr.cancelTransfer(id);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.cancelTransfer(id);
        vm.stopPrank();
    }

    function test_cancel_afterRefundReverts() public {
        vm.warp(exp);
        mgr.refundExpiredTransfer(id);
        vm.prank(alice);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.cancelTransfer(id);
    }

    function _assertCancelled(uint256 before) internal view {
        IRM.Transfer memory t = mgr.getTransfer(id);
        assertEq(uint8(t.status), uint8(IRM.Status.Cancelled));
        assertEq(t.settledAt, block.timestamp);
        assertEq(t.recipient, address(0));
        assertEq(musd.balanceOf(alice) - before, 100e18);
        assertEq(mgr.totalEscrowed(), 0);
        assertEq(musd.balanceOf(address(mgr)), 0);
        assertFalse(mgr.isClaimable(id));
    }
}

contract RefundTest is BaseTest {
    uint256 internal id;
    uint64 internal exp;

    function setUp() public override {
        super.setUp();
        id = _create(100e18);
        exp = mgr.getTransfer(id).expiresAt;
    }

    function test_refund_atExactExpiryByAnyone() public {
        uint256 before = musd.balanceOf(alice);
        vm.warp(exp);
        vm.expectEmit(true, true, true, true, address(mgr));
        emit IRM.TransferRefunded(id, alice, 100e18, carol);
        vm.prank(carol);
        mgr.refundExpiredTransfer(id);

        IRM.Transfer memory t = mgr.getTransfer(id);
        assertEq(uint8(t.status), uint8(IRM.Status.Refunded));
        assertEq(t.settledAt, exp);
        assertEq(musd.balanceOf(alice) - before, 100e18, "funds always to sender");
        assertEq(musd.balanceOf(carol), 0);
        assertEq(mgr.totalEscrowed(), 0);
    }

    function test_refund_revertsBeforeExpiry() public {
        vm.warp(exp - 1);
        vm.expectRevert(IRM.NotExpired.selector);
        mgr.refundExpiredTransfer(id);
        vm.prank(alice);
        vm.expectRevert(IRM.NotExpired.selector);
        mgr.refundExpiredTransfer(id);
    }

    function test_refund_revertsAfterClaim() public {
        mgr.claimTransfer(id, bob, _sigFor(id, bob));
        vm.warp(exp);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.refundExpiredTransfer(id);
    }

    function test_refund_revertsAfterCancel() public {
        vm.prank(alice);
        mgr.cancelTransfer(id);
        vm.warp(exp);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.refundExpiredTransfer(id);
    }

    function test_refund_twiceReverts() public {
        vm.warp(exp);
        mgr.refundExpiredTransfer(id);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.refundExpiredTransfer(id);
    }

    function test_refund_revertsUnknown() public {
        vm.expectRevert(IRM.TransferNotFound.selector);
        mgr.refundExpiredTransfer(5);
    }

    function test_refund_revertsDirect() public {
        vm.prank(alice);
        uint256 d = mgr.sendDirect(bob, 1e18, _ref(100));
        vm.warp(exp);
        vm.expectRevert(IRM.NotClaimable.selector);
        mgr.refundExpiredTransfer(d);
    }

    function testFuzz_refund_timing(uint256 dt) public {
        dt = bound(dt, 0, 365 days);
        vm.warp(START + dt);
        if (block.timestamp < exp) {
            vm.expectRevert(IRM.NotExpired.selector);
            mgr.refundExpiredTransfer(id);
        } else {
            mgr.refundExpiredTransfer(id);
            assertEq(uint8(mgr.getTransferStatus(id)), uint8(IRM.Status.Refunded));
        }
    }
}

contract MultiTransferTest is BaseTest {
    function test_escrowIsPerTransfer() public {
        uint256 a = _create(10e18);
        uint256 b = _create(20e18);
        uint256 c = _create(30e18);
        assertEq(mgr.totalEscrowed(), 60e18);

        mgr.claimTransfer(b, bob, _sigFor(b, bob));
        assertEq(musd.balanceOf(bob), 20e18);
        assertEq(mgr.totalEscrowed(), 40e18);

        vm.prank(alice);
        mgr.cancelTransfer(a);
        assertEq(mgr.totalEscrowed(), 30e18);

        vm.warp(mgr.getTransfer(c).expiresAt);
        mgr.refundExpiredTransfer(c);
        assertEq(mgr.totalEscrowed(), 0);
        assertEq(musd.balanceOf(address(mgr)), 0);
    }
}
