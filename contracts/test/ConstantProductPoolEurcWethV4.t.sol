// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolEurcWethV4} from "../src/v4/ConstantProductPoolEurcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit & integration tests for ConstantProductPoolEurcWethV4 (EURC 6-dec / WETH 18-dec, x*y=k, real-yield harvest).
contract ConstantProductPoolEurcWethV4Test is Test {
    ConstantProductPoolEurcWethV4 pool;
    MockERC20 eurc;
    MockERC20 weth;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);

    uint256 constant DEC6 = 1e6;   // EURC decimals
    uint256 constant DEC18 = 1e18; // WETH decimals

    function setUp() public {
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pool = new ConstantProductPoolEurcWethV4(address(eurc), address(weth), 30, owner); // 30 bps = 0.30%

        eurc.mint(alice, 10_000_000 * DEC6);
        weth.mint(alice,      1_000 * DEC18);
        eurc.mint(bob,   10_000_000 * DEC6);
        weth.mint(bob,        1_000 * DEC18);
    }

    function _approveAlice() internal {
        vm.startPrank(alice);
        eurc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _approveBob() internal {
        vm.startPrank(bob);
        eurc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_LpDecimalsStandardized18() public view {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
    }

    function test_InitialLiquidityMintingMath() public {
        _approveAlice();

        // 1 WETH = 2,400 EURC
        uint256 amountA = 24_000 * DEC6; // 24,000 EURC
        uint256 amountB = 10 * DEC18;     // 10 WETH

        vm.prank(alice);
        uint256 lpShares = pool.addLiquidity(amountA, amountB, 0, type(uint256).max);

        assertGt(lpShares, 0, "Alice should receive LP shares");
        assertEq(pool.balanceOf(alice), lpShares);
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), pool.MINIMUM_LIQUIDITY());
        assertEq(pool.reserveA(), amountA);
        assertEq(pool.reserveB(), amountB);
    }

    function test_SwapEurcToWeth() public {
        _approveAlice();
        _approveBob();

        // Alice adds initial liquidity: 240,000 EURC and 100 WETH (ratio: 2,400 EURC / WETH)
        vm.prank(alice);
        pool.addLiquidity(240_000 * DEC6, 100 * DEC18, 0, type(uint256).max);

        // Bob swaps 2,400 EURC for WETH
        uint256 bobEurcIn = 2_400 * DEC6;
        uint256 bobWethBefore = weth.balanceOf(bob);

        vm.prank(bob);
        uint256 wethOut = pool.swap(address(eurc), address(weth), bobEurcIn, 0, type(uint256).max);

        assertGt(wethOut, 0, "Bob must receive WETH");
        assertEq(weth.balanceOf(bob) - bobWethBefore, wethOut);
        // Fee (30 bps on 2400 EURC = 7.2 EURC) should be in unclaimedFeeA
        assertEq(pool.unclaimedFeeA(), (bobEurcIn * 30) / 10000);
    }

    function test_SwapWethToEurc() public {
        _approveAlice();
        _approveBob();

        // Alice adds liquidity: 240,000 EURC and 100 WETH
        vm.prank(alice);
        pool.addLiquidity(240_000 * DEC6, 100 * DEC18, 0, type(uint256).max);

        // Bob swaps 1 WETH for EURC
        uint256 bobWethIn = 1 * DEC18;
        uint256 bobEurcBefore = eurc.balanceOf(bob);

        vm.prank(bob);
        uint256 eurcOut = pool.swap(address(weth), address(eurc), bobWethIn, 0, type(uint256).max);

        assertGt(eurcOut, 0, "Bob must receive EURC");
        assertEq(eurc.balanceOf(bob) - bobEurcBefore, eurcOut);
        // Fee (30 bps on 1 WETH = 0.003 WETH) should be in unclaimedFeeB
        assertEq(pool.unclaimedFeeB(), (bobWethIn * 30) / 10000);
    }

    function test_HarvestAccruedFees() public {
        _approveAlice();
        _approveBob();

        // Alice provides liquidity
        vm.prank(alice);
        pool.addLiquidity(240_000 * DEC6, 100 * DEC18, 0, type(uint256).max);

        // Bob performs two swaps
        vm.startPrank(bob);
        pool.swap(address(eurc), address(weth), 2_400 * DEC6, 0, type(uint256).max);
        pool.swap(address(weth), address(eurc), 1 * DEC18, 0, type(uint256).max);
        vm.stopPrank();

        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertGt(pendingA, 0, "Alice should have pending EURC fees");
        assertGt(pendingB, 0, "Alice should have pending WETH fees");

        uint256 aliceEurcBefore = eurc.balanceOf(alice);
        uint256 aliceWethBefore = weth.balanceOf(alice);

        vm.prank(alice);
        (uint256 feeA, uint256 feeB) = pool.harvest();

        assertEq(feeA, pendingA);
        assertEq(feeB, pendingB);
        assertEq(eurc.balanceOf(alice) - aliceEurcBefore, feeA);
        assertEq(weth.balanceOf(alice) - aliceWethBefore, feeB);

        // After harvest, pending fees should reset
        (uint256 pendingAAfter, uint256 pendingBAfter) = pool.pendingFees(alice);
        assertEq(pendingAAfter, 0);
        assertEq(pendingBAfter, 0);
    }

    function test_SkimExcessTokens() public {
        // Send accidental tokens directly to the contract
        eurc.mint(address(pool), 500 * DEC6);
        assertEq(eurc.balanceOf(address(pool)), 500 * DEC6);

        address recoveryRecipient = address(0x9999);
        pool.skim(address(eurc), recoveryRecipient);

        assertEq(eurc.balanceOf(recoveryRecipient), 500 * DEC6);
        assertEq(eurc.balanceOf(address(pool)), 0);
    }
}
