// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StableSwapPoolV2} from "../src/v2/StableSwapPoolV2.sol";
import {ConstantProductPoolV2} from "../src/v2/ConstantProductPoolV2.sol";
import {YieldVaultV2} from "../src/v2/YieldVaultV2.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @notice Arcis V2 deployment script — Arc Testnet & Mainnet.
/// @dev Deploys V2 pool contracts (MINIMUM_LIQUIDITY, slippage guards, Pausable)
///      + the Pausable ERC-4626 yield vault. V1 history untouched.
contract DeployV2 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Contract admin / owner for Pausable + Ownable (defaults to deployer).
        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        // Token addresses (configurable via environment variables)
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address eurc = vm.envOr("EURC_ADDRESS", address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));
        address cirbtc = vm.envOr("CIRBTC_ADDRESS", address(0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF));

        vm.startBroadcast(deployerKey);

        // Same fee set as V1: Stable 0.12%, Constant-Product 0.25%, Vault 1%.
        StableSwapPoolV2 stableV2 = new StableSwapPoolV2(usdc, eurc, 12, owner);
        ConstantProductPoolV2 cpV2 = new ConstantProductPoolV2(usdc, cirbtc, 25, owner);
        YieldVaultV2 vaultV2 = new YieldVaultV2(IERC20(usdc), "Arcis USDC Yield v2", "af-USDC-v2", 100, owner);

        console2.log("=== Arcis V2 Contracts Deployed ===");
        console2.log("Deployer:", deployer);
        console2.log("Owner/Admin:", owner);
        console2.log("StableSwapPoolV2 (USDC/EURC):", address(stableV2));
        console2.log("ConstantProductPoolV2 (USDC/cirBTC):", address(cpV2));
        console2.log("YieldVaultV2 (af-USDC-v2):", address(vaultV2));

        vm.stopBroadcast();
    }
}