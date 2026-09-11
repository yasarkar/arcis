// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StableSwapPoolV3} from "../src/v3/StableSwapPoolV3.sol";
import {ConstantProductPoolV3} from "../src/v3/ConstantProductPoolV3.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for 24h rolling volume tracking and lazy reset (K3-B).
contract Volume24hTest is Test {
    StableSwapPoolV3 ssPool;
    ConstantProductPoolV3 cpPool;
    MockERC20 usdc;
    MockERC20 eurc;
    MockERC20 cirBtc;

    address owner = address(this);
    address alice = address(0x1);

    uint256 constant DEC6 = 1e6;
    uint256 constant DEC8 = 1e8;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        cirBtc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);

        ssPool = new StableSwapPoolV3(address(usdc), address(eurc), 12, owner);
        cpPool = new ConstantProductPoolV3(address(usdc), address(cirBtc), 25, owner);

        usdc.mint(alice, 10_000_000 * DEC6);
        eurc.mint(alice, 10_000_000 * DEC6);
        cirBtc.mint(alice, 100 * DEC8);

        vm.startPrank(alice);
        usdc.approve(address(ssPool), type(uint256).max);
        eurc.approve(address(ssPool), type(uint256).max);
        usdc.approve(address(cpPool), type(uint256).max);
        cirBtc.approve(address(cpPool), type(uint256).max);

        // Add initial liquidity to both pools
        ssPool.addLiquidity(100_000 * DEC6, 100_000 * DEC6, 0);
        cpPool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);
        vm.stopPrank();
    }

    function test_StableSwap24hVolumeTrackingAndLazyReset() public {
        vm.startPrank(alice);

        // 1. Initial 24h volume should be 0
        assertEq(ssPool.volume24hA(), 0);
        assertEq(ssPool.volume24hB(), 0);

        // 2. Perform a swap: 1,000 USDC -> EURC
        ssPool.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);
        assertEq(ssPool.volume24hA(), 1_000 * DEC6);
        assertEq(ssPool.volume24hB(), 0);

        // 3. Perform a swap: 500 EURC -> USDC
        ssPool.swap(address(eurc), address(usdc), 500 * DEC6, 0);
        assertEq(ssPool.volume24hA(), 1_000 * DEC6);
        assertEq(ssPool.volume24hB(), 500 * DEC6);

        // 4. Advance time by 12 hours (within 24h window)
        vm.warp(block.timestamp + 12 hours);
        assertEq(ssPool.volume24hA(), 1_000 * DEC6);
        assertEq(ssPool.volume24hB(), 500 * DEC6);

        // 5. Advance time past 24 hours (1 day + 1 second)
        vm.warp(block.timestamp + 12 hours + 1 seconds);
        // The view getter should report 0 since the window expired
        assertEq(ssPool.volume24hA(), 0);
        assertEq(ssPool.volume24hB(), 0);

        // 6. Next swap lazily resets the state variables and records new volume
        ssPool.swap(address(usdc), address(eurc), 2_000 * DEC6, 0);
        assertEq(ssPool.volume24hA(), 2_000 * DEC6);
        assertEq(ssPool.volume24hB(), 0);

        vm.stopPrank();
    }

    function test_ConstantProduct24hVolumeTrackingAndLazyReset() public {
        vm.startPrank(alice);

        // 1. Initial 24h volume should be 0
        assertEq(cpPool.volume24hA(), 0);
        assertEq(cpPool.volume24hB(), 0);

        // 2. Perform a swap: 5,000 USDC -> cirBTC
        cpPool.swap(address(usdc), address(cirBtc), 5_000 * DEC6, 0);
        assertEq(cpPool.volume24hA(), 5_000 * DEC6);
        assertEq(cpPool.volume24hB(), 0);

        // 3. Advance time by 25 hours
        vm.warp(block.timestamp + 25 hours);
        assertEq(cpPool.volume24hA(), 0);

        // 4. Swap in new window
        cpPool.swap(address(usdc), address(cirBtc), 1_500 * DEC6, 0);
        assertEq(cpPool.volume24hA(), 1_500 * DEC6);

        vm.stopPrank();
    }
}
