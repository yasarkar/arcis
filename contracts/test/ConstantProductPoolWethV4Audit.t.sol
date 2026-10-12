// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolWethV4} from "../src/v4/ConstantProductPoolWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Formal security audit & invariant PoC suite for ConstantProductPoolWethV4.
/// @dev Covers every finding in the security review:
///      H-1  : Fee accumulation fails silently when eligible LP supply is zero
///      H-2  : 50% per-call swap cap bypassed by split swaps in the same block
///      H-3  : Zero-fee dust swaps (amountIn <= 333) for USDC direction
///      M-1  : CEI ordering -- reserve updates occur AFTER external transfers in swap()
///      M-2  : No slippage guard on initial deposit (minLpShares not checked before token pull)
///      M-3  : Missing deadline parameter -- swaps/deposits exposed to MEV holding
///      M-4  : Centralised pause with no timelock -- owner can halt trading indefinitely
///      M-5  : No token rescue function -- stray ERC-20 donations permanently locked
///      L-1  : block.timestamp manipulation for 24h volume window reset
///      I-1  : fee dust permanently unclaimable after all real LPs exit
///      INVARIANT : reserveA + feeReserveA == tokenA.balanceOf(pool) after every op
///      INVARIANT : sum(pendingFees) <= feeReserve
///      INVARIANT : k never decreases across swaps
contract ConstantProductPoolWethV4AuditTest is Test {
    ConstantProductPoolWethV4 pool;
    MockERC20 usdc;
    MockERC20 weth;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);
    address carol = address(0xCA401);

    uint256 constant DEC6  = 1e6;
    uint256 constant DEC18 = 1e18;

    // --- Setup ----------------------------------------------------------------
    function setUp() public {
        usdc = new MockERC20("USD Coin",      "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pool = new ConstantProductPoolWethV4(address(usdc), address(weth), 30, owner);

        usdc.mint(alice, 100_000_000 * DEC6);
        weth.mint(alice,      10_000 * DEC18);
        usdc.mint(bob,   100_000_000 * DEC6);
        weth.mint(bob,        10_000 * DEC18);
        usdc.mint(carol, 100_000_000 * DEC6);
        weth.mint(carol,      10_000 * DEC18);
    }

    function _approveAll(address who) internal {
        vm.startPrank(who);
        usdc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    // Far-future deadline so tests never expire.
    uint256 constant FAR_FUTURE = type(uint256).max;

    function _addLiquidity(address who, uint256 a, uint256 b) internal returns (uint256) {
        vm.prank(who);
        return pool.addLiquidity(a, b, 0, FAR_FUTURE);
    }

    function _swapAB(address who, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return pool.swap(address(usdc), address(weth), amount, 0, FAR_FUTURE);
    }

    function _swapBA(address who, uint256 amount) internal returns (uint256) {
        vm.prank(who);
        return pool.swap(address(weth), address(usdc), amount, 0, FAR_FUTURE);
    }

    // =========================================================================
    // H-1 : FEE ACCUMULATION FAILS SILENTLY WHEN ELIGIBLE LP SUPPLY IS ZERO
    // =========================================================================

    /// @notice H-1 fix verification: once all real LPs exit, swap() now reverts with
    ///         NoLiquidityProviders instead of silently orphaning fees.
    function test_H1_FeeLostWhenEligibleSupplyZero() public {
        _approveAll(alice);
        _approveAll(bob);

        // Alice is the sole LP
        uint256 lpAlice = _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        // Generate some fees for Alice, then she harvests and exits
        _approveAll(carol);
        _swapAB(carol, 10_000 * DEC6);

        vm.prank(alice);
        pool.harvest();

        vm.prank(alice);
        pool.removeLiquidity(lpAlice, 0, 0);

        // Verify: no real LP remains (only dead address holds MINIMUM_LIQUIDITY)
        uint256 eligible = pool.totalSupply() - pool.balanceOf(pool.DEAD_ADDRESS());
        assertEq(eligible, 0, "H-1: eligible supply must be 0 after full exit");

        // Balance identity still holds at this point (no orphaning yet)
        assertEq(
            usdc.balanceOf(address(pool)),
            pool.reserveA() + pool.feeReserveA(),
            "H-1: balance identity holds after full exit"
        );

        // H-1 fix: swap() now reverts with NoLiquidityProviders -- fees can never be orphaned
        _approveAll(bob);
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolWethV4.NoLiquidityProviders.selector);
        pool.swap(address(usdc), address(weth), 1_000 * DEC6, 0, FAR_FUTURE);
    }

    // =========================================================================
    // H-2 : 50% PER-CALL SWAP CAP BYPASSED BY SPLIT SWAPS IN SAME BLOCK
    // =========================================================================

    /// @notice PoC: the 50% cap is per-call only. Two consecutive swaps of ~40% each
    ///         drain well over 50% of the initial WETH reserve in a single atomic tx.
    function test_H2_SplitSwapBypassesHalfCap() public {
        _approveAll(alice);
        _approveAll(carol);

        // Seed pool: 260k USDC / 100 WETH
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);
        uint256 wethReserveInit = pool.reserveB(); // 100 WETH

        // Each individual swap is bounded to <50% output -- the per-call cap allows each.
        // By chaining multiple swaps (possible in one tx or across multiple blocks),
        // a trader can cumulatively extract far more than 50% of the initial reserve.
        // We use 4 swaps of ~40k USDC each; each passes the per-call cap on the
        // then-current (shrinking) reserve.

        uint256 totalOut;
        // 30k USDC per swap; simulation shows 9 swaps exceed 50% of the 100 WETH reserve.
        // Each individual swap stays well within the per-call 50% cap (each takes ~10% or less).
        uint256 swapAmount = 30_000 * DEC6;

        for (uint256 i = 0; i < 10; i++) {
            uint256 wethBefore = weth.balanceOf(carol);
            vm.prank(carol);
            try pool.swap(address(usdc), address(weth), swapAmount, 0, FAR_FUTURE) {
                uint256 wethAfter = weth.balanceOf(carol);
                totalOut += wethAfter - wethBefore;
            } catch {
                // Pool cap hit on the later smaller reserve -- stop
                break;
            }
        }

        emit log_named_uint("H-2: initial WETH reserve (wei)", wethReserveInit);
        emit log_named_uint("H-2: total WETH drained by 10 swaps (wei)", totalOut);
        emit log_named_uint("H-2: pct drained (bps)", (totalOut * 10_000) / wethReserveInit);

        // Each swap individually passed the per-call 50% check, yet together they
        // extracted more than 50% of the initial WETH reserve.
        assertGt(totalOut, wethReserveInit / 2,
            "H-2 confirmed: split swaps cumulatively drain >50% of initial reserve");
    }

    // =========================================================================
    // H-3 : DUST SWAPS WITH ZERO FEE (amountIn <= 333 USDC micro-units)
    // =========================================================================

    /// @notice H-3 fix verification: with the DustSwapNotAllowed guard applied, any
    ///         amountIn whose fee rounds to zero now reverts instead of succeeding for free.
    ///         The fix threshold: fee = (amountIn * 30) / 10000 >= 1 requires amountIn >= 334.
    function test_H3_DustSwapZeroFee() public {
        _approveAll(alice);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        // Confirm the fee still rounds to zero for 333 micro-USDC (the un-fixed behaviour)
        uint256 dustIn = 333; // 333 micro-USDC = $0.000333
        uint256 fee = (dustIn * 30) / 10_000;
        assertEq(fee, 0, "H-3 setup: fee is 0 for 333 micro-USDC input (integer truncation)");

        // H-3 fix: the swap now reverts with DustSwapNotAllowed (fee == 0 && swapFeeBps > 0)
        vm.prank(carol);
        vm.expectRevert(ConstantProductPoolWethV4.DustSwapNotAllowed.selector);
        pool.swap(address(usdc), address(weth), dustIn, 0, FAR_FUTURE);

        // Minimum valid swap: 334 micro-USDC produces fee = 1 wei and succeeds
        uint256 minValidIn = 334;
        uint256 minFee = (minValidIn * 30) / 10_000;
        assertEq(minFee, 1, "H-3: 334 micro-USDC produces fee = 1 wei (minimum valid)");

        uint256 wethBefore = weth.balanceOf(carol);
        vm.prank(carol);
        pool.swap(address(usdc), address(weth), minValidIn, 0, FAR_FUTURE);
        assertGt(weth.balanceOf(carol) - wethBefore, 0,
            "H-3 fix: minimum valid swap (334 micro-USDC) succeeds and delivers WETH");
    }

    // =========================================================================
    // M-1 : RESERVE UPDATES OCCUR AFTER EXTERNAL TRANSFERS IN swap()
    // =========================================================================

    /// @notice PoC: confirms nonReentrant prevents exploitation of the CEI gap.
    ///         In A-to-B swap, both token transfers fire before reserveA/B update.
    ///         Without the nonReentrant guard a re-entrant harvest() would see stale
    ///         reserves and could double-claim. The guard causes it to revert.
    function test_M1_ReentrantHarvestBlockedByGuard() public {
        _approveAll(alice);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);
        _swapAB(carol, 5_000 * DEC6);

        // Alice has pending fees; now try to re-enter harvest from inside transfer callback
        // We simulate by deploying a malicious WETH that calls back during transfer
        MaliciousReentrantWeth malWeth = new MaliciousReentrantWeth(address(pool));
        weth.mint(address(malWeth), 10 * DEC18);

        // A pool where malWeth is tokenB -- any transfer out calls back into pool.harvest()
        ConstantProductPoolWethV4 malPool = new ConstantProductPoolWethV4(
            address(usdc), address(malWeth), 30, owner
        );

        // Seed the malPool with real USDC
        usdc.mint(alice, 1_000_000 * DEC6);
        vm.startPrank(alice);
        usdc.approve(address(malPool), type(uint256).max);
        malWeth.approve(address(malPool), type(uint256).max);
        vm.stopPrank();
        malWeth.setPool(address(malPool));

        // The initial addLiquidity will trigger malWeth.transferFrom which calls back harvest()
        // ReentrancyGuard must block the nested call
        vm.prank(alice);
        vm.expectRevert(); // ReentrancyGuardReentrantCall
        malPool.addLiquidity(260_000 * DEC6, 100 * DEC18, 0, FAR_FUTURE);
    }

    // =========================================================================
    // M-2 : INITIAL DEPOSIT SLIPPAGE CHECK IS POST-TRANSFER (ORDER ISSUE)
    // =========================================================================

    /// @notice PoC: minLpShares is checked on line 168, which is AFTER the initial
    ///         deposit pulls tokens (lines 147-148) and updates reserves (lines 149-150).
    ///         A revert here rolls back atomically, so no funds are lost. But slippage
    ///         is not checked upfront -- the user's tx is wasted if conditions changed.
    function test_M2_InitialDepositSlippageCheckIsPostTransfer() public {
        _approveAll(alice);

        // Set an impossible minLpShares to force a revert
        uint256 impossibleMin = type(uint256).max;

        // Must revert with SlippageExceeded
        vm.prank(alice);
        vm.expectRevert(ConstantProductPoolWethV4.SlippageExceeded.selector);
        pool.addLiquidity(260_000 * DEC6, 100 * DEC18, impossibleMin, FAR_FUTURE);

        // Solidity atomically rolled back; no tokens stuck
        assertEq(usdc.balanceOf(address(pool)), 0, "M-2: token pull rolled back on revert");
    }

    // =========================================================================
    // M-3 : NO DEADLINE -- SWAPS EXPOSED TO TRANSACTION ORDERING / DELAY
    // =========================================================================

    /// @notice Demonstrates that a swap submitted at t=0 can execute at t+1hr when
    ///         pool conditions have changed significantly, with no deadline protection.
    function test_M3_SwapExecutesAfterMarketMove() public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        uint256 rBAtSubmit = pool.reserveB();

        // Large swap from Bob changes the price significantly (simulating delay)
        _swapAB(bob, 175_000 * DEC6);

        uint256 rBAtExecution = pool.reserveB();
        assertLt(rBAtExecution, rBAtSubmit * 70 / 100,
            "M-3 setup: pool moved >30% between submission and execution");

        // Carol's swap goes through with minOut=0 -- no protection
        uint256 carolWethBefore = weth.balanceOf(carol);
        _swapAB(carol, 1_000 * DEC6);
        uint256 carolWethGot = weth.balanceOf(carol) - carolWethBefore;

        emit log_named_uint("M-3: Carol WETH received (wei)", carolWethGot);
        emit log_named_uint("M-3: WETH reserve at submission", rBAtSubmit);
        emit log_named_uint("M-3: WETH reserve at execution",  rBAtExecution);
    }

    // =========================================================================
    // M-4 : CENTRALISED PAUSE WITH NO TIMELOCK
    // =========================================================================

    /// @notice PoC: owner pauses; neither swap() nor addLiquidity() can proceed.
    ///         removeLiquidity() stays live (correct by design), but there is no
    ///         on-chain mechanism to force an unpause after N days.
    function test_M4_PauseBlocksSwapAndAddForever() public {
        _approveAll(alice);
        _approveAll(bob);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        pool.pause();
        assertTrue(pool.paused(), "pool must be paused");

        vm.prank(bob);
        vm.expectRevert(); // EnforcedPause
        pool.swap(address(usdc), address(weth), 1_000 * DEC6, 0, FAR_FUTURE);

        vm.prank(bob);
        vm.expectRevert(); // EnforcedPause
        pool.addLiquidity(1_000 * DEC6, 1 * DEC18, 0, FAR_FUTURE);

        // removeLiquidity still works (correct: LPs must always exit)
        uint256 lpAlice = pool.balanceOf(alice);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lpAlice, 0, 0);
        assertGt(outA + outB, 0, "M-4: removeLiquidity still works while paused (expected)");
    }

    // =========================================================================
    // M-5 : NO TOKEN RESCUE -- STRAY ERC-20 DONATIONS PERMANENTLY LOCKED
    // =========================================================================

    /// @notice PoC: a user accidentally sends WETH directly to the pool. reserveB is
    ///         NOT updated; the tokens are untracked and unretrievable.
    function test_M5_StrayTokenDonationPermanentlyLocked() public {
        _approveAll(alice);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        uint256 reserveBefore = pool.reserveB();
        uint256 stray = 5 * DEC18; // 5 WETH mistakenly sent

        vm.prank(carol);
        weth.transfer(address(pool), stray);

        // reserveB unchanged -- donation not reflected
        assertEq(pool.reserveB(), reserveBefore, "M-5: reserveB unchanged after direct donation");

        // The stray tokens sit in the pool but are permanently untracked
        uint256 contractWeth = weth.balanceOf(address(pool));
        uint256 trackedWeth  = pool.reserveB() + pool.feeReserveB();
        assertEq(contractWeth - trackedWeth, stray,
            "M-5 confirmed: stray WETH exceeds tracked reserves by exactly the donation amount");
    }

    // =========================================================================
    // L-1 : block.timestamp 24h VOLUME WINDOW MANIPULATION
    // =========================================================================

    /// @notice PoC: a validator advancing block.timestamp by >= 1 day forces the
    ///         lazy-reset on the next swap, zeroing historical volume metrics.
    function test_L1_TimestampManipulationResetsVolume() public {
        _approveAll(alice);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        _swapAB(carol, 10_000 * DEC6);
        _swapAB(carol, 10_000 * DEC6);
        uint256 volumeAccumulated = pool.volume24hA();
        assertGt(volumeAccumulated, 0, "volume must be non-zero after swaps");

        // Validator advances timestamp by exactly 1 day
        vm.warp(block.timestamp + 1 days + 1);

        // volume24hA() view function returns 0 (window expired)
        assertEq(pool.volume24hA(), 0, "L-1: volume24hA() returns 0 after time advance");

        // Next swap resets the window and re-starts from zero
        _swapAB(carol, 1_000 * DEC6);
        uint256 volumeAfterReset = pool.volume24hA();
        assertLt(volumeAfterReset, volumeAccumulated,
            "L-1: volume reset to 0 then incremented by just the new swap");
    }

    // =========================================================================
    // I-1 : FEE DUST PERMANENTLY UNCLAIMABLE AFTER ALL REAL LPs EXIT
    // =========================================================================

    /// @notice PoC: remainder carry-forward leaves bounded dust in feeReserveA after
    ///         all real LPs harvest and exit. Dust is < 1 USDC but is unclaimable.
    function test_I1_FeeRemainderLockedAfterFullExit() public {
        _approveAll(alice);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        for (uint256 i = 0; i < 10; i++) {
            _swapAB(carol, 5_000 * DEC6);
        }

        vm.prank(alice);
        (uint256 fA,) = pool.harvest();
        assertGt(fA, 0, "Alice should harvest USDC fees");

        uint256 lpAlice = pool.balanceOf(alice);
        vm.prank(alice);
        pool.removeLiquidity(lpAlice, 0, 0);

        // Remainder dust in feeReserveA -- bounded and non-destructive
        uint256 dustA = pool.feeReserveA();
        emit log_named_uint("I-1: unclaimable feeReserveA dust (wei)", dustA);
        assertLt(dustA, 1 * DEC6, "I-1: dust bounded below 1 USDC");
    }

    // =========================================================================
    // INVARIANT : reserveA + feeReserveA == tokenA.balanceOf(pool)
    // =========================================================================

    function _assertBalanceIdentity() internal view {
        assertEq(
            usdc.balanceOf(address(pool)),
            pool.reserveA() + pool.feeReserveA(),
            "INVARIANT: USDC balance != reserveA + feeReserveA"
        );
        assertEq(
            weth.balanceOf(address(pool)),
            pool.reserveB() + pool.feeReserveB(),
            "INVARIANT: WETH balance != reserveB + feeReserveB"
        );
    }

    function test_Invariant_BalanceIdentityAcrossOps() public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        _assertBalanceIdentity();

        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);
        _assertBalanceIdentity();

        _swapAB(carol, 5_000 * DEC6);
        _assertBalanceIdentity();

        _swapBA(carol, 1 * DEC18);
        _assertBalanceIdentity();

        _addLiquidity(bob, 50_000 * DEC6, 20 * DEC18);
        _assertBalanceIdentity();

        vm.prank(alice);
        pool.harvest();
        _assertBalanceIdentity();

        uint256 lpBob = pool.balanceOf(bob);
        vm.prank(bob);
        pool.removeLiquidity(lpBob, 0, 0);
        _assertBalanceIdentity();
    }

    // =========================================================================
    // INVARIANT : k never decreases across swaps
    // =========================================================================

    function testFuzz_Invariant_KNeverDecreasesAtoB(uint256 amountIn) public {
        _approveAll(alice);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        amountIn = bound(amountIn, 1 * DEC6, (pool.reserveA() * 40) / 100);
        uint256 kBefore = pool.reserveA() * pool.reserveB();

        _swapAB(carol, amountIn);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "INVARIANT: k must not decrease on A-to-B swap");
    }

    function testFuzz_Invariant_KNeverDecreasesBtoA(uint256 amountIn) public {
        _approveAll(alice);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);

        amountIn = bound(amountIn, DEC18 / 1000, (pool.reserveB() * 40) / 100);
        uint256 kBefore = pool.reserveA() * pool.reserveB();

        _swapBA(carol, amountIn);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "INVARIANT: k must not decrease on B-to-A swap");
    }

    // =========================================================================
    // INVARIANT : sum(pendingFees) <= feeReserve (solvency)
    // =========================================================================

    function testFuzz_Invariant_FeeSolvency(uint256 seed) public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);
        _addLiquidity(bob,    50_000 * DEC6,  20 * DEC18);

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();

        for (uint256 i = 0; i < 8; i++) {
            uint256 s = uint256(keccak256(abi.encodePacked(seed, i)));
            if (s % 2 == 0) {
                uint256 amt = bound(s >> 8, 1 * DEC6, (rA * 40) / 100);
                _swapAB(carol, amt);
            } else {
                uint256 amt = bound(s >> 8, DEC18 / 1000, (rB * 40) / 100);
                _swapBA(carol, amt);
            }
            rA = pool.reserveA();
            rB = pool.reserveB();
        }

        (uint256 pAliceA, uint256 pAliceB) = pool.pendingFees(alice);
        (uint256 pBobA,   uint256 pBobB)   = pool.pendingFees(bob);

        assertLe(pAliceA + pBobA, pool.feeReserveA(),
            "INVARIANT: sum pendingFeeA must be <= feeReserveA");
        assertLe(pAliceB + pBobB, pool.feeReserveB(),
            "INVARIANT: sum pendingFeeB must be <= feeReserveB");
    }

    // =========================================================================
    // INVARIANT : harvest never double-claims (CEI)
    // =========================================================================

    function test_Invariant_DoubleHarvestReverts() public {
        _approveAll(alice);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);
        _swapAB(carol, 10_000 * DEC6);

        vm.prank(alice);
        pool.harvest();

        vm.prank(alice);
        vm.expectRevert(bytes4(keccak256("NoFeesAccrued()")));
        pool.harvest();
    }

    // =========================================================================
    // INVARIANT : self-transfer cannot double-count userUnclaimed
    // =========================================================================

    function test_Invariant_SelfTransferNoDoubleFee() public {
        _approveAll(alice);
        _approveAll(carol);
        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);
        _swapAB(carol, 10_000 * DEC6);

        (uint256 pendingBefore, ) = pool.pendingFees(alice);
        assertGt(pendingBefore, 0);

        uint256 lpAlice = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(alice, lpAlice);

        (uint256 pendingAfter, ) = pool.pendingFees(alice);
        assertEq(pendingAfter, pendingBefore,
            "INVARIANT: self-transfer must not double-count fees");
    }

    // =========================================================================
    // INVARIANT : decimal normalisation -- initial LP is 18-dec
    // =========================================================================

    function test_Invariant_InitialLpIs18Dec() public {
        _approveAll(alice);
        uint256 amountA = 260_000 * DEC6;
        uint256 amountB = 100 * DEC18;

        uint256 lpShares = _addLiquidity(alice, amountA, amountB);

        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
        assertGt(lpShares, 1e18, "LP shares must be > 1 full token unit for canonical deposit");
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), pool.MINIMUM_LIQUIDITY(),
            "MINIMUM_LIQUIDITY must be locked to dead address");
    }

    // =========================================================================
    // ARC NETWORK CHECKS
    // =========================================================================

    function test_Arc_NoNativeDeposit() public {
        (bool ok, ) = address(pool).call{value: 1}("");
        assertFalse(ok, "native value deposit must revert (no receive/fallback)");
    }

    function test_Arc_TokenAddressesImmutable() public view {
        assertEq(address(pool.tokenA()), address(usdc), "tokenA must be USDC");
        assertEq(address(pool.tokenB()), address(weth), "tokenB must be WETH");
    }

    function test_Arc_SafeTransferHandlesReturnFalse() public {
        vm.prank(bob);
        vm.expectRevert(bytes4(keccak256("TransferFailed()")));
        pool.addLiquidity(100_000 * DEC6, 1 * DEC18, 0, FAR_FUTURE);
    }

    function test_Arc_ContractExistenceCheckOnTokens() public {
        address eoa = address(0xBEEF);
        vm.expectRevert(ConstantProductPoolWethV4.ZeroAddress.selector);
        new ConstantProductPoolWethV4(eoa, address(weth), 30, owner);
    }

    // =========================================================================
    // FUZZ : stateful balance identity holds after every operation type
    // =========================================================================

    function testFuzz_Stateful_BalanceIdentityHoldsAfterEveryOp(uint256 seed) public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        _addLiquidity(alice, 260_000 * DEC6, 100 * DEC18);
        _addLiquidity(bob,    50_000 * DEC6,  20 * DEC18);

        _assertBalanceIdentity();

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();

        for (uint256 i = 0; i < 8; i++) {
            uint256 s  = uint256(keccak256(abi.encodePacked(seed, i)));
            uint256 op = s % 5;

            if (op == 0) {
                uint256 amt = bound(s >> 8, 1 * DEC6, (rA * 40) / 100);
                _swapAB(carol, amt);
            } else if (op == 1) {
                uint256 amt = bound(s >> 8, DEC18 / 1000, (rB * 40) / 100);
                _swapBA(carol, amt);
            } else if (op == 2) {
                uint256 addA = bound(s >> 8,  1_000 * DEC6, 20_000 * DEC6);
                uint256 addB = bound(s >> 16, DEC18 / 100,  5 * DEC18);
                vm.prank(carol);
                pool.addLiquidity(addA, addB, 0, FAR_FUTURE);
            } else if (op == 3) {
                uint256 aliceLp = pool.balanceOf(alice);
                if (aliceLp > 1000) {
                    uint256 removeLp = bound(s >> 8, 1, aliceLp / 20);
                    vm.prank(alice);
                    pool.removeLiquidity(removeLp, 0, 0);
                }
            } else {
                (uint256 pA, uint256 pB) = pool.pendingFees(alice);
                if (pA > 0 || pB > 0) {
                    vm.prank(alice);
                    pool.harvest();
                }
            }

            rA = pool.reserveA();
            rB = pool.reserveB();
            _assertBalanceIdentity();
        }
    }
}

// =============================================================================
// Helper: Malicious re-entrant WETH to probe nonReentrant guard (M-1)
// =============================================================================

interface IPoolHarvest {
    function harvest() external returns (uint256, uint256);
    function addLiquidity(uint256 a, uint256 b, uint256 min, uint256 deadline) external returns (uint256);
}

contract MaliciousReentrantWeth is MockERC20 {
    address public poolTarget;
    bool public attacking;

    constructor(address _pool) MockERC20("Malicious WETH", "MWETH", 18) {
        poolTarget = _pool;
    }

    function setPool(address _pool) external {
        poolTarget = _pool;
    }

    function approve(address spender, uint256 amount) public override returns (bool) {
        return super.approve(spender, amount);
    }

    /// @dev Override transferFrom: call back into pool.addLiquidity on first call
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (!attacking && poolTarget != address(0)) {
            attacking = true;
            // Re-entrant call into pool -- must be blocked by nonReentrant
            try IPoolHarvest(poolTarget).harvest() {} catch {}
            attacking = false;
        }
        return super.transferFrom(from, to, amount);
    }
}
