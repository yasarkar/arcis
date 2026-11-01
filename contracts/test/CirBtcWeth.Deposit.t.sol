// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {CirBtcWethV4Base} from "./CirBtcWeth.Base.t.sol";
import {ConstantProductPoolCirBtcWethV4 as Pool} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";

/// @notice F-02: subsequent deposits mint min(a*total/rA, b*total/rB) and pull ceil(shares*reserve/total) of each
///         token, never more than the inputs. Exercised at 1, 20 and 100 WETH per cirBTC.
contract CirBtcWethDepositTest is CirBtcWethV4Base {
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpMinted);

    struct Quote {
        uint256 shares;
        uint256 pullA;
        uint256 pullB;
    }

    function _expected(uint256 a, uint256 b) internal view returns (Quote memory q) {
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 total = pool.totalSupply();
        q.shares = Math.min((a * total) / rA, (b * total) / rB);
        q.pullA = Math.ceilDiv(q.shares * rA, total);
        q.pullB = Math.ceilDiv(q.shares * rB, total);
    }

    // ── exact proportional deposits are unchanged ──

    function _exactProportional(uint256 ratio) internal {
        _seed(ratio);
        uint256 a = SAT / 10;
        uint256 b = ratio * ETH / 10;
        uint256 a0 = btc.balanceOf(bob);
        uint256 w0 = weth.balanceOf(bob);
        uint256 total = pool.totalSupply();
        uint256 shares = _add(bob, a, b);
        assertEq(shares, (a * total) / SAT, "shares = a * total / reserveA");
        assertEq(a0 - btc.balanceOf(bob), a, "pulls exactly the cirBTC offered");
        assertEq(w0 - weth.balanceOf(bob), b, "pulls exactly the WETH offered");
        assertEq(pool.reserveA(), SAT + a);
        assertEq(pool.reserveB(), ratio * ETH + b);
        assertEq(pool.balanceOf(bob), shares);
    }

    function test_ExactProportional_1BtcEq1Eth() public {
        _exactProportional(1);
    }

    function test_ExactProportional_1BtcEq20Eth() public {
        _exactProportional(20);
    }

    function test_ExactProportional_1BtcEq100Eth() public {
        _exactProportional(100);
    }

    function testFuzz_ExactProportionalDepositPullsExactInputs(uint8 sel, uint256 k) public {
        uint256 ratio = _ratio(sel);
        _seed(ratio);
        k = bound(k, 100, 1e6);
        uint256 a = k * 1e4;
        uint256 b = a * ratio * 1e10; // exactly the pool price (rB / rA = ratio * 1e10)
        uint256 a0 = btc.balanceOf(bob);
        uint256 w0 = weth.balanceOf(bob);
        _add(bob, a, b);
        assertEq(a0 - btc.balanceOf(bob), a);
        assertEq(w0 - weth.balanceOf(bob), b);
    }

    // ── non-divisible deposits pay ceil amounts for the shares minted, never more than the inputs ──

    function _nonDivisible(uint256 ratio, uint256 a, uint256 b) internal returns (Quote memory q) {
        _seed(ratio);
        q = _expected(a, b);
        uint256 a0 = btc.balanceOf(bob);
        uint256 w0 = weth.balanceOf(bob);
        vm.expectEmit(true, false, false, true, address(pool));
        emit LiquidityAdded(bob, q.pullA, q.pullB, q.shares);
        uint256 got = _add(bob, a, b);
        assertEq(got, q.shares, "mints the smaller of the two share quotes");
        assertEq(a0 - btc.balanceOf(bob), q.pullA);
        assertEq(w0 - weth.balanceOf(bob), q.pullB);
        assertLe(q.pullA, a, "never more cirBTC than offered");
        assertLe(q.pullB, b, "never more WETH than offered");
    }

    /// 1 BTC = 1 ETH, (2 sat, 2e10 - 1 wei): the B leg limits the mint to 2e10 - 1 shares; the pool pulls the
    /// ceil amounts for those shares (2 sat, 2e10 - 1 wei) -- not a blanket "all of amountBIn" for fewer shares.
    function test_NonDivisible_2Sat_2e10Minus1_At1Eth() public {
        Quote memory q = _nonDivisible(1, 2, 2e10 - 1);
        assertEq(q.shares, 2e10 - 1);
        assertEq(q.pullA, 2);
        assertEq(q.pullB, 2e10 - 1);
    }

    /// 1 BTC = 20 ETH: 1 sat = 2e11 wei.
    function test_NonDivisible_2Sat_At20Eth() public {
        Quote memory q = _nonDivisible(20, 2, 4e11 - 1);
        assertLe(q.pullB, 4e11 - 1);
        assertGt(q.shares, 0);
    }

    /// 1 BTC = 100 ETH: (2 sat, 2e12 - 1 wei) now pulls strictly LESS than the whole 2e12 - 1 wei offered.
    function test_NonDivisible_2Sat_2e12Minus1_At100Eth() public {
        Quote memory q = _nonDivisible(100, 2, 2e12 - 1);
        assertEq(q.shares, 2e11 - 1);
        assertEq(q.pullA, 2);
        assertEq(q.pullB, 2e12 - 10);
        assertLt(q.pullB, 2e12 - 1, "no longer donates the unmatched WETH");
    }

    /// A-limited branch on a skewed (non-divisible) pool.
    function testFuzz_NonDivisibleDeposit_CeilNeverExceedsInputs(uint8 sel, uint256 a, uint256 b, bool skew) public {
        uint256 ratio = _ratio(sel);
        _seed(ratio);
        if (skew) _swap(carol, true, 12_345_678);
        a = bound(a, 1, 1e12);
        b = bound(b, 1, 1e32);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 total = pool.totalSupply();
        Quote memory q = _expected(a, b);
        if (q.shares == 0) {
            vm.prank(bob);
            vm.expectRevert(abi.encodeWithSelector(Pool.SlippageExceeded.selector, 0, 0));
            pool.addLiquidity(a, b, 0, type(uint256).max);
            return;
        }
        uint256 a0 = btc.balanceOf(bob);
        uint256 w0 = weth.balanceOf(bob);
        uint256 got = _add(bob, a, b); // can never hit ExcessiveToken{A,B}Required
        assertEq(got, q.shares);
        uint256 paidA = a0 - btc.balanceOf(bob);
        uint256 paidB = w0 - weth.balanceOf(bob);
        assertEq(paidA, q.pullA);
        assertEq(paidB, q.pullB);
        assertLe(paidA, a);
        assertLe(paidB, b);
        // never below the exact proportional amount, and less than one unit above it
        assertGe(paidA * total, got * rA);
        assertGe(paidB * total, got * rB);
        assertLt(paidA * total, got * rA + total);
        assertLt(paidB * total, got * rB + total);
    }

    /// Shares price from the SMALLER contribution: an excess of either token is not pulled.
    function test_ExcessOfEitherTokenIsNotPulled() public {
        _seed(20);
        uint256 w0 = weth.balanceOf(bob);
        _add(bob, SAT / 10, 50 * ETH); // wants 2 ETH for 0.1 BTC; offers 50
        assertApproxEqAbs(w0 - weth.balanceOf(bob), 2 * ETH, 1);
        uint256 a0 = btc.balanceOf(bob);
        _add(bob, 5 * SAT, 2 * ETH); // offers 5 BTC for 2 ETH (worth 0.1 BTC)
        assertApproxEqAbs(a0 - btc.balanceOf(bob), SAT / 10, 1);
    }

    // ── revert paths ──

    /// Zero shares (b * total < rB) reverts SlippageExceeded(minLp, 0).
    function test_ZeroShares_RevertsSlippage_At100Eth() public {
        _seed(100); // total = 1e19, rB = 1e20: 1 wei of WETH is worth 0.1 LP wei
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.SlippageExceeded.selector, 0, 0));
        pool.addLiquidity(SAT, 1, 0, type(uint256).max);
    }

    function testFuzz_MinLpSharesEnforced(uint8 sel, uint256 a) public {
        uint256 ratio = _ratio(sel);
        _seed(ratio);
        a = bound(a, 1e4, 1e10);
        uint256 b = a * ratio * 1e10;
        Quote memory q = _expected(a, b);
        vm.startPrank(bob);
        vm.expectRevert(abi.encodeWithSelector(Pool.SlippageExceeded.selector, q.shares + 1, q.shares));
        pool.addLiquidity(a, b, q.shares + 1, type(uint256).max);
        assertEq(pool.addLiquidity(a, b, q.shares, type(uint256).max), q.shares);
        vm.stopPrank();
    }

    function test_ZeroInputsRevert() public {
        _seed(20);
        vm.startPrank(bob);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.addLiquidity(0, ETH, 0, type(uint256).max);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.addLiquidity(SAT, 0, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_AddLiquidity_RevertsWhilePaused() public {
        _seed(20);
        pool.pause();
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.addLiquidity(SAT / 10, 2 * ETH, 0, type(uint256).max);
    }

    function test_AddLiquidity_RevertsOnExpiredDeadline_AndAcceptsExactDeadline() public {
        _seed(20);
        vm.startPrank(bob);
        vm.expectRevert(Pool.DeadlineExpired.selector);
        pool.addLiquidity(SAT / 10, 2 * ETH, 0, block.timestamp - 1);
        assertGt(pool.addLiquidity(SAT / 10, 2 * ETH, 0, block.timestamp), 0, "deadline == now is still valid");
        vm.stopPrank();
    }

    // ── initial deposit branch is unchanged ──

    function test_InitialDeposit_ThresholdAndSlippage() public {
        vm.startPrank(alice);
        vm.expectRevert(Pool.ZeroAmount.selector);
        pool.addLiquidity(1, 1e11, 0, type(uint256).max); // rawSqrt < 1e6
        uint256 lp = 1e18 - 1000; // 1 BTC = 1 ETH mints 1e18 - 1000 to the depositor
        vm.expectRevert(abi.encodeWithSelector(Pool.SlippageExceeded.selector, lp + 1, lp));
        pool.addLiquidity(SAT, ETH, lp + 1, type(uint256).max);
        assertEq(pool.addLiquidity(SAT, ETH, lp, type(uint256).max), lp);
        vm.stopPrank();
        assertEq(pool.balanceOf(DEAD), 1000);
    }
}
