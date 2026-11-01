// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Shared fixture for the second-batch (F-02/F-05/F-07/F-08/F-10) cirBTC/WETH suites. No test functions.
///      Prices: ratio sel 0 / 1 / 2  =>  1 / 20 / 100 WETH per cirBTC.
abstract contract CirBtcWethV4Base is Test {
    ConstantProductPoolCirBtcWethV4 internal pool;
    MockERC20 internal btc; // tokenA, 8 decimals
    MockERC20 internal weth; // tokenB, 18 decimals

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant SAT = 1e8; // 1 cirBTC
    uint256 internal constant ETH = 1e18; // 1 WETH

    address internal alice = makeAddr("alice"); // seeds the pool
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    function setUp() public virtual {
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        weth = new MockERC20("WETH", "WETH", 18);
        pool = new ConstantProductPoolCirBtcWethV4(address(btc), address(weth), 30, address(this));
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            btc.mint(us[i], 1e18);
            weth.mint(us[i], 1e40);
            vm.startPrank(us[i]);
            btc.approve(address(pool), type(uint256).max);
            weth.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    // ── fixture helpers ──

    function _roll() internal {
        vm.roll(block.number + 1);
    }

    function _ratio(uint256 sel) internal pure returns (uint256) {
        uint256 s = sel % 3;
        return s == 0 ? 1 : (s == 1 ? 20 : 100);
    }

    /// @dev alice seeds 1 cirBTC : ethPerBtc WETH and does NOT roll (she stays locked in this block).
    function _seedNoRoll(uint256 ethPerBtc) internal returns (uint256 lp) {
        vm.prank(alice);
        lp = pool.addLiquidity(SAT, ethPerBtc * ETH, 0, type(uint256).max);
    }

    /// @dev alice seeds then a block is mined so her lock has expired.
    function _seed(uint256 ethPerBtc) internal returns (uint256 lp) {
        lp = _seedNoRoll(ethPerBtc);
        _roll();
    }

    function _add(address who, uint256 a, uint256 b) internal returns (uint256 lp) {
        vm.prank(who);
        lp = pool.addLiquidity(a, b, 0, type(uint256).max);
    }

    function _swap(address who, bool aToB, uint256 amountIn) internal returns (uint256 out) {
        vm.prank(who);
        out = pool.swap(
            aToB ? address(btc) : address(weth),
            aToB ? address(weth) : address(btc),
            amountIn,
            0,
            type(uint256).max
        );
    }

    function _lockedSel() internal pure returns (bytes4) {
        return ConstantProductPoolCirBtcWethV4.LiquidityLockedThisBlock.selector;
    }

    // ── off-chain mirrors of the pool math (30 bps, ceil fee) ──

    function _fee(uint256 amountIn) internal pure returns (uint256) {
        return Math.ceilDiv(amountIn * 30, 10000);
    }

    function _netIn(uint256 amountIn) internal pure returns (uint256) {
        return amountIn - _fee(amountIn);
    }

    function _quote(uint256 rIn, uint256 rOut, uint256 amountIn) internal pure returns (uint256) {
        uint256 n = _netIn(amountIn);
        return (rOut * n) / (rIn + n);
    }

    /// @dev Smallest amountIn whose net-of-fee input is >= target. _netIn steps by 0 or 1, so equality is reachable.
    function _minInForNet(uint256 target) internal pure returns (uint256 lo) {
        lo = target;
        uint256 hi = target * 2 + 10;
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (_netIn(mid) >= target) hi = mid;
            else lo = mid + 1;
        }
    }

    /// @dev Smallest amountIn whose quoted output is >= minOut (quote is monotone in amountIn).
    function _minInForOut(uint256 rIn, uint256 rOut, uint256 minOut) internal pure returns (uint256 lo) {
        lo = 1;
        uint256 hi = rIn * 4 + 10; // net >= 2 * rIn quotes at least 2/3 of rOut
        while (lo < hi) {
            uint256 mid = (lo + hi) / 2;
            if (_quote(rIn, rOut, mid) >= minOut) hi = mid;
            else lo = mid + 1;
        }
    }
}
