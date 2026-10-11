// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolV4} from "../src/v4/ConstantProductPoolV4.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Invariant & Fuzzing Audit Suite for ConstantProductPoolV4 (Arcis cirBTC/USDC).
contract ConstantProductPoolV4AuditTest is Test {
    ConstantProductPoolV4 pool;
    MockERC20 usdc;
    MockERC20 btc;

    address owner = address(this);
    address alice = address(0x10);
    address bob = address(0x20);
    address charlie = address(0x30);
    address constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    uint256 constant DEC6 = 1e6;
    uint256 constant DEC8 = 1e8;
    uint256 constant BPS = 25; // 0.25%

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        btc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);
        pool = new ConstantProductPoolV4(address(usdc), address(btc), BPS, owner);

        usdc.mint(alice, 100_000_000 * DEC6);
        btc.mint(alice, 10_000 * DEC8);

        usdc.mint(bob, 100_000_000 * DEC6);
        btc.mint(bob, 10_000 * DEC8);

        usdc.mint(charlie, 100_000_000 * DEC6);
        btc.mint(charlie, 10_000 * DEC8);

        vm.prank(alice);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(alice);
        btc.approve(address(pool), type(uint256).max);

        vm.prank(bob);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(bob);
        btc.approve(address(pool), type(uint256).max);

        vm.prank(charlie);
        usdc.approve(address(pool), type(uint256).max);
        vm.prank(charlie);
        btc.approve(address(pool), type(uint256).max);
    }

    /// @notice Invariant: Total contract balance must always be >= AMM reserve + Fee reserve.
    function testFuzz_ReservesSolvency(uint32 swapA, uint32 swapB) public {
        vm.assume(swapA >= 100 * DEC6 && swapA <= 10_000 * DEC6);
        vm.assume(swapB >= 1e6 && swapB <= 0.1 * 1e8); // 0.01 to 0.1 BTC

        // Seed liquidity: 60k USDC + 1 BTC
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);

        // Swap A -> B
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), swapA, 0);

        // Swap B -> A
        vm.prank(charlie);
        pool.swap(address(btc), address(usdc), swapB, 0);

        assertGe(usdc.balanceOf(address(pool)), pool.reserveA() + pool.feeReserveA(), "USDC balance must cover reserves");
        assertGe(btc.balanceOf(address(pool)), pool.reserveB() + pool.feeReserveB(), "BTC balance must cover reserves");
    }

    /// @notice Invariant: K product (x * y) must never decrease after swap.
    function testFuzz_KInvariantMonotonic(uint32 swapAmount) public {
        vm.assume(swapAmount >= 10 * DEC6 && swapAmount <= 20_000 * DEC6);

        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(usdc), address(btc), swapAmount, 0);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "Constant product k must not decrease");
    }

    /// @notice Sum of individual LP pending fees must never exceed fee reserve.
    function test_SumPendingFeesNeverExceedsReserve() public {
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);

        vm.prank(bob);
        pool.addLiquidity(30_000 * DEC6, 0.5 * 1e8, 0);

        for (uint256 i = 0; i < 5; i++) {
            vm.prank(charlie);
            pool.swap(address(usdc), address(btc), 2_000 * DEC6, 0);
            vm.prank(charlie);
            pool.swap(address(btc), address(usdc), 0.02 * 1e8, 0);
        }

        (uint256 aliceA, uint256 aliceB) = pool.pendingFees(alice);
        (uint256 bobA, uint256 bobB) = pool.pendingFees(bob);

        assertLe(aliceA + bobA, pool.feeReserveA(), "Sum of pending USDC must be <= feeReserveA");
        assertLe(aliceB + bobB, pool.feeReserveB(), "Sum of pending BTC must be <= feeReserveB");
    }

    /// @notice Volume 24H counters reset after window expiration.
    function test_Volume24hResetsAfterWindow() public {
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);

        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 1_000 * DEC6, 0);
        assertEq(pool.volume24hA(), 1_000 * DEC6);

        // Advance 25 hours
        vm.warp(block.timestamp + 25 hours);

        assertEq(pool.volume24hA(), 0, "volume24hA view must return 0 after window");

        // Swap lazily resets state variable
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 500 * DEC6, 0);
        assertEq(pool.volume24hA(), 500 * DEC6, "volume24hA must record new swap in new window");
    }
}
