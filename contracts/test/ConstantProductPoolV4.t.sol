// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolV4} from "../src/v4/ConstantProductPoolV4.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit & Integration tests for ConstantProductPoolV4 (USDC/cirBTC, x*y=k with Real Yield Harvest).
contract ConstantProductPoolV4Test is Test {
    ConstantProductPoolV4 pool;
    MockERC20 usdc;
    MockERC20 btc;

    address owner = address(this);
    address alice = address(0x10);
    address bob = address(0x20);
    address charlie = address(0x30);
    address constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    uint256 constant DEC6 = 1e6; // USDC decimals
    uint256 constant DEC8 = 1e8; // cirBTC decimals
    uint256 constant BPS = 25;   // 25 bps = 0.25% fee

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        btc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);

        pool = new ConstantProductPoolV4(address(usdc), address(btc), BPS, owner);

        usdc.mint(alice, 10_000_000 * DEC6);
        btc.mint(alice, 100 * DEC8);

        usdc.mint(bob, 10_000_000 * DEC6);
        btc.mint(bob, 100 * DEC8);

        usdc.mint(charlie, 10_000_000 * DEC6);
        btc.mint(charlie, 100 * DEC8);

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

    function test_InitialLiquidityAndStandardizedLp() public {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");

        uint256 seedA = 60_000 * DEC6; // 60k USDC
        uint256 seedB = 1 * DEC8;      // 1 BTC

        vm.prank(alice);
        uint256 lpAlice = pool.addLiquidity(seedA, seedB, 0);

        // sqrt(60_000 * 1e6 * 1 * 1e8) = sqrt(6e18) = 2449489742
        // scaled by 1e11 = 244948974200000000000 (approx 244.94 LP)
        assertGt(lpAlice, 0, "Alice must receive LP tokens");
        assertEq(pool.balanceOf(DEAD_ADDRESS), 1000, "1000 LP must be locked permanently to dead address");
        assertEq(pool.totalSupply(), lpAlice + 1000, "Total supply must equal user LP + minimum dead LP");

        assertEq(pool.reserveA(), seedA, "reserveA must match seedA");
        assertEq(pool.reserveB(), seedB, "reserveB must match seedB");
        assertEq(pool.feeReserveA(), 0, "initial feeReserveA must be 0");
        assertEq(pool.feeReserveB(), 0, "initial feeReserveB must be 0");
    }

    function test_RevertDegenerateTokenPair() public {
        vm.expectRevert(ConstantProductPoolV4.InvalidTokenPair.selector);
        new ConstantProductPoolV4(address(usdc), address(usdc), 25, owner);
    }

    function test_RevertZeroAddressTokens() public {
        vm.expectRevert(ConstantProductPoolV4.ZeroAddress.selector);
        new ConstantProductPoolV4(address(0), address(btc), 25, owner);

        vm.expectRevert(ConstantProductPoolV4.ZeroAddress.selector);
        new ConstantProductPoolV4(address(usdc), address(0), 25, owner);
    }

    function test_RevertInvalidFeeBps() public {
        vm.expectRevert(ConstantProductPoolV4.InvalidFeeBps.selector);
        new ConstantProductPoolV4(address(usdc), address(btc), 1001, owner);
    }

    function test_NativeDepositReverts() public {
        (bool ok,) = address(pool).call{value: 1 ether}("");
        assertFalse(ok, "Direct native value transfer must revert");
    }

    function test_SwapAccruesFeeAndHarvestSucceeds() public {
        // Alice adds initial liquidity
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);
        uint256 lpAlice = pool.balanceOf(alice);

        // Bob swaps 6,000 USDC for cirBTC
        uint256 swapAmount = 6_000 * DEC6;
        uint256 expectedFee = (swapAmount * BPS) / 10000; // 25 bps of 6000 USDC = 15 USDC = 15,000,000 wei

        vm.prank(bob);
        uint256 btcOut = pool.swap(address(usdc), address(btc), swapAmount, 0);
        assertGt(btcOut, 0, "Bob should receive cirBTC");

        // Fee reserve checks
        assertEq(pool.feeReserveA(), expectedFee, "feeReserveA must hold exact collected swap fee");
        assertEq(pool.feeReserveB(), 0, "feeReserveB must be 0");

        // Alice pending fees check
        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertGt(pendingA, 0, "Alice should have accrued pending USDC fees");
        assertEq(pendingB, 0, "Pending EURC/BTC should be 0");

        // Alice harvests fees
        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        (uint256 harvestedA, uint256 harvestedB) = pool.harvest();

        assertEq(harvestedA, pendingA, "Harvested fee must match pending fee");
        assertEq(harvestedB, 0);
        assertEq(usdc.balanceOf(alice) - usdcBefore, harvestedA, "Alice should receive USDC directly");

        // LP token balance unchanged
        assertEq(pool.balanceOf(alice), lpAlice, "Alice LP balance must not change during harvest");

        // Second harvest reverts with NoFeesAccrued
        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        pool.harvest();
    }

    function test_BidirectionalSwapAccruesBothFees() public {
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);

        // 1. Swap USDC -> cirBTC (accrues fee in USDC)
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 6_000 * DEC6, 0);

        // 2. Swap cirBTC -> USDC (accrues fee in cirBTC)
        vm.prank(charlie);
        pool.swap(address(btc), address(usdc), 0.1 * 1e8, 0);

        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertGt(pendingA, 0, "Should have pending USDC");
        assertGt(pendingB, 0, "Should have pending cirBTC");

        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 btcBefore = btc.balanceOf(alice);

        vm.prank(alice);
        (uint256 harvA, uint256 harvB) = pool.harvest();

        assertEq(harvA, pendingA);
        assertEq(harvB, pendingB);
        assertEq(usdc.balanceOf(alice) - usdcBefore, harvA);
        assertEq(btc.balanceOf(alice) - btcBefore, harvB);
    }

    function test_DualLpProportionalFeeSplit() public {
        // Alice provides initial liquidity: 60,000 USDC + 1 BTC
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);
        uint256 lpAlice = pool.balanceOf(alice);

        // Bob adds identical liquidity: 60,000 USDC + 1 BTC
        vm.prank(bob);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);
        uint256 lpBob = pool.balanceOf(bob);

        // Verify LP parity (within roundoff)
        assertApproxEqAbs(lpAlice, lpBob, 1000, "Alice and Bob should have nearly identical LP shares");

        // Charlie performs swap
        vm.prank(charlie);
        pool.swap(address(usdc), address(btc), 10_000 * DEC6, 0);

        (uint256 aliceA,) = pool.pendingFees(alice);
        (uint256 bobA,) = pool.pendingFees(bob);

        assertGt(aliceA, 0);
        assertGt(bobA, 0);
        assertApproxEqAbs(aliceA, bobA, 5, "Fee split should be equal between equal LPs");

        // Both harvest
        vm.prank(alice);
        pool.harvest();
        vm.prank(bob);
        pool.harvest();

        assertEq(pool.balanceOf(alice), lpAlice, "Alice LP unchanged");
        assertEq(pool.balanceOf(bob), lpBob, "Bob LP unchanged");
    }

    function test_RemoveLiquiditySucceedsAndPreservesFees() public {
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);
        uint256 lpAlice = pool.balanceOf(alice);

        // Bob performs swap
        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 6_000 * DEC6, 0);

        (uint256 pendingBefore,) = pool.pendingFees(alice);
        assertGt(pendingBefore, 0);

        // Alice removes half of her liquidity
        uint256 removeLp = lpAlice / 2;
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(removeLp, 0, 0);

        assertGt(outA, 0);
        assertGt(outB, 0);

        // Pending fees must remain intact
        (uint256 pendingAfter,) = pool.pendingFees(alice);
        assertEq(pendingAfter, pendingBefore, "Unclaimed fees must not be lost upon partial withdrawal");

        // Alice can harvest the fees afterwards
        vm.prank(alice);
        (uint256 harvA,) = pool.harvest();
        assertEq(harvA, pendingBefore);
    }

    function test_SelfTransfer_DoubleHarvestBugGuard() public {
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);

        vm.prank(bob);
        pool.swap(address(usdc), address(btc), 6_000 * DEC6, 0);

        (uint256 pendingBefore,) = pool.pendingFees(alice);
        assertGt(pendingBefore, 0);

        // Alice transfers to herself
        vm.prank(alice);
        pool.transfer(alice, 1000);

        (uint256 pendingAfter,) = pool.pendingFees(alice);
        assertEq(pendingAfter, pendingBefore, "Self-transfer must not inflate pending fees");
    }

    function test_DrainageGuardReverts() public {
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);

        // Attempt to drain > 50% of BTC reserve in one swap
        // In x*y=k, swapping 60,000 USDC would extract 50% of 1 BTC
        // Swapping 120,000 USDC would extract 66.6% (> 50%)
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolV4.SlippageExceeded.selector);
        pool.swap(address(usdc), address(btc), 120_000 * DEC6, 0);
    }

    function test_PauseBlocksOperations() public {
        vm.prank(alice);
        pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0);

        pool.pause();
        assertTrue(pool.paused());

        vm.prank(bob);
        vm.expectRevert();
        pool.swap(address(usdc), address(btc), 1_000 * DEC6, 0);

        pool.unpause();
        vm.prank(bob);
        uint256 out = pool.swap(address(usdc), address(btc), 1_000 * DEC6, 0);
        assertGt(out, 0);
    }
}
