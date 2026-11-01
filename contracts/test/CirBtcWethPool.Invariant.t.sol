// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {CirBtcWethPoolHandler} from "./CirBtcWethPool.Handler.t.sol";

/// @notice Multi-actor stateful invariants for the cirBTC/WETH V4 pool (magnified fee ledger, dead-address block,
///         last-LP sweep + restart). The handler drives adds, removes, LP transfers, swaps, harvests, pauses,
///         DEAD-transfer attempts, consolidations and full-exit/restart cycles.
contract CirBtcWethPoolInvariantTest is StdInvariant, Test {
    ConstantProductPoolCirBtcWethV4 internal pool;
    MockERC20 internal btc;
    MockERC20 internal weth;
    CirBtcWethPoolHandler internal handler;
    address[3] internal actors;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        weth = new MockERC20("WETH", "WETH", 18);
        pool = new ConstantProductPoolCirBtcWethV4(address(btc), address(weth), 30, address(this));
        actors = [makeAddr("alice"), makeAddr("bob"), makeAddr("carol")];
        for (uint256 i; i < 3; i++) {
            btc.mint(actors[i], 1e24);
            weth.mint(actors[i], 1e38);
            vm.startPrank(actors[i]);
            btc.approve(address(pool), type(uint256).max);
            weth.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
        vm.prank(actors[0]);
        pool.addLiquidity(10e8, 200e18, 0, type(uint256).max); // 1 BTC = 20 ETH
        vm.roll(block.number + 1); // F-07: expire the seed LP's same-block lock

        handler = new CirBtcWethPoolHandler(pool, btc, weth, actors, address(this));
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](15);
        sels[0] = CirBtcWethPoolHandler.addLiquidity.selector;
        sels[1] = CirBtcWethPoolHandler.removeLiquidity.selector;
        sels[2] = CirBtcWethPoolHandler.transferLp.selector;
        sels[3] = CirBtcWethPoolHandler.swap.selector;
        sels[4] = CirBtcWethPoolHandler.swap.selector; // weight swaps higher
        sels[5] = CirBtcWethPoolHandler.harvest.selector;
        sels[6] = CirBtcWethPoolHandler.roll.selector;
        sels[7] = CirBtcWethPoolHandler.exitAndRestart.selector;
        sels[8] = CirBtcWethPoolHandler.consolidate.selector;
        sels[9] = CirBtcWethPoolHandler.tryTransferToDead.selector;
        sels[10] = CirBtcWethPoolHandler.setPaused.selector;
        sels[11] = CirBtcWethPoolHandler.swap.selector;
        sels[12] = CirBtcWethPoolHandler.removeLiquidityTo.selector;
        sels[13] = CirBtcWethPoolHandler.harvestTo.selector;
        sels[14] = CirBtcWethPoolHandler.roll.selector; // blocks must advance often enough to release locks
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// PROPERTY: sum of every holder's claimable fees never exceeds the isolated fee reserve (per token).
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_FeeClaimsNeverExceedFeeReserve() public view {
        uint256 sumA;
        uint256 sumB;
        for (uint256 i; i < 3; i++) {
            (uint256 fa, uint256 fb) = pool.pendingFees(actors[i]);
            sumA += fa;
            sumB += fb;
        }
        assertLe(sumA, pool.feeReserveA(), "sum pendingFees cirBTC <= feeReserveA");
        assertLe(sumB, pool.feeReserveB(), "sum pendingFees WETH <= feeReserveB");
    }

    /// PROPERTY: the pool always holds at least reserve + feeReserve of each token (no insolvency).
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_PoolBalanceCoversReservesAndFees() public view {
        assertGe(btc.balanceOf(address(pool)), pool.reserveA() + pool.feeReserveA());
        assertGe(weth.balanceOf(address(pool)), pool.reserveB() + pool.feeReserveB());
    }

    /// PROPERTY: x*y never decreases across a successful swap.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_KNonDecreasingAcrossSwaps() public view {
        assertFalse(handler.kViolated());
    }

    /// PROPERTY: full exit sweeps to zero, swaps then revert NoLiquidityProviders, restart deposit is exact and
    ///           the restart depositor can always exit with their deposit.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_RestartAfterFullExitWorks() public view {
        assertFalse(handler.restartViolated());
    }

    /// PROPERTY: accrued fees survive exits/transfers, are never inherited, and harvest pays exactly pendingFees.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_FeeLedgerConsistentThroughExitAndRestart() public view {
        assertFalse(handler.feeLedgerViolated());
    }

    /// PROPERTY (F-07): locked accounts never move/exit/harvest, unlocked ones are never blocked, and incoming LP
    ///                  transfers never lock the recipient.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_LiquidityLockEnforcedExactly() public view {
        assertFalse(handler.lockViolated());
    }

    /// PROPERTY (F-08): remove/harvest debit the caller and deliver exactly the outputs to the recipient.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_RecipientOverloadsDeliverToRecipient() public view {
        assertFalse(handler.recipientViolated());
    }

    /// PROPERTY (F-10): accepted swaps never exceed the 50% output cap; rejected ones carry the exact cap error.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_OutputCapAndFeeExact() public view {
        assertFalse(handler.capViolated());
        assertFalse(handler.feeViolated());
    }

    /// PROPERTY: no pool call reverts with a reason outside the documented set (no panics / underflows).
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_NoUnexpectedReverts() public view {
        assertFalse(handler.unexpectedRevert());
    }

    /// PROPERTY: LP supply is conserved across transfers / mints / burns among the known holders.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_LpSupplyEqualsSumOfBalances() public view {
        uint256 sum = pool.balanceOf(DEAD);
        for (uint256 i; i < 3; i++) {
            sum += pool.balanceOf(actors[i]);
        }
        assertEq(pool.totalSupply(), sum);
    }

    /// PROPERTY: the dead balance is exactly MINIMUM_LIQUIDITY at all times and never accrues fees.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_DeadBalanceIsExactly1000_AndNeverAccrues() public view {
        assertEq(pool.balanceOf(DEAD), pool.MINIMUM_LIQUIDITY());
        assertEq(pool.balanceOf(DEAD), 1000);
        (uint256 da, uint256 db) = pool.pendingFees(DEAD);
        assertEq(da + db, 0);
    }

    /// PROPERTY: every transfer / transferFrom to DEAD reverts DeadAddressTransferBlocked.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_TransfersToDeadAlwaysRevert() public view {
        assertFalse(handler.deadTransferSucceeded());
    }

    /// PROPERTY: eligible supply is backed by reserves; an emptied pool holds only the 1000 dead shares.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_EligibleSupplyIsBackedByReserves() public view {
        uint256 eligible = pool.totalSupply() - pool.balanceOf(DEAD);
        if (eligible > 0) {
            assertGt(pool.reserveA(), 0);
            assertGt(pool.reserveB(), 0);
        } else {
            assertEq(pool.reserveA(), 0);
            assertEq(pool.reserveB(), 0);
        }
    }

    /// PROPERTY: live reserves are either both zero (emptied pool) or both positive.
    /// forge-config: default.invariant.runs = 256
    /// forge-config: default.invariant.depth = 100
    function invariant_ReservesBothZeroOrBothPositive() public view {
        assertEq(pool.reserveA() == 0, pool.reserveB() == 0);
    }

    /// @dev Coverage telemetry (visible with -vv): shows the interesting paths are really exercised.
    function afterInvariant() public view {
        console2.log("swaps/harvests/removes", handler.swapsOk(), handler.harvestsOk(), handler.removesOk());
        console2.log("adds/restarts/deadAttempts", handler.addsOk(), handler.restarts(), handler.deadAttempts());
    }

    // ── Deterministic reachability: the handler paths are really reachable (guards against vacuous invariants) ──

    function test_Handler_FullExitAndRestartIsReachable() public {
        handler.swap(0, true, 1e8);
        handler.swap(1, false, 1e18);
        assertEq(handler.swapsOk(), 2);
        (uint256 pa, uint256 pb) = pool.pendingFees(actors[0]);
        assertGt(pa, 0);
        assertGt(pb, 0);
        handler.exitAndRestart(5e9, 5e19, 1);
        assertEq(handler.restarts(), 1, "alice was the sole eligible LP, so exit + restart ran");
        assertFalse(handler.restartViolated());
        assertFalse(handler.feeLedgerViolated());
        assertFalse(handler.unexpectedRevert());
        assertEq(pool.balanceOf(DEAD), 1000);
        // alice's pre-exit fees are still claimable after the restart by bob (a different restarter)
        (uint256 qa, uint256 qb) = pool.pendingFees(actors[0]);
        assertEq(qa, pa);
        assertEq(qb, pb);
    }

    function test_Handler_ConsolidateThenExitIsReachable() public {
        handler.addLiquidity(1, 2e9, 4e19); // bob joins at ~the pool ratio
        handler.addLiquidity(2, 2e9, 4e19); // carol joins
        assertEq(handler.addsOk(), 2);
        handler.swap(0, true, 1e8);
        handler.exitAndRestart(5e9, 5e19, 0); // three holders: nobody is the last LP, so a no-op
        assertEq(handler.restarts(), 0);
        vm.roll(block.number + 1); // bob and carol minted LP in this block: F-07 releases them next block
        handler.consolidate(2);
        assertEq(pool.balanceOf(actors[2]), pool.totalSupply() - pool.balanceOf(DEAD));
        handler.exitAndRestart(5e9, 5e19, 0);
        assertEq(handler.restarts(), 1, "carol was the last LP after consolidation");
        assertFalse(handler.restartViolated());
        assertFalse(handler.feeLedgerViolated());
        assertFalse(handler.unexpectedRevert());
    }

    function test_Handler_HarvestAndRemovePathsReachable() public {
        handler.addLiquidity(1, 2e9, 4e19);
        assertEq(handler.addsOk(), 1);
        handler.swap(0, true, 1e8);
        handler.harvest(0);
        assertEq(handler.harvestsOk(), 1);
        handler.harvest(0); // nothing left: NoFeesAccrued is the expected revert
        assertEq(handler.harvestsOk(), 1);
        handler.removeLiquidity(1, type(uint256).max); // bob minted this block: locked, handler expects the revert
        assertEq(handler.removesOk(), 0);
        assertFalse(handler.lockViolated());
        vm.roll(block.number + 1);
        handler.removeLiquidity(1, type(uint256).max);
        assertEq(handler.removesOk(), 1);
        assertFalse(handler.lockViolated());
        assertFalse(handler.recipientViolated());
        assertFalse(handler.unexpectedRevert());
        assertFalse(handler.feeLedgerViolated());
    }

    function test_Handler_RecipientOverloadsAreReachable() public {
        handler.swap(0, true, 1e8);
        handler.harvestTo(0, 1);
        assertEq(handler.harvestsOk(), 1);
        handler.addLiquidity(2, 2e9, 4e19);
        vm.roll(block.number + 1);
        handler.removeLiquidityTo(2, type(uint256).max, 1);
        assertEq(handler.removesOk(), 1);
        assertFalse(handler.recipientViolated());
        assertFalse(handler.lockViolated());
        assertFalse(handler.unexpectedRevert());
    }

    function test_Handler_LockIsEnforcedAndReleased() public {
        handler.addLiquidity(1, 2e9, 4e19); // bob locked in this block
        assertEq(handler.addsOk(), 1);
        handler.transferLp(1, 2, 1e15); // locked: transfer must revert and the handler accepts only that
        handler.harvest(1);
        handler.swap(0, true, 1e8);
        assertFalse(handler.lockViolated());
        assertFalse(handler.unexpectedRevert());
        assertEq(handler.harvestsOk(), 0, "locked harvest did not succeed");
        // incoming transfer to carol must not lock her
        handler.transferLp(0, 2, 1e15);
        assertEq(pool.lastLiquidityBlock(actors[2]), 0);
        assertFalse(handler.lockViolated());
        vm.roll(block.number + 1);
        handler.harvest(1);
        assertEq(handler.harvestsOk(), 1);
        assertFalse(handler.lockViolated());
    }

    function test_Handler_PausedExitsAndHarvestsStayLive() public {
        handler.swap(0, true, 1e8);
        handler.setPaused(true);
        assertEq(handler.pausedActions(), 1);
        handler.swap(1, true, 1e8); // reverts EnforcedPause: expected, not flagged
        handler.addLiquidity(1, 2e9, 4e19);
        assertEq(handler.addsOk(), 0);
        handler.harvest(0);
        assertEq(handler.harvestsOk(), 1);
        handler.exitAndRestart(5e9, 5e19, 1); // exit works while paused; restart is skipped
        assertEq(pool.reserveA(), 0);
        assertFalse(handler.restartViolated());
        assertFalse(handler.unexpectedRevert());
    }

    function test_Handler_DeadTransferAttemptsAreBlocked() public {
        handler.tryTransferToDead(0, type(uint256).max, false);
        handler.tryTransferToDead(0, type(uint256).max, true);
        handler.tryTransferToDead(0, 12345, false);
        assertEq(handler.deadAttempts(), 3);
        assertFalse(handler.deadTransferSucceeded());
        assertEq(pool.balanceOf(DEAD), 1000);
    }
}
