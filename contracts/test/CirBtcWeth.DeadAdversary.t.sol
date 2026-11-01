// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CirBtcWethDeadBase} from "./CirBtcWeth.DeadBase.t.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Regression for the high-severity review finding (ported from the EURC/cirBTC sister pool): an attacker
///         used to park almost all LP on DEAD, become the last eligible LP (lpAmount == eligible supply), sweep
///         every reserve, and after a victim's restart deposit the unbacked dead shares diluted the victim's
///         withdrawal. With DeadAddressTransferBlocked the dead balance is pinned at MINIMUM_LIQUIDITY, so the
///         dilution cannot be built. These tests replay the whole story end to end at cirBTC(8)/WETH(18) decimals.
contract CirBtcWethDeadAdversaryTest is CirBtcWethDeadBase {
    // attacker (alice) balances before the episode
    uint256 internal a0;
    uint256 internal b0;
    // victim's minted restart LP
    uint256 internal vLpStored;

    struct Params {
        uint256 aA; // attacker seed cirBTC
        uint256 aB; // attacker seed WETH
        uint256 vA; // victim restart cirBTC
        uint256 vB; // victim restart WETH
        uint256 div; // dust = victim deposit / div
        bool attackerFirst; // attacker exits their dust before the victim withdraws
        bool withSwaps; // third-party swaps between seed and attacker's full exit
        bool sameBlock; // probe the F-07 same-block lock (the exit must revert) before rolling to the next block
    }

    function _defaultParams() internal pure returns (Params memory p) {
        p = Params({
            aA: 10 * SAT,
            aB: 200 * ETH,
            vA: 5 * SAT,
            vB: 500 * ETH, // victim restarts at a different price (1 BTC = 100 ETH)
            div: 1_000_000,
            attackerFirst: false,
            withSwaps: false,
            sameBlock: false
        });
    }

    /// @dev F-07: LP minted by `who` cannot be burned in the same block. In `sameBlock` mode the atomic
    ///      add -> exit is attempted first and must revert LiquidityLockedThisBlock; then the block is mined so the
    ///      scenario can continue. An attacker therefore cannot dust-and-exit atomically around a victim.
    function _maybeRoll(Params memory p, address who) internal {
        if (p.sameBlock) {
            vm.prank(who);
            vm.expectRevert(ConstantProductPoolCirBtcWethV4.LiquidityLockedThisBlock.selector);
            pool.removeLiquidity(1, 0, 0);
        }
        _roll();
    }

    /// @dev Phase 1: the attacker seeds, tries every route to shrink eligible supply via DEAD (all revert), then
    ///      exits fully as the last LP and must get back exactly the pool's reserves.
    function _attackerSeedsAndExits(Params memory p) internal {
        a0 = btc.balanceOf(alice);
        b0 = weth.balanceOf(alice);
        uint256 lp = _add(alice, p.aA, p.aB);
        _maybeRoll(p, alice);

        vm.startPrank(alice);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp - 2);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp - 1);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp);
        pool.approve(carol, lp);
        vm.stopPrank();
        vm.prank(carol);
        vm.expectRevert(_deadSel());
        pool.transferFrom(alice, DEAD, lp - 2);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
        assertEq(pool.totalSupply() - pool.balanceOf(DEAD), lp, "eligible supply cannot be shrunk");

        if (p.withSwaps) {
            vm.prank(carol);
            pool.swap(address(btc), address(weth), p.aA / 10, 0, type(uint256).max);
            vm.prank(bob);
            pool.swap(address(weth), address(btc), p.aB / 20, 0, type(uint256).max);
        }

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0);
        assertEq(outA, rA, "last LP gets exactly the trading reserveA");
        assertEq(outB, rB, "last LP gets exactly the trading reserveB");
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
        assertEq(pool.totalSupply(), MIN_LIQ, "only the 1000 dead shares remain");
        if (!p.withSwaps) {
            // no trading happened: the attacker's tokens are restored to the wei
            assertEq(btc.balanceOf(alice), a0);
            assertEq(weth.balanceOf(alice), b0);
        }
    }

    /// @dev Phase 2+3: victim restarts, attacker dusts in a later block, then both leave in the chosen order.
    function _victimRestartDustAndExit(Params memory p) internal {
        int256 vA0 = int256(btc.balanceOf(bob));
        int256 vB0 = int256(weth.balanceOf(bob));

        uint256 vLp = _add(bob, p.vA, p.vB);
        vLpStored = vLp;
        assertEq(vLp, Math.sqrt(p.vA * p.vB) * 1e5, "restart mints the full geometric-mean share");
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
        _maybeRoll(p, bob); // attacker acts in a LATER block than the restart

        (uint256 aLp, uint256 paidA, uint256 paidB) = _attackerDusts(p);
        _maybeRoll(p, alice);

        if (p.attackerFirst) {
            _attackerExitsDust(aLp, paidA, paidB);
            _victimExits(vLp);
        } else {
            _victimExits(vLp);
            _attackerExitsDust(aLp, paidA, paidB);
        }

        // victim's net position: lost at most the (negligible) dead slice 1000/vLp + rounding; may gain crumbs
        assertLe(vA0 - int256(btc.balanceOf(bob)), int256(_tol(p.vA)), "victim loses no cirBTC principal");
        assertLe(vB0 - int256(weth.balanceOf(bob)), int256(_tol(p.vB)), "victim loses no WETH principal");
    }

    /// @dev rounding + the dead slice (1000 / vLp of the victim's deposit), with 3x headroom.
    function _tol(uint256 v) internal view returns (uint256) {
        return 3 + (v * 3000) / vLpStored;
    }

    function _attackerDusts(Params memory p) internal returns (uint256 aLp, uint256 paidA, uint256 paidB) {
        uint256 dA = Math.max(p.vA / p.div, 1);
        uint256 dB = Math.max(p.vB / p.div, 1);
        uint256 e0 = btc.balanceOf(alice);
        uint256 c0 = weth.balanceOf(alice);
        aLp = _add(alice, dA, dB);
        paidA = e0 - btc.balanceOf(alice);
        paidB = c0 - weth.balanceOf(alice);
        assertLe(paidA, dA);
        assertLe(paidB, dB);
        assertGt(aLp, 0);
    }

    function _victimExits(uint256 vLp) internal {
        uint256 e0 = btc.balanceOf(bob);
        uint256 c0 = weth.balanceOf(bob);
        vm.prank(bob);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(vLp, 0, 0);
        assertEq(btc.balanceOf(bob) - e0, outA);
        assertEq(weth.balanceOf(bob) - c0, outB);
    }

    function _attackerExitsDust(uint256 aLp, uint256 paidA, uint256 paidB) internal {
        // while the victim is still in, the attacker is NOT the last LP: proportional payout, bounded by what they paid
        bool victimStillIn = pool.balanceOf(bob) > 0;
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(aLp, 0, 0);
        if (victimStillIn) {
            assertLe(outA, paidA, "attacker cannot withdraw more cirBTC than their dust deposit");
            assertLe(outB, paidB, "attacker cannot withdraw more WETH than their dust deposit");
        }
    }

    function _assertAttackerNoProfit(Params memory p) internal view {
        if (!p.withSwaps) {
            int256 gainA = int256(btc.balanceOf(alice)) - int256(a0);
            int256 gainB = int256(weth.balanceOf(alice)) - int256(b0);
            // allow only sub-unit rounding crumbs (floor remainders, negligible dead slice)
            assertLe(gainA, int256(_tol(p.vA)), "attacker gained cirBTC from the victim");
            assertLe(gainB, int256(_tol(p.vB)), "attacker gained WETH from the victim");
        }
        // pool is empty: no victim funds stranded in unbacked reserves
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
        assertEq(pool.totalSupply(), MIN_LIQ);
    }

    // ── Scenario tests ──

    function test_Adversarial_DeadTransferBlocked_ExitExactly_VictimKeepsPrincipal() public {
        Params memory p = _defaultParams();
        _attackerSeedsAndExits(p);
        _victimRestartDustAndExit(p);
        _assertAttackerNoProfit(p);
    }

    function test_Adversarial_AttackerExitsDustBeforeVictim() public {
        Params memory p = _defaultParams();
        p.attackerFirst = true;
        _attackerSeedsAndExits(p);
        _victimRestartDustAndExit(p);
        _assertAttackerNoProfit(p);
    }

    function test_Adversarial_SameBlockDustAndExit() public {
        Params memory p = _defaultParams();
        p.sameBlock = true;
        _attackerSeedsAndExits(p);
        _victimRestartDustAndExit(p);
        _assertAttackerNoProfit(p);
    }

    function test_Adversarial_WithThirdPartySwapsBeforeAttackerExit() public {
        Params memory p = _defaultParams();
        p.withSwaps = true;
        _attackerSeedsAndExits(p);
        _victimRestartDustAndExit(p);
        _assertAttackerNoProfit(p);
        // the attacker's pre-exit fee entitlement is untouched and still fully backed by the fee reserve
        (uint256 fa, uint256 fb) = pool.pendingFees(alice);
        assertLe(fa, pool.feeReserveA());
        assertLe(fb, pool.feeReserveB());
        assertGt(fa + fb, 0, "pre-exit fees remain claimable");
        vm.prank(alice);
        pool.harvest();
    }

    /// @dev Victim's withdrawal value is the full principal share: concrete numbers, not just a bound.
    function test_Adversarial_VictimWithdrawalIsFullShare_NotDiluted() public {
        Params memory p = _defaultParams();
        _attackerSeedsAndExits(p);
        uint256 vLp = _add(bob, p.vA, p.vB);
        _roll();
        // the dust deposit adds a negligible LP slice
        uint256 aLp = _add(alice, p.vA / p.div, p.vB / p.div);
        _roll();
        uint256 totalBefore = pool.totalSupply();
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        vm.prank(bob);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(vLp, 0, 0);
        // victim's share of the pool is vLp / total and the dead slice is 1000 / total (~1e-8 of the pool)
        assertEq(outA, (rA * vLp) / totalBefore);
        assertEq(outB, (rB * vLp) / totalBefore);
        assertGe(outA, p.vA - 1, "victim receives their cirBTC principal (within 1 sat)");
        assertGe(outB, p.vB - (p.vB * 3000) / vLp - 1, "victim receives their WETH principal (less dead slice)");
        assertGt(outA * 1000, p.vA * 999, "far above any diluted payout");
        // the attacker holds only their dust share
        assertLt(aLp * 100_000, vLp);
    }

    /// @dev The attacker can no longer be the last LP while a victim is in: sweeping needs lpAmount == eligible.
    function test_Adversarial_AttackerCannotSweepWhileVictimHoldsEligibleShare() public {
        Params memory p = _defaultParams();
        _attackerSeedsAndExits(p);
        uint256 vLp = _add(bob, p.vA, p.vB);
        _roll();
        uint256 aLp = _add(alice, p.vA / p.div, p.vB / p.div);
        _roll();
        // attacker asks for far more than they own
        vm.prank(alice);
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.NotEnoughLP.selector);
        pool.removeLiquidity(vLp, 0, 0);
        // and cannot make the victim's share "dead" by pushing it to DEAD
        vm.prank(bob);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, vLp);
        vm.prank(alice);
        (uint256 outA,) = pool.removeLiquidity(aLp, 0, 0);
        assertLe(outA, p.vA / p.div);
        assertGt(pool.reserveA(), p.vA - 3, "victim's reserves intact");
    }

    // ── Fuzz: same story over arbitrary deposit sizes and the three requested price points ──

    function testFuzz_Adversarial_VictimKeepsPrincipal_AttackerNoProfit(
        uint256 aA,
        uint256 vA,
        uint8 aSel,
        uint8 vSel,
        uint256 aSkew,
        uint256 vSkew,
        uint256 div,
        uint8 flags
    ) public {
        Params memory p;
        p.aA = bound(aA, 1e8, 1e11); // 1 .. 1000 cirBTC
        p.aB = (p.aA * _ratio(aSel) * 1e10 * bound(aSkew, 50, 200)) / 100;
        p.vA = bound(vA, 1e8, 1e11);
        p.vB = (p.vA * _ratio(vSel) * 1e10 * bound(vSkew, 50, 200)) / 100;
        p.div = bound(div, 1e3, 1e6);
        p.attackerFirst = flags & 1 != 0;
        p.withSwaps = flags & 2 != 0;
        p.sameBlock = flags & 4 != 0;
        _attackerSeedsAndExits(p);
        _victimRestartDustAndExit(p);
        _assertAttackerNoProfit(p);
    }

    /// @dev Fuzz the DEAD attempt itself: any amount, either route, at any point, always reverts and leaves
    ///      eligible supply untouched.
    function testFuzz_Adversarial_AnyDeadTransferReverts(uint256 amt, uint8 sel, bool viaFrom) public {
        uint256 ratio = _ratio(sel);
        uint256 lp = _add(alice, 5 * SAT, 5 * ratio * ETH);
        amt = bound(amt, 0, lp);
        if (viaFrom) {
            vm.prank(alice);
            pool.approve(carol, amt);
            vm.prank(carol);
            vm.expectRevert(_deadSel());
            pool.transferFrom(alice, DEAD, amt);
        } else {
            vm.prank(alice);
            vm.expectRevert(_deadSel());
            pool.transfer(DEAD, amt);
        }
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
        assertEq(pool.balanceOf(alice), lp);
    }
}
