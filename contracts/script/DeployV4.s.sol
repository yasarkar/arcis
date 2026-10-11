// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StableSwapPoolV4} from "../src/v4/StableSwapPoolV4.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @notice Arcis V4 deployment script for USDC/EURC Real Yield Stable Pool on Arc Testnet.
contract DeployV4 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        // Arc Testnet official addresses
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address eurc = vm.envOr("EURC_ADDRESS", address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));

        require(usdc != address(0) && eurc != address(0), "USDC and EURC addresses required");

        vm.startBroadcast(deployerKey);

        // 12 basis points (0.12%) swap fee
        StableSwapPoolV4 stableV4 = new StableSwapPoolV4(usdc, eurc, 12, owner);

        console2.log("=== Arcis V4 USDC/EURC Stable Pool Deployed ===");
        console2.log("Deployer:", deployer);
        console2.log("Owner/Admin:", owner);
        console2.log("StableSwapPoolV4 (USDC/EURC):", address(stableV4));

        vm.stopBroadcast();
    }
}
