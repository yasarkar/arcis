// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {YieldVaultV4} from "../src/v4/YieldVaultV4.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @notice Standalone deployment script for YieldVaultV4 on Arc Testnet (chainId 5042002).
/// @dev    Usage:
///           forge script script/DeployVaultV4.s.sol \
///             --rpc-url arc_testnet --broadcast --verify \
///             --env-file .env
///
///         Required env vars:
///           PRIVATE_KEY         — deployer EOA private key
///
///         Optional overrides (defaults to Arc Testnet canonical addresses):
///           USDC_ADDRESS        — override USDC ERC-20 address
///           OWNER_ADDRESS       — admin/owner (defaults to deployer)
///           VAULT_PERF_FEE_BPS  — performance fee in bps (default 100 = 1%)
contract DeployVaultV4 is Script {
    // Arc Testnet canonical addresses
    address internal constant ARC_USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer    = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;
        address owner       = vm.envOr("OWNER_ADDRESS", deployer);
        address usdc        = vm.envOr("USDC_ADDRESS", ARC_USDC);
        uint256 perfFeeBps  = vm.envOr("VAULT_PERF_FEE_BPS", uint256(100)); // default 1%

        require(
            block.chainid == 5042002 || block.chainid == 31337,
            "DeployVaultV4: wrong chain - expected Arc Testnet (5042002)"
        );
        require(usdc != address(0), "DeployVaultV4: USDC address required");
        require(owner != address(0), "DeployVaultV4: owner address required");
        require(perfFeeBps <= 1000, "DeployVaultV4: performance fee exceeds 10%");

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        YieldVaultV4 vaultV4 = new YieldVaultV4(
            IERC20(usdc),
            "Arcis USDC Yield Vault v4",
            "af-USDC-v4",
            perfFeeBps,
            owner
        );

        vm.stopBroadcast();

        console2.log("=== Arcis YieldVaultV4 Deployed ===");
        console2.log("Deployer:          ", deployer);
        console2.log("Owner/Admin:       ", owner);
        console2.log("YieldVaultV4:      ", address(vaultV4));
        console2.log("Asset (USDC):      ", usdc);
        console2.log("Share decimals:    ", vaultV4.decimals());
        console2.log("Performance fee:   ", perfFeeBps, "bps");
        console2.log("Max fee cap:       ", vaultV4.MAX_FEE_BPS(), "bps");
    }
}
