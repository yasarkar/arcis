// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ArcisSwapRouter} from "../src/ArcisSwapRouter.sol";
import {Script, console2} from "forge-std/Script.sol";

contract DeployRouter is Script {
    function run() external returns (address routerAddress) {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        ArcisSwapRouter router = new ArcisSwapRouter();
        routerAddress = address(router);

        console2.log("=== ArcisSwapRouter Deployed ===");
        console2.log("Router Address:", routerAddress);

        vm.stopBroadcast();
    }
}
