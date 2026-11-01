// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {Script, console2} from "forge-std/Script.sol";

interface IMinimalERC20 {
    function decimals() external view returns (uint8);
    function symbol()   external view returns (string memory);
}

/// @notice Deployment script for Arcis cirBTC/WETH Pool V4 on Arc Testnet (Chain ID: 5042002).
/// @dev Includes token preflight checks; does not seed liquidity or perform an ownership handoff.
contract DeployCirBtcWethPool is Script {
    uint256 public constant ARC_TESTNET_CHAIN_ID = 5042002;

    address public constant CANONICAL_CIRBTC = 0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF;
    address public constant CANONICAL_WETH   = 0x2c4047028a72803939b6fb674D01bC059B5C4961;

    uint256 public constant DEFAULT_SWAP_FEE_BPS = 30; // 0.30%

    function run() external returns (ConstantProductPoolCirBtcWethV4 pool) {
        require(
            block.chainid == ARC_TESTNET_CHAIN_ID,
            "DeployCirBtcWethPool: wrong network -- expected Arc Testnet (5042002)"
        );

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;

        address owner = vm.envOr("OWNER_ADDRESS", deployer);
        require(owner != address(0), "DeployCirBtcWethPool: OWNER_ADDRESS must be non-zero");

        address cirBtc = vm.envOr("CIRBTC_ADDRESS", CANONICAL_CIRBTC);
        address weth = vm.envOr("WETH_ADDRESS", CANONICAL_WETH);

        require(cirBtc != address(0) && weth != address(0), "cirBTC and WETH addresses required");
        require(cirBtc != weth, "cirBTC and WETH must differ");
        require(cirBtc.code.length > 0, "cirBTC must have code");
        require(weth.code.length > 0, "WETH must have code");
        require(IMinimalERC20(cirBtc).decimals() == 8,  "cirBTC must have 8 decimals");
        require(IMinimalERC20(weth).decimals() == 18,   "WETH must have 18 decimals");

        uint256 swapFeeBps = vm.envOr("SWAP_FEE_BPS", DEFAULT_SWAP_FEE_BPS);

        console2.log("Deploying ConstantProductPoolCirBtcWethV4");
        console2.log("  Deployer   :", deployer);
        console2.log("  Owner      :", owner);
        console2.log("  cirBTC     :", cirBtc);
        console2.log("  WETH       :", weth);
        console2.log("  SwapFeeBps :", swapFeeBps);
        console2.log("Recommendation: seed liquidity in the same batch as deployment; this script does not seed.");
        console2.log("Recommendation: deploy with the deployer as owner, then transferOwnership (Ownable2Step)");
        console2.log("to the final owner, who must call acceptOwnership.");

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        pool = new ConstantProductPoolCirBtcWethV4(cirBtc, weth, swapFeeBps, owner);

        vm.stopBroadcast();

        require(
            address(pool).code.length > 0,
            "DeployCirBtcWethPool: deployment failed -- no bytecode at pool address"
        );
        require(pool.swapFeeBps() == swapFeeBps, "DeployCirBtcWethPool: swapFeeBps mismatch");
        require(pool.owner() == owner, "DeployCirBtcWethPool: owner mismatch");

        console2.log("ConstantProductPoolCirBtcWethV4 deployed at:", address(pool));
        console2.log("  LP token name   :", pool.name());
        console2.log("  LP token symbol :", pool.symbol());
    }
}

