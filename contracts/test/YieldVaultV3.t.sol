// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {YieldVaultV3} from "../src/v3/YieldVaultV3.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for YieldVaultV3 (ERC-4626 + Pausable + real yield distribution).
contract YieldVaultV3Test is Test {
    YieldVaultV3 vault;
    MockERC20 usdc;

    address owner = address(this);
    address alice = address(0x1);

    uint256 constant DEC6 = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new YieldVaultV3(usdc, "Arcis USDC Yield v3", "af-USDC-v3", 100, owner); // 1% perf fee

        usdc.mint(alice, 1_000_000 * DEC6);
        usdc.mint(owner, 1_000_000 * DEC6);
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
        uint256 shares = vault.deposit(100_000 * DEC6, alice);
        vm.stopPrank();

        uint256 baseline = vault.previewRedeem(shares);

        vm.startPrank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vault.distributeYield(100_000 * DEC6);
        vm.stopPrank();

        uint256 redeemed = vault.previewRedeem(shares);
        assertEq(baseline, 100_000 * DEC6, "baseline redeem equals deposit for 1:1 vault");
        assertGt(redeemed, baseline, "previewRedeem must grow after distributeYield");
        assertLt(redeemed, 200_000 * DEC6, "net yield excludes 1% performance fee");
        assertGt(vault.totalYieldDistributed(), 0);
    }
}