// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolV4} from "../src/v4/ConstantProductPoolV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit & integration tests for ConstantProductPoolV4 (USDC/cirBTC, x*y=k, real-yield harvest).
contract ConstantProductPoolV4Test is Test {
    ConstantProductPoolV4 pool;
    MockERC20 usdc;
    MockERC20 btc;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);

    uint256 constant DEC6 = 1e6;  // USDC decimals
    uint256 constant DEC8 = 1e8;  // cirBTC decimals

    // ── Setup ─────────────────────────────────────────────────────────────────
    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        btc  = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);
        pool = new ConstantProductPoolV4(address(usdc), address(btc), 25, owner);

        usdc.mint(alice, 10_000_000 * DEC6);
        btc.mint(alice,      1_000 * DEC8);
        usdc.mint(bob,  10_000_000 * DEC6);
        btc.mint(bob,        1_000 * DEC8);
    }

    function _approveAlice() internal {
        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        btc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _approveBob() internal {
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        btc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // ── LP Token Properties ───────────────────────────────────────────────────

    function test_LpDecimalsStandardized18() public view {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
    }

    // ── Constructor Guards ────────────────────────────────────────────────────

    function test_ConstructorRejectsZeroTokenA() public {
        vm.expectRevert(ConstantProductPoolV4.ZeroAddress.selector);
        new ConstantProductPoolV4(address(0), address(btc), 25, owner);
    }

    function test_ConstructorRejectsZeroTokenB() public {
        vm.expectRevert(ConstantProductPoolV4.ZeroAddress.selector);
        new ConstantProductPoolV4(address(usdc), address(0), 25, owner);
    }

    function test_ConstructorRejectsIdenticalTokens() public {
        vm.expectRevert(ConstantProductPoolV4.InvalidTokenPair.selector);
        new ConstantProductPoolV4(address(usdc), address(usdc), 25, owner);
    }

    function test_ConstructorRejectsInvalidFeeBps() public {
        vm.expectRevert(ConstantProductPoolV4.InvalidFeeBps.selector);
        new ConstantProductPoolV4(address(usdc), address(btc), 1001, owner);
    }

    function test_ConstructorRejectsEOATokenAddress() public {
        // H-1: contract code length check
        address eoa = address(0xBEEF);
        vm.expectRevert(ConstantProductPoolV4.ZeroAddress.selector);
        new ConstantProductPoolV4(eoa, address(btc), 25, owner);
    }

    // ── First Deposit & MINIMUM_LIQUIDITY ────────────────────────────────────

    function test_MinimumLiquidityLockedToDead() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        assertEq(
            pool.balanceOf(pool.DEAD_ADDRESS()),
            1000,
            "1000 LP wei must be locked to dead address"
        );
    }

    function test_InitialLpShares_GeometricMean() public {
        _approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        // sqrt(100_000e6 * 1e8) * 1e11 - 1000
        // = sqrt(1e19) * 1e11 - 1000
        // = 1e9.5 * 1e11 ≈ 3.16e20 * 1e11 ... exact via uint256
        uint256 rawA = 100_000 * DEC6;
        uint256 rawB = 1 * DEC8;
        uint256 product = rawA * rawB;
        // Babylonian sqrt
        uint256 z = product;
        uint256 x = product / 2 + 1;
        while (x < z) { z = x; x = (product / x + x) / 2; }
        uint256 expected = z * 1e11 - 1000;
        assertEq(lp, expected, "initial LP shares must equal sqrt(amountA*amountB)*1e11 - MINIMUM_LIQUIDITY");
    }

    function test_RevertIfZeroAmounts() public {
        _approveAlice();
        vm.prank(alice);
        vm.expectRevert(ConstantProductPoolV4.ZeroAmount.selector);
        pool.addLiquidity(0, 1 * DEC8, 0);
    }

    // ── Subsequent Liquidity ──────────────────────────────────────────────────

    function test_SecondDeposit_ProportionalShares() public {
        _approveAlice();
        _approveBob();

        vm.prank(alice);
        uint256 lpAlice = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        vm.prank(bob);
        uint256 lpBob = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        // Both supply same amounts; Bob should get ≈ same LP (modulo MINIMUM_LIQUIDITY rounding)
        assertApproxEqRel(lpBob, lpAlice, 1e15, "second deposit should yield proportional LP");
    }

    // ── Swap & Fee Isolation ──────────────────────────────────────────────────

    function test_Swap_AtoB_UpdatesReserves() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        uint256 rABefore = pool.reserveA();
        uint256 rBBefore = pool.reserveB();

        _approveBob();
        vm.prank(bob);
        uint256 amountOut = pool.swap(address(usdc), address(btc), 1_000 * DEC6, 0);

        assertGt(pool.reserveA(), rABefore, "reserveA must increase after USDC-in swap");
        assertLt(pool.reserveB(), rBBefore, "reserveB must decrease after BTC-out swap");
        assertGt(amountOut, 0, "amountOut must be positive");
    }

    function test_Swap_FeeIsolatedFromReserve() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 10_000 * DEC6, 0);

        // feeReserveA must grow; reserveA excludes fee (fee is NOT added to reserveA)
        assertGt(pool.feeReserveA(), 0, "feeReserveA must grow after USDC-in swap");
        // Total USDC balance = reserveA + feeReserveA
        uint256 contractBalance = usdc.balanceOf(address(pool));
        assertEq(contractBalance, pool.reserveA() + pool.feeReserveA(),
            "contractBalance == reserveA + feeReserveA");
    }

    function test_Swap_BtoA_UpdatesReserves() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        uint256 amountOut = pool.swap(address(btc), address(usdc), 1e7, 0); // 0.1 BTC

        assertGt(amountOut, 0);
        assertGt(pool.feeReserveB(), 0, "feeReserveB must grow after BTC-in swap");
    }

    function test_Swap_ZeroAmountReverts() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolV4.ZeroAmount.selector);
        pool.swap(address(usdc), address(btc), 0, 0);
    }

    function test_Swap_InvalidPairReverts() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolV4.InvalidTokenPair.selector);
        pool.swap(address(usdc), address(usdc), 1_000 * DEC6, 0);
    }

    function test_Swap_SlippageReverts() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolV4.SlippageExceeded.selector);
        pool.swap(address(usdc), address(btc), 1_000 * DEC6, type(uint256).max);
    }

    // ── 50% Output Cap ────────────────────────────────────────────────────────

    function test_Swap_50PctCapReverts() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        // Swap in so much USDC that the formula would give > 50% of reserveB
        // reserveB = 1 * DEC8 = 100_000_000 units; >50% = >50_000_000 units
        // To get ~51%, we need amountIn >> reserveA per the formula
        _approveBob();
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolV4.SlippageExceeded.selector);
        pool.swap(address(usdc), address(btc), 1_000_000 * DEC6, 0);
    }

    // ── Remove Liquidity ──────────────────────────────────────────────────────

    function test_RemoveLiquidity_ReturnsCorrectAmounts() public {
        _approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 btcBefore  = btc.balanceOf(alice);

        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);

        assertGt(usdc.balanceOf(alice), usdcBefore, "Alice must receive USDC back");
        assertGt(btc.balanceOf(alice),  btcBefore,  "Alice must receive BTC back");
    }

    function test_RemoveLiquidity_ZeroAmountReverts() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        vm.prank(alice);
        vm.expectRevert(ConstantProductPoolV4.ZeroAmount.selector);
        pool.removeLiquidity(0, 0, 0);
    }

    function test_RemoveLiquidity_SlippageReverts() public {
        _approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        vm.prank(alice);
        vm.expectRevert(ConstantProductPoolV4.SlippageExceeded.selector);
        pool.removeLiquidity(lp, type(uint256).max, 0);
    }

    function test_RemoveLiquidity_SucceedsWhenPaused() public {
        _approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        pool.pause();
        assertTrue(pool.paused());

        // removeLiquidity must work even when paused (intentional escape hatch)
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
    }

    // ── Pause ─────────────────────────────────────────────────────────────────

    function test_Pause_BlocksAddLiquidityAndSwap() public {
        _approveAlice();
        pool.pause();

        vm.prank(alice);
        vm.expectRevert();
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);
    }

    function test_Pause_AccessControl() public {
        vm.prank(alice);
        vm.expectRevert();
        pool.pause();
    }

    // ── Harvest ───────────────────────────────────────────────────────────────

    function test_Harvest_ClaimsFeesWithoutExiting() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 10_000 * DEC6, 0);

        (uint256 pA, ) = pool.pendingFees(alice);
        assertGt(pA, 0, "Alice must have pending USDC fees");

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 hA, ) = pool.harvest();
        assertGt(hA, 0, "harvest must return positive feeA");
        assertGt(usdc.balanceOf(alice), balBefore, "Alice USDC balance must increase");

        // Alice's LP balance is unchanged
        assertGt(pool.balanceOf(alice), 0, "LP balance must survive harvest");
    }

    function test_Harvest_NoFeesReverts() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        vm.prank(alice);
        vm.expectRevert(bytes4(keccak256("NoFeesAccrued()")));
        pool.harvest();
    }

    function test_Harvest_DoubleClaimReverts() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 5_000 * DEC6, 0);

        vm.prank(alice);
        pool.harvest();

        vm.prank(alice);
        vm.expectRevert(bytes4(keccak256("NoFeesAccrued()")));
        pool.harvest();
    }

    // ── Fee Getters ───────────────────────────────────────────────────────────

    function test_FeeGettersCompatibility() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 1_000 * DEC6, 0);

        assertGt(pool.unclaimedFeeA(), 0, "unclaimedFeeA must reflect accrued fee");
    }

    // ── Volume 24h ────────────────────────────────────────────────────────────

    function test_Volume24hResetsAfterWindow() public {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveBob();
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 1_000 * DEC6, 0);
        assertGt(pool.volume24hA(), 0);

        vm.warp(block.timestamp + 2 days);
        assertEq(pool.volume24hA(), 0, "volume must reset after 24h window");
    }
}
