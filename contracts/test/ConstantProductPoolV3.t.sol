// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolV3} from "../src/v3/ConstantProductPoolV3.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for ConstantProductPoolV3 (USDC/cirBTC, x*y=k).
/// @dev Ported from V2 + degenerate-pair guard coverage.
contract ConstantProductPoolV3Test is Test {
    ConstantProductPoolV3 pool;
    MockERC20 usdc;
    MockERC20 btc;

    address owner = address(this);
    address alice = address(0x1);
    address bob = address(0x2);

    uint256 constant DEC6 = 1e6;
    uint256 constant DEC8 = 1e8;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        btc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);
        pool = new ConstantProductPoolV3(address(usdc), address(btc), 25, owner);

        usdc.mint(alice, 1_000_000 * DEC6);
        btc.mint(alice, 100 * DEC8);
        usdc.mint(bob, 1_000_000 * DEC6);
        btc.mint(bob, 100 * DEC8);
    }

    function approveAlice() internal {
        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        btc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function approveBob() internal {
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        btc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_LpDecimalsStandardized18() public view {
        assertEq(pool.decimals(), 18, "cirBTC LP token must be standardized to 18 decimals");
    }

    function test_RevertDegenerateTokenPair() public {
        vm.expectRevert(ConstantProductPoolV3.InvalidTokenPair.selector);
        new ConstantProductPoolV3(address(usdc), address(usdc), 25, owner);
    }

    function test_MinimumLiquidityLockedToDead() public {
        approveAlice();
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        assertEq(pool.balanceOf(0x000000000000000000000000000000000000dEaD), 1000,
            "1000 LP must be locked to dead address");
    }

    function test_MinLpSharesGuardReverts() public {
        approveAlice();
        approveBob();
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        vm.startPrank(bob);
        vm.expectRevert(ConstantProductPoolV3.SlippageExceeded.selector);
        pool.addLiquidity(1_000 * DEC6, 1e7, type(uint256).max); // 0.1 cirBTC = 1e7 (8-dec)
        vm.stopPrank();
    }

    function test_PauseBlocksOperations() public {
        approveAlice();
        pool.pause();
        assertTrue(pool.paused());

        vm.prank(alice);
        vm.expectRevert();
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        pool.unpause();
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);
        assertGt(pool.reserveA(), 0, "must mint after unpause");
    }

    function test_FeeGettersCompatibility() public {
        approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 1 * DEC8, 0);

        approveBob();
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 1_000 * DEC6, 0);

        assertGt(pool.unclaimedFeeA(), 0, "unclaimedFeeA must reflect accrued fee");
        assertEq(pool.unclaimedFeeA(), pool.accumulatedFeeA(), "unclaimed maps to accumulated");
    }
}