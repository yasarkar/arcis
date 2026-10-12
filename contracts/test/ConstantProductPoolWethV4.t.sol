// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolWethV4} from "../src/v4/ConstantProductPoolWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit & integration tests for ConstantProductPoolWethV4 (USDC 6-dec / WETH 18-dec, x*y=k, real-yield harvest).
contract ConstantProductPoolWethV4Test is Test {
    ConstantProductPoolWethV4 pool;
    MockERC20 usdc;
    MockERC20 weth;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);

    uint256 constant DEC6 = 1e6;   // USDC decimals
    uint256 constant DEC18 = 1e18; // WETH decimals

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pool = new ConstantProductPoolWethV4(address(usdc), address(weth), 30, owner); // 30 bps = 0.30%

        usdc.mint(alice, 10_000_000 * DEC6);
        weth.mint(alice,      1_000 * DEC18);
        usdc.mint(bob,   10_000_000 * DEC6);
        weth.mint(bob,        1_000 * DEC18);
    }

    function _approveAlice() internal {
        vm.startPrank(alice);
        usdc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _approveBob() internal {
        vm.startPrank(bob);
        usdc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function test_LpDecimalsStandardized18() public view {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
    }

    function test_InitialLiquidityMintingMath() public {
        _approveAlice();

        // 1 WETH = 2,600 USDC
        uint256 amountA = 26_000 * DEC6; // 26,000 USDC
        uint256 amountB = 10 * DEC18;     // 10 WETH

        vm.prank(alice);
        uint256 lpShares = pool.addLiquidity(amountA, amountB, 0, type(uint256).max);

        // Expected:
        // rawSqrt = sqrt(26_000 * 1e6 * 10 * 1e18) = sqrt(260_000 * 1e24) = 509901951359 * 1e12...
        // sqrt(2.6e29) approx 5.099e14
        // rawSqrt * 1e6 gives 18-dec LP shares
        assertGt(lpShares, 0, "Alice should receive LP shares");
        assertEq(pool.balanceOf(alice), lpShares);
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), pool.MINIMUM_LIQUIDITY());
        assertEq(pool.reserveA(), amountA);
        assertEq(pool.reserveB(), amountB);
    }

    function test_SwapUsdcToWeth() public {
        _approveAlice();
        _approveBob();

        // Alice adds initial liquidity: 260,000 USDC and 100 WETH (ratio: 2,600 USDC / WETH)
        vm.prank(alice);
        pool.addLiquidity(260_000 * DEC6, 100 * DEC18, 0, type(uint256).max);

        // Bob swaps 2,600 USDC for WETH
        uint256 bobUsdcIn = 2_600 * DEC6;
        uint256 bobWethBefore = weth.balanceOf(bob);

        vm.prank(bob);
        uint256 wethOut = pool.swap(address(usdc), address(weth), bobUsdcIn, 0, type(uint256).max);

        assertGt(wethOut, 0, "Bob must receive WETH");
        assertEq(weth.balanceOf(bob) - bobWethBefore, wethOut);
        // Fee (30 bps on 2600 USDC = 7.8 USDC) should be in unclaimedFeeA
        assertEq(pool.unclaimedFeeA(), (bobUsdcIn * 30) / 10000);
    }

    function test_SwapWethToUsdc() public {
        _approveAlice();
        _approveBob();

        // Alice adds liquidity: 260,000 USDC and 100 WETH
        vm.prank(alice);
        pool.addLiquidity(260_000 * DEC6, 100 * DEC18, 0, type(uint256).max);

        // Bob swaps 1 WETH for USDC
        uint256 bobWethIn = 1 * DEC18;
        uint256 bobUsdcBefore = usdc.balanceOf(bob);

        vm.prank(bob);
        uint256 usdcOut = pool.swap(address(weth), address(usdc), bobWethIn, 0, type(uint256).max);

        assertGt(usdcOut, 0, "Bob must receive USDC");
        assertEq(usdc.balanceOf(bob) - bobUsdcBefore, usdcOut);
        // Fee on 1 WETH (30 bps = 0.003 WETH) in unclaimedFeeB
        assertEq(pool.unclaimedFeeB(), (bobWethIn * 30) / 10000);
    }

    function test_HarvestSwapFees() public {
        _approveAlice();
        _approveBob();

        // Alice provides liquidity
        vm.prank(alice);
        pool.addLiquidity(260_000 * DEC6, 100 * DEC18, 0, type(uint256).max);

        // Bob swaps 5,200 USDC for WETH
        vm.prank(bob);
        pool.swap(address(usdc), address(weth), 5_200 * DEC6, 0, type(uint256).max);

        // Bob swaps 2 WETH for USDC
        vm.prank(bob);
        pool.swap(address(weth), address(usdc), 2 * DEC18, 0, type(uint256).max);

        // Alice harvests accrued swap fees
        (uint256 pFeeA, uint256 pFeeB) = pool.pendingFees(alice);
        assertGt(pFeeA, 0, "Alice should have pending USDC fee");
        assertGt(pFeeB, 0, "Alice should have pending WETH fee");

        uint256 aliceUsdcBefore = usdc.balanceOf(alice);
        uint256 aliceWethBefore = weth.balanceOf(alice);

        vm.prank(alice);
        (uint256 feeA, uint256 feeB) = pool.harvest();

        assertEq(usdc.balanceOf(alice) - aliceUsdcBefore, feeA);
        assertEq(weth.balanceOf(alice) - aliceWethBefore, feeB);
    }
}
