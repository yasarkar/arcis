// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EurcCirBtcDeadBase} from "./EurcCirBtcPool.DeadBase.t.sol";
import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Regression for the high-severity review finding: an attacker used to park almost all LP on DEAD, become
///         the last eligible LP (lpAmount == eligible supply), sweep every reserve, and after a victim's restart
///         deposit the unbacked dead shares diluted the victim's withdrawal to ~0.1%.
///         With DeadAddressTransferBlocked the dead balance is pinned at MINIMUM_LIQUIDITY, so the dilution
///         cannot be built. These tests replay the whole story end to end.
contract EurcCirBtcDeadAdversaryTest is EurcCirBtcDeadBase {
    // attacker (alice) token balances before the episode
    uint256 internal a0;
    uint256 internal b0;

    struct Params {
        uint256 aA; // attacker seed EURC
        uint256 aB; // attacker seed cirBTC
        uint256 vA; // victim restart EURC
        uint256 vB; // victim restart cirBTC
        uint256 div; // dust = victim deposit / div
        bool attackerFirst; // attacker exits their dust before the victim withdraws
        bool withSwaps; // third-party swaps between seed and attacker's full exit
    }

    function _defaultParams() internal pure returns (Params memory p) {
        p = Params({
            aA: SEED_A, aB: SEED_B, vA: 150_000e6, vB: 5e8, div: 1_000_000, attackerFirst: false, withSwaps: false
        });
    }

    /// @dev Phase 1: the attacker seeds, tries every route to shrink eligible supply via DEAD (all revert), then
    ///      exits fully as the last LP and must get back exactly the pool's reserves.
    function _attackerSeedsAndExits(Params memory p) internal {
        a0 = eurc.balanceOf(alice);
        b0 = btc.balanceOf(alice);
        uint256 lp = _add(alice, p.aA, p.aB);
        _roll();

        vm.startPrank(alice);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp - 2);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp - 1);
        pool.approve(carol, lp);
        vm.stopPrank();
        vm.prank(carol);
        vm.expectRevert(_deadSel());
        pool.transferFrom(alice, DEAD, lp - 2);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
        assertEq(pool.totalSupply() - pool.balanceOf(DEAD), lp, "eligible supply cannot be shrunk");

        if (p.withSwaps) {
            vm.prank(carol);
            pool.swap(address(eurc), address(btc), p.aA / 10, 0, type(uint256).max);
            vm.prank(bob);
            pool.swap(address(btc), address(eurc), p.aB / 20, 0, type(uint256).max);
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
            assertEq(eurc.balanceOf(alice), a0);
            assertEq(btc.balanceOf(alice), b0);
        }
    }

    /// @dev Phase 2+3: victim restarts, attacker dusts in a later block, then both leave in the chosen order.
    function _victimRestartDustAndExit(Params memory p) internal {
        int256 vA0 = int256(eurc.balanceOf(bob));
        int256 vB0 = int256(btc.balanceOf(bob));

        uint256 vLp = _add(bob, p.vA, p.vB);
        assertEq(vLp, Math.sqrt(p.vA * p.vB) * 1e11, "restart mints the full geometric-mean share");
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
        _roll(); // attacker acts in a LATER block than the restart

        (uint256 aLp, uint256 paidA, uint256 paidB) = _attackerDusts(p);
        _roll(); // release both locks

        if (p.attackerFirst) {
            _attackerExitsDust(aLp, paidA, paidB);
            _victimExits(vLp);
        } else {
            _victimExits(vLp);
            _attackerExitsDust(aLp, paidA, paidB);
        }

        // victim's net position: lost at most the (negligible) dead slice + rounding; may even gain dust crumbs
        assertLe(vA0 - int256(eurc.balanceOf(bob)), int256(3 + p.vA / 1e9), "victim loses no EURC principal");
        assertLe(vB0 - int256(btc.balanceOf(bob)), int256(3 + p.vB / 1e9), "victim loses no cirBTC principal");
    }

    function _attackerDusts(Params memory p) internal returns (uint256 aLp, uint256 paidA, uint256 paidB) {
        uint256 dA = Math.max(p.vA / p.div, 1);
        uint256 dB = Math.max(p.vB / p.div, 1);
        uint256 e0 = eurc.balanceOf(alice);
        uint256 c0 = btc.balanceOf(alice);
        aLp = _add(alice, dA, dB);
        paidA = e0 - eurc.balanceOf(alice);
        paidB = c0 - btc.balanceOf(alice);
        assertLe(paidA, dA);
        assertLe(paidB, dB);
        assertGt(aLp, 0);
    }

    function _victimExits(uint256 vLp) internal {
        uint256 e0 = eurc.balanceOf(bob);
        uint256 c0 = btc.balanceOf(bob);
        vm.prank(bob);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(vLp, 0, 0);
        assertEq(eurc.balanceOf(bob) - e0, outA);
        assertEq(btc.balanceOf(bob) - c0, outB);
    }

    function _attackerExitsDust(uint256 aLp, uint256 paidA, uint256 paidB) internal {
        // while the victim is still in, the attacker is NOT the last LP: proportional payout, bounded by what they paid
        bool victimStillIn = pool.balanceOf(bob) > 0;
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(aLp, 0, 0);
        if (victimStillIn) {
            assertLe(outA, paidA, "attacker cannot withdraw more EURC than their dust deposit");
            assertLe(outB, paidB, "attacker cannot withdraw more cirBTC than their dust deposit");
        }
    }

    function _assertAttackerNoProfit(Params memory p) internal view {
        int256 gainA = int256(eurc.balanceOf(alice)) - int256(a0);
        int256 gainB = int256(btc.balanceOf(alice)) - int256(b0);
        if (!p.withSwaps) {
            // allow only sub-unit rounding crumbs (floor remainders, negligible dead slice)
            assertLe(gainA, int256(3 + p.vA / 1e12), "attacker gained EURC from the victim");
            assertLe(gainB, int256(3 + p.vB / 1e12), "attacker gained cirBTC from the victim");
        }
        // pool is empty or near empty: no victim funds stranded in unbacked reserves
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
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
    }

    /// @dev Victim's withdrawal value is the full principal share: concrete numbers, not just a bound.
    function test_Adversarial_VictimWithdrawalIsFullShare_NotDilutedToTenthOfPercent() public {
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
        // victim's share of the pool is vLp / total and the dead slice is 1000 / total (~4e-19)
        assertEq(outA, (rA * vLp) / totalBefore);
        assertEq(outB, (rB * vLp) / totalBefore);
        assertGe(outA, p.vA - 1, "victim receives their EURC principal (within 1 wei)");
        assertGe(outB, p.vB - 1, "victim receives their cirBTC principal (within 1 wei)");
        assertGt(outA * 1000, p.vA * 999, "far above the ~0.1% payout of the exploit");
        // the attacker holds only their dust share
        assertLt(aLp * 1e5, vLp);
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
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.NotEnoughLP.selector);
        pool.removeLiquidity(vLp, 0, 0);
        // and cannot grow their eligible share by pushing LP to DEAD to make the victim's share "dead"
        vm.prank(bob);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, vLp);
        vm.prank(alice);
        (uint256 outA,) = pool.removeLiquidity(aLp, 0, 0);
        assertLe(outA, p.vA / p.div);
        assertGt(pool.reserveA(), p.vA - 3, "victim's reserves intact");
    }

    // ── Fuzz: same story over arbitrary deposit sizes ──

    function testFuzz_Adversarial_VictimKeepsPrincipal_AttackerNoProfit(
        uint256 aA,
        uint256 aB,
        uint256 vA,
        uint256 vB,
        uint256 div,
        bool attackerFirst,
        bool withSwaps
    ) public {
        Params memory p;
        p.aA = bound(aA, 1e8, 1e13);
        p.aB = bound(aB, 1e5, 1e11);
        p.vA = bound(vA, 1e8, 1e13);
        p.vB = bound(vB, 1e5, 1e11);
        p.div = bound(div, 1e3, 1e6);
        p.attackerFirst = attackerFirst;
        p.withSwaps = withSwaps;
        _attackerSeedsAndExits(p);
        _victimRestartDustAndExit(p);
        _assertAttackerNoProfit(p);
    }
}
