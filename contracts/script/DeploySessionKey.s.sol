// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {SessionKeyModule} from "../src/SessionKeyModule.sol";

/// @notice Deploys the SessionKeyModule and optionally registers a test session key.
/// Usage:
///   forge script script/DeploySessionKey.s.sol --rpc-url arc_testnet --broadcast
contract DeploySessionKey is Script {
    // Arc Testnet real addresses
    address public constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // The MSCA address must be provided (from Circle registration)
        // For testnet you can read it from localStorage or env
        address mscaAddress = vm.envOr("MSCA_ADDRESS", address(0));
        require(mscaAddress != address(0), "Set MSCA_ADDRESS in .env");

        vm.startBroadcast(deployerKey);

        // Deploy the session key module
        SessionKeyModule module = new SessionKeyModule(mscaAddress, deployer);
        console2.log("SessionKeyModule deployed at:", address(module));
        console2.log("  Owner (passkey admin):", deployer);
        console2.log("  Target MSCA:", mscaAddress);

        vm.stopBroadcast();
    }
}