// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {BaseTest} from "./Base.t.sol";
import {RemittanceManager} from "../src/RemittanceManager.sol";
import {IRemittanceManager as IRM} from "../src/interfaces/IRemittanceManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract SignatureTest is BaseTest {
    uint256 internal constant SECP_N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    uint256 internal id;

    function setUp() public override {
        super.setUp();
        id = _create(100e18);
    }

    function test_claimDigest_matchesRawEip712() public view {
        assertEq(mgr.claimDigest(id, bob), _rawDigest(address(mgr), block.chainid, id, bob));
    }

    function testFuzz_claimDigest_matchesRawEip712(uint256 tid, address to) public view {
        assertEq(mgr.claimDigest(tid, to), _rawDigest(address(mgr), block.chainid, tid, to));
    }

    function test_claim_withSigOverRawDigest() public {
        bytes memory sig = _sign(claimPk, _rawDigest(address(mgr), block.chainid, id, bob));
        mgr.claimTransfer(id, bob, sig);
        assertEq(musd.balanceOf(bob), 100e18);
    }

    function test_frontRun_swappedRecipientFails() public {
        bytes memory sig = _sigFor(id, bob);
        address attacker = makeAddr("attacker");
        vm.prank(attacker);
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, attacker, sig);
        // the honest submission still succeeds afterwards
        vm.prank(relayer);
        mgr.claimTransfer(id, bob, sig);
        assertEq(musd.balanceOf(bob), 100e18);
        assertEq(musd.balanceOf(attacker), 0);
    }

    function test_replay_acrossTransfersFails() public {
        uint256 id2 = _create(50e18); // same claimSigner
        bytes memory sig1 = _sigFor(id, bob);
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id2, bob, sig1);
        mgr.claimTransfer(id, bob, sig1);
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id2, bob, sig1);
    }

    function test_replay_acrossManagersFails() public {
        RemittanceManager mgr2 = new RemittanceManager(IERC20(address(musd)), MIN);
        vm.prank(alice);
        musd.approve(address(mgr2), type(uint256).max);
        vm.prank(alice);
        uint256 id2 = mgr2.createClaimable(claimSigner, 100e18, uint64(block.timestamp + 1 days), _ref(1));
        assertEq(id2, id, "same id on both managers");
        assertTrue(mgr.claimDigest(id, bob) != mgr2.claimDigest(id, bob));

        bytes memory sig = _sigFor(id, bob);
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr2.claimTransfer(id2, bob, sig);
        mgr.claimTransfer(id, bob, sig);
    }

    function test_replay_acrossChainsFails() public {
        bytes memory sig = _sigFor(id, bob);
        bytes32 before = mgr.claimDigest(id, bob);
        vm.chainId(block.chainid + 1);
        assertTrue(mgr.claimDigest(id, bob) != before);
        assertEq(mgr.claimDigest(id, bob), _rawDigest(address(mgr), block.chainid, id, bob));
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, sig);
    }

    function test_wrongDomainName_fails() public {
        bytes32 domainSep = keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256("MezoRemit "),
                keccak256("1"),
                block.chainid,
                address(mgr)
            )
        );
        bytes32 structHash = keccak256(abi.encode(mgr.CLAIM_TYPEHASH(), id, bob));
        bytes memory sig = _sign(claimPk, keccak256(abi.encodePacked("\x19\x01", domainSep, structHash)));
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, sig);
    }

    function test_malleableHighS_rejected() public {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimPk, mgr.claimDigest(id, bob));
        bytes32 highS = bytes32(SECP_N - uint256(s));
        uint8 flippedV = v == 27 ? 28 : 27;
        // (r, n - s, v') recovers the same address under raw ecrecover, but must be rejected.
        assertEq(ecrecover(mgr.claimDigest(id, bob), flippedV, r, highS), claimSigner);
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, abi.encodePacked(r, highS, flippedV));
    }

    function test_invalidV_rejected() public {
        (, bytes32 r, bytes32 s) = vm.sign(claimPk, mgr.claimDigest(id, bob));
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, abi.encodePacked(r, s, uint8(29)));
    }

    function test_badLength_rejected() public {
        bytes memory sig = _sigFor(id, bob);
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, "");
        // EIP-2098 compact (64 bytes) is not accepted
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(claimPk, mgr.claimDigest(id, bob));
        bytes32 vs = bytes32(uint256(s) | (uint256(v - 27) << 255));
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, abi.encodePacked(r, vs));
        bytes memory longSig = abi.encodePacked(sig, bytes1(0x00));
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, longSig);
    }

    function test_zeroSignatureRecoversToZero_rejected() public {
        bytes memory sig = new bytes(65);
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        mgr.claimTransfer(id, bob, sig);
    }
}

