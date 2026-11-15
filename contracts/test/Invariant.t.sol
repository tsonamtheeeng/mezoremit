// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test, console2} from "forge-std/Test.sol";
import {RemittanceManager} from "../src/RemittanceManager.sol";
import {IRemittanceManager as IRM} from "../src/interfaces/IRemittanceManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";

/// @dev Drives random create/claim/cancel/refund/direct/warp sequences over several actors and keeps a ghost
///      model of every transfer so the invariant suite can compare chain state against it.
contract Handler is Test {
    RemittanceManager public mgr;
    MockMUSD public musd;
    address[] public actors;
    uint256[] public claimKeys;

    uint256 public ghostFundedSum;
    uint256 public ghostRefCounter;
    uint256[] public ids;
    mapping(uint256 => bool) public everSettled; // once true, must never be Funded again
    mapping(uint256 => uint256) public ghostPaidOut; // tokens released per claimable id
    uint256 public calls_create;
    uint256 public calls_claim;
    uint256 public calls_cancel;
    uint256 public calls_refund;
    uint256 public calls_direct;

    constructor(RemittanceManager mgr_, MockMUSD musd_) {
        mgr = mgr_;
        musd = musd_;
        for (uint256 i; i < 4; i++) {
            address a = makeAddr(string(abi.encodePacked("actor", i)));
            actors.push(a);
            claimKeys.push(0xC0FFEE + i);
            musd.mint(a, 1_000_000_000e18);
            vm.prank(a);
            musd.approve(address(mgr), type(uint256).max);
        }
    }

    function idsLength() external view returns (uint256) {
        return ids.length;
    }

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function create(uint256 actorSeed, uint256 keySeed, uint256 amount, uint256 window) external {
        amount = bound(amount, 1, mgr.MAX_AMOUNT());
        window = bound(window, mgr.MIN_EXPIRY(), mgr.MAX_EXPIRY());
        address a = _actor(actorSeed);
        address signer = vm.addr(claimKeys[keySeed % claimKeys.length]);
        vm.prank(a);
        // forge-lint: disable-next-line(unsafe-typecast)
        uint256 id = mgr.createClaimable(signer, amount, uint64(block.timestamp + window), bytes32(++ghostRefCounter));
        ids.push(id);
        ghostFundedSum += amount;
        calls_create++;
    }

    function direct(uint256 actorSeed, uint256 toSeed, uint256 amount) external {
        address a = _actor(actorSeed);
        address to = _actor(toSeed);
        if (a == to) to = _actor(toSeed + 1);
        if (musd.balanceOf(a) == 0) return;
        amount = bound(amount, 1, _min(mgr.MAX_AMOUNT(), musd.balanceOf(a)));
        vm.prank(a);
        uint256 id = mgr.sendDirect(to, amount, bytes32(++ghostRefCounter));
        ids.push(id);
        everSettled[id] = true;
        calls_direct++;
    }

    function claim(uint256 idSeed, uint256 toSeed, uint256 keySeed, bool useRightKey) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        IRM.Transfer memory t = mgr.getTransfer(id);
        address to = _actor(toSeed);
        uint256 pk = claimKeys[keySeed % claimKeys.length];
        if (useRightKey) {
            for (uint256 i; i < claimKeys.length; i++) {
                if (vm.addr(claimKeys[i]) == t.claimSigner) pk = claimKeys[i];
            }
        }
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, mgr.claimDigest(id, to));
        bool shouldWork = t.kind == IRM.Kind.Claimable && t.status == IRM.Status.Funded
            && block.timestamp < t.expiresAt && vm.addr(pk) == t.claimSigner;
        uint256 before = musd.balanceOf(to);
        try mgr.claimTransfer(id, to, abi.encodePacked(r, s, v)) {
            assertTrue(shouldWork, "claim succeeded when it should not");
            assertEq(musd.balanceOf(to) - before, t.amount);
            ghostFundedSum -= t.amount;
            ghostPaidOut[id] += t.amount;
            everSettled[id] = true;
            calls_claim++;
        } catch {
            assertFalse(shouldWork, "valid claim reverted");
        }
    }

    function cancel(uint256 idSeed, uint256 callerSeed, bool asSender) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        IRM.Transfer memory t = mgr.getTransfer(id);
        address caller = asSender ? t.sender : _actor(callerSeed);
        bool shouldWork = t.kind == IRM.Kind.Claimable && t.status == IRM.Status.Funded && caller == t.sender;
        uint256 before = musd.balanceOf(t.sender);
        vm.prank(caller);
        try mgr.cancelTransfer(id) {
            assertTrue(shouldWork, "cancel succeeded when it should not");
            assertEq(musd.balanceOf(t.sender) - before, t.amount);
            ghostFundedSum -= t.amount;
            ghostPaidOut[id] += t.amount;
            everSettled[id] = true;
            calls_cancel++;
        } catch {
            assertFalse(shouldWork, "valid cancel reverted");
        }
    }

    function refund(uint256 idSeed, uint256 callerSeed) external {
        if (ids.length == 0) return;
        uint256 id = ids[idSeed % ids.length];
        IRM.Transfer memory t = mgr.getTransfer(id);
        bool shouldWork =
            t.kind == IRM.Kind.Claimable && t.status == IRM.Status.Funded && block.timestamp >= t.expiresAt;
        uint256 before = musd.balanceOf(t.sender);
        vm.prank(_actor(callerSeed));
        try mgr.refundExpiredTransfer(id) {
            assertTrue(shouldWork, "refund succeeded when it should not");
            assertEq(musd.balanceOf(t.sender) - before, t.amount);
            ghostFundedSum -= t.amount;
            ghostPaidOut[id] += t.amount;
            everSettled[id] = true;
            calls_refund++;
        } catch {
            assertFalse(shouldWork, "valid refund reverted");
        }
    }

    function _min(uint256 a, uint256 b) internal pure returns (uint256) {
        return a < b ? a : b;
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 30 days));
    }
}

