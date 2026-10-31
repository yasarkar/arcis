// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit & integration tests for ConstantProductPoolEurcCirBtcV4
///         (EURC 6-dec / cirBTC 8-dec, x*y=k, real-yield harvest).
contract ConstantProductPoolEurcCirBtcV4Test is Test {
    ConstantProductPoolEurcCirBtcV4 pool;
    MockERC20 eurc;
    MockERC20 cirBtc;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);

    uint256 constant DEC6 = 1e6;  // EURC decimals
    uint256 constant DEC8 = 1e8;  // cirBTC decimals

    function setUp() public {
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        cirBtc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);
        pool = new ConstantProductPoolEurcCirBtcV4(address(eurc), address(cirBtc), 25, owner); // 25 bps = 0.25%

        eurc.mint(alice, 10_000_000 * DEC6);
        cirBtc.mint(alice,       100 * DEC8);
        eurc.mint(bob,   10_000_000 * DEC6);
        cirBtc.mint(bob,         100 * DEC8);
    }

    function _approveAlice() internal {
        vm.startPrank(alice);
        eurc.approve(address(pool), type(uint256).max);
        cirBtc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _approveBob() internal {
        vm.startPrank(bob);
        eurc.approve(address(pool), type(uint256).max);
        cirBtc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    /// @dev Add 600,000 EURC + 10 cirBTC initial liquidity (1 BTC = 60,000 EUR).
    function _seedPool() internal {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(600_000 * DEC6, 10 * DEC8, 0, type(uint256).max);
    }

    // ── Decimal & Constructor Tests ───────────────────────────────────────────

    function test_LpDecimalsStandardized18() public view {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
    }

    function test_Constructor_RejectsZeroFeeBps() public {
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.InvalidFeeBps.selector, 0));
        new ConstantProductPoolEurcCirBtcV4(address(eurc), address(cirBtc), 0, owner);
    }

    function test_Constructor_RejectsFeeBpsAbove1000() public {
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.InvalidFeeBps.selector, 1001));
        new ConstantProductPoolEurcCirBtcV4(address(eurc), address(cirBtc), 1001, owner);
    }

    function test_Constructor_AcceptsMaxValidFee() public {
        ConstantProductPoolEurcCirBtcV4 testPool = new ConstantProductPoolEurcCirBtcV4(
            address(eurc),
            address(cirBtc),
            1000,
            owner
        );
        assertEq(testPool.swapFeeBps(), 1000);
    }

    // ── Initial Liquidity & Math ──────────────────────────────────────────────

    function test_InitialLiquidityMintingMath() public {
        _approveAlice();

        // 60,000 EURC (60_000 * 1e6 = 6e10)
        // 1 cirBTC (1 * 1e8 = 1e8)
        // rawSqrt = sqrt(6e18) = 2,449,489,742
        // initialLp = 2,449,489,742 * 1e11 = 244,948,974,200,000,000,000 (~244.94 LP tokens)
        uint256 amountA = 60_000 * DEC6;
        uint256 amountB = 1 * DEC8;

        vm.prank(alice);
        uint256 lpShares = pool.addLiquidity(amountA, amountB, 0, type(uint256).max);

        assertGt(lpShares, 0, "Alice should receive LP shares");
        assertEq(pool.balanceOf(alice), lpShares);
        assertEq(pool.balanceOf(pool.DEAD_ADDRESS()), pool.MINIMUM_LIQUIDITY());
        assertEq(pool.reserveA(), amountA);
        assertEq(pool.reserveB(), amountB);
    }

    function test_InitialDeposit_RejectsDustAmounts() public {
        _approveAlice();
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        vm.prank(alice);
        pool.addLiquidity(0, 1 * DEC8, 0, type(uint256).max);
    }

    function test_InitialDeposit_RejectsSubSqrtThreshold() public {
        _approveAlice();
        // Product = 100 * 100 = 10,000; sqrt = 100 < 1e3
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        vm.prank(alice);
        pool.addLiquidity(100, 100, 0, type(uint256).max);
    }

    // ── Swap Tests ────────────────────────────────────────────────────────────

    function test_SwapEurcToCirBtc() public {
        _seedPool();
        _approveBob();

        uint256 bobEurcIn = 6_000 * DEC6;
        uint256 bobBtcBefore = cirBtc.balanceOf(bob);

        vm.prank(bob);
        uint256 btcOut = pool.swap(address(eurc), address(cirBtc), bobEurcIn, 0, type(uint256).max);

        assertGt(btcOut, 0, "Bob must receive cirBTC");
        assertEq(cirBtc.balanceOf(bob) - bobBtcBefore, btcOut);
        // Fee is 25 bps on 6000 EURC = 15 EURC (15 * 1e6)
        assertEq(pool.unclaimedFeeA(), (bobEurcIn * 25) / 10000);
    }

    function test_SwapCirBtcToEurc() public {
        _seedPool();
        _approveBob();

        uint256 bobBtcIn = 1 * DEC8; // 1 cirBTC
        uint256 bobEurcBefore = eurc.balanceOf(bob);

        vm.prank(bob);
        uint256 eurcOut = pool.swap(address(cirBtc), address(eurc), bobBtcIn, 0, type(uint256).max);

        assertGt(eurcOut, 0, "Bob must receive EURC");
        assertEq(eurc.balanceOf(bob) - bobEurcBefore, eurcOut);
        // Fee is 25 bps on 1 cirBTC = 0.0025 cirBTC (250_000 units)
        assertEq(pool.unclaimedFeeB(), (bobBtcIn * 25) / 10000);
    }

    function test_KInvariant_PreservedAfterEurcToCirBtc() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 30_000 * DEC6, 0, type(uint256).max);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after EURC -> cirBTC swap");
    }

    function test_KInvariant_PreservedAfterCirBtcToEurc() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(cirBtc), address(eurc), 5 * DEC8 / 10, 0, type(uint256).max);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after cirBTC -> EURC swap");
    }

    function test_Swap_Reverts_On50PctDrainAttempt() public {
        _seedPool();
        _approveBob();

        // Attempting to buy out > 50% of the cirBTC reserve
        vm.expectRevert();
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 700_000 * DEC6, 0, type(uint256).max);
    }

    function test_Swap_RevertsDustSwap_ZeroFee() public {
        _seedPool();
        _approveBob();

        // 1 wei input has fee = (1 * 25) / 10000 = 0
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.DustSwapNotAllowed.selector);
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 1, 0, type(uint256).max);
    }

    function test_Swap_RevertsOnExpiredDeadline() public {
        _seedPool();
        _approveBob();

        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.DeadlineExpired.selector);
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 1_000 * DEC6, 0, block.timestamp - 1);
    }

    function test_Swap_RevertsWhilePaused() public {
        _seedPool();
        _approveBob();

        pool.pause();

        vm.expectRevert();
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 1_000 * DEC6, 0, type(uint256).max);
    }

    // ── Liquidity Management & Proportional Deposit (H-01) ────────────────────

    function test_SubsequentDeposit_ProportionalAmountsAccepted() public {
        _seedPool();
        _approveBob();

        // Seed ratio is 600,000 EURC : 10 cirBTC = 60,000 : 1
        // Bob deposits 60,000 EURC + 1 cirBTC exactly
        uint256 bobBalBeforeA = eurc.balanceOf(bob);
        uint256 bobBalBeforeB = cirBtc.balanceOf(bob);

        vm.prank(bob);
        uint256 lpShares = pool.addLiquidity(60_000 * DEC6, 1 * DEC8, 0, type(uint256).max);

        assertGt(lpShares, 0);
        assertEq(bobBalBeforeA - eurc.balanceOf(bob), 60_000 * DEC6);
        assertEq(bobBalBeforeB - cirBtc.balanceOf(bob), 1 * DEC8);
    }

    function test_SubsequentDeposit_ExcessTokenBCapped_NotDonated() public {
        _seedPool();
        _approveBob();

        // Bob specifies 60,000 EURC and offers up to 5 cirBTC (excessive)
        // Pool should only pull 1 cirBTC and NOT 5 cirBTC!
        uint256 bobBalBeforeB = cirBtc.balanceOf(bob);

        vm.prank(bob);
        pool.addLiquidity(60_000 * DEC6, 5 * DEC8, 0, type(uint256).max);

        assertEq(bobBalBeforeB - cirBtc.balanceOf(bob), 1 * DEC8, "Only optimal cirBTC should be pulled");
    }

    function test_RemoveLiquidity_WorksWhilePaused() public {
        _seedPool();

        pool.pause();

        uint256 aliceLp = pool.balanceOf(alice);
        uint256 eurcBefore = eurc.balanceOf(alice);
        uint256 btcBefore = cirBtc.balanceOf(alice);

        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(aliceLp, 0, 0);

        assertGt(outA, 0);
        assertGt(outB, 0);
        assertEq(eurc.balanceOf(alice) - eurcBefore, outA);
        assertEq(cirBtc.balanceOf(alice) - btcBefore, outB);
    }

    // ── Real Yield Harvest Tests ──────────────────────────────────────────────

    function test_HarvestAccruedFees() public {
        _seedPool();
        _approveBob();

        // Bob performs swaps to generate fees in both tokens
        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 60_000 * DEC6, 0, type(uint256).max);

        vm.prank(bob);
        pool.swap(address(cirBtc), address(eurc), 1 * DEC8, 0, type(uint256).max);

        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertGt(pendingA, 0, "Alice should have pending EURC fees");
        assertGt(pendingB, 0, "Alice should have pending cirBTC fees");

        uint256 eurcBefore = eurc.balanceOf(alice);
        uint256 btcBefore = cirBtc.balanceOf(alice);

        vm.prank(alice);
        (uint256 feeA, uint256 feeB) = pool.harvest();

        assertEq(feeA, pendingA);
        assertEq(feeB, pendingB);
        assertEq(eurc.balanceOf(alice) - eurcBefore, feeA);
        assertEq(cirBtc.balanceOf(alice) - btcBefore, feeB);

        // After harvest, pending fees should be 0
        (uint256 postA, uint256 postB) = pool.pendingFees(alice);
        assertEq(postA, 0);
        assertEq(postB, 0);
    }

    function test_Harvest_WorksWhilePaused() public {
        _seedPool();
        _approveBob();

        vm.prank(bob);
        pool.swap(address(eurc), address(cirBtc), 60_000 * DEC6, 0, type(uint256).max);

        pool.pause();

        vm.prank(alice);
        (uint256 feeA,) = pool.harvest();
        assertGt(feeA, 0, "LPs must be able to harvest fees while paused");
    }

    // ── Token Recovery (Skim) & Ownership ─────────────────────────────────────

    function test_SkimExcessTokens() public {
        _seedPool();

        // Direct donation of 1,000 EURC to pool
        eurc.mint(address(pool), 1_000 * DEC6);

        address recipient = address(0x999);
        pool.skim(address(eurc), recipient);

        assertEq(eurc.balanceOf(recipient), 1_000 * DEC6);
    }

    function test_OwnershipTransferIsTwoStep() public {
        address newOwner = address(0xCAFE);
        pool.transferOwnership(newOwner);

        // Still owner until accepted
        assertEq(pool.owner(), owner);

        vm.prank(newOwner);
        pool.acceptOwnership();

        assertEq(pool.owner(), newOwner);
    }
}

