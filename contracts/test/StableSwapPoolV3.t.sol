// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StableSwapPoolV3} from "../src/v3/StableSwapPoolV3.sol";
import {StableSwapPool} from "../src/StableSwapPool.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for StableSwapPoolV3 (USDC/EURC, Curve invariant, canonical Ann = A*4).
/// @dev Covers: MINIMUM_LIQUIDITY, minLpShares / minOut guards, backward-compatible 2-arg
///      overloads, Pausable, degenerate-pair guard, and canonical V3 == V1 (A*4) parity.
contract StableSwapPoolV3Test is Test {
    StableSwapPoolV3 pool;
    StableSwapPool poolV1;
    MockERC20 usdc;
    MockERC20 eurc;

    address owner = address(this);
    address alice = address(0x1);
    address bob = address(0x2);

    uint256 constant DEC6 = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        pool = new StableSwapPoolV3(address(usdc), address(eurc), 12, owner);
        poolV1 = new StableSwapPool(address(usdc), address(eurc), 12);

        usdc.mint(alice, 1_000_000 * DEC6);
        eurc.mint(alice, 1_000_000 * DEC6);
        usdc.mint(bob, 1_000_000 * DEC6);
        eurc.mint(bob, 1_000_000 * DEC6);
    }

    function approveAlice() internal {
        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        usdc.approve(address(poolV1), type(uint256).max);
        eurc.approve(address(poolV1), type(uint256).max);
        vm.stopPrank();
    }

    function approveBob() internal {
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        usdc.approve(address(poolV1), type(uint256).max);
        eurc.approve(address(poolV1), type(uint256).max);
        vm.stopPrank();
    }

    function test_LpDecimalsStandardized() public {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
    }

    function test_RevertDegenerateTokenPair() public {
        vm.expectRevert(StableSwapPoolV3.InvalidTokenPair.selector);
        new StableSwapPoolV3(address(usdc), address(usdc), 12, owner);
    }

    function test_MinimumLiquidityLockedToDead() public {
        approveAlice();
        vm.prank(alice);
        pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);

        assertEq(pool.balanceOf(0x000000000000000000000000000000000000dEaD), 1000,
            "1000 LP must be permanently locked to dead address");
    }

    function test_AddLiquidityMinLpGuardReverts() public {
        approveAlice();
        approveBob();
        vm.prank(alice);
        pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);

        // Unreachably high minLpShares must trigger SlippageExceeded.
        vm.startPrank(bob);
        vm.expectRevert(StableSwapPoolV3.SlippageExceeded.selector);
        pool.addLiquidity(1_000 * DEC6, 1_000 * DEC6, type(uint256).max);
        vm.stopPrank();
    }

    function test_RemoveLiquidityMinOutGuardReverts() public {
        approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);

        vm.prank(alice);
        vm.expectRevert(StableSwapPoolV3.SlippageExceeded.selector);
        pool.removeLiquidity(lp, type(uint256).max, 0);
    }

    function test_RemoveLiquidityZeroSlippagePermitsFullExit() public {
        approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);

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

    function test_PauseBlocksLiquidity() public {
        approveAlice();
        pool.pause();
        assertTrue(pool.paused(), "pool must be paused");

        vm.prank(alice);
        vm.expectRevert();
        pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);

        pool.unpause();
        assertFalse(pool.paused(), "pool must be unpaused");
        vm.prank(alice);
        pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);
    }

    function test_FeeGettersCompatibility() public {
        approveAlice();
        vm.prank(alice);
        pool.addLiquidity(50_000 * DEC6, 50_000 * DEC6, 0);

        approveBob();
        vm.prank(bob);
        pool.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);

        assertGt(pool.unclaimedFeeA(), 0, "unclaimedFeeA must reflect accrued fee");
        assertEq(pool.unclaimedFeeA(), pool.accumulatedFeeA(), "unclaimed maps to accumulated");
    }

    /// @notice H-1 canonical parity: V3 (Ann = A*4) matches V1 (Ann = A*4) on identical
    ///         reserves, proving V3 restores the canonical Curve pricing that V2 (A*2) changed.
    function test_CanonicalParityWithV1() public {
        approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 500_000 * DEC6, 0);
        vm.prank(alice);
        poolV1.addLiquidity(500_000 * DEC6, 500_000 * DEC6);

        assertEq(pool.reserveA(), poolV1.reserveA(), "reserveA identical");
        assertEq(pool.reserveB(), poolV1.reserveB(), "reserveB identical");

        approveBob();
        vm.prank(bob);
        uint256 outV3 = pool.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);
        vm.prank(bob);
        uint256 outV1 = poolV1.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);

        assertEq(outV3, outV1, "V3 (A*4) swap output must equal canonical V1 (A*4)");
        assertLt(outV3, 1_000 * DEC6, "sanity: still below 1:1 due to 0.12% fee");
    }
}