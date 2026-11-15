// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {RemittanceManager} from "../src/RemittanceManager.sol";
import {IRemittanceManager as IRM} from "../src/interfaces/IRemittanceManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {MockNoPermit} from "./mocks/MockMUSD.sol";
import {FeeOnTransferToken} from "./mocks/FeeOnTransferToken.sol";
import {HookToken} from "./mocks/HookToken.sol";
import {ReentrantAttacker} from "./mocks/ReentrantAttacker.sol";

contract PermitTest is BaseTest {
    bytes32 internal constant PERMIT_TYPEHASH =
        keccak256("Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)");

    uint256 internal davePk = 0xDA7E;
    address internal dave;

    function setUp() public override {
        super.setUp();
        dave = vm.addr(davePk);
        musd.mint(dave, 1_000e18);
    }

    function _permit(uint256 value, uint256 deadline) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash =
            keccak256(abi.encode(PERMIT_TYPEHASH, dave, address(mgr), value, musd.nonces(dave), deadline));
        (v, r, s) = vm.sign(davePk, keccak256(abi.encodePacked("\x19\x01", musd.DOMAIN_SEPARATOR(), structHash)));
    }

    function test_sendDirectWithPermit_happy() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(100e18, deadline);
        vm.expectEmit(true, true, true, true, address(mgr));
        emit IRM.DirectTransferSent(1, dave, bob, 100e18, _ref(1));
        vm.prank(dave);
        mgr.sendDirectWithPermit(bob, 100e18, _ref(1), deadline, v, r, s);
        assertEq(musd.balanceOf(bob), 100e18);
        assertEq(musd.allowance(dave, address(mgr)), 0);
    }

    function test_createClaimableWithPermit_happy() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(100e18, deadline);
        vm.prank(dave);
        uint256 id =
            mgr.createClaimableWithPermit(claimSigner, 100e18, uint64(block.timestamp + 1 days), _ref(1), deadline, v, r, s);
        assertEq(mgr.totalEscrowed(), 100e18);
        assertEq(mgr.getTransfer(id).sender, dave);
        mgr.claimTransfer(id, bob, _sigFor(id, bob));
        assertEq(musd.balanceOf(bob), 100e18);
    }

    function test_permitFrontRun_stillSucceeds() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(100e18, deadline);
        // griefer submits the permit from the mempool first: nonce consumed, allowance set
        vm.prank(carol);
        musd.permit(dave, address(mgr), 100e18, deadline, v, r, s);
        vm.prank(dave);
        mgr.createClaimableWithPermit(claimSigner, 100e18, uint64(block.timestamp + 1 days), _ref(1), deadline, v, r, s);
        assertEq(mgr.totalEscrowed(), 100e18);
    }

    function test_permitFrontRun_direct_stillSucceeds() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(100e18, deadline);
        musd.permit(dave, address(mgr), 100e18, deadline, v, r, s);
        vm.prank(dave);
        mgr.sendDirectWithPermit(bob, 100e18, _ref(1), deadline, v, r, s);
        assertEq(musd.balanceOf(bob), 100e18);
    }

    function test_badPermitWithoutAllowance_reverts() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(100e18, deadline);
        vm.prank(dave);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(mgr), 0, 200e18));
        mgr.sendDirectWithPermit(bob, 200e18, _ref(1), deadline, v, r, s); // permit was for 100, so it fails
    }

    function test_expiredPermitWithPriorApproval_succeeds() public {
        uint256 deadline = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _permit(100e18, deadline);
        vm.warp(deadline + 1);
        vm.prank(dave);
        musd.approve(address(mgr), 100e18);
        vm.prank(dave);
        mgr.sendDirectWithPermit(bob, 100e18, _ref(1), deadline, v, r, s);
        assertEq(musd.balanceOf(bob), 100e18);
    }

    function test_nonPermitToken_withApproval_succeeds() public {
        MockNoPermit np = new MockNoPermit();
        RemittanceManager m = new RemittanceManager(IERC20(address(np)), MIN);
        np.mint(alice, 10e18);
        vm.startPrank(alice);
        np.approve(address(m), 10e18);
        m.createClaimableWithPermit(claimSigner, 10e18, uint64(block.timestamp + 1 days), _ref(1), 0, 0, 0, 0);
        vm.stopPrank();
        assertEq(m.totalEscrowed(), 10e18);
    }
}