/// @notice Cross-language check: a signature produced by viem through the FROZEN lib/chain/claim.ts
///         (contracts/test/fixtures/gen-claim-vector.mts -> claim-vector.json) must verify on-chain.
contract TsCompatTest is BaseTest {
    uint256 internal constant TS_CLAIM_KEY = 0x1111111111111111111111111111111111111111111111111111111111111111;
    address internal constant TS_CLAIM_SIGNER = 0x19E7E376E7C213B7E7e7e46cc70A5dD086DAff2A;
    address internal constant TS_MANAGER = 0x1000000000000000000000000000000000000001;
    address internal constant TS_RECIPIENT = 0x000000000000000000000000000000000000bEEF;
    bytes32 internal constant TS_DIGEST = 0x9891a5492cca9b9dae399f02dcafc64616dac0416aa7cba4c75795d42dbd8bec;
    bytes internal constant TS_SIG =
        hex"5502fa567c1bd10a729764db961d79a2a68791613296e3a2207ced7fb5c99bcd4ddf3b74e205d0e5e2bad5c20821d7b98f47f0f98b354d4aaa24da86b4c556c81b";
    string internal constant TS_UUID = "3f2b8c1e-6a4d-4e2f-9b7a-0c5d1e2f3a4b";
    bytes32 internal constant TS_REF = 0x51a9942823c4124c7d27281583b1121b4b507d956fda281ae20b746632e7f4de;

    RemittanceManager internal tsMgr;

    function setUp() public override {
        super.setUp();
        vm.chainId(31611);
        deployCodeTo("RemittanceManager.sol:RemittanceManager", abi.encode(address(musd), MIN), TS_MANAGER);
        tsMgr = RemittanceManager(TS_MANAGER);
        vm.prank(alice);
        musd.approve(TS_MANAGER, type(uint256).max);
    }

    function test_tsVector_keyAndRef() public pure {
        assertEq(vm.addr(TS_CLAIM_KEY), TS_CLAIM_SIGNER);
        assertEq(keccak256(abi.encodePacked("mezoremit:transfer:", TS_UUID)), TS_REF);
    }

    function test_tsVector_digestMatches() public view {
        assertEq(tsMgr.claimDigest(1, TS_RECIPIENT), TS_DIGEST);
        assertEq(_rawDigest(TS_MANAGER, 31611, 1, TS_RECIPIENT), TS_DIGEST);
    }

    function test_tsVector_viemSignatureClaims() public {
        vm.prank(alice);
        uint256 tid = tsMgr.createClaimable(TS_CLAIM_SIGNER, 42e18, uint64(block.timestamp + 1 days), TS_REF);
        assertEq(tid, 1);
        assertEq(tsMgr.transferIdByRef(alice, TS_REF), 1);
        vm.prank(relayer);
        tsMgr.claimTransfer(1, TS_RECIPIENT, TS_SIG);
        assertEq(musd.balanceOf(TS_RECIPIENT), 42e18);
        assertEq(uint8(tsMgr.getTransferStatus(1)), uint8(IRM.Status.Claimed));
    }

    function test_tsVector_wrongChainFails() public {
        vm.prank(alice);
        tsMgr.createClaimable(TS_CLAIM_SIGNER, 42e18, uint64(block.timestamp + 1 days), TS_REF);
        vm.chainId(31612);
        vm.expectRevert(IRM.InvalidClaimSignature.selector);
        tsMgr.claimTransfer(1, TS_RECIPIENT, TS_SIG);
    }
}