contract RemittanceInvariantTest is Test {
    RemittanceManager internal mgr;
    MockMUSD internal musd;
    Handler internal handler;

    function setUp() public {
        vm.warp(1_750_000_000);
        musd = new MockMUSD();
        mgr = new RemittanceManager(IERC20(address(musd)), 60);
        handler = new Handler(mgr, musd);
        targetContract(address(handler));
    }

    /// Coverage log: shows the handler actually reaches every settlement path.
    function afterInvariant() public view {
        console2.log("create", handler.calls_create(), "direct", handler.calls_direct());
        console2.log("claim", handler.calls_claim(), "cancel", handler.calls_cancel());
        console2.log("refund", handler.calls_refund());
    }

    /// I1/I2: escrow is fully backed and equals the sum of Funded claimables (no donations in this model).
    function invariant_balanceEqualsTotalEscrowedEqualsFundedSum() public view {
        uint256 sum;
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; i++) {
            IRM.Transfer memory t = mgr.getTransfer(handler.ids(i));
            if (t.status == IRM.Status.Funded) sum += t.amount;
        }
        assertEq(musd.balanceOf(address(mgr)), mgr.totalEscrowed(), "balance != totalEscrowed");
        assertEq(mgr.totalEscrowed(), sum, "totalEscrowed != sum(Funded)");
        assertEq(sum, handler.ghostFundedSum(), "ghost mismatch");
    }

    /// I3: terminal states are terminal; each claimable pays out at most its amount, exactly once.
    function invariant_settledNeverFundedAgain() public view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; i++) {
            uint256 id = handler.ids(i);
            IRM.Transfer memory t = mgr.getTransfer(id);
            if (handler.everSettled(id)) {
                assertTrue(t.status != IRM.Status.Funded, "settled transfer is Funded again");
                assertTrue(t.settledAt != 0);
                if (t.kind == IRM.Kind.Claimable) assertEq(handler.ghostPaidOut(id), t.amount);
            } else {
                assertEq(uint8(t.status), uint8(IRM.Status.Funded));
                assertEq(handler.ghostPaidOut(id), 0);
            }
        }
    }

    /// I4: ids are dense from 1 and every ref maps back to its transfer.
    function invariant_idsAndRefsConsistent() public view {
        uint256 n = handler.idsLength();
        assertEq(mgr.nextTransferId(), n + 1);
        for (uint256 i; i < n; i++) {
            uint256 id = handler.ids(i);
            assertEq(id, i + 1);
            IRM.Transfer memory t = mgr.getTransfer(id);
            assertEq(mgr.transferIdByRef(t.sender, t.ref), id);
            assertTrue(t.ref != bytes32(0));
        }
    }

    /// I5: kind/field shape is consistent with status.
    function invariant_recordShape() public view {
        uint256 n = handler.idsLength();
        for (uint256 i; i < n; i++) {
            IRM.Transfer memory t = mgr.getTransfer(handler.ids(i));
            if (t.kind == IRM.Kind.Direct) {
                assertEq(uint8(t.status), uint8(IRM.Status.Completed));
                assertEq(t.expiresAt, 0);
                assertEq(t.claimSigner, address(0));
                assertTrue(t.recipient != address(0));
            } else {
                assertEq(uint8(t.kind), uint8(IRM.Kind.Claimable));
                assertTrue(t.status != IRM.Status.Completed && t.status != IRM.Status.None);
                assertTrue(t.claimSigner != address(0));
                assertEq(t.recipient != address(0), t.status == IRM.Status.Claimed);
                assertEq(mgr.isClaimable(handler.ids(i)), t.status == IRM.Status.Funded && block.timestamp < t.expiresAt);
            }
        }
    }
}
