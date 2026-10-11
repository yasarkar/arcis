// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {YieldVaultV4} from "../src/v4/YieldVaultV4.sol";

/// @notice Deployment script for YieldVaultV4 on Arc Testnet (Chain ID: 5042002).
///
/// Usage (Arc Testnet):
///   forge script contracts/script/DeployVaultV4.s.sol \
///     --rpc-url https://rpc.testnet.arc.io \
///     --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY
///
/// Vault Configuration:
///   Asset           : Native USDC (0x3600000000000000000000000000000000000000, 6 decimals)
///   Name            : "Arcis USDC Yield v4"
///   Symbol          : "af-USDC-v4"
///   Performance Fee : 100 bps (1%)
///   Share Decimals  : 9 (_decimalsOffset = 3 inflation defense)
contract DeployVaultV4 is Script {
    address public constant ARC_TESTNET_USDC = 0x3600000000000000000000000000000000000000;
    uint256 public constant PERFORMANCE_FEE_BPS = 100; // 1%

    function run() external returns (YieldVaultV4 vault) {
        address deployer;
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));

        if (deployerKey != 0) {
            deployer = vm.addr(deployerKey);
            vm.startBroadcast(deployerKey);
        } else {
            deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
            vm.startBroadcast();
        }

        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        console2.log("Deploying YieldVaultV4");
        console2.log("  Chain ID            :", block.chainid);
        console2.log("  Deployer            :", deployer);
        console2.log("  Owner               :", owner);
        console2.log("  Asset (USDC)        :", ARC_TESTNET_USDC);
        console2.log("  Performance Fee Bps :", PERFORMANCE_FEE_BPS);

        if (block.chainid != 31337) {
            require(
                block.chainid == 5042002,
                "DeployVaultV4: wrong chain - expected Arc Testnet (5042002)"
            );
        }

        vault = new YieldVaultV4(
            IERC20(ARC_TESTNET_USDC),
            "Arcis USDC Yield v4",
            "af-USDC-v4",
            PERFORMANCE_FEE_BPS,
            owner
        );

        console2.log("=== Arcis V4 USDC Yield Vault Deployed ===");
        console2.log("YieldVaultV4 Address:", address(vault));

        vm.stopBroadcast();
    }
}
