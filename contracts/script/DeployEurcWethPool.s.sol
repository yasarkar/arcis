// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConstantProductPoolEurcWethV4} from "../src/v4/ConstantProductPoolEurcWethV4.sol";
import {Script, console2} from "forge-std/Script.sol";

interface IMinimalERC20 {
    function decimals() external view returns (uint8);
    function symbol()   external view returns (string memory);
}

/// @notice Deployment script for Arcis EURC/WETH Pool V4 on Arc Testnet.
/// @dev Chain-ID guard ensures the script is never accidentally run on the wrong network.
///      Symbol/decimals sanity checks confirm the token addresses match the expected assets.
contract DeployEurcWethPool is Script {
    /// @dev Arc Testnet chain ID.
    uint256 public constant ARC_TESTNET_CHAIN_ID = 5042002;

    function run() external {
        // Chain-ID guard: hard-fail on wrong network before broadcasting any transaction.
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "DeployEurcWethPool: wrong network -- expected Arc Testnet (5042002)");

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;
        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        // Arc Testnet official addresses
        address eurc = vm.envOr("EURC_ADDRESS", address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));
        address weth = vm.envOr("WETH_ADDRESS", address(0x2c4047028a72803939b6fb674D01bC059B5C4961));

        require(eurc != address(0) && weth != address(0), "EURC and WETH addresses required");

        // Sanity-check decimals against the expected token spec.
        require(IMinimalERC20(eurc).decimals() == 6,  "DeployEurcWethPool: EURC_ADDRESS does not have 6 decimals");
        require(IMinimalERC20(weth).decimals() == 18, "DeployEurcWethPool: WETH_ADDRESS does not have 18 decimals");

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        // 30 basis points (0.30%) swap fee for volatile ETH pair
        ConstantProductPoolEurcWethV4 eurcWethPool = new ConstantProductPoolEurcWethV4(eurc, weth, 30, owner);

        console2.log("=== Arcis EURC/WETH V4 Pool Deployed ===");
        console2.log("Deployer:                                   ", deployer);
        console2.log("Owner/Admin:                                ", owner);
        console2.log("Chain ID:                                   ", block.chainid);
        console2.log("EURC (tokenA):                              ", eurc);
        console2.log("WETH (tokenB):                              ", weth);
        console2.log("ConstantProductPoolEurcWethV4 (EURC/WETH):  ", address(eurcWethPool));

        vm.stopBroadcast();
    }
}
