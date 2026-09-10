// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolV2} from "../src/v2/ConstantProductPoolV2.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for ConstantProductPoolV2 (USDC/cirBTC, x*y=k).
/// @dev Covers 18-dec standardization, MINIMUM_LIQUIDITY, slippage guards,
///      backward-compatible overloads and Pausable.
contract ConstantProductPoolV2Test is Test {
    ConstantProductPoolV2 pool;
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
        pool = new ConstantProductPoolV2(address(usdc), address(btc), 25, owner);

        usdc.mint(alice, 100_000 * DEC6);
        btc.mint(alice, 10 * DEC8);
        usdc.mint(bob, 100_000 * DEC6);
        btc.mint(bob, 10 * DEC8);
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

    function test_LpDecimalsStandardized18() public {
        assertEq(pool.decimals(), 18, "cirBTC LP token must be standardized to 18 decimals");
    }

    function test_MinimumLiquidityLockedToDead() public {
        approveAlice();
        vm.prank(alice);
        pool.addLiquidity(10_000 * DEC6, 1 * DEC8, 0);

        assertEq(pool.balanceOf(0x000000000000000000000000000000000000dEaD), 1000,
            "1000 LP must be locked to dead address");
    }

    function test_MinLpSharesGuardReverts() public {
        approveAlice();
        approveBob();
        vm.prank(alice);
        pool.addLiquidity(10_000 * DEC6, 1 * DEC8, 0);

        vm.startPrank(bob);
        vm.expectRevert(ConstantProductPoolV2.SlippageExceeded.selector);
        pool.addLiquidity(1_000 * DEC6, 1e7, type(uint256).max); // 0.1 cirBTC = 1e7 (8-dec)
        vm.stopPrank();
    }

    function test_RemoveLiquidityMinOutGuardReverts() public {
        approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(10_000 * DEC6, 1 * DEC8, 0);

        vm.prank(alice);
        vm.expectRevert(ConstantProductPoolV2.SlippageExceeded.selector);
        pool.removeLiquidity(lp, type(uint256).max, 0);
    }

    function test_RemoveLiquidityZeroSlippagePermitsFullExit() public {
        approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(10_000 * DEC6, 1 * DEC8, 0);

        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0); // 3-arg, no slippage
        assertGt(outA, 0);
        assertGt(outB, 0);
        assertEq(pool.balanceOf(alice), 0, "Alice LP must be fully burned");
        // 1000 LP stay permanently locked to the dead address.
        assertEq(
            pool.balanceOf(0x000000000000000000000000000000000000dEaD),
            1000,
            "Minimum liquidity must remain locked"
        );
    }

    function test_PauseBlocksOperations() public {
        approveAlice();
        pool.pause();
        assertTrue(pool.paused());

        vm.prank(alice);
        vm.expectRevert();
        pool.addLiquidity(10_000 * DEC6, 1 * DEC8, 0);

        pool.unpause();
        vm.prank(alice);
        pool.addLiquidity(10_000 * DEC6, 1 * DEC8, 0);
        assertGt(pool.reserveA(), 0, "must mint after unpause");
    }

    function test_FeeGettersCompatibility() public {
        approveAlice();
        vm.prank(alice);
        pool.addLiquidity(50_000 * DEC6, 1 * DEC8, 0);

        approveBob();
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 1_000 * DEC6, 0);

        assertGt(pool.unclaimedFeeA(), 0, "unclaimedFeeA must reflect accrued fee");
        assertEq(pool.unclaimedFeeA(), pool.accumulatedFeeA(), "unclaimed maps to accumulated");
    }
}