// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ConstantProductPoolEurcWethV4} from "../src/v4/ConstantProductPoolEurcWethV4.sol";
import {Script, console2} from "forge-std/Script.sol";

interface IMinimalERC20 {
    function decimals() external view returns (uint8);
    function symbol()   external view returns (string memory);
}

/// @notice Deployment script for Arcis EURC/WETH Pool V4 on Arc Testnet.
/// @dev Security changes applied (audit remediation):
///
///   H-02: OWNER_ADDRESS is now mandatory -- the script hard-fails when the env var is unset.
///         It also requires the owner to be a deployed contract (e.g., a multisig), not an EOA,
///         to limit blast radius from a single-key compromise.  Override the contract check with
///         ALLOW_EOA_OWNER=true only for local tests / throwaway devnet deployments.
///
///   M-03: In addition to decimal validation, the script checks that the supplied token addresses
///         match the canonical Arc Testnet addresses.  Overriding with non-canonical addresses
///         requires ALLOW_NONCANONICAL_TOKENS=true so the deviation is always explicit.
///
///   L-03: Post-deploy assertions read back swapFeeBps and owner() to confirm correct
///         construction before the broadcast receipt is considered final.
contract DeployEurcWethPool is Script {
    /// @dev Arc Testnet chain ID.
    uint256 public constant ARC_TESTNET_CHAIN_ID = 5042002;

    /// @dev Canonical Arc Testnet token addresses for EURC and WETH.
    address public constant CANONICAL_EURC = 0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a;
    address public constant CANONICAL_WETH = 0x2c4047028a72803939b6fb674D01bC059B5C4961;

    function run() external {
        // ── Network guard ────────────────────────────────────────────────────
        require(
            block.chainid == ARC_TESTNET_CHAIN_ID,
            "DeployEurcWethPool: wrong network -- expected Arc Testnet (5042002)"
        );

        // ── Deployer resolution ──────────────────────────────────────────────
        uint256 deployerKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address deployer = deployerKey != 0 ? vm.addr(deployerKey) : msg.sender;

        // ── H-02: OWNER_ADDRESS is mandatory -- no silent fallback to deployer EOA ──
        // Set OWNER_ADDRESS to a multisig (e.g., a Safe) that controls pause/skim/unpause.
        // Set ALLOW_EOA_OWNER=true ONLY for local devnet / throwaway test deployments.
        address owner = vm.envAddress("OWNER_ADDRESS");
        require(owner != address(0), "DeployEurcWethPool: OWNER_ADDRESS must be non-zero");

        bool allowEoa = vm.envOr("ALLOW_EOA_OWNER", false);
        if (!allowEoa) {
            require(
                owner.code.length > 0,
                "DeployEurcWethPool: OWNER_ADDRESS must be a contract (multisig). Set ALLOW_EOA_OWNER=true to override."
            );
        }

        // ── Token address resolution ─────────────────────────────────────────
        address eurc = vm.envOr("EURC_ADDRESS", CANONICAL_EURC);
        address weth = vm.envOr("WETH_ADDRESS", CANONICAL_WETH);

        require(eurc != address(0) && weth != address(0), "EURC and WETH addresses required");

        // ── M-03: Canonical address guard ───────────────────────────────────
        // Non-canonical addresses require an explicit opt-in flag so any deviation is auditable.
        bool allowNonCanonical = vm.envOr("ALLOW_NONCANONICAL_TOKENS", false);
        if (!allowNonCanonical) {
            require(
                eurc == CANONICAL_EURC,
                "DeployEurcWethPool: EURC_ADDRESS is non-canonical. Set ALLOW_NONCANONICAL_TOKENS=true to override."
            );
            require(
                weth == CANONICAL_WETH,
                "DeployEurcWethPool: WETH_ADDRESS is non-canonical. Set ALLOW_NONCANONICAL_TOKENS=true to override."
            );
        }

        // ── Decimal sanity checks ────────────────────────────────────────────
        require(IMinimalERC20(eurc).decimals() == 6,  "DeployEurcWethPool: EURC_ADDRESS does not have 6 decimals");
        require(IMinimalERC20(weth).decimals() == 18, "DeployEurcWethPool: WETH_ADDRESS does not have 18 decimals");

        // ── Broadcast ────────────────────────────────────────────────────────
        if (deployerKey != 0) {
            vm.startBroadcast(deployerKey);
        } else {
            vm.startBroadcast();
        }

        // 30 basis points (0.30%) swap fee for volatile ETH pair
        ConstantProductPoolEurcWethV4 eurcWethPool = new ConstantProductPoolEurcWethV4(eurc, weth, 30, owner);

        vm.stopBroadcast();

        // ── L-03: Post-deploy assertions ─────────────────────────────────────
        // These run AFTER the broadcast so they cost no gas but catch construction bugs.
        require(
            address(eurcWethPool).code.length > 0,
            "DeployEurcWethPool: deployment failed -- no bytecode at pool address"
        );
        require(
            eurcWethPool.swapFeeBps() == 30,
            "DeployEurcWethPool: swapFeeBps mismatch"
        );
        require(
            eurcWethPool.owner() == owner,
            "DeployEurcWethPool: owner mismatch"
        );
        require(
            address(eurcWethPool.tokenA()) == eurc,
            "DeployEurcWethPool: tokenA mismatch"
        );
        require(
            address(eurcWethPool.tokenB()) == weth,
            "DeployEurcWethPool: tokenB mismatch"
        );

        console2.log("=== Arcis EURC/WETH V4 Pool Deployed ===");
        console2.log("Deployer:                                   ", deployer);
        console2.log("Owner/Admin:                                ", owner);
        console2.log("Chain ID:                                   ", block.chainid);
        console2.log("EURC (tokenA):                              ", eurc);
        console2.log("WETH (tokenB):                              ", weth);
        console2.log("ConstantProductPoolEurcWethV4 (EURC/WETH):  ", address(eurcWethPool));
        console2.log("Post-deploy assertions: PASSED");
    }
}
