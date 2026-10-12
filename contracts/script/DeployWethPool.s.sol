// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConstantProductPoolWethV4} from "../src/v4/ConstantProductPoolWethV4.sol";
import {Script, console2} from "forge-std/Script.sol";

interface IMinimalERC20 {
    function decimals() external view returns (uint8);
    function symbol()   external view returns (string memory);
}

/// @notice Deployment script for Arcis USDC/WETH Pool V4 on Arc Testnet.
/// @dev L-2 fix: chain-ID guard ensures the script is never accidentally run on the wrong network.
///      Symbol/decimals sanity checks confirm the token addresses match the expected assets.
contract DeployWethPool is Script {
    /// @dev Arc Testnet chain ID.
    uint256 public constant ARC_TESTNET_CHAIN_ID = 5042002;

    function run() external {
        // L-2 fix: hard-fail on wrong network before broadcasting any transaction.
        require(block.chainid == ARC_TESTNET_CHAIN_ID, "DeployWethPool: wrong network -- expected Arc Testnet (5042002)");

        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;
        address owner = vm.envOr("OWNER_ADDRESS", deployer);

        // Arc Testnet official addresses
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address weth = vm.envOr("WETH_ADDRESS", address(0x2c4047028a72803939b6fb674D01bC059B5C4961));

        require(usdc != address(0) && weth != address(0), "USDC and WETH addresses required");

        // L-2 fix: sanity-check decimals and symbols against the expected token spec.
        require(IMinimalERC20(usdc).decimals() == 6,  "DeployWethPool: USDC_ADDRESS does not have 6 decimals");
        require(IMinimalERC20(weth).decimals() == 18, "DeployWethPool: WETH_ADDRESS does not have 18 decimals");

        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        // 30 basis points (0.30%) swap fee for volatile ETH pair
        ConstantProductPoolWethV4 wethPool = new ConstantProductPoolWethV4(usdc, weth, 30, owner);

        console2.log("=== Arcis USDC/WETH V4 Pool Deployed ===");
        console2.log("Deployer:                               ", deployer);
        console2.log("Owner/Admin:                            ", owner);
        console2.log("Chain ID:                               ", block.chainid);
        console2.log("USDC (tokenA):                          ", usdc);
        console2.log("WETH (tokenB):                          ", weth);
        console2.log("ConstantProductPoolWethV4 (USDC/WETH):  ", address(wethPool));

        vm.stopBroadcast();
    }
}
