// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPool} from "../src/ConstantProductPool.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for ConstantProductPool (USDC/cirBTC x*y=k).
contract ConstantProductPoolTest is Test {
    ConstantProductPool pool;
    MockERC20 usdc;
    MockERC20 cirbtc;

    address alice = address(0x1);
    address bob = address(0x2);

    uint256 constant DEC6 = 1e6;
    uint256 constant DEC8 = 1e8;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        cirbtc = new MockERC20("Circle Bitcoin", "cirBTC", 8);
        pool = new ConstantProductPool(address(usdc), address(cirbtc), 25); // 0.25%

        usdc.mint(alice, 100_000 * DEC6);
        cirbtc.mint(alice, 10 * DEC8);
        usdc.mint(bob, 100_000 * DEC6);
        cirbtc.mint(bob, 10 * DEC8);
    }

    function approveAll() internal {
        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        cirbtc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        cirbtc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_InitialLiquidity() public {
        approveAll();
        vm.prank(alice);
        // 100,000 USDC + 1 BTC (price 100k)
        uint256 lp = pool.addLiquidity(100_000 * DEC6, 1 * DEC8);
        assertGt(lp, 0);
        assertEq(pool.reserveA(), 100_000 * DEC6);
        assertEq(pool.reserveB(), 1 * DEC8);
    }

    function test_SwapMinOut() public {
        approveAll();
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8);

        vm.startPrank(bob);
        uint256 out = pool.swap(address(usdc), address(cirbtc), 1_000 * DEC6, 0);
        assertGt(out, 0);
        assertLt(out, 1 * DEC8); // less than 1 BTC

        // Slippage guard works
        vm.expectRevert();
        pool.swap(address(usdc), address(cirbtc), 1_000 * DEC6, type(uint256).max);
        vm.stopPrank();
    }

    function test_KInvariantIncreasing() public {
        approveAll();
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8);

        uint256 kBefore = pool.reserveA() * pool.reserveB();
        vm.prank(bob);
        pool.swap(address(usdc), address(cirbtc), 1_000 * DEC6, 0);

        // k should grow because fees increase it (x*y increases)
        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGt(kAfter, kBefore, "k increases with fee-on-swap");
    }

    function test_BalanceOfTracking() public {
        approveAll();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(100_000 * DEC6, 1 * DEC8);
        assertEq(pool.balanceOf(alice), lp, "Alice balance should equal minted LP");

        vm.prank(alice);
        pool.removeLiquidity(lp / 2);
        assertEq(pool.balanceOf(alice), lp / 2, "Alice balance should decrease after withdraw");
    }

    function test_CannotWithdrawMoreThanBalance() public {
        approveAll();
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(100_000 * DEC6, 1 * DEC8);

        // Bob tries to remove Alice's liquidity
        vm.prank(bob);
        vm.expectRevert();
        pool.removeLiquidity(lp);
    }

    function test_NativeReceiveReverts() public {
        (bool ok,) = address(pool).call{value: 1}("");
        assertFalse(ok, "native deposit must revert");
    }
}