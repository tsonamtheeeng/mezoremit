// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RemittanceManager} from "../src/RemittanceManager.sol";

/// @notice Deploys RemittanceManager and records it in deployments/<chainid>.json.
/// Env:
///   DEPLOYER_PRIVATE_KEY  optional; if unset, the signer comes from --account / --private-key / --ledger
///   MUSD                  optional; default = Mezo testnet MUSD 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503
///   MIN_EXPIRY            optional; default 60 (seconds)
/// Usage (from contracts/):
///   forge script script/Deploy.s.sol --rpc-url mezo_testnet --broadcast --legacy [--account <name>]
/// The JSON file is only written when broadcasting (not on dry runs). `deployBlock` is the block the script
/// observed before sending, i.e. a safe lower bound for indexer backfill; the exact tx hash/block are in
/// broadcast/Deploy.s.sol/<chainid>/run-latest.json.
contract Deploy is Script {
    address internal constant MEZO_TESTNET_MUSD = 0x118917a40FAF1CD7a13dB0Ef56C86De7973Ac503;

    function run() external returns (RemittanceManager manager) {
        address musd = vm.envOr("MUSD", MEZO_TESTNET_MUSD);
        uint64 minExpiry = uint64(vm.envOr("MIN_EXPIRY", uint256(60)));
        uint256 pk = vm.envOr("DEPLOYER_PRIVATE_KEY", uint256(0));
        require(musd.code.length > 0 || block.chainid == 31337, "MUSD has no code on this chain");

        uint256 deployBlock = block.number;
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        manager = new RemittanceManager(IERC20(musd), minExpiry);
        vm.stopBroadcast();

        (, address deployer,) = vm.readCallers();
        if (pk != 0) deployer = vm.addr(pk);

        console2.log("RemittanceManager", address(manager));
        console2.log("MUSD", musd);
        console2.log("minExpiry", minExpiry);
        console2.log("chainId", block.chainid);

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            string memory k = "deployment";
            vm.serializeUint(k, "chainId", block.chainid);
            vm.serializeAddress(k, "manager", address(manager));
            vm.serializeAddress(k, "musd", musd);
            vm.serializeUint(k, "minExpiry", minExpiry);
            vm.serializeUint(k, "deployBlock", deployBlock);
            string memory json = vm.serializeAddress(k, "deployer", deployer);
            string memory path =
                string.concat(vm.projectRoot(), "/deployments/", vm.toString(block.chainid), ".json");
            vm.writeJson(json, path);
            console2.log("wrote", path);
        }
    }
}
