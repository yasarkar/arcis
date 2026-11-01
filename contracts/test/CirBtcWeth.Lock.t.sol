// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {CirBtcWethV4Base} from "./CirBtcWeth.Base.t.sol";
import {ConstantProductPoolCirBtcWethV4 as Pool} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";

/// @notice F-07 same-block liquidity lock (block.number based), F-04 renounce disabled, 2-step ownership.
contract CirBtcWethLockTest is CirBtcWethV4Base {
    // ── lastLiquidityBlock bookkeeping ──

    function test_AddLiquidity_RecordsLastLiquidityBlock() public {
        vm.roll(777);
        _seedNoRoll(20);
        assertEq(pool.lastLiquidityBlock(alice), 777);
        assertEq(pool.lastLiquidityBlock(bob), 0);
        vm.roll(900);
        _add(alice, SAT / 10, 2 * ETH); // a top-up overwrites the recorded block
        assertEq(pool.lastLiquidityBlock(alice), 900);
    }

    function test_TopUpRelocksWholeBalance() public {
        _seed(20); // alice unlocked
        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(bob, 1); // unlocked: fine
        _add(alice, SAT / 100, 2 * ETH / 10);
        assertEq(pool.lastLiquidityBlock(alice), block.number);
        vm.prank(alice);
        vm.expectRevert(_lockedSel());
        pool.transfer(bob, 1); // the older balance is locked as well
        assertGt(pool.balanceOf(alice), lp - 1);
    }

    // ── add -> remove / transfer / transferFrom / harvest in one block revert; after a roll they succeed ──

    function testFuzz_Lock_AddThenRemove(uint8 sel, uint256 delta) public {
        uint256 lp = _seedNoRoll(_ratio(sel));
        vm.prank(alice);
        vm.expectRevert(_lockedSel());
        pool.removeLiquidity(lp, 0, 0);
        vm.prank(alice);
        vm.expectRevert(_lockedSel());
        pool.removeLiquidity(lp, 0, 0, alice);
        assertEq(pool.balanceOf(alice), lp);

        vm.roll(block.number + bound(delta, 1, 1_000_000));
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0);
        assertEq(outA, SAT);
        assertEq(outB, _ratio(sel) * ETH);
    }

    function test_Lock_AddThenTransfer() public {
        uint256 lp = _seedNoRoll(20);
        vm.startPrank(alice);
        vm.expectRevert(_lockedSel());
        pool.transfer(bob, lp);
        vm.expectRevert(_lockedSel());
        pool.transfer(bob, 0); // even a zero-value transfer out is blocked
        vm.stopPrank();
        _roll();
        vm.prank(alice);
        assertTrue(pool.transfer(bob, lp));
        assertEq(pool.balanceOf(bob), lp);
    }

    function test_Lock_AddThenTransferFrom_LockIsOnTheTokenOwner() public {
        uint256 lp = _seedNoRoll(20);
        vm.prank(alice);
        pool.approve(bob, lp);
        vm.prank(bob);
        vm.expectRevert(_lockedSel());
        pool.transferFrom(alice, carol, lp);
        _roll();
        vm.prank(bob);
        assertTrue(pool.transferFrom(alice, carol, lp));
        assertEq(pool.balanceOf(carol), lp);
    }

    function test_Lock_AddThenHarvest_BothOverloads() public {
        _seed(20);
        _swap(bob, true, SAT / 10); // alice accrues fees
        (uint256 pa,) = pool.pendingFees(alice);
        assertGt(pa, 0);
        _add(alice, SAT / 10, 2 * ETH); // top-up re-locks alice with fees pending
        vm.startPrank(alice);
        vm.expectRevert(_lockedSel());
        pool.harvest();
        vm.expectRevert(_lockedSel());
        pool.harvest(carol);
        vm.stopPrank();
        (uint256 pa2,) = pool.pendingFees(alice);
        assertEq(pa2, pa, "nothing was paid");

        _roll();
        uint256 a0 = btc.balanceOf(alice);
        vm.prank(alice);
        (uint256 feeA,) = pool.harvest();
        assertEq(feeA, pa);
        assertEq(btc.balanceOf(alice) - a0, pa);
    }

    function test_Lock_BurnsAreBlockedForPartialRemoval() public {
        uint256 lp = _seedNoRoll(20);
        vm.prank(alice);
        vm.expectRevert(_lockedSel());
        pool.removeLiquidity(lp / 2, 0, 0);
        _roll();
        vm.prank(alice);
        pool.removeLiquidity(lp / 2, 0, 0);
    }

    // ── incoming LP never locks the recipient; other accounts are unaffected ──

    function test_ThirdPartyTransferIn_DoesNotLockTheVictim() public {
        _seed(20);
        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(bob, lp / 2); // bob is the victim: an LP who minted nothing
        assertEq(pool.lastLiquidityBlock(bob), 0, "receiving does not record a lock");
        // bob can immediately move or exit what he received in the same block
        vm.prank(bob);
        pool.transfer(carol, lp / 4);
        assertEq(pool.lastLiquidityBlock(carol), 0);
        vm.prank(bob);
        pool.removeLiquidity(lp / 4, 0, 0);
        vm.prank(carol);
        pool.removeLiquidity(lp / 4, 0, 0);
    }

    /// A griefer that dusts an established LP in the LP's own block cannot trap them.
    function test_GrieferDustTransferCannotLockEstablishedLp() public {
        _seed(20);
        _add(bob, SAT, 20 * ETH);
        _roll();
        // carol (a fresh minter, locked herself) sends 1 wei of LP to bob
        uint256 cLp = _add(carol, SAT / 10, 2 * ETH);
        assertGt(cLp, 1);
        vm.prank(carol);
        vm.expectRevert(_lockedSel()); // carol cannot even send it: lock is on the sender
        pool.transfer(bob, 1);
        // alice (unlocked) dusts bob; bob's exit in the same block still works
        vm.prank(alice);
        pool.transfer(bob, 1);
        uint256 bobLp = pool.balanceOf(bob);
        vm.prank(bob);
        pool.removeLiquidity(bobLp, 0, 0);
    }

    function test_LockIsPerAccount() public {
        _seed(20);
        _add(bob, SAT, 20 * ETH); // bob locked now
        uint256 half = pool.balanceOf(alice) / 2;
        vm.prank(alice);
        pool.removeLiquidity(half, 0, 0); // alice unaffected by bob's lock
        vm.prank(bob);
        vm.expectRevert(_lockedSel());
        pool.removeLiquidity(1, 0, 0);
    }

    function test_SwapsDoNotLock() public {
        _seed(20);
        uint256 seededAt = pool.lastLiquidityBlock(alice);
        _swap(alice, true, SAT / 10);
        assertEq(pool.lastLiquidityBlock(alice), seededAt, "only addLiquidity writes the lock");
        vm.prank(alice);
        pool.removeLiquidity(1e18, 0, 0);
    }

    // ── pause neither bypasses nor extends the lock ──

    function test_Pause_DoesNotBypassLock() public {
        uint256 lp = _seedNoRoll(20);
        pool.pause();
        vm.startPrank(alice);
        vm.expectRevert(_lockedSel()); // Locked, not EnforcedPause: removals are not paused-gated, lock still applies
        pool.removeLiquidity(lp, 0, 0);
        vm.expectRevert(_lockedSel());
        pool.transfer(bob, 1);
        vm.expectRevert(_lockedSel());
        pool.harvest();
        vm.stopPrank();
    }

    function test_Pause_DoesNotExtendLock() public {
        uint256 lp = _seedNoRoll(20);
        pool.pause();
        _roll(); // a single block later, still paused
        vm.startPrank(alice);
        pool.transfer(bob, lp / 4);
        (uint256 outA,) = pool.removeLiquidity(lp / 4, 0, 0);
        assertGt(outA, 0);
        vm.stopPrank();
        pool.unpause();
        vm.prank(alice);
        pool.removeLiquidity(lp / 4, 0, 0);
    }

    function test_Pause_AddWhilePausedRevertsAndSetsNoLock() public {
        _seed(20);
        pool.pause();
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.addLiquidity(SAT / 10, 2 * ETH, 0, type(uint256).max);
        assertEq(pool.lastLiquidityBlock(bob), 0, "a reverted add leaves no lock");
    }

    // ── F-04: renounce disabled, pause/unpause unaffected ──

    function test_RenounceReverts_Always() public {
        vm.expectRevert(Pool.RenounceDisabled.selector);
        pool.renounceOwnership();
        assertEq(pool.owner(), address(this));
        // access control still runs first for non-owners
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.renounceOwnership();
    }

    function test_RenounceDisabledWhilePaused_UnpauseStillWorks() public {
        _seed(20);
        pool.pause();
        vm.expectRevert(Pool.RenounceDisabled.selector);
        pool.renounceOwnership();
        assertEq(pool.owner(), address(this));
        assertTrue(pool.paused());
        pool.unpause();
        assertFalse(pool.paused());
        _swap(bob, true, SAT / 10); // trading resumes
    }

    // ── ownership is still two-step ──

    function test_TwoStepOwnership() public {
        address newOwner = makeAddr("newOwner");
        pool.transferOwnership(newOwner);
        assertEq(pool.owner(), address(this), "still the owner until acceptance");
        assertEq(pool.pendingOwner(), newOwner);
        vm.prank(newOwner);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, newOwner));
        pool.pause(); // pending owner has no powers yet
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        pool.acceptOwnership();
        vm.prank(newOwner);
        pool.acceptOwnership();
        assertEq(pool.owner(), newOwner);
        assertEq(pool.pendingOwner(), address(0));
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, address(this)));
        pool.pause(); // old owner lost control
        vm.startPrank(newOwner);
        pool.pause();
        vm.expectRevert(Pool.RenounceDisabled.selector);
        pool.renounceOwnership(); // the new owner cannot renounce either
        pool.unpause();
        vm.stopPrank();
    }
}
