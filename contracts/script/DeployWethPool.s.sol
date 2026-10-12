// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConstantProductPoolWethV4} from "../src/v4/ConstantProductPoolWethV4.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @notice Deployment script for Arcis USDC/WETH Pool V4 on Arc Testnet.
contract DeployWethPool is Script {
    function run() external {
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;
        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        // Arc Testnet official addresses
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address weth = vm.envOr("WETH_ADDRESS", address(0x2c4047028a72803939b6fb674D01bC059B5C4961));

        require(usdc != address(0) && weth != address(0), "USDC and WETH addresses required");

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        // 30 basis points (0.30%) swap fee for volatile ETH pair
        ConstantProductPoolWethV4 wethPool = new ConstantProductPoolWethV4(usdc, weth, 30, owner);

        console2.log("=== Arcis USDC/WETH V4 Pool Deployed ===");
        console2.log("Deployer:", deployer);
        console2.log("Owner/Admin:", owner);
        console2.log("ConstantProductPoolWethV4 (USDC/WETH):", address(wethPool));

        vm.stopBroadcast();
    }
}
