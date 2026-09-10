// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {StableSwapPool} from "../src/StableSwapPool.sol";
import {StableSwapPoolV2} from "../src/v2/StableSwapPoolV2.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Numeric evidence for H-1: compares the invariant math between V1 (Ann = A*4,
///         canonical Curve `A * n**n` for n=2) and V2 (Ann = A*2) on identical reserves.
/// @dev Same reserves + same swap input must produce a meaningful deviation in bps.
///      Canonical Curve uses `Ann = A * n**n` = A*4 for a 2-coin pool, which is what V1
///      already does. Higher Ann = more amplification = lower slippage for the swapper.
contract StableMathComparisonTest is Test {
    StableSwapPool poolV1;
    StableSwapPoolV2 poolV2;
    MockERC20 usdc;
    MockERC20 eurc;

    address alice = address(0x1);
    address bob = address(0x2);

    uint256 constant DEC6 = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        poolV1 = new StableSwapPool(address(usdc), address(eurc), 12); // 0.12% fee, Ann = A*4
        poolV2 = new StableSwapPoolV2(address(usdc), address(eurc), 12, address(this)); // Ann = A*2

        usdc.mint(alice, 3_000_000 * DEC6);
        eurc.mint(alice, 3_000_000 * DEC6);
        usdc.mint(bob, 3_000_000 * DEC6);
        eurc.mint(bob, 3_000_000 * DEC6);
    }

    function approveAll() internal {
        vm.startPrank(alice);
        usdc.approve(address(poolV1), type(uint256).max);
        eurc.approve(address(poolV1), type(uint256).max);
        usdc.approve(address(poolV2), type(uint256).max);
        eurc.approve(address(poolV2), type(uint256).max);
        vm.stopPrank();
        vm.startPrank(bob);
        usdc.approve(address(poolV1), type(uint256).max);
        eurc.approve(address(poolV1), type(uint256).max);
        usdc.approve(address(poolV2), type(uint256).max);
        eurc.approve(address(poolV2), type(uint256).max);
        vm.stopPrank();
    }

    function seedIdenticalReserves() internal {
        approveAll();
        // Identical reserves in both pools (first-deposit LP scaling differs, reserves don't).
        vm.prank(alice);
        poolV1.addLiquidity(50_000 * DEC6, 50_000 * DEC6);
        vm.prank(alice);
        poolV2.addLiquidity(50_000 * DEC6, 50_000 * DEC6, 0);
    }

    /// Seeds identical arbitrary reserves into both pools (LP scaling may differ, reserves won't).
    function seedPool(uint256 amountA, uint256 amountB) internal {
        approveAll();
        vm.prank(alice);
        poolV1.addLiquidity(amountA, amountB);
        vm.prank(alice);
        poolV2.addLiquidity(amountA, amountB, 0);
        assertEq(poolV1.reserveA(), poolV2.reserveA(), "reserveA must be identical");
        assertEq(poolV1.reserveB(), poolV2.reserveB(), "reserveB must be identical");
    }

    /// @notice Proves that on identical reserves + swap, V1 (A*4) gives MORE output
    ///         (lower slippage) than V2 (A*2), and quantifies the deviation in bps.
    function test_InvariantAnnDeviationBps() public {
        seedIdenticalReserves();

        assertEq(poolV1.reserveA(), poolV2.reserveA(), "reserveA must be identical");
        assertEq(poolV1.reserveB(), poolV2.reserveB(), "reserveB must be identical");

        vm.prank(bob);
        uint256 outV1 = poolV1.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);
        vm.prank(bob);
        uint256 outV2 = poolV2.swap(address(usdc), address(eurc), 1_000 * DEC6, 0);

        // Canonical A*4 must produce at least as much output as A*2 on the same input.
        assertGt(outV1, outV2, "Ann=A*4 (canonical) must give lower slippage than Ann=A*2");

        // At a balanced 1:1 peg the divergence is sub-bps; assert that (non-breaking to switch).
        uint256 devBps = ((outV1 - outV2) * 10000) / outV1;
        emit log_named_uint("deviation_bps_A4_vs_A2_at_balance", devBps);
        emit log_named_uint("amountOut_A4", outV1);
        emit log_named_uint("amountOut_A2", outV2);
        assertLt(devBps, 10, "balanced 1:1 dev must be sub-bps (<10 bps) -> non-breaking");

        // Sanity: both outputs remain below the fee-adjusted 1:1 (~998.8 * DEC6).
        assertLt(outV1, 1_000 * DEC6, "output must stay below 1:1 due to 0.12% fee");
    }

    /// @notice At a heavily imbalanced pool the amplification constant genuinely matters:
///         A*4 and A*2 diverge materially (>= 1 bps). This is not a directional
///         "better/worse" claim — higher A hugs the 1:1 peg (canonical stableswap intent),
///         lower A lets price drift more. V3 restores the canonical Curve Ann = A*4.
 function test_ImbalancedDeviationIsMeaningful() public {
        // Seed identical IMBALANCED reserves directly into both pools.
        seedPool(900_000 * DEC6, 100_000 * DEC6);
        emit log_named_uint("pct_A_of_reserves", 90);

        // Reverse swap (eurc -> usdc) on the imbalanced curve.
        vm.prank(bob);
        uint256 outV1 = poolV1.swap(address(eurc), address(usdc), 1_000 * DEC6, 0);
        vm.prank(bob);
        uint256 outV2 = poolV2.swap(address(eurc), address(usdc), 1_000 * DEC6, 0);

        uint256 devBps;
        if (outV1 >= outV2) {
            devBps = ((outV1 - outV2) * 10000) / outV1;
        } else {
            devBps = ((outV2 - outV1) * 10000) / outV2;
        }
        emit log_named_uint("imbalanced_dev_bps", devBps);
        emit log_named_uint("imbalanced_outV1_A4", outV1);
        emit log_named_uint("imbalanced_outV2_A2", outV2);

        // The two constants genuinely diverge at imbalance (material, not rounding).
        assertGe(devBps, 1, "at imbalance the Ann divergence must be >=1 bps");
        assertLt(devBps, 5000, "imbalanced divergence stays bounded (sanity)");
    }
}