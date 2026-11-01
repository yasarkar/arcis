// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {Script, console2} from "forge-std/Script.sol";

interface IMinimalERC20 {
    function decimals() external view returns (uint8);
    function symbol()   external view returns (string memory);
}

/// @notice Deployment script for Arcis EURC/cirBTC Pool V4 on Arc Testnet (Chain ID: 5042002).
contract DeployEurcCirBtcPool is Script {
    uint256 public constant ARC_TESTNET_CHAIN_ID = 5042002;

    address public constant CANONICAL_EURC   = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address public constant CANONICAL_CIRBTC = 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF;

    uint256 public constant DEFAULT_SWAP_FEE_BPS = 25; // 0.25%

    function run() external returns (ConstantProductPoolEurcCirBtcV4 pool) {
        require(
            block.chainid == ARC_TESTNET_CHAIN_ID,
            "DeployEurcCirBtcPool: wrong network -- expected Arc Testnet (5042002)"
        );

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;

        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        require(owner != address(0), "DeployEurcCirBtcPool: OWNER_ADDRESS must be non-zero");

        address eurc = vm.envOr("EURC_ADDRESS", CANONICAL_EURC);
        address cirBtc = vm.envOr("CIRBTC_ADDRESS", CANONICAL_CIRBTC);

        require(eurc != address(0) && cirBtc != address(0), "EURC and cirBTC addresses required");
        require(eurc.code.length > 0, "EURC must have deployed code");
        require(cirBtc.code.length > 0, "cirBTC must have deployed code");
        require(eurc != cirBtc, "EURC and cirBTC must be different addresses");
        require(IMinimalERC20(eurc).decimals() == 6,   "EURC must have 6 decimals");
        require(IMinimalERC20(cirBtc).decimals() == 8, "cirBTC must have 8 decimals");

        uint256 swapFeeBps = vm.envOr("SWAP_FEE_BPS", DEFAULT_SWAP_FEE_BPS);

        console2.log("Deploying ConstantProductPoolEurcCirBtcV4");
        console2.log("  Deployer   :", deployer);
        console2.log("  Owner      :", owner);
        console2.log("  EURC       :", eurc);
        console2.log("  cirBTC     :", cirBtc);
        console2.log("  SwapFeeBps :", swapFeeBps);
        console2.log(
            "NOTE: Seed liquidity in the same script/transaction batch as deployment to avoid first-deposit price front-running."
        );

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        pool = new ConstantProductPoolEurcCirBtcV4(eurc, cirBtc, swapFeeBps, owner);

        vm.stopBroadcast();

        require(
            address(pool).code.length > 0,
            "DeployEurcCirBtcPool: deployment failed -- no bytecode at pool address"
        );
        require(pool.swapFeeBps() == swapFeeBps, "DeployEurcCirBtcPool: swapFeeBps mismatch");
        require(pool.owner() == owner, "DeployEurcCirBtcPool: owner mismatch");

        console2.log("ConstantProductPoolEurcCirBtcV4 deployed at:", address(pool));
        console2.log("  LP token name   :", pool.name());
        console2.log("  LP token symbol :", pool.symbol());
    }
}

