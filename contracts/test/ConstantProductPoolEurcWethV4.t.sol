// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolEurcWethV4} from "../src/v4/ConstantProductPoolEurcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit & integration tests for ConstantProductPoolEurcWethV4
///         (EURC 6-dec / WETH 18-dec, x*y=k, real-yield harvest).
///         Covers all original happy-path tests plus the full audit-remediation
///         test additions (removeLiquidity while paused, harvest while paused,
///         skim third token, proportional-deposit enforcement, zero-fee rejection,
///         k-invariant assertion, Ownable2Step, and additional edge cases).
contract ConstantProductPoolEurcWethV4Test is Test {
    ConstantProductPoolEurcWethV4 pool;
    MockERC20 eurc;
    MockERC20 weth;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);

    uint256 constant DEC6  = 1e6;   // EURC decimals
    uint256 constant DEC18 = 1e18;  // WETH decimals

    // ── Setup ─────────────────────────────────────────────────────────────────

    function setUp() public {
        eurc = new MockERC20("Euro Coin",     "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pool = new ConstantProductPoolEurcWethV4(address(eurc), address(weth), 30, owner);

        eurc.mint(alice, 10_000_000 * DEC6);
        weth.mint(alice,      1_000 * DEC18);
        eurc.mint(bob,   10_000_000 * DEC6);
        weth.mint(bob,        1_000 * DEC18);
    }

    function _approveAlice() internal {
        vm.startPrank(alice);
        eurc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _approveBob() internal {
        vm.startPrank(bob);
        eurc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    /// @dev Add 240,000 EURC + 100 WETH initial liquidity from alice.
    function _seedPool() internal {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(240_000 * DEC6, 100 * DEC18, 0, type(uint256).max);
    }

    // ── Original tests (updated for new error signatures) ────────────────────

    function test_LpDecimalsStandardized18() public view {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
    }

    function test_InitialLiquidityMintingMath() public {
        _approveAlice();

        // 1 WETH = 2,400 EURC
        uint256 amountA = 24_000 * DEC6; // 24,000 EURC
        uint256 amountB = 10 * DEC18;    // 10 WETH

        vm.prank(alice);
        uint256 lpShares = pool.addLiquidity(amountA, amountB, 0, type(uint256).max);

        assertGt(lpShares, 0, "Alice should receive LP shares");
        assertEq(pool.balanceOf(alice), lpShares);
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), pool.MINIMUM_LIQUIDITY());
        assertEq(pool.reserveA(), amountA);
        assertEq(pool.reserveB(), amountB);
    }

    function test_SwapEurcToWeth() public {
        _seedPool();
        _approveBob();

        uint256 bobEurcIn   = 2_400 * DEC6;
        uint256 bobWethBefore = weth.balanceOf(bob);

        vm.prank(bob);
        uint256 wethOut = pool.swap(address(eurc), address(weth), bobEurcIn, 0, type(uint256).max);

        assertGt(wethOut, 0, "Bob must receive WETH");
        assertEq(weth.balanceOf(bob) - bobWethBefore, wethOut);
        // Fee (30 bps on 2400 EURC) should be in feeReserveA
        assertEq(pool.unclaimedFeeA(), (bobEurcIn * 30) / 10000);
    }

    function test_SwapWethToEurc() public {
        _seedPool();
        _approveBob();

        uint256 bobWethIn   = 1 * DEC18;
        uint256 bobEurcBefore = eurc.balanceOf(bob);

        vm.prank(bob);
        uint256 eurcOut = pool.swap(address(weth), address(eurc), bobWethIn, 0, type(uint256).max);

        assertGt(eurcOut, 0, "Bob must receive EURC");
        assertEq(eurc.balanceOf(bob) - bobEurcBefore, eurcOut);
        // Fee (30 bps on 1 WETH) should be in feeReserveB
        assertEq(pool.unclaimedFeeB(), (bobWethIn * 30) / 10000);
    }

    function test_HarvestAccruedFees() public {
        _seedPool();
        _approveBob();

        vm.startPrank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);
        pool.swap(address(weth), address(eurc), 1 * DEC18,    0, type(uint256).max);
        vm.stopPrank();

        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertGt(pendingA, 0, "Alice should have pending EURC fees");
        assertGt(pendingB, 0, "Alice should have pending WETH fees");

        uint256 aliceEurcBefore = eurc.balanceOf(alice);
        uint256 aliceWethBefore = weth.balanceOf(alice);

        vm.prank(alice);
        (uint256 feeA, uint256 feeB) = pool.harvest();

        assertEq(feeA, pendingA);
        assertEq(feeB, pendingB);
        assertEq(eurc.balanceOf(alice) - aliceEurcBefore, feeA);
        assertEq(weth.balanceOf(alice) - aliceWethBefore, feeB);

        (uint256 pendingAAfter, uint256 pendingBAfter) = pool.pendingFees(alice);
        assertEq(pendingAAfter, 0);
        assertEq(pendingBAfter, 0);
    }

    function test_SkimExcessTokens() public {
        // Donate tokens directly, bypassing addLiquidity, then verify skim recovers them.
        eurc.mint(address(pool), 500 * DEC6);
        assertEq(eurc.balanceOf(address(pool)), 500 * DEC6);

        address recipient = address(0x9999);
        pool.skim(address(eurc), recipient);

        assertEq(eurc.balanceOf(recipient),    500 * DEC6);
        assertEq(eurc.balanceOf(address(pool)), 0);
    }

    // ── M-02: zero-fee pool rejected ─────────────────────────────────────────

    function test_Constructor_RejectsZeroFeeBps() public {
        vm.expectRevert();
        new ConstantProductPoolEurcWethV4(address(eurc), address(weth), 0, owner);
    }

    function test_Constructor_RejectsFeeBpsAbove1000() public {
        vm.expectRevert();
        new ConstantProductPoolEurcWethV4(address(eurc), address(weth), 1001, owner);
    }

    function test_Constructor_AcceptsMaxValidFee() public {
        ConstantProductPoolEurcWethV4 p =
            new ConstantProductPoolEurcWethV4(address(eurc), address(weth), 1000, owner);
        assertEq(p.swapFeeBps(), 1000);
    }

    // ── M-01: Ownable2Step ────────────────────────────────────────────────────

    function test_OwnershipTransferIsTwoStep() public {
        address newOwner = address(0xBEEF);

        // initiate -- does not take effect immediately
        pool.transferOwnership(newOwner);
        assertEq(pool.owner(), owner, "Owner should not change until new owner accepts");
        assertEq(pool.pendingOwner(), newOwner);

        // accept -- only then does ownership transfer
        vm.prank(newOwner);
        pool.acceptOwnership();
        assertEq(pool.owner(), newOwner);
    }

    function test_PendingOwner_CannotActAsOwner() public {
        address newOwner = address(0xBEEF);
        pool.transferOwnership(newOwner);

        // pending owner cannot pause before accepting
        vm.prank(newOwner);
        vm.expectRevert();
        pool.pause();
    }

    // ── H-01: proportional-deposit enforcement ────────────────────────────────

    function test_SubsequentDeposit_ProportionalAmountsAccepted() public {
        _seedPool();
        _approveBob();

        // reserveA=240,000 EURC, reserveB=100 WETH → ratio: 2400:1
        // Bob adds exactly proportional: 24,000 EURC & 10 WETH
        uint256 reserveABefore = pool.reserveA();
        uint256 reserveBBefore = pool.reserveB();

        vm.prank(bob);
        uint256 lpShares = pool.addLiquidity(24_000 * DEC6, 10 * DEC18, 0, type(uint256).max);
        assertGt(lpShares, 0);

        // Both reserves must have increased by exactly the amounts provided
        assertEq(pool.reserveA() - reserveABefore, 24_000 * DEC6);
        assertEq(pool.reserveB() - reserveBBefore, 10 * DEC18);
    }

    function test_SubsequentDeposit_ExcessTokenBCapped_NotDonated() public {
        _seedPool();
        _approveBob();

        // ratio is 2400:1. Bob offers 24,000 EURC and 20 WETH (2x too much WETH).
        // Contract should use only 10 WETH (the proportional amount) and NOT pull 20 WETH.
        uint256 bobWethBefore = weth.balanceOf(bob);
        uint256 reserveBBefore = pool.reserveB();

        vm.prank(bob);
        pool.addLiquidity(24_000 * DEC6, 20 * DEC18, 0, type(uint256).max);

        // Only 10 WETH (proportional) should have been pulled
        uint256 wethPulled = bobWethBefore - weth.balanceOf(bob);
        assertEq(wethPulled, 10 * DEC18, "Contract must pull only proportional WETH, not excess");
        assertEq(pool.reserveB() - reserveBBefore, 10 * DEC18);
    }

    function test_SubsequentDeposit_SmallEurc_PullsProportionalWeth() public {
        _seedPool();
        _approveBob();

        // ratio is 2400:1 (reserveA=240000e6, reserveB=100e18).
        // Bob offers 1 EURC and 10 WETH as the upper bound.
        // optimalB = 1e6 * 100e18 / 240000e6 = 416666 raw WETH wei (tiny).
        // 416666 <= 10e18, so tokenA is the limiting side; only ~416666 WETH raw is pulled.
        uint256 bobWethBefore = weth.balanceOf(bob);
        vm.prank(bob);
        pool.addLiquidity(1 * DEC6, 10 * DEC18, 0, type(uint256).max);
        uint256 wethPulled = bobWethBefore - weth.balanceOf(bob);
        // Should be far less than 10 WETH (only proportional fraction pulled)
        assertLt(wethPulled, 1 * DEC18, "Only proportional WETH fraction should be pulled");
        assertGt(wethPulled, 0, "Some WETH must be pulled to maintain ratio");
    }

    function test_SubsequentDeposit_ExcessTokenAReverts_WhenOverBound() public {
        _seedPool();
        _approveBob();

        // ratio is 2400:1. Bob offers only 1 WETH as amountBIn but wants amountAIn = 10,000 EURC.
        // optimalB = 10000e6 * 100e18 / 240000e6 ≈ 4166666666666666 raw WETH wei ≈ 0.00416 WETH.
        // optimalB (0.00416 WETH) <= amountBIn (1 WETH), so tokenA is limiting, actualB = optimalB.
        // This should succeed with no revert.
        // To trigger ExcessiveTokenARequired we need tokenB to be limiting:
        //   amountBIn = 1 WETH, amountAIn = 1 EURC.
        //   optimalB = 1e6 * 100e18 / 240000e6 = 416666 raw WETH.
        //   optimalB (416666) <= 1e18 → tokenA limiting → no revert (covered above).
        //   Force tokenB limiting: set amountBIn very small so optimalB > amountBIn.
        //   amountBIn = 1 raw WETH wei, amountAIn = 24000e6.
        //   optimalB = 24000e6 * 100e18 / 240000e6 = 10e18 >> 1 wei.
        //   So tokenB is limiting; optimalA = 1 * 240000e6 / 100e18 = 0 → lpShares = 0 → SlippageExceeded.
        vm.prank(bob);
        vm.expectRevert();
        pool.addLiquidity(24_000 * DEC6, 1, 0, type(uint256).max);
    }

    function test_SubsequentDeposit_LpSharesProportional() public {
        _seedPool();
        _approveBob();

        uint256 totalLpBefore = pool.totalLp();

        vm.prank(bob);
        // Bob adds exactly 10% more proportional liquidity
        uint256 lpShares = pool.addLiquidity(24_000 * DEC6, 10 * DEC18, 0, type(uint256).max);

        // LP shares should be exactly 10% of current total (240k/2400k * total)
        // reserveA=240000, added 24000 → 10% of pool
        assertApproxEqRel(lpShares, totalLpBefore / 10, 1e15, "LP shares should be ~10% of pool");
    }

    // ── L-01: sqrt dust guard on initial deposit ─────────────────────────────

    function test_InitialDeposit_RejectsDustAmounts() public {
        _approveAlice();
        // 1 EURC (raw: 1e6) * 1 WETH (raw: 1e18) → sqrt(1e24) = 1e12 → * 1e6 = 1e18 LP. Fine.
        // But 1 EURC raw (1e6) * 1 WETH raw (1e18) is fine; 1 * 1 raw (sub-unit) is tiny.
        // Test the extreme: amountA=1 (1 raw EURC unit) * amountB=1 (1 raw WETH unit)
        // sqrt(1) = 1 < 1e6 → revert.
        eurc.mint(owner, 1);
        weth.mint(owner, 1);
        eurc.approve(address(pool), 1);
        weth.approve(address(pool), 1);
        vm.expectRevert();
        pool.addLiquidity(1, 1, 0, type(uint256).max);
    }

    function test_InitialDeposit_RejectsSubSqrtThreshold() public {
        _approveAlice();
        // sqrt(1e11) ≈ 316227 < 1e6 → should revert
        // Use 1 EURC raw (1e6) * 1e5 WETH raw → product = 1e11
        eurc.mint(owner, 1 * DEC6);
        weth.mint(owner, 1e5);
        eurc.approve(address(pool), 1 * DEC6);
        weth.approve(address(pool), 1e5);
        vm.expectRevert();
        pool.addLiquidity(1 * DEC6, 1e5, 0, type(uint256).max);
    }

    // ── Pausability: removeLiquidity and harvest must work while paused ───────

    function test_RemoveLiquidity_WorksWhilePaused() public {
        _seedPool();

        // Pause trading
        pool.pause();
        assertTrue(pool.paused());

        uint256 aliceLp = pool.balanceOf(alice);
        assertGt(aliceLp, 0);

        // removeLiquidity should succeed even while paused
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(aliceLp, 0, 0);

        assertGt(outA, 0, "Alice should receive EURC on exit");
        assertGt(outB, 0, "Alice should receive WETH on exit");
        assertEq(pool.balanceOf(alice), 0);
    }

    function test_Harvest_WorksWhilePaused() public {
        _seedPool();
        _approveBob();

        // Generate fees before pausing
        vm.prank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);

        // Pause
        pool.pause();
        assertTrue(pool.paused());

        (uint256 pendingA,) = pool.pendingFees(alice);
        assertGt(pendingA, 0, "Alice should have pending fees even while paused");

        // harvest must work while paused
        vm.prank(alice);
        (uint256 feeA,) = pool.harvest();
        assertGt(feeA, 0);
        // feeB may be zero when only one swap direction occurred -- that is acceptable
    }

    function test_AddLiquidity_RevertsWhilePaused() public {
        _seedPool();
        pool.pause();
        _approveBob();

        vm.prank(bob);
        vm.expectRevert();
        pool.addLiquidity(24_000 * DEC6, 10 * DEC18, 0, type(uint256).max);
    }

    function test_Swap_RevertsWhilePaused() public {
        _seedPool();
        pool.pause();
        _approveBob();

        vm.prank(bob);
        vm.expectRevert();
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);
    }

    // ── Skim: third token (not tokenA or tokenB) ─────────────────────────────

    function test_Skim_ThirdToken_ReturnsFullBalance() public {
        MockERC20 stray = new MockERC20("Stray Token", "STRAY", 18);
        stray.mint(address(pool), 1_000 * DEC18);

        address recipient = address(0xABCD);
        pool.skim(address(stray), recipient);

        assertEq(stray.balanceOf(recipient),    1_000 * DEC18);
        assertEq(stray.balanceOf(address(pool)), 0);
    }

    function test_Skim_DoesNotRemoveReserves() public {
        _seedPool();

        // Donate extra tokenA above reserves
        eurc.mint(address(pool), 100 * DEC6);
        uint256 reserveABefore = pool.reserveA();

        pool.skim(address(eurc), owner);

        // reserves must be untouched
        assertEq(pool.reserveA(), reserveABefore);
        // donated tokens were recovered
        assertEq(eurc.balanceOf(owner), 100 * DEC6);
    }

    function test_Skim_DoesNotRemoveFeeReserves() public {
        _seedPool();
        _approveBob();

        // Generate fees
        vm.prank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);

        uint256 feeReserveBefore = pool.unclaimedFeeA();
        assertGt(feeReserveBefore, 0);

        // No surplus above reserveA + feeReserveA; skim should take nothing
        pool.skim(address(eurc), owner);

        assertEq(pool.unclaimedFeeA(), feeReserveBefore, "Fee reserve must not be skimmed");
    }

    // ── k-invariant preservation across swaps ─────────────────────────────────

    function test_KInvariant_PreservedAfterEurcToWeth() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after swap");
    }

    function test_KInvariant_PreservedAfterWethToEurc() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(weth), address(eurc), 1 * DEC18, 0, type(uint256).max);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after swap");
    }

    function test_KInvariant_PreservedAfterMultipleSwaps() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.startPrank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);
        pool.swap(address(weth), address(eurc), 1 * DEC18,    0, type(uint256).max);
        pool.swap(address(eurc), address(weth), 4_800 * DEC6, 0, type(uint256).max);
        vm.stopPrank();

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease across multiple swaps");
    }

    // ── contract balance invariant: balance >= reserve + feeReserve ──────────

    function test_ContractBalance_CoversReservePlusFees_AfterSwaps() public {
        _seedPool();
        _approveBob();

        vm.startPrank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);
        pool.swap(address(weth), address(eurc), 1 * DEC18,    0, type(uint256).max);
        vm.stopPrank();

        assertGe(
            eurc.balanceOf(address(pool)),
            pool.reserveA() + pool.unclaimedFeeA(),
            "EURC balance must cover reserveA + feeReserveA"
        );
        assertGe(
            weth.balanceOf(address(pool)),
            pool.reserveB() + pool.unclaimedFeeB(),
            "WETH balance must cover reserveB + feeReserveB"
        );
    }

    // ── volume24h view functions (M-04) ──────────────────────────────────────

    function test_Volume24h_ReturnsZero_AfterWindowExpiry() public {
        _seedPool();
        _approveBob();

        vm.prank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);

        assertGt(pool.volume24hA(), 0, "volume should be non-zero within window");

        // advance time past the 24h window
        vm.warp(block.timestamp + 1 days + 1);

        assertEq(pool.volume24hA(), 0, "volume24hA must return 0 after window expiry");
        assertEq(pool.volume24hB(), 0, "volume24hB must return 0 after window expiry");
    }

    function test_Volume24h_ResetsOnNextSwap() public {
        _seedPool();
        _approveBob();

        vm.prank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);
        uint256 volBefore = pool.volume24hA();
        assertGt(volBefore, 0);

        // advance past window and swap again to trigger lazy reset
        vm.warp(block.timestamp + 1 days + 1);

        vm.prank(bob);
        pool.swap(address(eurc), address(weth), 1_200 * DEC6, 0, type(uint256).max);

        // volume must now reflect only the new window
        assertEq(pool.volume24hA(), 1_200 * DEC6, "volume must reflect only new-window swap");
    }

    // ── Deadline guards ───────────────────────────────────────────────────────

    function test_AddLiquidity_RevertsOnExpiredDeadline() public {
        _approveAlice();
        vm.warp(1000);
        vm.prank(alice);
        vm.expectRevert();
        pool.addLiquidity(24_000 * DEC6, 10 * DEC18, 0, 999); // deadline in the past
    }

    function test_Swap_RevertsOnExpiredDeadline() public {
        _seedPool();
        _approveBob();
        vm.warp(1000);
        vm.prank(bob);
        vm.expectRevert();
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, 999);
    }

    // ── DustSwapNotAllowed ────────────────────────────────────────────────────

    function test_Swap_RevertsDustSwap_ZeroFee() public {
        _seedPool();
        _approveBob();

        // With 30 bps fee, smallest amountIn that produces fee >= 1 is ceil(10000/30) = 334.
        // amountIn = 1 → fee = (1 * 30) / 10000 = 0 → DustSwapNotAllowed
        eurc.mint(bob, 1);
        vm.prank(bob);
        vm.expectRevert();
        pool.swap(address(eurc), address(weth), 1, 0, type(uint256).max);
    }

    // ── 50% drain cap ─────────────────────────────────────────────────────────

    function test_Swap_Reverts_On50PctDrainAttempt() public {
        _seedPool();
        _approveBob();

        // reserveB = 100 WETH; output capped at 50 WETH.
        // To get > 50 WETH out we need a very large EURC in.
        // amountOut > reserveB/2 → revert SlippageExceeded
        // Use a huge EURC amount; mint enough for bob.
        eurc.mint(bob, 500_000 * DEC6);
        vm.prank(bob);
        vm.expectRevert();
        pool.swap(address(eurc), address(weth), 500_000 * DEC6, 0, type(uint256).max);
    }

    // ── Multi-LP fee distribution ─────────────────────────────────────────────

    function test_TwoLPs_ProportionalFeeDistribution() public {
        _approveAlice();
        _approveBob();

        // Alice adds 240,000 EURC + 100 WETH
        vm.prank(alice);
        pool.addLiquidity(240_000 * DEC6, 100 * DEC18, 0, type(uint256).max);

        // Bob adds equal proportional liquidity (he gets ~equal LP shares)
        vm.prank(bob);
        pool.addLiquidity(240_000 * DEC6, 100 * DEC18, 0, type(uint256).max);

        // A third party performs a swap to generate fees (use owner for simplicity)
        address swapper = address(0xDEAD1);
        eurc.mint(swapper, 2_400 * DEC6);
        vm.startPrank(swapper);
        eurc.approve(address(pool), type(uint256).max);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);
        vm.stopPrank();

        (uint256 alicePendingA,) = pool.pendingFees(alice);
        (uint256 bobPendingA,)   = pool.pendingFees(bob);

        assertGt(alicePendingA, 0,  "Alice must have pending fees");
        assertGt(bobPendingA,   0,  "Bob must have pending fees");

        // Alice and Bob have equal LP shares → should receive equal fees (within 1 wei rounding)
        assertApproxEqAbs(alicePendingA, bobPendingA, 1, "Equal LPs must receive equal fees");
    }

    // ── NoLiquidityProviders guard ────────────────────────────────────────────

    function test_Swap_Reverts_NoLiquidityProviders() public {
        // Pool is fresh (no liquidity) -- eligible supply = 0
        _approveBob();
        vm.prank(bob);
        vm.expectRevert();
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);
    }

    // ── InvalidTokenPair ─────────────────────────────────────────────────────

    function test_Swap_Reverts_InvalidTokenPair() public {
        _seedPool();
        _approveBob();
        vm.prank(bob);
        vm.expectRevert();
        pool.swap(address(eurc), address(eurc), 2_400 * DEC6, 0, type(uint256).max);
    }

}
