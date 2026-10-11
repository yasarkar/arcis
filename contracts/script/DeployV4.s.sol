// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StableSwapPoolV4} from "../src/v4/StableSwapPoolV4.sol";
import {ConstantProductPoolV4} from "../src/v4/ConstantProductPoolV4.sol";
import {YieldVaultV4} from "../src/v4/YieldVaultV4.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @notice Arcis V4 deployment script for complete V4 Real Yield Protocol Suite on Arc Testnet.
contract DeployV4 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        // Arc Testnet official addresses
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address eurc = vm.envOr("EURC_ADDRESS", address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));
        address cirbtc = vm.envOr("CIRBTC_ADDRESS", address(0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF));

        require(usdc != address(0) && eurc != address(0) && cirbtc != address(0), "USDC, EURC and cirBTC required");

        vm.startBroadcast(deployerKey);

        // 12 basis points (0.12%) stable swap fee
        StableSwapPoolV4 stableV4 = new StableSwapPoolV4(usdc, eurc, 12, owner);
        // 25 basis points (0.25%) volatile constant-product swap fee
        ConstantProductPoolV4 cpV4 = new ConstantProductPoolV4(usdc, cirbtc, 25, owner);
        // 100 basis points (1%) performance fee vault
        YieldVaultV4 vaultV4 = new YieldVaultV4(IERC20(usdc), "Arcis USDC Yield v4", "af-USDC-v4", 100, owner);

        console2.log("=== Arcis V4 Full Protocol Suite Deployed ===");
        console2.log("Deployer:", deployer);
        console2.log("Owner/Admin:", owner);
        console2.log("StableSwapPoolV4 (USDC/EURC):", address(stableV4));
        console2.log("ConstantProductPoolV4 (USDC/cirBTC):", address(cpV4));
        console2.log("YieldVaultV4 (af-USDC-v4):", address(vaultV4));

        vm.stopBroadcast();
    }
}
