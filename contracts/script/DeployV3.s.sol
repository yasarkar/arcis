// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {StableSwapPoolV3} from "../src/v3/StableSwapPoolV3.sol";
import {ConstantProductPoolV3} from "../src/v3/ConstantProductPoolV3.sol";
import {YieldVaultV3} from "../src/v3/YieldVaultV3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @notice Arcis V3 deployment script — the single mainnet-bound contract set.
/// @dev Deploys ONLY the V3 contracts:
///      - StableSwapPoolV3 (canonical Ann = A*4, MINIMUM_LIQUIDITY, Pausable)
///      - ConstantProductPoolV3 (x*y=k, MINIMUM_LIQUIDITY, Pausable, degenerate-pair guard)
///      - YieldVaultV3 (ERC-4626 + Pausable)
///      Works on both Arc Testnet (5042002) and Arc Mainnet (5042001): the only difference
///      is the --rpc-url and PRIVATE_KEY used. Same bytecode => same behavior in both.
contract DeployV3 is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Contract admin / owner for Pausable + Ownable (defaults to deployer).
        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        // Token addresses (configurable via environment variables).
        // Defaults match Arc Testnet (5042002). For mainnet, override USDC_ADDRESS /
        // EURC_ADDRESS / CIRBTC_ADDRESS to the Arc Mainnet token contracts.
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address eurc = vm.envOr("EURC_ADDRESS", address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));
        address cirbtc = vm.envOr("CIRBTC_ADDRESS", address(0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF));

        require(usdc != address(0) && eurc != address(0) && cirbtc != address(0), "USDC/EURC/CIRBTC required");

        vm.startBroadcast(deployerKey);

        // V3 fee set: Stable 0.12%, Constant-Product 0.25%, Vault 1% (matches V1/V2).
        StableSwapPoolV3 stableV3 = new StableSwapPoolV3(usdc, eurc, 12, owner);
        ConstantProductPoolV3 cpV3 = new ConstantProductPoolV3(usdc, cirbtc, 25, owner);
        YieldVaultV3 vaultV3 = new YieldVaultV3(IERC20(usdc), "Arcis USDC Yield v3", "af-USDC-v3", 100, owner);

        console2.log("=== Arcis V3 Contracts Deployed ===");
        console2.log("Deployer:", deployer);
        console2.log("Owner/Admin:", owner);
        console2.log("StableSwapPoolV3 (USDC/EURC):", address(stableV3));
        console2.log("ConstantProductPoolV3 (USDC/cirBTC):", address(cpV3));
        console2.log("YieldVaultV3 (af-USDC-v3):", address(vaultV3));

        vm.stopBroadcast();
    }
}