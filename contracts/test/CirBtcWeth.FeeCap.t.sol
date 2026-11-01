// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CirBtcWethV4Base} from "./CirBtcWeth.Base.t.sol";
import {ConstantProductPoolCirBtcWethV4 as Pool} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";

/// @notice F-05 (ceil swap fee, no dust guard) and F-10 (dedicated 50% output cap with an exact boundary),
///         at 1, 20 and 100 WETH per cirBTC.
contract CirBtcWethFeeCapTest is CirBtcWethV4Base {
    event Swapped(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    // ── F-05: fee = ceilDiv(amountIn * 30, 10000) ──

    function testFuzz_FeeIsExactCeil_AToB(uint8 sel, uint256 amountIn) public {
        _seed(_ratio(sel));
        amountIn = bound(amountIn, 2, SAT / 2);
        uint256 fee = _fee(amountIn);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 out = _quote(rA, rB, amountIn);
        vm.expectEmit(true, false, false, true, address(pool));
        emit Swapped(bob, address(btc), amountIn, out);
        assertEq(_swap(bob, true, amountIn), out);
        assertEq(pool.feeReserveA(), fee, "fee reserve grows by exactly ceilDiv(in * 30, 10000)");
        assertEq(pool.feeReserveB(), 0);
        assertGe(fee * 10000, amountIn * 30, "never below 0.30%");
        assertLt(fee * 10000, amountIn * 30 + 10000, "and never a full unit above");
        assertEq(pool.reserveA(), rA + amountIn - fee, "fee is excluded from the trading reserve");
    }

    function testFuzz_FeeIsExactCeil_BToA(uint8 sel, uint256 amountIn) public {
        uint256 ratio = _ratio(sel);
        _seed(ratio);
        // output must be >= 1 sat: net input >= ~ratio * 1e10 wei; stay below the cap
        amountIn = bound(amountIn, ratio * 3e10, ratio * ETH / 2);
        uint256 fee = _fee(amountIn);
        uint256 out = _quote(pool.reserveB(), pool.reserveA(), amountIn);
        assertEq(_swap(bob, false, amountIn), out);
        assertEq(pool.feeReserveB(), fee);
        assertEq(pool.feeReserveA(), 0);
        assertGe(fee * 10000, amountIn * 30, "never below 0.30%");
        assertLt(fee * 10000, amountIn * 30 + 10000);
    }

    function test_FeeIsExactlyThirtyBpsWhenDivisible() public {
        _seed(20);
        _swap(bob, true, 1_000_000); // 30 bps of 1e6 = 3000 exactly
        assertEq(pool.feeReserveA(), 3000);
    }

    /// DustSwapNotAllowed is gone: a 1-unit input pays a 1-unit fee, nets 0 and fails on ZeroAmount, both legs.
    function _oneUnit(uint256 ratio) internal {
        _seed(ratio);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        vm.startPrank(bob);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.swap(address(btc), address(weth), 1, 0, type(uint256).max);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.swap(address(weth), address(btc), 1, 0, type(uint256).max);
        vm.stopPrank();
        assertEq(pool.reserveA(), rA);
        assertEq(pool.reserveB(), rB);
        assertEq(pool.feeReserveA() + pool.feeReserveB(), 0, "a failed swap books no fee");
    }

    function test_OneUnitInputRevertsZeroAmount_1Eth() public {
        _oneUnit(1);
    }

    function test_OneUnitInputRevertsZeroAmount_20Eth() public {
        _oneUnit(20);
    }

    function test_OneUnitInputRevertsZeroAmount_100Eth() public {
        _oneUnit(100);
    }

    function test_TwoUnitsAreAccepted_AToB() public {
        _seed(20);
        _swap(bob, true, 2); // fee 1, net 1 => output of ~2e11 wei
        assertEq(pool.feeReserveA(), 1);
    }

    /// 666 sat used to pay a 1 sat fee (0.15%). Now: single swap pays 2; any chunking pays at least as much.
    function _chunking(uint256 ratio) internal {
        _seed(ratio);
        _swap(bob, true, 666);
        assertEq(pool.feeReserveA(), 2, "single 666-sat swap pays ceil(19980 / 10000) = 2");
        uint256 before = pool.feeReserveA();
        _swap(bob, true, 333);
        _swap(bob, true, 333);
        assertEq(pool.feeReserveA() - before, 2, "2 x 333 pays 1 + 1");
        before = pool.feeReserveA();
        for (uint256 i; i < 6; i++) {
            _swap(bob, true, 111);
        }
        assertEq(pool.feeReserveA() - before, 6, "6 x 111 pays 6 (chunking never reduces the fee)");
    }

    function test_666SatChunking_NoLongerHalvesFee_1Eth() public {
        _chunking(1);
    }

    function test_666SatChunking_NoLongerHalvesFee_20Eth() public {
        _chunking(20);
    }

    function test_666SatChunking_NoLongerHalvesFee_100Eth() public {
        _chunking(100);
    }

    function testFuzz_ChunkedFeesNeverBelowSingleSwapFee(uint8 sel, uint256 x, uint256 y) public {
        _seed(_ratio(sel));
        x = bound(x, 2, 1e6);
        y = bound(y, 2, 1e6);
        _swap(bob, true, x);
        _swap(bob, true, y);
        assertEq(pool.feeReserveA(), _fee(x) + _fee(y));
        assertGe(pool.feeReserveA(), _fee(x + y), "splitting a trade never lowers the total fee");
    }

    // ── F-10: output cap = reserveOut / 2, dedicated error, exact boundary ──

    /// output == reserveOut / 2 succeeds; the next unit of net input that makes it reserveOut / 2 + 1 reverts.
    function _capBoundary(uint256 ratio, bool aToB) internal {
        _seed(ratio);
        uint256 rIn = aToB ? pool.reserveA() : pool.reserveB();
        uint256 rOut = aToB ? pool.reserveB() : pool.reserveA();
        uint256 cap = rOut / 2;

        // exact half: net input == reserveIn  =>  out = rIn * rOut / (2 rIn) = rOut / 2
        uint256 inHalf = _minInForNet(rIn);
        assertEq(_netIn(inHalf), rIn);
        assertEq(_quote(rIn, rOut, inHalf), cap, "construction: output is exactly half");
        uint256 snap = vm.snapshotState();
        assertEq(_swap(bob, aToB, inHalf), cap, "output == reserveOut / 2 succeeds");
        assertEq(aToB ? pool.reserveB() : pool.reserveA(), rOut - cap);
        vm.revertToState(snap);

        // half + 1: the smallest input quoting reserveOut / 2 + 1 reverts with the dedicated error
        uint256 inOver = _minInForOut(rIn, rOut, cap + 1);
        uint256 outOver = _quote(rIn, rOut, inOver);
        assertGt(outOver, cap);
        assertLe(_quote(rIn, rOut, inOver - 1), cap, "one unit less is within the cap");
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.OutputCapExceeded.selector, outOver, cap));
        pool.swap(
            aToB ? address(btc) : address(weth),
            aToB ? address(weth) : address(btc),
            inOver,
            0,
            type(uint256).max
        );
        vm.stopPrank();
        // while one unit less goes through and takes no more than half
        uint256 under = _swap(bob, aToB, inOver - 1);
        assertLe(under, cap);
    }

    function test_CapBoundary_AToB_1Eth() public {
        _capBoundary(1, true);
    }

    function test_CapBoundary_AToB_20Eth() public {
        _capBoundary(20, true);
    }

    function test_CapBoundary_AToB_100Eth() public {
        _capBoundary(100, true);
    }

    function test_CapBoundary_BToA_1Eth() public {
        _capBoundary(1, false);
    }

    function test_CapBoundary_BToA_20Eth() public {
        _capBoundary(20, false);
    }

    function test_CapBoundary_BToA_100Eth() public {
        _capBoundary(100, false);
    }

    /// The cap is evaluated before the minOut slippage check, so an over-cap swap reports OutputCapExceeded.
    function test_CapErrorTakesPrecedenceOverSlippage() public {
        _seed(20);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 amountIn = 20 * SAT;
        uint256 out = _quote(rA, rB, amountIn);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.OutputCapExceeded.selector, out, rB / 2));
        pool.swap(address(btc), address(weth), amountIn, type(uint256).max, type(uint256).max);
    }

    /// A swap rejected by the cap changes nothing (no fee booked, no transfer).
    function test_CapRevertLeavesStateUntouched() public {
        _seed(20);
        uint256 bal = btc.balanceOf(bob);
        vm.prank(bob);
        vm.expectRevert();
        pool.swap(address(btc), address(weth), 20 * SAT, 0, type(uint256).max);
        assertEq(btc.balanceOf(bob), bal);
        assertEq(pool.feeReserveA(), 0);
        assertEq(pool.reserveA(), SAT);
    }

    /// Accepted swaps never exceed the cap; rejected ones carry the exact (out, rOut / 2) arguments.
    function testFuzz_CapIsEnforcedExactly(uint8 sel, uint256 amountIn, bool aToB) public {
        uint256 ratio = _ratio(sel);
        _seed(ratio);
        uint256 rIn = aToB ? pool.reserveA() : pool.reserveB();
        uint256 rOut = aToB ? pool.reserveB() : pool.reserveA();
        amountIn = bound(amountIn, aToB ? 2 : ratio * 3e10, rIn * 3);
        uint256 out = _quote(rIn, rOut, amountIn);
        vm.startPrank(bob);
        address tin = aToB ? address(btc) : address(weth);
        address tout = aToB ? address(weth) : address(btc);
        if (out > rOut / 2) {
            vm.expectRevert(abi.encodeWithSelector(Pool.OutputCapExceeded.selector, out, rOut / 2));
            pool.swap(tin, tout, amountIn, 0, type(uint256).max);
        } else {
            assertEq(pool.swap(tin, tout, amountIn, 0, type(uint256).max), out);
        }
        vm.stopPrank();
    }
}
