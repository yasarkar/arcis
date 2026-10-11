// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {ConstantProductPoolV4} from "../src/v4/ConstantProductPoolV4.sol";

/// @notice Deployment script for ConstantProductPoolV4 on Arc Testnet (Chain ID: 5042002).
///
/// Usage (Arc Testnet):
///   forge script contracts/script/DeployConstantProductV4.s.sol \
///     --rpc-url https://rpc.testnet.arc.io \
///     --broadcast \
///     --private-key $DEPLOYER_PRIVATE_KEY
///
/// Token addresses (Arc Testnet):
///   USDC  : 0x3600000000000000000000000000000000000000  (6 decimals, ERC-20 interface)
///   cirBTC: 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF  (8 decimals)
///
/// Arc Gas Note: native gas on Arc IS USDC (18-decimal native). This contract exclusively
///   interacts with the 6-decimal ERC-20 USDC interface and does not accept native value.
///   Gas for the deployment transaction itself will be deducted from the deployer's native
///   (Arc USDC) balance — ensure it holds at least 0.01 USDC in native form before running.
contract DeployConstantProductV4 is Script {
    // ── Arc Testnet token addresses ───────────────────────────────────────────
    address public constant ARC_TESTNET_USDC  = 0x3600000000000000000000000000000000000000;
    address public constant ARC_TESTNET_CIRBTC = 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF;

    // ── Pool configuration ────────────────────────────────────────────────────
    uint256 public constant SWAP_FEE_BPS = 25; // 0.25%

    function run() external returns (ConstantProductPoolV4 pool) {
        address deployer;
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));

        if (deployerKey != 0) {
            deployer = vm.addr(deployerKey);
            vm.startBroadcast(deployerKey);
        } else {
            deployer = vm.envOr("DEPLOYER_ADDRESS", msg.sender);
            vm.startBroadcast();
        }

        console2.log("Deploying ConstantProductPoolV4");
        console2.log("  Chain ID        :", block.chainid);
        console2.log("  Deployer        :", deployer);
        console2.log("  tokenA (USDC)   :", ARC_TESTNET_USDC);
        console2.log("  tokenB (cirBTC) :", ARC_TESTNET_CIRBTC);
        console2.log("  swapFeeBps      :", SWAP_FEE_BPS);

        // Verify we are on Arc Testnet (chain ID 5042002 or local 31337)
        if (block.chainid != 31337) {
            require(
                block.chainid == 5042002,
                "DeployConstantProductV4: wrong chain - expected Arc Testnet (5042002)"
            );
        }

        pool = new ConstantProductPoolV4(
            ARC_TESTNET_USDC,
            ARC_TESTNET_CIRBTC,
            SWAP_FEE_BPS,
            deployer
        );

        vm.stopBroadcast();

        console2.log("ConstantProductPoolV4 deployed at:", address(pool));
        console2.log("  LP token name   :", pool.name());
        console2.log("  LP token symbol :", pool.symbol());
        console2.log("  swapFeeBps      :", pool.swapFeeBps());
        console2.log("  owner           :", deployer);

        // Sanity checks post-deploy
        require(address(pool.tokenA()) == ARC_TESTNET_USDC,  "tokenA mismatch");
        require(address(pool.tokenB()) == ARC_TESTNET_CIRBTC, "tokenB mismatch");
        require(pool.swapFeeBps() == SWAP_FEE_BPS,           "fee mismatch");
        require(pool.totalSupply() == 0,                      "pool must start empty");

        return pool;
    }
}
