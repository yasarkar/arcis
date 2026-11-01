// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {EurcCirBtcDeadBase} from "./EurcCirBtcPool.DeadBase.t.sol";
import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice DeadAddressTransferBlocked: no LP transfer / transferFrom may ever target DEAD_ADDRESS, so the dead
///         balance is exactly MINIMUM_LIQUIDITY (minted once, on the first deposit) at every point in the pool's life.
contract EurcCirBtcDeadAddressTest is EurcCirBtcDeadBase {
    // ── transfer() to DEAD reverts ──

    function test_Transfer_ToDead_Reverts_UnlockedHolder() public {
        uint256 lp = _seed(); // alice unlocked (rolled)
        vm.prank(alice);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp / 2);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
        assertEq(pool.balanceOf(alice), lp, "failed transfer leaves balance intact");
    }

    function test_Transfer_ToDead_Reverts_AlmostAllLp() public {
        uint256 lp = _seed();
        vm.prank(alice);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp - 2); // the review's attack: leave a 2-wei eligible supply
        vm.prank(alice);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp);
        assertEq(pool.totalSupply() - pool.balanceOf(DEAD), lp, "eligible supply cannot shrink");
    }

    function test_Transfer_ToDead_Reverts_AfterManyBlocks() public {
        uint256 lp = _seed();
        vm.roll(block.number + 10_000);
        vm.prank(alice);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp / 3);
    }

    function test_Transfer_ToDead_Reverts_ZeroValue() public {
        _seed();
        vm.prank(alice);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, 0);
    }

    /// @dev The dead check runs before the same-block liquidity lock, so a locked minter gets the dead error.
    function test_Transfer_ToDead_Reverts_DeadErrorTakesPrecedenceOverLock() public {
        uint256 lp = _add(alice, SEED_A, SEED_B); // no roll: alice is locked in this block
        vm.prank(alice);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp);
        // a non-dead recipient still hits the lock
        vm.prank(alice);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector);
        pool.transfer(bob, lp);
    }

    function test_Transfer_ToDead_Reverts_ForHolderWhoReceivedLp() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.transfer(bob, lp / 2); // bob never minted, so he is never locked
        vm.prank(bob);
        vm.expectRevert(_deadSel());
        pool.transfer(DEAD, lp / 2);
    }

    // ── transferFrom() to DEAD reverts ──

    function test_TransferFrom_ToDead_Reverts_ApprovedSpender() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.approve(carol, lp);
        vm.prank(carol);
        vm.expectRevert(_deadSel());
        pool.transferFrom(alice, DEAD, lp - 2);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
        assertEq(pool.allowance(alice, carol), lp, "failed transferFrom spends no allowance");
    }

    function test_TransferFrom_ToDead_Reverts_AfterRoll() public {
        uint256 lp = _add(alice, SEED_A, SEED_B);
        vm.prank(alice);
        pool.approve(carol, type(uint256).max);
        vm.roll(block.number + 5);
        vm.prank(carol);
        vm.expectRevert(_deadSel());
        pool.transferFrom(alice, DEAD, lp);
    }

    function test_TransferFrom_ToDead_Reverts_SelfApprovedHolder() public {
        uint256 lp = _seed();
        vm.startPrank(alice);
        pool.approve(alice, lp);
        vm.expectRevert(_deadSel());
        pool.transferFrom(alice, DEAD, lp / 2);
        vm.stopPrank();
    }

    function test_TransferFrom_ToOtherRecipientStillWorks() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.approve(carol, lp);
        vm.prank(carol);
        pool.transferFrom(alice, bob, lp / 4);
        assertEq(pool.balanceOf(bob), lp / 4);
    }

    function testFuzz_TransferAndTransferFrom_ToDeadAlwaysRevert(uint256 amount, uint256 blocksLater, bool viaFrom)
        public
    {
        uint256 lp = _seed();
        amount = bound(amount, 0, lp);
        blocksLater = bound(blocksLater, 0, 1e6);
        vm.roll(block.number + blocksLater);
        vm.prank(alice);
        pool.approve(carol, type(uint256).max);
        if (viaFrom) {
            vm.prank(carol);
            vm.expectRevert(_deadSel());
            pool.transferFrom(alice, DEAD, amount);
        } else {
            vm.prank(alice);
            vm.expectRevert(_deadSel());
            pool.transfer(DEAD, amount);
        }
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
    }

    // ── dead balance == MINIMUM_LIQUIDITY throughout the pool's life ──

    function test_DeadBalance_ZeroBeforeFirstDeposit_ThenMinimumLiquidity() public {
        assertEq(pool.balanceOf(DEAD), 0);
        uint256 lp = _add(alice, SEED_A, SEED_B);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ, "dead balance after first deposit");
        assertEq(pool.MINIMUM_LIQUIDITY(), MIN_LIQ);
        assertEq(pool.totalSupply(), lp + MIN_LIQ);
    }

    function test_DeadBalance_UnchangedByLaterDeposits() public {
        _seed();
        _add(bob, 60_000e6, 1e8);
        _roll();
        _add(carol, 6_000e6, 1e7);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
    }

    function test_DeadBalance_UnchangedAfterSwaps() public {
        _seed();
        _swapBothLegs();
        vm.prank(carol);
        pool.swap(address(eurc), address(btc), 10_000e6, 0, type(uint256).max);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
        (uint256 a, uint256 b) = pool.pendingFees(DEAD);
        assertEq(a, 0, "DEAD never accrues fee A");
        assertEq(b, 0, "DEAD never accrues fee B");
    }

    function test_DeadBalance_UnchangedAfterPartialExit() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp / 3, 0, 0);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ);
    }

    function test_DeadBalance_UnchangedAfterFullExit() public {
        uint256 lp = _seed();
        _swapBothLegs();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ, "dead balance after full exit");
        assertEq(pool.totalSupply(), MIN_LIQ);
        (uint256 a, uint256 b) = pool.pendingFees(DEAD);
        assertEq(a + b, 0);
    }

    function test_DeadBalance_UnchangedAfterRestart() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
        uint256 shares = _add(bob, SEED_A, SEED_B);
        assertEq(shares, Math.sqrt(SEED_A * SEED_B) * 1e11, "restart mints full sqrt(a*b)*1e11");
        assertEq(pool.balanceOf(DEAD), MIN_LIQ, "dead balance after restart");
        assertEq(pool.totalSupply(), MIN_LIQ + shares);
        _roll();
        // a second full exit / restart cycle keeps it fixed too
        vm.prank(bob);
        pool.removeLiquidity(shares, 0, 0);
        _add(carol, SEED_A / 2, SEED_B / 2);
        assertEq(pool.balanceOf(DEAD), MIN_LIQ, "dead balance after second restart");
    }

    function test_PendingFeesDead_StaysZero_AndDeadCannotHarvest() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.transfer(bob, lp / 2);
        _swapBothLegs();
        (uint256 a, uint256 b) = pool.pendingFees(DEAD);
        assertEq(a, 0);
        assertEq(b, 0);
        vm.prank(DEAD);
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        pool.harvest();
        // eligible holders (alice+bob) own the entire fee stream, excluding DEAD
        (uint256 pa,) = pool.pendingFees(alice);
        (uint256 pb,) = pool.pendingFees(bob);
        assertLe(pa + pb, pool.feeReserveA());
        assertApproxEqAbs(pa + pb, pool.feeReserveA(), pool.totalSupply() / 1e18 + 2);
    }

    /// @dev PROPERTY: for any sequence of deposits / swaps / transfers / exits the dead balance is exactly 1000.
    function testFuzz_DeadBalanceAlwaysMinimumLiquidity(uint256 seed) public {
        _seed();
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 30; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address u = us[(seed >> 8) % 3];
            uint256 op = seed % 6;
            uint256 amt = 1e6 + (seed >> 32) % 1e9;
            uint256 bal = pool.balanceOf(u);
            vm.prank(u);
            if (op == 0) {
                try pool.addLiquidity(amt, amt / 6000 + 1000, 0, type(uint256).max) {} catch {}
            } else if (op == 1) {
                try pool.swap(address(eurc), address(btc), amt, 0, type(uint256).max) {} catch {}
            } else if (op == 2) {
                try pool.swap(address(btc), address(eurc), amt / 600 + 2, 0, type(uint256).max) {} catch {}
            } else if (op == 3) {
                try pool.transfer(us[(seed >> 16) % 3], bal == 0 ? 0 : (seed >> 24) % bal + 1) {} catch {}
            } else if (op == 4) {
                try pool.removeLiquidity(bal == 0 ? 0 : (seed >> 24) % bal + 1, 0, 0) {} catch {}
            } else {
                _roll();
            }
            assertEq(pool.balanceOf(DEAD), MIN_LIQ, "dead balance fixed");
        }
    }
}
