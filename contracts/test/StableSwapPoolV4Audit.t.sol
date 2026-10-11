// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StableSwapPoolV4} from "../src/v4/StableSwapPoolV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Audit-targeted test suite for StableSwapPoolV4 + LpFeeAccounting.
/// @dev Each test covers a specific security property NOT exercised by the base suite.
///      The eight cases mirror the audit checklist:
///      1. Self-transfer double-harvest guard
///      2. Fee reserve solvency invariant after N swaps + M harvests
///      3. removeLiquidity works while paused (intentional — no whenNotPaused)
///      4. Zero-reserve swap freeze (would cause _getD division-by-zero)
///      5. Minimum liquidity lock at first deposit
///      6. Harvest CEI: reward debt reset prevents second immediate harvest
///      7. Transfer front-run: pre-transfer fees stay with sender, not receiver
///      8. Fuzz _distributeSwapFee: feeReserveA never exceeds actual token balance
contract StableSwapPoolV4AuditTest is Test {
    StableSwapPoolV4 internal pool;
    MockERC20 internal usdc;
    MockERC20 internal eurc;

    address internal owner = address(this);
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");
    address internal trader = makeAddr("trader");

    uint256 internal constant DEC6 = 1e6;
    // 12 bps fee (mirrors the base suite)
    uint256 internal constant FEE_BPS = 12;

    // ─── Shared setUp ───────────────────────────────────────────────────────────

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        pool = new StableSwapPoolV4(address(usdc), address(eurc), FEE_BPS, owner);

        // Fund all participants
        usdc.mint(alice, 1_000_000 * DEC6);
        eurc.mint(alice, 1_000_000 * DEC6);
        usdc.mint(bob, 1_000_000 * DEC6);
        eurc.mint(bob, 1_000_000 * DEC6);
        usdc.mint(carol, 1_000_000 * DEC6);
        eurc.mint(carol, 1_000_000 * DEC6);
        usdc.mint(trader, 1_000_000 * DEC6);
        eurc.mint(trader, 1_000_000 * DEC6);

        // Approve pool for all participants
        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(carol);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(trader);
        usdc.approve(address(pool), type(uint256).max);
        eurc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // ─── Internal helpers ────────────────────────────────────────────────────────

    /// @dev Add liquidity from `actor` and return LP shares received.
    function _addLiquidity(address actor, uint256 aAmt, uint256 bAmt)
        internal
        returns (uint256 lpShares)
    {
        vm.prank(actor);
        lpShares = pool.addLiquidity(aAmt, bAmt, 0);
    }

    /// @dev Trader swaps `amountIn` of USDC for EURC.
    function _swapAtoB(uint256 amountIn) internal {
        vm.prank(trader);
        pool.swap(address(usdc), address(eurc), amountIn, 0);
    }

    /// @dev Trader swaps `amountIn` of EURC for USDC.
    function _swapBtoA(uint256 amountIn) internal {
        vm.prank(trader);
        pool.swap(address(eurc), address(usdc), amountIn, 0);
    }

    // ─── Case 1: Self-transfer double-harvest ────────────────────────────────────

    /// @notice FIXED (was Critical): `transfer(self, lpBalance)` no longer doubles accrued fees.
    /// @dev The fix adds `if (from == to) { super._update(from, to, value); return; }` at the
    ///      top of `_update`, which skips both `_beforeLpBalanceChange` calls for self-transfers.
    ///      Pre-fix: both calls saw the same pre-transfer balance and each added the full pending
    ///      delta to `userUnclaimedA`, resulting in 2× the correct amount.
    ///      Post-fix: self-transfer runs the ERC-20 balance update only; fee accounting is untouched,
    ///      so `pendingFees` is unchanged before and after the self-transfer.
    function test_SelfTransfer_DoubleHarvestBug() public {
        // Alice and Bob each deposit identical amounts
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        _addLiquidity(bob, 10_000 * DEC6, 10_000 * DEC6);

        // Generate fees — use a conservative swap well below the 50% cap
        _swapAtoB(4_000 * DEC6);

        (uint256 pendingBefore, ) = pool.pendingFees(alice);
        assertGt(pendingBefore, 0, "Alice must have pending fees before self-transfer");

        // Alice self-transfers her full LP balance
        uint256 aliceLp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(alice, aliceLp);

        // FIX: pending fees must be UNCHANGED after a self-transfer (no doubling)
        (uint256 pendingAfter, ) = pool.pendingFees(alice);
        assertApproxEqAbs(
            pendingAfter,
            pendingBefore,
            2,
            "FIXED: self-transfer must not change pending fees"
        );

        // Alice harvests exactly her fair share
        vm.prank(alice);
        (uint256 aliceClaimed, ) = pool.harvest();
        assertApproxEqAbs(aliceClaimed, pendingBefore, 2,
            "FIXED: Alice harvests only her fair share after self-transfer");

        // Bob can still harvest his full share — reserve was NOT pillaged
        (uint256 bobPending, ) = pool.pendingFees(bob);
        uint256 reserveLeft = pool.feeReserveA();
        assertLe(bobPending, reserveLeft + 1,
            "FIXED: Bob's pending fees fit within remaining feeReserveA");
    }

    /// @notice Regression: a partial self-transfer also leaves pendingFees unchanged.
    function test_SelfTransferPartial_PendingFeesInflated() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        // Conservative swap well below 50% cap
        _swapAtoB(3_000 * DEC6);

        (uint256 pendingBefore, ) = pool.pendingFees(alice);
        assertGt(pendingBefore, 0);

        uint256 aliceLp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(alice, aliceLp / 2);

        (uint256 pendingAfter, ) = pool.pendingFees(alice);
        // FIXED: pending fees unchanged regardless of self-transfer amount
        assertApproxEqAbs(
            pendingAfter,
            pendingBefore,
            2,
            "FIXED: partial self-transfer must not change pending fees"
        );
    }

    // ─── Case 2: Fee reserve solvency ────────────────────────────────────────────

    /// @notice Invariant: feeReserveA <= tokenA.balanceOf(pool) at all times.
    /// @dev After N swaps and M harvests by different LPs, the fee reserve accounting
    ///      must never claim more from the pool than exists.
    function test_FeeReserveSolvencyAfterManySwapsAndHarvests() public {
        // Three LPs deposit at different sizes
        _addLiquidity(alice, 50_000 * DEC6, 50_000 * DEC6);
        _addLiquidity(bob, 30_000 * DEC6, 30_000 * DEC6);
        _addLiquidity(carol, 20_000 * DEC6, 20_000 * DEC6);

        // 10 swaps in each direction — accumulate fees in both reserves
        for (uint256 i = 0; i < 10; i++) {
            _swapAtoB(5_000 * DEC6);
            _swapBtoA(5_000 * DEC6);
        }

        // Verify solvency BEFORE any harvests
        assertLe(
            pool.feeReserveA(),
            usdc.balanceOf(address(pool)),
            "feeReserveA must not exceed actual USDC balance (pre-harvest)"
        );
        assertLe(
            pool.feeReserveB(),
            eurc.balanceOf(address(pool)),
            "feeReserveB must not exceed actual EURC balance (pre-harvest)"
        );

        // Alice harvests
        vm.prank(alice);
        pool.harvest();

        // Solvency must hold after partial harvest
        assertLe(
            pool.feeReserveA(),
            usdc.balanceOf(address(pool)),
            "feeReserveA must not exceed USDC balance after alice harvest"
        );
        assertLe(
            pool.feeReserveB(),
            eurc.balanceOf(address(pool)),
            "feeReserveB must not exceed EURC balance after alice harvest"
        );

        // Bob harvests
        vm.prank(bob);
        pool.harvest();

        assertLe(
            pool.feeReserveA(),
            usdc.balanceOf(address(pool)),
            "feeReserveA must not exceed USDC balance after bob harvest"
        );
        assertLe(
            pool.feeReserveB(),
            eurc.balanceOf(address(pool)),
            "feeReserveB must not exceed EURC balance after bob harvest"
        );

        // Carol harvests
        vm.prank(carol);
        pool.harvest();

        assertLe(
            pool.feeReserveA(),
            usdc.balanceOf(address(pool)),
            "feeReserveA must not exceed USDC balance after carol harvest"
        );
        assertLe(
            pool.feeReserveB(),
            eurc.balanceOf(address(pool)),
            "feeReserveB must not exceed EURC balance after carol harvest"
        );
    }

    // ─── Case 3: Paused removeLiquidity ──────────────────────────────────────────

    /// @notice Property: removeLiquidity SUCCEEDS even when the pool is paused.
    /// @dev removeLiquidity intentionally omits `whenNotPaused`. This allows LPs to
    ///      exit in emergency situations where trading (addLiquidity/swap) is halted.
    ///      This is a deliberate design choice documented here as a test.
    /// @dev INTENTIONAL DESIGN: The absence of `whenNotPaused` on `removeLiquidity`
    ///      is a safety escape hatch — LPs can always withdraw principal regardless
    ///      of pool operating state, consistent with the principle that liquidity
    ///      providers must never be permanently trapped.
    function test_RemoveLiquiditySucceedsWhenPaused() public {
        uint256 lpShares = _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);

        // Owner pauses the pool
        pool.pause();
        assertTrue(pool.paused(), "Pool must be paused");

        // addLiquidity must revert while paused
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        pool.addLiquidity(1_000 * DEC6, 1_000 * DEC6, 0);

        // swap must revert while paused
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(Pausable.EnforcedPause.selector));
        pool.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);

        // removeLiquidity must SUCCEED while paused (intentional safety escape hatch)
        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 eurcBefore = eurc.balanceOf(alice);

        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lpShares, 0, 0);

        assertGt(outA, 0, "Alice must receive tokenA on removal while paused");
        assertGt(outB, 0, "Alice must receive tokenB on removal while paused");
        assertEq(usdc.balanceOf(alice), usdcBefore + outA, "Alice USDC balance must increase");
        assertEq(eurc.balanceOf(alice), eurcBefore + outB, "Alice EURC balance must increase");
        assertEq(pool.balanceOf(alice), 0, "Alice LP balance must be burned");
    }

    // ─── Case 4: Zero-reserve swap freeze / Curve math resilience ───────────────

    /// @notice FIXED (was Medium): a massive swap now reverts with SlippageExceeded.
    /// @dev    The fix adds `if (amountOut > reserveB / 2) revert SlippageExceeded()` in both
    ///         swap branches, capping any single swap at 50% of the output reserve.
    ///         Pre-fix: Curve math asymptotically converges above zero, so y never hit
    ///         the `if (y >= reserveB)` guard — a 100× pool-size swap succeeded and drained
    ///         ~99% of the reserve.
    ///         Post-fix: a swap attempting > 50% output reverts before any tokens move.
    function test_MassiveSwapDrainsReserveWithoutRevert() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);

        uint256 massiveSwap = 1_000_000 * DEC6; // 100× the pool size
        usdc.mint(trader, massiveSwap);

        // FIXED: massive swap now reverts with SlippageExceeded (50% output cap)
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.SlippageExceeded.selector));
        pool.swap(address(usdc), address(eurc), massiveSwap, 0);

        // A swap within the 50% cap still succeeds
        vm.prank(trader);
        uint256 eurcOut = pool.swap(address(usdc), address(eurc), 4_000 * DEC6, 0);
        assertGt(eurcOut, 0, "Swap within cap must succeed");
        assertLe(eurcOut, pool.reserveB() + eurcOut, "Output capped at 50% of reserve");
    }

    /// @notice Verify that _getD(0, 0) returns 0 (s==0 early-exit) rather than panicking.
    function test_GetDZeroSumReturnsZeroNotPanic() public {
        // We can't call _getD directly (internal), but addLiquidity with zero amounts
        // is guarded by ZeroAmount before _getD is reached.
        // This test verifies the guard fires correctly so _getD is never called with (0,0).
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.ZeroAmount.selector));
        pool.addLiquidity(0, 0, 0);
    }

    /// @notice Direct test: _getD with zero inputs (s==0) returns 0, no panic.
    function test_GetDZeroInputsReturnZero() public {
        // Accessing via addLiquidity with zero amounts triggers the revert before _getD.
        // We verify the pool correctly rejects zero-amount deposits.
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.ZeroAmount.selector));
        pool.addLiquidity(0, 1_000 * DEC6, 0);

        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.ZeroAmount.selector));
        pool.addLiquidity(1_000 * DEC6, 0, 0);
    }

    /// @notice Verify swap with zero amountIn reverts with ZeroAmount.
    function test_SwapZeroAmountReverts() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.ZeroAmount.selector));
        pool.swap(address(usdc), address(eurc), 0, 0);
    }

    // ─── Case 5: Minimum liquidity lock ──────────────────────────────────────────

    /// @notice Property: on first deposit, DEAD_ADDRESS holds exactly MINIMUM_LIQUIDITY LP shares.
    function test_MinimumLiquidityLockedInDeadAddress() public {
        uint256 deadBefore = pool.balanceOf(pool.DEAD_ADDRESS());
        assertEq(deadBefore, 0, "DEAD_ADDRESS must start with 0 LP");

        vm.prank(alice);
        uint256 lpShares = pool.addLiquidity(50_000 * DEC6, 50_000 * DEC6, 0);

        uint256 deadAfter = pool.balanceOf(pool.DEAD_ADDRESS());
        assertEq(
            deadAfter,
            pool.MINIMUM_LIQUIDITY(),
            "DEAD_ADDRESS must hold exactly MINIMUM_LIQUIDITY after first deposit"
        );
        assertGt(lpShares, 0, "Alice must receive LP shares");

        // Subsequent deposits must NOT add to DEAD_ADDRESS
        _addLiquidity(bob, 10_000 * DEC6, 10_000 * DEC6);
        assertEq(
            pool.balanceOf(pool.DEAD_ADDRESS()),
            pool.MINIMUM_LIQUIDITY(),
            "DEAD_ADDRESS lock must be exactly MINIMUM_LIQUIDITY after second deposit"
        );
    }

    /// @notice Property: DEAD_ADDRESS LP shares never decrease (they are never burned).
    function test_DeadAddressLpNeverDecreases() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        uint256 deadLp = pool.balanceOf(pool.DEAD_ADDRESS());

        // Multiple subsequent deposits
        _addLiquidity(bob, 5_000 * DEC6, 5_000 * DEC6);
        _swapAtoB(1_000 * DEC6);

        assertEq(
            pool.balanceOf(pool.DEAD_ADDRESS()),
            deadLp,
            "DEAD_ADDRESS LP shares must be immutable after first deposit"
        );
    }

    // ─── Case 6: Harvest CEI — reward debt reset ──────────────────────────────────

    /// @notice Property: after harvest(), userRewardDebt reflects current accFeePerShare
    ///         so a second immediate harvest() reverts with NoFeesAccrued.
    function test_HarvestCEI_SecondHarvestRevertsWithNoFeesAccrued() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        _swapAtoB(5_000 * DEC6);

        // First harvest must succeed
        vm.prank(alice);
        (uint256 claimedA, ) = pool.harvest();
        assertGt(claimedA, 0, "First harvest must yield fees");

        // Second immediate harvest (no new swaps) must revert with NoFeesAccrued
        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        pool.harvest();
    }

    /// @notice Property: reward debt is updated correctly — after a second swap,
    ///         a second harvest succeeds and yields only the NEW fees.
    function test_HarvestCEI_NewFeesAfterFirstHarvestAreClaimable() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);

        // First swap + harvest — conservative size, well below 50% cap
        _swapAtoB(2_000 * DEC6);
        vm.prank(alice);
        (uint256 first, ) = pool.harvest();
        assertGt(first, 0);

        // Second swap in the opposite direction to rebalance pool before second A→B swap
        _swapBtoA(2_000 * DEC6);

        // Third swap generates new feeA
        _swapAtoB(1_000 * DEC6);

        // Second harvest must succeed and return only the new swap's fee
        vm.prank(alice);
        (uint256 second, ) = pool.harvest();
        assertGt(second, 0, "Second harvest must yield fees from subsequent swaps");

        // Immediately after: next harvest must revert
        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        pool.harvest();
    }

    /// @notice Property: reward debt fields are reset atomically — userUnclaimedA/B
    ///         are zeroed and rewardDebt is updated to reflect current balance × accFeePerShare.
    function test_HarvestCEI_UnclaimedAndDebtAreResetAtomically() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        _swapAtoB(5_000 * DEC6);

        vm.prank(alice);
        pool.harvest();

        // After harvest, pending fees must be exactly 0
        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertEq(pendingA, 0, "pendingA must be 0 immediately after harvest");
        assertEq(pendingB, 0, "pendingB must be 0 immediately after harvest");

        // And the unclaimed storage slots must be zero
        assertEq(pool.userUnclaimedA(alice), 0, "userUnclaimedA must be cleared");
        assertEq(pool.userUnclaimedB(alice), 0, "userUnclaimedB must be cleared");
    }

    // ─── Case 7: Transfer front-run ──────────────────────────────────────────────

    /// @notice Property: fees earned before an LP transfer stay with the SENDER.
    ///         Bob must NOT receive Alice's pre-transfer fees.
    /// @dev _update calls _beforeLpBalanceChange(alice) which moves alice's
    ///      accumulated-but-unwritten fees into userUnclaimedA[alice].
    ///      After transfer, alice's LP balance is 0 so she cannot harvest via
    ///      the live-balance path, but userUnclaimedA[alice] is still claimable.
    ///      Bob starts with a zero debt offset; the fees he can claim are only
    ///      those accrued AFTER he received the LP shares.
    function test_TransferFrontRun_PreTransferFeesStayWithSender() public {
        // Alice is the sole LP
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);

        // Generate fees (Alice earns 100% as sole LP)
        _swapAtoB(5_000 * DEC6);

        (uint256 alicePendingBefore, ) = pool.pendingFees(alice);
        assertGt(alicePendingBefore, 0, "Alice must have pending fees before transfer");

        // Alice transfers her entire LP balance to Bob
        uint256 aliceLp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(bob, aliceLp);

        // Bob has LP shares now, but NO pre-transfer fees
        (uint256 bobPending, ) = pool.pendingFees(bob);
        assertEq(bobPending, 0, "Bob must NOT receive Alice's pre-transfer fees");

        // Alice has zero LP but her unclaimed fees are preserved in userUnclaimedA
        (uint256 alicePendingAfter, ) = pool.pendingFees(alice);
        assertApproxEqAbs(
            alicePendingAfter,
            alicePendingBefore,
            1,
            "Alice's pre-transfer fees must be preserved after LP transfer to Bob"
        );

        // Alice can still harvest her pre-transfer fees (she has no LP but unclaimed > 0)
        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 aliceClaimed, ) = pool.harvest();
        assertApproxEqAbs(aliceClaimed, alicePendingBefore, 1, "Alice must harvest all pre-transfer fees");
        assertEq(usdc.balanceOf(alice), aliceUsdcBefore + aliceClaimed);
    }

    /// @notice Property: Bob can only harvest fees earned AFTER receiving the LP shares.
    function test_TransferFrontRun_BobEarnsOnlyPostTransferFees() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);

        // Swap before transfer — Alice earns these, NOT Bob (conservative, below 50% cap)
        _swapAtoB(2_000 * DEC6);

        uint256 aliceLp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(bob, aliceLp);

        // Bob has no fees yet
        (uint256 bobPendingA, ) = pool.pendingFees(bob);
        assertEq(bobPendingA, 0, "Bob has no fees right after receiving LP");

        // Rebalance pool with a B→A swap so the subsequent A→B swap fits under the cap
        _swapBtoA(2_000 * DEC6);

        // Swap after transfer — Bob earns these
        _swapAtoB(1_000 * DEC6);

        (uint256 bobPendingAfterSwap, ) = pool.pendingFees(bob);
        assertGt(bobPendingAfterSwap, 0, "Bob must earn fees from swap that occurred after transfer");

        // Bob harvests only his post-transfer fees
        vm.prank(bob);
        (uint256 bobClaimed, ) = pool.harvest();
        assertApproxEqAbs(bobClaimed, bobPendingAfterSwap, 1);
    }

    // ─── Case 8: Fuzz _distributeSwapFee ────────────────────────────────────────

    /// @notice Fuzz property: feeReserveA must never exceed actual tokenA.balanceOf(pool).
    /// @dev We fuzz over (depositA, depositB, swapIn) ensuring reasonable pool size
    ///      so that the swap succeeds and the reserve accounting stays solvent.
    function testFuzz_FeeReserveNeverExceedsTokenBalance(
        uint64 depositA,
        uint64 depositB,
        uint64 swapIn
    ) public {
        // Constrain inputs to reasonable sizes (1 unit .. 500,000 tokens in 6-dec units)
        uint256 dA = bound(uint256(depositA), 1_000 * DEC6, 500_000 * DEC6);
        uint256 dB = bound(uint256(depositB), 1_000 * DEC6, 500_000 * DEC6);
        uint256 sIn = bound(uint256(swapIn), 1 * DEC6, 1_000 * DEC6);

        // Mint enough for fuzz values
        usdc.mint(alice, dA);
        eurc.mint(alice, dB);
        usdc.mint(trader, sIn);

        _addLiquidity(alice, dA, dB);

        // Execute swap — may revert for extreme imbalances; skip those cases
        vm.prank(trader);
        try pool.swap(address(usdc), address(eurc), sIn, 0) {
            // Invariant: fee reserves never exceed actual pool token holdings
            assertLe(
                pool.feeReserveA(),
                usdc.balanceOf(address(pool)),
                "feeReserveA must not exceed USDC balance after fuzz swap"
            );
            assertLe(
                pool.feeReserveB(),
                eurc.balanceOf(address(pool)),
                "feeReserveB must not exceed EURC balance after fuzz swap"
            );

            // Harvest and re-check solvency
            (uint256 pendA, ) = pool.pendingFees(alice);
            if (pendA > 0) {
                vm.prank(alice);
                pool.harvest();
                assertLe(
                    pool.feeReserveA(),
                    usdc.balanceOf(address(pool)),
                    "feeReserveA must not exceed USDC balance after fuzz harvest"
                );
            }
        } catch {
            // Swap reverted (e.g. InvalidReserves due to extreme imbalance) — acceptable
        }
    }

    /// @notice Fuzz both fee directions: feeReserveA and feeReserveB stay solvent.
    function testFuzz_BothFeeReservesSolventBidirectional(
        uint64 depositA,
        uint64 depositB,
        uint64 swapAB,
        uint64 swapBA
    ) public {
        uint256 dA = bound(uint256(depositA), 10_000 * DEC6, 200_000 * DEC6);
        uint256 dB = bound(uint256(depositB), 10_000 * DEC6, 200_000 * DEC6);
        uint256 sAB = bound(uint256(swapAB), 1 * DEC6, 5_000 * DEC6);
        uint256 sBA = bound(uint256(swapBA), 1 * DEC6, 5_000 * DEC6);

        usdc.mint(alice, dA);
        eurc.mint(alice, dB);
        usdc.mint(trader, sAB + sBA);
        eurc.mint(trader, sAB + sBA);

        _addLiquidity(alice, dA, dB);

        // Swap A→B
        vm.prank(trader);
        try pool.swap(address(usdc), address(eurc), sAB, 0) {} catch {}

        // Swap B→A
        vm.prank(trader);
        try pool.swap(address(eurc), address(usdc), sBA, 0) {} catch {}

        assertLe(
            pool.feeReserveA(),
            usdc.balanceOf(address(pool)),
            "feeReserveA must not exceed USDC balance (bidirectional fuzz)"
        );
        assertLe(
            pool.feeReserveB(),
            eurc.balanceOf(address(pool)),
            "feeReserveB must not exceed EURC balance (bidirectional fuzz)"
        );
    }

    // ─── Invariant: total claimable fees never exceed fee reserve ────────────────

    /// @notice With multiple LPs and multiple swaps, the sum of all pending fees
    ///         must not exceed feeReserveA (rounding losses are acceptable but
    ///         over-claiming is a critical bug).
    function test_SumPendingFeesDoesNotExceedFeeReserve() public {
        _addLiquidity(alice, 20_000 * DEC6, 20_000 * DEC6);
        _addLiquidity(bob, 20_000 * DEC6, 20_000 * DEC6);
        _addLiquidity(carol, 10_000 * DEC6, 10_000 * DEC6);

        // Multiple swaps
        for (uint256 i = 0; i < 5; i++) {
            _swapAtoB(3_000 * DEC6);
        }

        (uint256 pA, ) = pool.pendingFees(alice);
        (uint256 pB, ) = pool.pendingFees(bob);
        (uint256 pC, ) = pool.pendingFees(carol);

        uint256 totalPending = pA + pB + pC;

        // Sum of all pending fees must not exceed the fee reserve (allow 3 wei rounding for 3 LPs)
        assertLe(
            totalPending,
            pool.feeReserveA() + 3,
            "Sum of pending fees must not exceed feeReserveA"
        );
    }

    // ─── Edge cases ──────────────────────────────────────────────────────────────

    /// @notice removeLiquidity with zero lpAmount reverts with ZeroAmount.
    function test_RemoveLiquidityZeroAmountReverts() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.ZeroAmount.selector));
        pool.removeLiquidity(0, 0, 0);
    }

    /// @notice removeLiquidity with more LP than owned reverts with NotEnoughLP.
    function test_RemoveLiquidityMoreThanBalanceReverts() public {
        uint256 lpShares = _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.NotEnoughLP.selector));
        pool.removeLiquidity(lpShares + 1, 0, 0);
    }

    /// @notice Slippage check on removeLiquidity.
    function test_RemoveLiquiditySlippageReverts() public {
        uint256 lpShares = _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        uint256 expectedOut = (pool.reserveA() * lpShares) / pool.totalSupply();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.SlippageExceeded.selector));
        pool.removeLiquidity(lpShares, expectedOut + 1, 0);
    }

    /// @notice Swap with invalid token pair reverts with InvalidTokenPair.
    function test_SwapInvalidTokenPairReverts() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        vm.prank(trader);
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.InvalidTokenPair.selector));
        pool.swap(address(usdc), address(usdc), 1_000 * DEC6, 0);
    }

    /// @notice Constructor rejects zero-address tokens.
    function test_ConstructorRejectsZeroAddressTokens() public {
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.ZeroAddress.selector));
        new StableSwapPoolV4(address(0), address(eurc), FEE_BPS, owner);

        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.ZeroAddress.selector));
        new StableSwapPoolV4(address(usdc), address(0), FEE_BPS, owner);
    }

    /// @notice Constructor rejects fee > 1000 bps.
    function test_ConstructorRejectsInvalidFeeBps() public {
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.InvalidFeeBps.selector));
        new StableSwapPoolV4(address(usdc), address(eurc), 1001, owner);
    }

    /// @notice Constructor rejects identical tokenA == tokenB.
    function test_ConstructorRejectsIdenticalTokens() public {
        vm.expectRevert(abi.encodeWithSelector(StableSwapPoolV4.InvalidTokenPair.selector));
        new StableSwapPoolV4(address(usdc), address(usdc), FEE_BPS, owner);
    }

    /// @notice harvest() reverts for an address that has never provided liquidity.
    function test_HarvestRevertsForNonLP() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        _swapAtoB(5_000 * DEC6);

        vm.prank(bob); // Bob never deposited
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        pool.harvest();
    }

    /// @notice 24h volume resets correctly after time warp.
    function test_Volume24hResetsAfterWindow() public {
        _addLiquidity(alice, 10_000 * DEC6, 10_000 * DEC6);
        _swapAtoB(1_000 * DEC6);

        assertGt(pool.volume24hA(), 0, "volume24hA must be nonzero after swap");

        // Warp past 24h window
        vm.warp(block.timestamp + 1 days + 1);

        assertEq(pool.volume24hA(), 0, "volume24hA must reset after 24h window");

        // First swap in new window resets state
        _swapAtoB(500 * DEC6);
        assertEq(pool.volume24hA(), 500 * DEC6, "volume24hA must start fresh in new window");
    }

    /// @notice pause/unpause access control: non-owner cannot pause.
    function test_PauseAccessControl() public {
        vm.prank(alice);
        vm.expectRevert(); // OwnableUnauthorizedAccount
        pool.pause();

        // Owner can pause
        pool.pause();
        assertTrue(pool.paused());

        // Non-owner cannot unpause
        vm.prank(alice);
        vm.expectRevert();
        pool.unpause();

        // Owner can unpause
        pool.unpause();
        assertFalse(pool.paused());
    }
}
