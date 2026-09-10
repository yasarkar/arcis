// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {YieldVaultV2} from "../src/v2/YieldVaultV2.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for YieldVaultV2 (ERC-4626 + Pausable + real yield distribution).
contract YieldVaultV2Test is Test {
    YieldVaultV2 vault;
    MockERC20 usdc;

    address owner = address(this);
    address alice = address(0x1);

    uint256 constant DEC6 = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new YieldVaultV2(usdc, "Arcis USDC Yield v2", "af-USDC-v2", 100, owner); // 1% perf fee

        usdc.mint(alice, 100_000 * DEC6);
        usdc.mint(owner, 100_000 * DEC6);
    }

    function test_DepositPaused() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vault.pause();
        assertTrue(vault.paused());

        vm.startPrank(alice);
        vm.expectRevert();
        vault.deposit(1_000 * DEC6, alice);
        vm.stopPrank();

        vault.unpause();
        vm.prank(alice);
        uint256 shares = vault.deposit(1_000 * DEC6, alice);
        assertGt(shares, 0, "deposit must succeed after unpause");
    }

    function test_DistributeYieldIncreasesShareValue() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        uint256 shares = vault.deposit(10_000 * DEC6, alice);
        vm.stopPrank();

        // Baseline redeem value BEFORE any distribution (1:1 vault).
        uint256 baseline = vault.previewRedeem(shares);

        // Owner distributes 10,000 USDC real yield (1% retained).
        vm.startPrank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vault.distributeYield(10_000 * DEC6);
        vm.stopPrank();

        uint256 redeemed = vault.previewRedeem(shares);
        assertEq(baseline, 10_000 * DEC6, "baseline redeem equals deposit for 1:1 vault");
        assertGt(redeemed, baseline, "previewRedeem must grow after distributeYield");
        assertLt(redeemed, 20_000 * DEC6, "net yield excludes 1% performance fee");
        assertGt(vault.totalYieldDistributed(), 0);
    }
}