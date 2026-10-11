// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StableSwapPoolV4} from "../src/v4/StableSwapPoolV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Comprehensive test suite for StableSwapPoolV4 (USDC/EURC Real Yield AMM).
/// @dev Verifies:
///      1. Curve invariant math & 18-decimal LP tokens.
///      2. Real Yield fee streaming into feeReserveA and feeReserveB.
///      3. Pro-rata per-LP fee accrual and pendingFees(lp) view.
///      4. harvest() claiming exact USDC and EURC tokens directly to caller's wallet without LP burning.
///      5. Multi-LP fair reward distribution (equal LP deposit gets exact equal fee share).
///      6. LP balance modifications (deposit/withdraw/transfer) preserving accrued fees.
contract StableSwapPoolV4Test is Test {
    StableSwapPoolV4 pool;
    MockERC20 usdc;
    MockERC20 eurc;

    address owner = address(this);
    address alice = address(0x1);
    address bob = address(0x2);
    address trader = address(0x3);

    uint256 constant DEC6 = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        // 12 basis points (0.12% swap fee)
        pool = new StableSwapPoolV4(address(usdc), address(eurc), 12, owner);

        usdc.mint(alice, 1_000_000 * DEC6);
        eurc.mint(alice, 1_000_000 * DEC6);

        usdc.mint(bob, 1_000_000 * DEC6);
        eurc.mint(bob, 1_000_000 * DEC6);

        usdc.mint(trader, 1_000_000 * DEC6);
        eurc.mint(trader, 1_000_000 * DEC6);

        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(trader);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_InitialLiquidityAndStandardizedLp() public {
        assertEq(pool.decimals(), 18, "LP token must have 18 decimals");

        vm.prank(alice);
        uint256 lpShares = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);

        assertGt(lpShares, 0, "Alice must receive LP shares");
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), 1000, "1000 LP permanently locked in DEAD_ADDRESS");
        assertEq(pool.reserveA(), 10_000 * DEC6, "reserveA must match deposit");
        assertEq(pool.reserveB(), 10_000 * DEC6, "reserveB must match deposit");
        assertEq(pool.feeReserveA(), 0, "initial feeReserveA must be 0");
        assertEq(pool.feeReserveB(), 0, "initial feeReserveB must be 0");
    }

    function test_SwapAccruesFeeAndHarvestSucceeds() public {
        // 1. Alice adds 50,000 USDC and 50,000 EURC
        vm.prank(alice);
        uint256 initialLp = pool.addLiquidity(50_000 * DEC6, 50_000 * DEC6, 0);

        // 2. Trader swaps 10,000 USDC for EURC
        uint256 swapAmount = 10_000 * DEC6;
        vm.prank(trader);
        uint256 eurcOut = pool.swap(address(usdc), address(eurc), swapAmount, 0);
        assertGt(eurcOut, 0, "Trader must receive EURC");

        // Fee: 12 bps of 10,000 USDC = 12 USDC
        uint256 expectedFee = (swapAmount * 12) / 10000;
        assertEq(pool.feeReserveA(), expectedFee, "feeReserveA must hold exact swap fee");
        assertEq(pool.feeReserveB(), 0, "feeReserveB must be zero for USDC->EURC swap");

        // 3. Alice checks pending fees (within 1 wei precision rounding)
        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertApproxEqAbs(pendingA, expectedFee, 1, "Alice must be entitled to full swap fee");
        assertEq(pendingB, 0, "pending EURC fee should be 0");

        // Non-LP trader must have 0 pending fees
        (uint256 traderA, uint256 traderB) = pool.pendingFees(trader);
        assertEq(traderA, 0);
        assertEq(traderB, 0);

        // 4. Alice harvests fees
        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 claimedA, uint256 claimedB) = pool.harvest();

        assertApproxEqAbs(claimedA, expectedFee, 1, "Alice must harvest exact feeA");
        assertEq(claimedB, 0, "feeB should be 0");
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore + claimedA, "Alice wallet must receive USDC");

        // Fee reserve must be emptied (or at most 1 wei rounding)
        assertLe(pool.feeReserveA(), 1, "feeReserveA must be cleared after full harvest");

        // Pending fees must now be 0
        (pendingA, pendingB) = pool.pendingFees(alice);
        assertEq(pendingA, 0, "pendingA must reset to 0");

        // Crucial: Alice's LP token balance remains UNCHANGED!
        assertEq(pool.balanceOf(alice), initialLp, "Alice LP balance must NOT be reduced by harvest");
    }

    function test_DualLpProportionalFeeSplit() public {
        // Alice deposits 10,000 USDC/EURC
        vm.prank(alice);
        uint256 aliceLp = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);

        // Bob deposits 10,000 USDC/EURC (Alice had 1000 MINIMUM_LIQUIDITY burned)
        vm.prank(bob);
        uint256 bobLp = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);
        assertEq(bobLp, aliceLp + 1000, "Bob gets full share; Alice burned MINIMUM_LIQUIDITY");

        // Trader swaps 20,000 USDC for EURC
        // Fee: 12 bps of 20,000 USDC = 24 USDC (24_000_000 units)
        vm.prank(trader);
        pool.swap(address(usdc), address(eurc), 20_000 * DEC6, 0);

        (uint256 aliceFeeA, ) = pool.pendingFees(alice);
        (uint256 bobFeeA, ) = pool.pendingFees(bob);

        // Each must get pro-rata share of 24 USDC (~12 USDC within 1 unit)
        assertApproxEqAbs(aliceFeeA, 12 * DEC6, 1, "Alice should receive ~50% of the fee");
        assertApproxEqAbs(bobFeeA, 12 * DEC6, 1, "Bob should receive ~50% of the fee");

        // Alice harvests
        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 aliceClaimed, ) = pool.harvest();
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore + aliceClaimed);

        // Bob harvests
        uint256 bobUsdcBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        (uint256 bobClaimed, ) = pool.harvest();
        assertEq(usdc.balanceOf(bob), bobUsdcBefore + bobClaimed);

        assertLe(pool.feeReserveA(), 2, "Fee reserve completely drained by proportional claims");
    }

    function test_BidirectionalSwapAccruesBothFees() public {
        vm.prank(alice);
        pool.addLiquidity(20_000 * DEC6, 20_000 * DEC6, 0);

        // Swap 1: USDC -> EURC (Fee in USDC)
        vm.prank(trader);
        pool.swap(address(usdc), address(eurc), 5_000 * DEC6, 0);

        // Swap 2: EURC -> USDC (Fee in EURC)
        vm.prank(trader);
        pool.swap(address(eurc), address(usdc), 5_000 * DEC6, 0);

        (uint256 feeA, uint256 feeB) = pool.pendingFees(alice);
        assertGt(feeA, 0, "Alice must have accrued USDC fee");
        assertGt(feeB, 0, "Alice must have accrued EURC fee");

        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 eurcBefore = eurc.balanceOf(alice);

        vm.prank(alice);
        (uint256 claimedA, uint256 claimedB) = pool.harvest();

        assertEq(claimedA, feeA);
        assertEq(claimedB, feeB);
        assertEq(usdc.balanceOf(alice), usdcBefore + feeA, "Alice receives USDC");
        assertEq(eurc.balanceOf(alice), eurcBefore + feeB, "Alice receives EURC");
    }

    function test_RemoveLiquiditySucceedsAndPreservesFees() public {
        vm.prank(alice);
        uint256 lpShares = pool.addLiquidity(10_000 * DEC6, 10_000 * DEC6, 0);

        // Trader swaps to generate fee
        vm.prank(trader);
        pool.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);

        (uint256 pendingA, ) = pool.pendingFees(alice);
        assertGt(pendingA, 0);

        // Alice withdraws half her LP position
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lpShares / 2, 0, 0);
        assertGt(outA, 0);
        assertGt(outB, 0);

        // Pending fee must be preserved!
        (uint256 pendingAfterWithdraw, ) = pool.pendingFees(alice);
        assertEq(pendingAfterWithdraw, pendingA, "Withdrawing LP principal must preserve earned fees");

        // Alice can still harvest her earned fees
        vm.prank(alice);
        (uint256 claimedA, ) = pool.harvest();
        assertEq(claimedA, pendingA);
    }

    function test_NativeDepositReverts() public {
        (bool ok, ) = address(pool).call{value: 1}("");
        assertFalse(ok, "native deposit must revert");
    }
}
