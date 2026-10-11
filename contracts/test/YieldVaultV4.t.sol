// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {YieldVaultV4} from "../src/v4/YieldVaultV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for YieldVaultV4 (ERC-4626 + Pausable + Harvest + Inflation Guard).
contract YieldVaultV4Test is Test {
    YieldVaultV4 vault;
    MockERC20 usdc;

    address owner = address(this);
    address alice = address(0x1);
    address bob = address(0x2);

    uint256 constant DEC6 = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new YieldVaultV4(usdc, "Arcis USDC Yield v4", "af-USDC-v4", 100, owner); // 1% perf fee

        usdc.mint(alice, 1_000_000 * DEC6);
        usdc.mint(bob, 1_000_000 * DEC6);
        usdc.mint(owner, 1_000_000 * DEC6);
    }

    function test_DecimalsIsNine() public view {
        assertEq(vault.decimals(), 9, "Vault share decimals must be 9 (6 asset decimals + 3 offset)");
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
        assertEq(vault.principalAssets(alice), 1_000 * DEC6, "principalAssets must match deposit");
    }

    function test_GuardedDepositAndRedeem() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);

        uint256 expectedShares = vault.previewDeposit(100 * DEC6);
        // Exceeding minShares should revert
        vm.expectRevert(YieldVaultV4.InsufficientShares.selector);
        vault.depositWithMinShares(100 * DEC6, alice, expectedShares + 1);

        // Exact or less minShares should succeed
        uint256 shares = vault.depositWithMinShares(100 * DEC6, alice, expectedShares);
        assertEq(shares, expectedShares);

        uint256 expectedAssets = vault.previewRedeem(shares);
        // Exceeding minAssets should revert
        vm.expectRevert(YieldVaultV4.InsufficientAssets.selector);
        vault.redeemWithMinAssets(shares, alice, alice, expectedAssets + 1);

        // Exact or less minAssets should succeed
        uint256 assets = vault.redeemWithMinAssets(shares, alice, alice, expectedAssets);
        assertEq(assets, expectedAssets);
        vm.stopPrank();
    }

    function test_DistributeYieldAndHarvest() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vault.deposit(10_000 * DEC6, alice);
        vm.stopPrank();

        assertEq(vault.pendingYield(alice), 0, "Initial pending yield should be 0");

        // Owner distributes 1,000 USDC yield
        vm.startPrank(owner);
        usdc.approve(address(vault), type(uint256).max);
        vault.distributeYield(1_000 * DEC6);
        vm.stopPrank();

        // 1% fee taken, 990 USDC distributed to vault
        assertEq(vault.totalYieldDistributed(), 990 * DEC6);
        uint256 pending = vault.pendingYield(alice);
        assertGt(pending, 0, "Pending yield must be positive after distribution");

        // Alice harvests yield
        uint256 balanceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 harvested = vault.harvest();
        uint256 balanceAfter = usdc.balanceOf(alice);

        assertGt(harvested, 0, "Harvested amount must be > 0");
        assertEq(balanceAfter - balanceBefore, harvested, "Alice must receive harvested USDC");
        assertLe(vault.pendingYield(alice), 1, "Pending yield should reset to near 0 after harvest");
    }

    function test_ShareTransferTransfersPrincipalCostBasis() public {
        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        uint256 shares = vault.deposit(10_000 * DEC6, alice);
        assertEq(vault.principalAssets(alice), 10_000 * DEC6);

        // Transfer half shares to Bob
        vault.transfer(bob, shares / 2);
        vm.stopPrank();

        assertApproxEqAbs(vault.principalAssets(alice), 5_000 * DEC6, 1);
        assertApproxEqAbs(vault.principalAssets(bob), 5_000 * DEC6, 1);
    }
}