contract FeeOnTransferTest is BaseTest {
    FeeOnTransferToken internal fee;
    RemittanceManager internal m;

    function setUp() public override {
        super.setUp();
        fee = new FeeOnTransferToken();
        m = new RemittanceManager(IERC20(address(fee)), MIN);
        fee.mint(alice, 1_000e18);
        vm.prank(alice);
        fee.approve(address(m), type(uint256).max);
    }

    function test_feeToken_createReverts() public {
        vm.prank(alice);
        vm.expectRevert(IRM.UnexpectedBalanceChange.selector);
        m.createClaimable(claimSigner, 100e18, uint64(block.timestamp + 1 days), _ref(1));
    }

    function test_feeToken_directReverts() public {
        vm.prank(alice);
        vm.expectRevert(IRM.UnexpectedBalanceChange.selector);
        m.sendDirect(bob, 100e18, _ref(1));
    }
}

contract ReentrancyTest is BaseTest {
    HookToken internal hook;
    RemittanceManager internal m;
    ReentrantAttacker internal atk;
    uint256 internal atkClaimPk = 0xA77AC;

    function setUp() public override {
        super.setUp();
        hook = new HookToken();
        m = new RemittanceManager(IERC20(address(hook)), MIN);
        atk = new ReentrantAttacker();
        hook.setHooked(address(atk), true);
        hook.mint(address(atk), 1_000e18);
        atk.approve(IERC20(address(hook)), address(m), type(uint256).max);
    }

    function _atkCreate(uint256 amount, bytes32 ref) internal returns (uint256 id) {
        bytes memory ret = atk.exec(
            address(m),
            abi.encodeCall(m.createClaimable, (vm.addr(atkClaimPk), amount, uint64(block.timestamp + 1 days), ref))
        );
        id = abi.decode(ret, (uint256));
    }

    function test_reenterCancelDuringCancel_bubbles() public {
        uint256 id = _atkCreate(100e18, _ref(1));
        atk.arm(address(m), abi.encodeCall(m.cancelTransfer, (id)), false, false);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        atk.exec(address(m), abi.encodeCall(m.cancelTransfer, (id)));
        assertEq(m.totalEscrowed(), 100e18);
    }

    function test_reenterCancelDuringCancel_swallowedPaysOnce() public {
        uint256 id = _atkCreate(100e18, _ref(1));
        uint256 id2 = _atkCreate(50e18, _ref(2));
        atk.arm(address(m), abi.encodeCall(m.cancelTransfer, (id2)), false, true);
        uint256 before = hook.balanceOf(address(atk));
        atk.exec(address(m), abi.encodeCall(m.cancelTransfer, (id)));
        assertEq(atk.reentries(), 1);
        assertEq(bytes4(atk.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(hook.balanceOf(address(atk)) - before, 100e18);
        assertEq(m.totalEscrowed(), 50e18);
        assertEq(hook.balanceOf(address(m)), 50e18);
        assertEq(uint8(m.getTransferStatus(id2)), uint8(IRM.Status.Funded));
    }

    function test_reenterClaimDuringClaim_blocked() public {
        uint256 id = _atkCreate(100e18, _ref(1));
        bytes memory sig = _sign(atkClaimPk, m.claimDigest(id, address(atk)));
        // attacker is the claim recipient and re-submits the same claim from tokensReceived
        atk.arm(address(m), abi.encodeCall(m.claimTransfer, (id, address(atk), sig)), false, true);
        m.claimTransfer(id, address(atk), sig);
        assertEq(bytes4(atk.lastRevert()), ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        assertEq(m.totalEscrowed(), 0);
        assertEq(hook.balanceOf(address(atk)), 1_000e18);
    }

    function test_reenterRefundDuringCreate_blocked() public {
        uint256 id = _atkCreate(100e18, _ref(1));
        vm.warp(block.timestamp + 1 days);
        // tokensToSend fires while the manager pulls funds for a new transfer
        atk.arm(address(m), abi.encodeCall(m.refundExpiredTransfer, (id)), true, false);
        bytes memory data =
            abi.encodeCall(m.createClaimable, (vm.addr(atkClaimPk), 10e18, uint64(block.timestamp + 1 days), _ref(2)));
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        atk.exec(address(m), data);
    }

    function test_reenterDuringDirect_blocked() public {
        uint256 id = _atkCreate(100e18, _ref(1));
        atk.arm(address(m), abi.encodeCall(m.cancelTransfer, (id)), true, false);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        atk.exec(address(m), abi.encodeCall(m.sendDirect, (bob, 1e18, _ref(9))));
    }
}
