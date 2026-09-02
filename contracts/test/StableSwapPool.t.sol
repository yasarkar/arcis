// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StableSwapPool} from "../src/StableSwapPool.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for StableSwapPool (USDC/EURC constant-sum).
contract StableSwapPoolTest is Test {
    StableSwapPool pool;
    MockERC20 usdc;
    MockERC20 eurc;

    address alice = address(0x1);
    address bob = address(0x2);

    uint256 constant DEC6 = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        pool = new StableSwapPool(address(usdc), address(eurc), 12); // 0.12%

        usdc.mint(alice, 100_000 * DEC6);
        eurc.mint(alice, 100_000 * DEC6);
        usdc.mint(bob, 100_000 * DEC6);
        eurc.mint(bob, 100_000 * DEC6);
    }

    function approveAll() internal {
        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_InitialLiquidity() public {
        approveAll();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6);
        assertGt(lp, 0, "Should mint LP");
        assertEq(pool.reserveA(), 10_000 * DEC6);
        assertEq(pool.reserveB(), 10_000 * DEC6);
    }

    function test_AddSecondDeposit() public {
        approveAll();
        vm.prank(alice);
        pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6);
        uint256 totalBefore = pool.totalLp();
        vm.prank(bob);
        uint256 lp = pool.addLiquidity(1_000 * DEC6, 1_000 * DEC6);
        assertEq(lp, totalBefore / 10, "10% of pool for 10% value");
    }

    function test_SwapStable() public {
        approveAll();
        vm.prank(alice);
        pool.addLiquidity(50_000 * DEC6, 50_000 * DEC6);

        uint256 eurcBefore = eurc.balanceOf(bob);
        vm.prank(bob);
        uint256 out = pool.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);

        // ~1:1 swap with 0.12% fee
        assertGt(out, 990 * DEC6, "~0.12% fee means out ~998.80 EURC");
        assertLt(out, 1_000 * DEC6);
        assertEq(eurc.balanceOf(bob), eurcBefore + out);
    }

    function test_UnclaimedFeeAccrues() public {
        approveAll();
        vm.prank(alice);
        pool.addLiquidity(50_000 * DEC6, 50_000 * DEC6);

        vm.prank(bob);
        pool.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);

        assertGt(pool.unclaimedFeeA(), 0, "Fee should accrue");
    }

    function test_BalanceOfTracking() public {
        approveAll();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6);
        assertEq(pool.balanceOf(alice), lp, "Alice balance should equal minted LP");

        vm.prank(alice);
        pool.removeLiquidity(lp / 2);
        assertEq(pool.balanceOf(alice), lp / 2, "Alice balance should decrease after withdraw");
    }

    function test_CannotWithdrawMoreThanBalance() public {
        approveAll();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6);

        // Bob tries to remove Alice's liquidity
        vm.prank(bob);
        vm.expectRevert();
        pool.removeLiquidity(lp);
    }

    function test_NativeReceiveReverts() public {
        (bool ok,) = address(pool).call{value: 1}("");
        assertFalse(ok, "native deposit must revert");
    }
}