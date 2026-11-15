// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {RemittanceManager} from "../src/RemittanceManager.sol";
import {IRemittanceManager} from "../src/interfaces/IRemittanceManager.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockMUSD} from "./mocks/MockMUSD.sol";

abstract contract BaseTest is Test {
    uint64 internal constant MIN = 60;
    uint256 internal constant START = 1_750_000_000;

    MockMUSD internal musd;
    RemittanceManager internal mgr;

    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal relayer = makeAddr("relayer");

    uint256 internal claimPk = 0xC1A1;
    address internal claimSigner;

    function setUp() public virtual {
        vm.warp(START);
        musd = new MockMUSD();
        mgr = new RemittanceManager(IERC20(address(musd)), MIN);
        claimSigner = vm.addr(claimPk);
        musd.mint(alice, 1_000_000e18);
        vm.prank(alice);
        musd.approve(address(mgr), type(uint256).max);
    }

    // ------------------------------------------------------------ helpers
    function _ref(uint256 i) internal pure returns (bytes32) {
        return keccak256(abi.encodePacked("ref", i));
    }

    function _create(uint256 amount) internal returns (uint256 id) {
        bytes32 ref = _ref(mgr.nextTransferId());
        vm.prank(alice);
        id = mgr.createClaimable(claimSigner, amount, uint64(block.timestamp + 1 days), ref);
    }

    function _sign(uint256 pk, bytes32 digest) internal pure returns (bytes memory) {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, digest);
        return abi.encodePacked(r, s, v);
    }

    function _sigFor(uint256 id, address recipient) internal view returns (bytes memory) {
        return _sign(claimPk, mgr.claimDigest(id, recipient));
    }

    /// @dev Independent EIP-712 digest straight from the spec, not from the contract.
    function _rawDigest(address manager, uint256 chainId, uint256 id, address recipient)
        internal
        pure
        returns (bytes32)
    {
        bytes32 domainTypeHash =
            keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
        bytes32 domainSep = keccak256(
            abi.encode(domainTypeHash, keccak256("MezoRemit"), keccak256("1"), chainId, manager)
        );
        bytes32 structHash = keccak256(abi.encode(keccak256("Claim(uint256 transferId,address recipient)"), id, recipient));
        return keccak256(abi.encodePacked("\x19\x01", domainSep, structHash));
    }
}
