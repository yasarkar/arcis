// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Unit & integration tests for ConstantProductPoolEurcCirBtcV4
///         (EURC 6-dec / cirBTC 8-dec, x*y=k, real-yield harvest).
/// @dev F-07 same-block lock: LP minted by `addLiquidity` cannot be burned / transferred / harvested by the
///      minter in the same block, so every helper that seeds the pool rolls one block afterwards.
contract ConstantProductPoolEurcCirBtcV4Test is Test {
    ConstantProductPoolEurcCirBtcV4 pool;
    MockERC20 eurc;
    MockERC20 cirBtc;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);

    uint256 constant DEC6 = 1e6;  // EURC decimals
    uint256 constant DEC8 = 1e8;  // cirBTC decimals

    function setUp() public {
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        cirBtc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);
        pool = new ConstantProductPoolEurcCirBtcV4(address(eurc), address(cirBtc), 25, owner); // 25 bps = 0.25%

        eurc.mint(alice, 10_000_000 * DEC6);
        cirBtc.mint(alice,       100 * DEC8);
        eurc.mint(bob,   10_000_000 * DEC6);
        cirBtc.mint(bob,         100 * DEC8);
    }

    function _approveAlice() internal {
        vm.startPrank(alice);
        eurc.approve(address(pool), type(uint256).max);
        cirBtc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _approveBob() internal {
        vm.startPrank(bob);
        eurc.approve(address(pool), type(uint256).max);
        cirBtc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    /// @dev Add 600,000 EURC + 10 cirBTC initial liquidity (1 BTC = 60,000 EUR), then advance one block
    ///      so alice is no longer same-block locked (F-07).
    function _seedPool() internal {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(600_000 * DEC6, 10 * DEC8, 0, type(uint256).max);
        _nextBlock();
    }

    function _nextBlock() internal {
        vm.roll(block.number + 1);
    }

    /// @dev bob generates fees on both legs (EURC fee 150e6, cirBTC fee 0.0025e8).
    function _generateFees() internal {
        _approveBob();
        vm.startPrank(bob);
        pool.swap(address(eurc), address(cirBtc), 60_000 * DEC6, 0, type(uint256).max);
        pool.swap(address(cirBtc), address(eurc), 1 * DEC8, 0, type(uint256).max);
        vm.stopPrank();
    }

    // ── Decimal & Constructor Tests ───────────────────────────────────────────

    function test_LpDecimalsStandardized18() public view {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
    }

    function test_Constructor_RejectsZeroFeeBps() public {
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.InvalidFeeBps.selector, 0));
        new ConstantProductPoolEurcCirBtcV4(address(eurc), address(cirBtc), 0, owner);
    }

    function test_Constructor_RejectsFeeBpsAbove1000() public {
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.InvalidFeeBps.selector, 1001));
        new ConstantProductPoolEurcCirBtcV4(address(eurc), address(cirBtc), 1001, owner);
    }

    function test_Constructor_AcceptsMaxValidFee() public {
        ConstantProductPoolEurcCirBtcV4 testPool = new ConstantProductPoolEurcCirBtcV4(
            address(eurc),
            address(cirBtc),
            1000,
            owner
        );
        assertEq(testPool.swapFeeBps(), 1000);
    }

    // ── Initial Liquidity & Math ──────────────────────────────────────────────

    function test_InitialLiquidityMintingMath() public {
        _approveAlice();

        // 60,000 EURC (60_000 * 1e6 = 6e10)
        // 1 cirBTC (1 * 1e8 = 1e8)
        // rawSqrt = sqrt(6e18) = 2,449,489,742
        // initialLp = 2,449,489,742 * 1e11 = 244,948,974,200,000,000,000 (~244.94 LP tokens)
        uint256 amountA = 60_000 * DEC6;
        uint256 amountB = 1 * DEC8;

        vm.prank(alice);
        uint256 lpShares = pool.addLiquidity(amountA, amountB, 0, type(uint256).max);

        assertGt(lpShares, 0, "Alice should receive LP shares");
        assertEq(pool.balanceOf(alice), lpShares);
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), pool.MINIMUM_LIQUIDITY());
        assertEq(pool.reserveA(), amountA);
        assertEq(pool.reserveB(), amountB);
    }

    function test_InitialDeposit_RejectsDustAmounts() public {
        _approveAlice();
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        vm.prank(alice);
        pool.addLiquidity(0, 1 * DEC8, 0, type(uint256).max);
    }

    function test_InitialDeposit_RejectsSubSqrtThreshold() public {
        _approveAlice();
        // Product = 100 * 100 = 10,000; sqrt = 100 < 1e3
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        vm.prank(alice);
        pool.addLiquidity(100, 100, 0, type(uint256).max);
    }

    // ── Swap Tests ────────────────────────────────────────────────────────────

    function test_SwapEurcToCirBtc() public {
        _seedPool();
        _approveBob();

        uint256 bobEurcIn = 6_000 * DEC6;
        uint256 bobBtcBefore = cirBtc.balanceOf(bob);

        vm.prank(bob);
        uint256 btcOut = pool.swap(address(eurc), address(cirBtc), bobEurcIn, 0, type(uint256).max);

        assertGt(btcOut, 0, "Bob must receive cirBTC");
        assertEq(cirBtc.balanceOf(bob) - bobBtcBefore, btcOut);
        // Fee is 25 bps on 6000 EURC = 15 EURC (15 * 1e6)
        assertEq(pool.unclaimedFeeA(), (bobEurcIn * 25) / 10000);
    }

    function test_SwapCirBtcToEurc() public {
        _seedPool();
        _approveBob();

        uint256 bobBtcIn = 1 * DEC8; // 1 cirBTC
        uint256 bobEurcBefore = eurc.balanceOf(bob);

        vm.prank(bob);
        uint256 eurcOut = pool.swap(address(cirBtc), address(eurc), bobBtcIn, 0, type(uint256).max);

        assertGt(eurcOut, 0, "Bob must receive EURC");
        assertEq(eurc.balanceOf(bob) - bobEurcBefore, eurcOut);
        // Fee is 25 bps on 1 cirBTC = 0.0025 cirBTC (250_000 units)
        assertEq(pool.unclaimedFeeB(), (bobBtcIn * 25) / 10000);
    }

    function test_KInvariant_PreservedAfterEurcToCirBtc() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 30_000 * DEC6, 0, type(uint256).max);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after EURC -> cirBTC swap");
    }

    function test_KInvariant_PreservedAfterCirBtcToEurc() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(cirBtc), address(eurc), 5 * DEC8 / 10, 0, type(uint256).max);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after cirBTC -> EURC swap");
    }

    function test_Swap_Reverts_On50PctDrainAttempt() public {
        _seedPool();
        _approveBob();

        // Attempting to buy out > 50% of the cirBTC reserve
        vm.expectRevert();
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 700_000 * DEC6, 0, type(uint256).max);
    }

    /// @dev F-05: DustSwapNotAllowed check removed. A 1-unit input now pays ceil fee = 1, leaving 0 net input,
    ///      so the output rounds to 0 and the swap reverts ZeroAmount (the error declaration is unused).
    function test_Swap_OneUnitInput_RevertsZeroAmount_EurcToCirBtc() public {
        _seedPool();
        _approveBob();

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 1, 0, type(uint256).max);
    }

    function test_Swap_OneUnitInput_RevertsZeroAmount_CirBtcToEurc() public {
        _seedPool();
        _approveBob();

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        vm.prank(bob);
        pool.swap(address(cirBtc), address(eurc), 1, 0, type(uint256).max);
    }

    function test_Swap_ZeroAmountInput_Reverts() public {
        _seedPool();
        _approveBob();

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 0, 0, type(uint256).max);
    }

    function test_Swap_SmallInputNoLongerBlockedByDustGuard() public {
        _seedPool();
        _approveBob();

        // 399 raw cirBTC used to be rejected as dust; now it is a normal swap paying ceil fee (= 1).
        vm.prank(bob);
        uint256 out = pool.swap(address(cirBtc), address(eurc), 399, 0, type(uint256).max);
        assertGt(out, 0);
        assertEq(pool.feeReserveB(), 1);
    }

    function test_Swap_RevertsInvalidTokenPair() public {
        _seedPool();
        _approveBob();

        vm.expectRevert(
            abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.InvalidTokenPair.selector, address(eurc), address(eurc))
        );
        vm.prank(bob);
        pool.swap(address(eurc), address(eurc), 1_000 * DEC6, 0, type(uint256).max);
    }

    function test_Swap_RevertsWhenMinOutNotMet() public {
        _seedPool();
        _approveBob();

        vm.expectRevert();
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 6_000 * DEC6, type(uint256).max, type(uint256).max);
    }

    function test_Swap_EmitsSwapped() public {
        _seedPool();
        _approveBob();

        uint256 amountIn = 6_000 * DEC6;
        uint256 fee = Math.ceilDiv(amountIn * 25, 10000);
        uint256 net = amountIn - fee;
        uint256 expectedOut = (pool.reserveB() * net) / (pool.reserveA() + net);

        vm.expectEmit(true, false, false, true, address(pool));
        emit ConstantProductPoolEurcCirBtcV4.Swapped(bob, address(eurc), amountIn, expectedOut);
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), amountIn, 0, type(uint256).max);
    }

    function test_Volume24h_AccumulatesAndResetsWindow() public {
        _seedPool();
        _approveBob();

        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 6_000 * DEC6, 0, type(uint256).max);
        assertEq(pool.volume24hA(), 6_000 * DEC6);
        assertEq(pool.volume24hB(), 0);

        // F-09 (NatSpec only): behaviour unchanged -- the getter reads 0 once the window has expired.
        skip(1 days);
        assertEq(pool.volume24hA(), 0);
    }

    function test_Swap_RevertsOnExpiredDeadline() public {
        _seedPool();
        _approveBob();

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.DeadlineExpired.selector);
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 1_000 * DEC6, 0, block.timestamp - 1);
    }

    function test_Swap_RevertsWhilePaused() public {
        _seedPool();
        _approveBob();

        pool.pause();

        vm.expectRevert();
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 1_000 * DEC6, 0, type(uint256).max);
    }

    // ── Liquidity Management & Proportional Deposit (H-01) ────────────────────

    function test_SubsequentDeposit_ProportionalAmountsAccepted() public {
        _seedPool();
        _approveBob();

        // Seed ratio is 600,000 EURC : 10 cirBTC = 60,000 : 1
        // Bob deposits 60,000 EURC + 1 cirBTC exactly
        uint256 bobBalBeforeA = eurc.balanceOf(bob);
        uint256 bobBalBeforeB = cirBtc.balanceOf(bob);

        vm.prank(bob);
        uint256 lpShares = pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);

        assertGt(lpShares, 0);
        assertEq(bobBalBeforeA - eurc.balanceOf(bob), 60_000 * DEC6);
        assertEq(bobBalBeforeB - cirBtc.balanceOf(bob), 1 * DEC8);
    }

    function test_SubsequentDeposit_ExcessTokenBCapped_NotDonated() public {
        _seedPool();
        _approveBob();

        // Bob specifies 60,000 EURC and offers up to 5 cirBTC (excessive)
        // Pool should only pull 1 cirBTC and NOT 5 cirBTC!
        uint256 bobBalBeforeB = cirBtc.balanceOf(bob);

        vm.prank(bob);
        pool.addLiquidity(60_000 * DEC6, 5 * DEC8, 0, type(uint256).max);

        assertEq(bobBalBeforeB - cirBtc.balanceOf(bob), 1 * DEC8, "Only optimal cirBTC should be pulled");
    }

    function test_RemoveLiquidity_WorksWhilePaused() public {
        _seedPool();

        pool.pause();

        uint256 aliceLp = pool.balanceOf(alice);
        uint256 eurcBefore = eurc.balanceOf(alice);
        uint256 btcBefore = cirBtc.balanceOf(alice);

        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(aliceLp, 0, 0);

        assertGt(outA, 0);
        assertGt(outB, 0);
        assertEq(eurc.balanceOf(alice) - eurcBefore, outA);
        assertEq(cirBtc.balanceOf(alice) - btcBefore, outB);
    }

    // ── Real Yield Harvest Tests ──────────────────────────────────────────────

    function test_HarvestAccruedFees() public {
        _seedPool();
        _approveBob();

        // Bob performs swaps to generate fees in both tokens
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 60_000 * DEC6, 0, type(uint256).max);

        vm.prank(bob);
        pool.swap(address(cirBtc), address(eurc), 1 * DEC8, 0, type(uint256).max);

        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertGt(pendingA, 0, "Alice should have pending EURC fees");
        assertGt(pendingB, 0, "Alice should have pending cirBTC fees");

        uint256 eurcBefore = eurc.balanceOf(alice);
        uint256 btcBefore = cirBtc.balanceOf(alice);

        vm.prank(alice);
        (uint256 feeA, uint256 feeB) = pool.harvest();

        assertEq(feeA, pendingA);
        assertEq(feeB, pendingB);
        assertEq(eurc.balanceOf(alice) - eurcBefore, feeA);
        assertEq(cirBtc.balanceOf(alice) - btcBefore, feeB);

        // After harvest, pending fees should be 0
        (uint256 postA, uint256 postB) = pool.pendingFees(alice);
        assertEq(postA, 0);
        assertEq(postB, 0);
    }

    function test_Harvest_WorksWhilePaused() public {
        _seedPool();
        _approveBob();

        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 60_000 * DEC6, 0, type(uint256).max);

        pool.pause();

        vm.prank(alice);
        (uint256 feeA,) = pool.harvest();
        assertGt(feeA, 0, "LPs must be able to harvest fees while paused");
    }

    // ── Token Recovery (Skim) & Ownership ─────────────────────────────────────

    function test_SkimExcessTokens() public {
        _seedPool();

        // Direct donation of 1,000 EURC to pool
        eurc.mint(address(pool), 1_000 * DEC6);

        address recipient = address(0x999);
        pool.skim(address(eurc), recipient);

        assertEq(eurc.balanceOf(recipient), 1_000 * DEC6);
    }

    function test_OwnershipTransferIsTwoStep() public {
        address newOwner = address(0xCAFE);
        pool.transferOwnership(newOwner);

        // Still owner until accepted
        assertEq(pool.owner(), owner);

        vm.prank(newOwner);
        pool.acceptOwnership();

        assertEq(pool.owner(), newOwner);
    }

    function test_Skim_RevertsForNonOwner() public {
        _seedPool();
        vm.prank(alice);
        vm.expectRevert();
        pool.skim(address(eurc), alice);
    }

    function test_Skim_RevertsOnZeroRecipient() public {
        _seedPool();
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.ZeroAddress.selector, address(0)));
        pool.skim(address(eurc), address(0));
    }

    function test_Skim_DoesNotTouchReservesOrFees() public {
        _seedPool();
        _generateFees();
        uint256 poolBalA = eurc.balanceOf(address(pool));
        // reserve + feeReserve fully accounts for the balance, so there is nothing to skim.
        assertEq(poolBalA, pool.reserveA() + pool.feeReserveA());
        pool.skim(address(eurc), address(0x999));
        assertEq(eurc.balanceOf(address(pool)), poolBalA);
        assertEq(eurc.balanceOf(address(0x999)), 0);
    }

    // ── Events ────────────────────────────────────────────────────────────────

    function test_AddLiquidity_EmitsLiquidityAdded() public {
        _approveAlice();
        uint256 a = 60_000 * DEC6;
        uint256 b = 1 * DEC8;
        uint256 shares = Math.sqrt(a * b) * 1e11 - pool.MINIMUM_LIQUIDITY();
        vm.expectEmit(true, false, false, true, address(pool));
        emit ConstantProductPoolEurcCirBtcV4.LiquidityAdded(alice, a, b, shares);
        vm.prank(alice);
        pool.addLiquidity(a, b, 0, type(uint256).max);
    }

    function test_RemoveLiquidity_EmitsLiquidityRemoved() public {
        _seedPool();
        uint256 lp = pool.balanceOf(alice) / 4;
        uint256 outA = (pool.reserveA() * lp) / pool.totalSupply();
        uint256 outB = (pool.reserveB() * lp) / pool.totalSupply();
        vm.expectEmit(true, false, false, true, address(pool));
        emit ConstantProductPoolEurcCirBtcV4.LiquidityRemoved(alice, lp, outA, outB);
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
    }

    function test_Harvest_EmitsFeesHarvested() public {
        _seedPool();
        _generateFees();
        (uint256 pA, uint256 pB) = pool.pendingFees(alice);
        vm.expectEmit(true, false, false, true, address(pool));
        emit LpFeeAccounting.FeesHarvested(alice, pA, pB);
        vm.prank(alice);
        pool.harvest();
    }

    // ── F-06: last real LP sweeps reserves; restart deposit ───────────────────

    function test_FirstDeposit_MintsDeadShares_Unchanged() public {
        _approveAlice();
        uint256 a = 600_000 * DEC6;
        uint256 b = 10 * DEC8;
        vm.prank(alice);
        uint256 shares = pool.addLiquidity(a, b, 0, type(uint256).max);
        uint256 initialLp = Math.sqrt(a * b) * 1e11;
        assertEq(shares, initialLp - 1000, "true first deposit: initialLp - 1000");
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), 1000);
        assertEq(pool.totalSupply(), initialLp);
    }

    function test_LastLp_RemoveLiquidity_SweepsAllReserves() public {
        _seedPool();
        _generateFees();

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 lp = pool.balanceOf(alice);
        // A proportional exit would strand the dead-share slice of the reserves.
        assertLt((rA * lp) / pool.totalSupply(), rA);

        uint256 a0 = eurc.balanceOf(alice);
        uint256 b0 = cirBtc.balanceOf(alice);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0);

        assertEq(outA, rA, "all reserveA swept");
        assertEq(outB, rB, "all reserveB swept");
        assertEq(eurc.balanceOf(alice) - a0, rA);
        assertEq(cirBtc.balanceOf(alice) - b0, rB);
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
        assertEq(pool.totalSupply(), 1000, "only dead shares remain");
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), 1000);
        // pool now holds only the isolated fee reserves
        assertEq(eurc.balanceOf(address(pool)), pool.feeReserveA());
        assertEq(cirBtc.balanceOf(address(pool)), pool.feeReserveB());
    }

    function test_LastLp_FeesStillHarvestableAfterFullExit() public {
        _seedPool();
        _generateFees();
        (uint256 pA, uint256 pB) = pool.pendingFees(alice);
        uint256 lpAll = pool.balanceOf(alice);
        vm.prank(alice);
        pool.removeLiquidity(lpAll, 0, 0);

        (uint256 qA, uint256 qB) = pool.pendingFees(alice);
        assertEq(qA, pA, "fee entitlement survives exit");
        assertEq(qB, pB);
        vm.prank(alice);
        pool.harvest();
        // accFeePerShare floors at 1e18 precision: one accumulator unit is worth lpAll/1e18 raw tokens, so the
        // stranded remainder after a full exit is bounded by that (here ~0.0006 EURC), never more.
        assertLe(eurc.balanceOf(address(pool)), lpAll / 1e18 + 1, "only sub-accumulator-unit dust left");
        assertEq(eurc.balanceOf(address(pool)), pool.feeReserveA());
    }

    function test_Swap_RevertsNoLiquidityProviders_AfterFullExit() public {
        _seedPool();
        _approveBob();
        uint256 lpAll = pool.balanceOf(alice);
        vm.prank(alice);
        pool.removeLiquidity(lpAll, 0, 0);

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.NoLiquidityProviders.selector);
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 1_000 * DEC6, 0, type(uint256).max);
    }

    function test_PartialExit_IsProportional_NotSweep() public {
        _seedPool();
        uint256 lp = pool.balanceOf(alice);
        uint256 total = pool.totalSupply();
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp / 2, 0, 0);
        assertEq(outA, (rA * (lp / 2)) / total);
        assertEq(outB, (rB * (lp / 2)) / total);
        assertGt(pool.reserveA(), 0);
    }

    function test_ExitWithOtherRealLpPresent_IsProportional_NotSweep() public {
        _seedPool();
        _approveBob();
        vm.prank(bob);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);
        _nextBlock();

        uint256 lp = pool.balanceOf(alice);
        uint256 total = pool.totalSupply();
        uint256 rA = pool.reserveA();
        vm.prank(alice);
        (uint256 outA,) = pool.removeLiquidity(lp, 0, 0);
        assertEq(outA, (rA * lp) / total);
        assertGt(pool.reserveA(), 0, "bob's share stays");
    }

    function test_RestartDeposit_NoNewDeadMint_PriceSetFreely() public {
        _seedPool();
        uint256 lpAll = pool.balanceOf(alice);
        vm.prank(alice);
        pool.removeLiquidity(lpAll, 0, 0);

        _approveBob();
        uint256 a = 30_000 * DEC6; // restart at a different price: 1 BTC = 30,000 EURC
        uint256 b = 1 * DEC8;
        vm.prank(bob);
        uint256 shares = pool.addLiquidity(a, b, 0, type(uint256).max);

        assertEq(shares, Math.sqrt(a * b) * 1e11, "restart: full sqrt(a*b)*1e11, no dead deduction");
        assertEq(pool.balanceOf(bob), shares);
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), 1000, "no additional dead mint");
        assertEq(pool.totalSupply(), 1000 + shares);
        assertEq(pool.reserveA(), a);
        assertEq(pool.reserveB(), b);

        // pool trades again at the new price
        _nextBlock();
        vm.prank(alice);
        uint256 out = pool.swap(address(cirBtc), address(eurc), 1_000_000, 0, type(uint256).max);
        assertGt(out, 0);
    }

    // ── F-07: same-block liquidity lock ───────────────────────────────────────

    function test_AddLiquidity_RecordsLastLiquidityBlock() public {
        _approveAlice();
        vm.roll(777);
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);
        assertEq(pool.lastLiquidityBlock(alice), 777);
        assertEq(pool.lastLiquidityBlock(bob), 0);
    }

    function test_Lock_RemoveLiquiditySameBlockReverts_ThenOkNextBlock() public {
        _approveAlice();
        vm.startPrank(alice);
        uint256 lp = pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        pool.removeLiquidity(lp, 0, 0);
        vm.stopPrank();

        _nextBlock();
        vm.prank(alice);
        (uint256 outA,) = pool.removeLiquidity(lp, 0, 0);
        assertGt(outA, 0);
    }

    function test_Lock_TransferSameBlockReverts_ThenOkNextBlock() public {
        _approveAlice();
        vm.startPrank(alice);
        uint256 lp = pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        pool.transfer(bob, lp);
        vm.stopPrank();

        _nextBlock();
        vm.prank(alice);
        pool.transfer(bob, lp);
        assertEq(pool.balanceOf(bob), lp);
    }

    function test_Lock_TransferFromSameBlockReverts() public {
        _approveAlice();
        vm.startPrank(alice);
        uint256 lp = pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);
        pool.approve(bob, lp);
        vm.stopPrank();

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        vm.prank(bob);
        pool.transferFrom(alice, bob, lp);

        _nextBlock();
        vm.prank(bob);
        pool.transferFrom(alice, bob, lp);
        assertEq(pool.balanceOf(bob), lp);
    }

    function test_Lock_HarvestSameBlockReverts_ThenOkNextBlock() public {
        _seedPool();
        _generateFees();
        // alice tops up -> her account is locked for this block even though fees are pending
        vm.startPrank(alice);
        pool.addLiquidity(6_000 * DEC6, 1e7, 0, type(uint256).max);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        pool.harvest();
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        pool.harvest(alice);
        vm.stopPrank();

        _nextBlock();
        vm.prank(alice);
        (uint256 feeA,) = pool.harvest();
        assertGt(feeA, 0);
    }

    function test_Lock_TopUpRelocksWholeBalance() public {
        _seedPool(); // alice unlocked
        vm.startPrank(alice);
        pool.addLiquidity(6_000 * DEC6, 1e7, 0, type(uint256).max);
        uint256 all = pool.balanceOf(alice);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        pool.removeLiquidity(all / 2, 0, 0);
        vm.stopPrank();
    }

    function test_Lock_IncomingTransferDoesNotLockRecipient() public {
        _seedPool();
        _approveBob();
        uint256 lp = pool.balanceOf(alice);
        // alice (unlocked) sends bob LP; bob can immediately forward / burn it in the same block
        vm.prank(alice);
        pool.transfer(bob, lp / 2);
        assertEq(pool.lastLiquidityBlock(bob), 0, "recipient not locked");

        vm.startPrank(bob);
        pool.transfer(carolAddr(), lp / 8);
        (uint256 outA,) = pool.removeLiquidity(lp / 4, 0, 0);
        vm.stopPrank();
        assertGt(outA, 0);
    }

    function test_Lock_PauseDoesNotBypass_NorExtend() public {
        _approveAlice();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);
        pool.pause();

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        vm.prank(alice);
        pool.transfer(bob, lp);

        _nextBlock();
        vm.prank(alice);
        (uint256 outA,) = pool.removeLiquidity(lp, 0, 0);
        assertGt(outA, 0, "paused pool: exit allowed once the lock block has passed");
    }

    function test_AddLiquidity_RevertsWhilePaused() public {
        _approveAlice();
        pool.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);
    }

    function carolAddr() internal pure returns (address) {
        return address(0xCA201);
    }

    // ── F-08: recipient overloads ─────────────────────────────────────────────

    function test_RemoveLiquidity_To_SendsToRecipient_DebitsCaller() public {
        _seedPool();
        address recipient = address(0x7777);
        uint256 lpBefore = pool.balanceOf(alice);
        uint256 lp = lpBefore / 2;
        uint256 aA = eurc.balanceOf(alice);
        uint256 aB = cirBtc.balanceOf(alice);

        vm.expectEmit(true, false, false, false, address(pool));
        emit ConstantProductPoolEurcCirBtcV4.LiquidityRemoved(alice, lp, 0, 0);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0, recipient);

        assertEq(pool.balanceOf(alice), lpBefore - lp, "LP burned from caller");
        assertEq(eurc.balanceOf(recipient), outA);
        assertEq(cirBtc.balanceOf(recipient), outB);
        assertEq(eurc.balanceOf(alice), aA, "caller receives nothing");
        assertEq(cirBtc.balanceOf(alice), aB);
        assertGt(outA, 0);
    }

    function test_RemoveLiquidity_To_LastLpSweepsToRecipient() public {
        _seedPool();
        address recipient = address(0x7777);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 lpAll = pool.balanceOf(alice);
        vm.prank(alice);
        pool.removeLiquidity(lpAll, 0, 0, recipient);
        assertEq(eurc.balanceOf(recipient), rA);
        assertEq(cirBtc.balanceOf(recipient), rB);
        assertEq(pool.reserveA(), 0);
    }

    function test_RemoveLiquidity_To_ZeroAddressReverts() public {
        _seedPool();
        uint256 lp = pool.balanceOf(alice);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.ZeroAddress.selector, address(0)));
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0, address(0));
    }

    function test_RemoveLiquidity_To_ChargesCallersBalanceNotRecipients() public {
        _seedPool();
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.NotEnoughLP.selector);
        vm.prank(bob); // bob holds no LP
        pool.removeLiquidity(1e18, 0, 0, alice);
    }

    function test_RemoveLiquidity_To_SameBlockLockStillApplies() public {
        _approveAlice();
        vm.startPrank(alice);
        uint256 lp = pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        pool.removeLiquidity(lp, 0, 0, bob);
        vm.stopPrank();
    }

    function test_RemoveLiquidity_BasicRevertPaths() public {
        _seedPool();
        uint256 tooMuch = pool.totalSupply() + 1;
        uint256 lp = pool.balanceOf(alice) / 2;
        uint256 expA = (pool.reserveA() * lp) / pool.totalSupply();
        vm.startPrank(alice);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        pool.removeLiquidity(0, 0, 0);

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.NotEnoughLP.selector);
        pool.removeLiquidity(tooMuch, 0, 0);

        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.SlippageExceeded.selector, expA + 1, expA));
        pool.removeLiquidity(lp, expA + 1, 0);
        vm.stopPrank();
    }

    function test_Harvest_To_SendsToRecipient_DebitsCaller() public {
        _seedPool();
        _generateFees();
        address recipient = address(0x7777);
        (uint256 pA, uint256 pB) = pool.pendingFees(alice);
        uint256 aA = eurc.balanceOf(alice);
        uint256 aB = cirBtc.balanceOf(alice);

        vm.expectEmit(true, false, false, true, address(pool));
        emit LpFeeAccounting.FeesHarvested(alice, pA, pB);
        vm.prank(alice);
        (uint256 feeA, uint256 feeB) = pool.harvest(recipient);

        assertEq(feeA, pA);
        assertEq(feeB, pB);
        assertEq(eurc.balanceOf(recipient), feeA);
        assertEq(cirBtc.balanceOf(recipient), feeB);
        assertEq(eurc.balanceOf(alice), aA, "caller receives nothing");
        assertEq(cirBtc.balanceOf(alice), aB);
        (uint256 postA, uint256 postB) = pool.pendingFees(alice);
        assertEq(postA, 0);
        assertEq(postB, 0);
    }

    function test_Harvest_To_ZeroAddressReverts() public {
        _seedPool();
        _generateFees();
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.ZeroAddress.selector, address(0)));
        vm.prank(alice);
        pool.harvest(address(0));
    }

    function test_Harvest_To_ClaimsAreCallersNotRecipients() public {
        _seedPool();
        _generateFees();
        // bob has no LP: harvesting "to alice" yields nothing for bob and cannot touch alice's claim
        (uint256 pA,) = pool.pendingFees(alice);
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        vm.prank(bob);
        pool.harvest(alice);
        (uint256 qA,) = pool.pendingFees(alice);
        assertEq(qA, pA);
    }

    function test_Harvest_NoFees_Reverts() public {
        _seedPool();
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        vm.prank(alice);
        pool.harvest();
    }

    function test_PendingFees_DeadAddressIsZero() public {
        _seedPool();
        _generateFees();
        (uint256 a, uint256 b) = pool.pendingFees(pool.DEAD_ADDRESS());
        assertEq(a, 0);
        assertEq(b, 0);
    }
    // ── 50% single-swap output cap: OutputCapExceeded boundary tests ──────────

    /// @dev Mirrors the pool's quote: fee = ceil(in * 25bps), out = rOut * net / (rIn + net).
    function _quote(uint256 amountIn, bool aToB) internal view returns (uint256) {
        uint256 net = amountIn - Math.ceilDiv(amountIn * 25, 10000);
        (uint256 rIn, uint256 rOut) = aToB ? (pool.reserveA(), pool.reserveB()) : (pool.reserveB(), pool.reserveA());
        return (rOut * net) / (rIn + net);
    }

    /// @dev Largest amountIn whose quote does not exceed reserveOut / 2 (binary search; quote is monotonic).
    function _maxInAtCap(bool aToB) internal view returns (uint256) {
        uint256 half = (aToB ? pool.reserveB() : pool.reserveA()) / 2;
        uint256 lo = 1;
        uint256 hi = (aToB ? pool.reserveA() : pool.reserveB()) * 4; // far above the cap
        while (lo < hi) {
            uint256 mid = (lo + hi + 1) / 2;
            if (_quote(mid, aToB) <= half) lo = mid;
            else hi = mid - 1;
        }
        return lo;
    }

    function _fundBobForCap() internal {
        eurc.mint(bob, 10_000_000 * DEC6);
        cirBtc.mint(bob, 1_000 * DEC8);
        _approveBob();
    }

    function test_SwapCap_AToB_OutputExactlyHalfReserveSucceeds() public {
        _seedPool();
        _fundBobForCap();
        uint256 half = pool.reserveB() / 2;
        uint256 amountIn = _maxInAtCap(true);
        assertEq(_quote(amountIn, true), half, "boundary input yields exactly reserveOut/2");

        vm.prank(bob);
        uint256 out = pool.swap(address(eurc), address(cirBtc), amountIn, half, type(uint256).max);
        assertEq(out, half);
        assertEq(pool.reserveB(), half, "half of cirBTC reserve remains");
    }

    function test_SwapCap_AToB_OneUnitAboveReverts_ExactArgs() public {
        _seedPool();
        _fundBobForCap();
        uint256 half = pool.reserveB() / 2;
        uint256 amountIn = _maxInAtCap(true) + 1;
        uint256 expectedOut = _quote(amountIn, true);
        assertEq(expectedOut, half + 1, "first input past the boundary yields reserveOut/2 + 1");

        uint256 bobEurc = eurc.balanceOf(bob);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.OutputCapExceeded.selector, half + 1, half));
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), amountIn, 0, type(uint256).max);
        assertEq(eurc.balanceOf(bob), bobEurc, "no funds moved");
    }

    function test_SwapCap_BToA_OutputExactlyHalfReserveSucceeds() public {
        _seedPool();
        _fundBobForCap();
        uint256 half = pool.reserveA() / 2;
        uint256 amountIn = _maxInAtCap(false);
        assertEq(_quote(amountIn, false), half, "boundary input yields exactly reserveOut/2");

        vm.prank(bob);
        uint256 out = pool.swap(address(cirBtc), address(eurc), amountIn, half, type(uint256).max);
        assertEq(out, half);
        assertEq(pool.reserveA(), half, "half of EURC reserve remains");
    }

    function test_SwapCap_BToA_OneUnitAboveReverts_ExactArgs() public {
        _seedPool();
        _fundBobForCap();
        uint256 half = pool.reserveA() / 2;
        uint256 amountIn = _maxInAtCap(false) + 1;
        uint256 expectedOut = _quote(amountIn, false);
        assertGt(expectedOut, half, "first input past the boundary exceeds the cap");

        uint256 bobBtc = cirBtc.balanceOf(bob);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.OutputCapExceeded.selector, expectedOut, half));
        vm.prank(bob);
        pool.swap(address(cirBtc), address(eurc), amountIn, 0, type(uint256).max);
        assertEq(cirBtc.balanceOf(bob), bobBtc, "no funds moved");
    }

    function test_SwapCap_OddReserveUsesFlooredHalf() public {
        // Odd output reserve: maxAmountOut is floor(reserve / 2).
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(600_000 * DEC6, 10 * DEC8 + 1, 0, type(uint256).max);
        _nextBlock();
        _fundBobForCap();
        uint256 half = pool.reserveB() / 2;
        assertEq(pool.reserveB() % 2, 1);
        uint256 amountIn = _maxInAtCap(true) + 1;
        uint256 expectedOut = _quote(amountIn, true);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.OutputCapExceeded.selector, expectedOut, half));
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), amountIn, 0, type(uint256).max);
    }

    function test_SwapCap_MassiveSwapRevertsOutputCapExceeded_BothDirections() public {
        _seedPool();
        _fundBobForCap();
        // Far above reserves: output approaches (but never reaches) the full reserve -> cap error, not slippage/K error.
        uint256 hugeA = 5_000_000 * DEC6;
        uint256 outB = _quote(hugeA, true);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.OutputCapExceeded.selector, outB, pool.reserveB() / 2));
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), hugeA, 0, type(uint256).max);

        uint256 hugeB = 50 * DEC8;
        uint256 outA = _quote(hugeB, false);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.OutputCapExceeded.selector, outA, pool.reserveA() / 2));
        vm.prank(bob);
        pool.swap(address(cirBtc), address(eurc), hugeB, 0, type(uint256).max);
    }

    function test_SwapCap_CheckedBeforeSlippage() public {
        _seedPool();
        _fundBobForCap();
        uint256 hugeA = 5_000_000 * DEC6;
        uint256 outB = _quote(hugeA, true);
        // minOut also unreachable, but the cap error takes precedence.
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.OutputCapExceeded.selector, outB, pool.reserveB() / 2));
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), hugeA, type(uint256).max, type(uint256).max);
    }
}
