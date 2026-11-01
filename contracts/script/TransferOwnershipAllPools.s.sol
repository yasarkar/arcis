// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console2} from "forge-std/Script.sol";

interface IOwnable {
    function owner() external view returns (address);
    function transferOwnership(address newOwner) external;
}

interface IOwnable2Step {
    function owner() external view returns (address);
    function pendingOwner() external view returns (address);
    function transferOwnership(address newOwner) external;
    function acceptOwnership() external;
}

/// @notice Transfers ownership of legacy V4 pools to the unified deployer address.
contract TransferOwnershipAllPools is Script {
    address public constant STABLE_SWAP_POOL   = 0xC3EdDA15AdfaC31ADfC23aC86dC96d791f72bE8a;
    address public constant CONSTANT_PROD_POOL = 0xf0e5f1d5C36a8362D96A8a43a441c6bb29416349;
    address public constant EURC_WETH_POOL     = 0x94f1fB8ab07146BB2C1f2A9AF155d51413a45809;

    address public constant EXPECTED_NEW_OWNER = 0xcb29758C8c2E5E333ec8edB99Dea0F287bf0e804;

    function run() external {
        uint256 oldOwnerKey = vm.envUint("OLD_OWNER_KEY");
        uint256 newOwnerKey = vm.envUint("PRIVATE_KEY");

        address oldOwner = vm.addr(oldOwnerKey);
        address newOwner = vm.addr(newOwnerKey);

        require(oldOwner == 0x3d839c9B5729aA3eA286d9BF7eBA5B7C542de772, "Mismatch on old owner address");
        require(newOwner == EXPECTED_NEW_OWNER, "Mismatch on new owner address");

        console2.log("=== Step 1: Initiating transfer from old owner ===");
        console2.log("Old Owner:", oldOwner);
        console2.log("New Owner:", newOwner);

        vm.startBroadcast(oldOwnerKey);

        // 1. StableSwapPoolV4 (standard Ownable)
        IOwnable(STABLE_SWAP_POOL).transferOwnership(newOwner);
        console2.log("StableSwapPool transferOwnership called");

        // 2. ConstantProductPoolV4 (standard Ownable)
        IOwnable(CONSTANT_PROD_POOL).transferOwnership(newOwner);
        console2.log("ConstantProductPool transferOwnership called");

        // 3. ConstantProductPoolEurcWethV4 (Ownable2Step)
        IOwnable2Step(EURC_WETH_POOL).transferOwnership(newOwner);
        console2.log("EURC/WETH Pool transferOwnership called");

        vm.stopBroadcast();

        console2.log("=== Step 2: Accepting ownership with new owner ===");
        vm.startBroadcast(newOwnerKey);

        IOwnable2Step(EURC_WETH_POOL).acceptOwnership();
        console2.log("EURC/WETH Pool acceptOwnership confirmed");

        vm.stopBroadcast();

        // Verification checks
        require(IOwnable(STABLE_SWAP_POOL).owner() == newOwner, "StableSwapPool ownership transfer failed");
        require(IOwnable(CONSTANT_PROD_POOL).owner() == newOwner, "ConstantProductPool ownership transfer failed");
        require(IOwnable2Step(EURC_WETH_POOL).owner() == newOwner, "EURC/WETH Pool ownership transfer failed");

        console2.log("=== SUCCESS: All pools successfully transferred to:", newOwner);
    }
}
