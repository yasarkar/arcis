// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit & integration tests for ConstantProductPoolCirBtcWethV4
///         (cirBTC 8-dec / WETH 18-dec, x*y=k, 30 bps fee, real-yield harvest).
contract ConstantProductPoolCirBtcWethV4Test is Test {
    ConstantProductPoolCirBtcWethV4 pool;
    MockERC20 cirBtc;
    MockERC20 weth;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);

    uint256 constant DEC8  = 1e8;   // cirBTC decimals
    uint256 constant DEC18 = 1e18;  // WETH decimals

    function setUp() public {
        cirBtc = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);
        weth = new MockERC20("Wrapped Ether", "WETH", 18);
        pool = new ConstantProductPoolCirBtcWethV4(address(cirBtc), address(weth), 30, owner); // 30 bps = 0.30%

        cirBtc.mint(alice,   100 * DEC8);
        weth.mint(alice,   2_000 * DEC18);
        cirBtc.mint(bob,     100 * DEC8);
        weth.mint(bob,     2_000 * DEC18);
    }

    function _approveAlice() internal {
        vm.startPrank(alice);
        cirBtc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _approveBob() internal {
        vm.startPrank(bob);
        cirBtc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    /// @dev Seed pool with 10 cirBTC + 200 WETH (ratio: 1 BTC = 20 ETH).
    function _seedPool() internal {
        _approveAlice();
        vm.prank(alice);
        pool.addLiquidity(10 * DEC8, 200 * DEC18, 0, type(uint256).max);
    }

    // ── Decimal & Constructor Tests ───────────────────────────────────────────

    function test_LpDecimalsStandardized18() public view {
        assertEq(pool.decimals(), 18, "LP token must be 18 decimals");
    }

    function test_Constructor_RejectsZeroFeeBps() public {
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolCirBtcWethV4.InvalidFeeBps.selector, 0));
        new ConstantProductPoolCirBtcWethV4(address(cirBtc), address(weth), 0, owner);
    }

    function test_Constructor_RejectsFeeBpsAbove1000() public {
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolCirBtcWethV4.InvalidFeeBps.selector, 1001));
        new ConstantProductPoolCirBtcWethV4(address(cirBtc), address(weth), 1001, owner);
    }

    function test_Constructor_AcceptsMaxValidFee() public {
        ConstantProductPoolCirBtcWethV4 testPool = new ConstantProductPoolCirBtcWethV4(
            address(cirBtc),
            address(weth),
            1000,
            owner
        );
        assertEq(testPool.swapFeeBps(), 1000);
    }

    // ── Initial Liquidity & Math ──────────────────────────────────────────────

    function test_InitialLiquidityMintingMath() public {
        _approveAlice();

        // 1 cirBTC (1 * 1e8 = 1e8)
        // 20 WETH   (20 * 1e18 = 2e19)
        // product = 2e27
        // rawSqrt = sqrt(2e27) = 44,721,359,549,995
        // initialLp = 44,721,359,549,995 * 1e5 = 4,472,135,954,999,500,000 (~4.47 LP tokens in 18 dec)
        uint256 amountA = 1 * DEC8;
        uint256 amountB = 20 * DEC18;

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
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.ZeroAmount.selector);
        vm.prank(alice);
        pool.addLiquidity(0, 20 * DEC18, 0, type(uint256).max);
    }

    function test_InitialDeposit_RejectsSubSqrtThreshold() public {
        _approveAlice();
        // Product = 100 * 100 = 10,000; sqrt = 100 < 1e6
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.ZeroAmount.selector);
        vm.prank(alice);
        pool.addLiquidity(100, 100, 0, type(uint256).max);
    }

    // ── Swap Tests ────────────────────────────────────────────────────────────

    function test_SwapCirBtcToWeth() public {
        _seedPool();
        _approveBob();

        uint256 bobBtcIn = 1 * DEC8; // 1 cirBTC
        uint256 bobWethBefore = weth.balanceOf(bob);

        vm.prank(bob);
        uint256 wethOut = pool.swap(address(cirBtc), address(weth), bobBtcIn, 0, type(uint256).max);

        assertGt(wethOut, 0, "Bob must receive WETH");
        assertEq(weth.balanceOf(bob) - bobWethBefore, wethOut);
        // Fee is 30 bps on 1 cirBTC = 0.003 cirBTC (300_000 raw units)
        assertEq(pool.unclaimedFeeA(), (bobBtcIn * 30) / 10000);
    }

    function test_SwapWethToCirBtc() public {
        _seedPool();
        _approveBob();

        uint256 bobWethIn = 20 * DEC18; // 20 WETH
        uint256 bobBtcBefore = cirBtc.balanceOf(bob);

        vm.prank(bob);
        uint256 btcOut = pool.swap(address(weth), address(cirBtc), bobWethIn, 0, type(uint256).max);

        assertGt(btcOut, 0, "Bob must receive cirBTC");
        assertEq(cirBtc.balanceOf(bob) - bobBtcBefore, btcOut);
        // Fee is 30 bps on 20 WETH = 0.06 WETH
        assertEq(pool.unclaimedFeeB(), (bobWethIn * 30) / 10000);
    }

    function test_KInvariant_PreservedAfterCirBtcToWeth() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(cirBtc), address(weth), 5 * DEC8 / 10, 0, type(uint256).max);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after cirBTC -> WETH swap");
    }

    function test_KInvariant_PreservedAfterWethToCirBtc() public {
        _seedPool();
        _approveBob();

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(weth), address(cirBtc), 10 * DEC18, 0, type(uint256).max);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after WETH -> cirBTC swap");
    }

    function test_Swap_Reverts_On50PctDrainAttempt() public {
        _seedPool();
        _approveBob();

        // Attempting to buy out > 50% of the WETH reserve (reserveB is 200 WETH, > 100 WETH output)
        // With 10 cirBTC and 200 WETH, depositing 15 cirBTC would yield > 100 WETH
        vm.expectRevert();
        vm.prank(bob);
        pool.swap(address(cirBtc), address(weth), 15 * DEC8, 0, type(uint256).max);
    }

    function test_Swap_RevertsDustSwap_ZeroFee() public {
        _seedPool();
        _approveBob();

        // 1 wei input has fee = (1 * 30) / 10000 = 0
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.DustSwapNotAllowed.selector);
        vm.prank(bob);
        pool.swap(address(cirBtc), address(weth), 1, 0, type(uint256).max);
    }

    function test_Swap_RevertsOnExpiredDeadline() public {
        _seedPool();
        _approveBob();

        vm.expectRevert(ConstantProductPoolCirBtcWethV4.DeadlineExpired.selector);
        vm.prank(bob);
        pool.swap(address(cirBtc), address(weth), 1 * DEC8, 0, block.timestamp - 1);
    }

    function test_Swap_RevertsWhilePaused() public {
        _seedPool();
        _approveBob();

        pool.pause();

        vm.expectRevert();
        vm.prank(bob);
        pool.swap(address(cirBtc), address(weth), 1 * DEC8, 0, type(uint256).max);
    }

    // ── Liquidity Management & Proportional Deposit (H-01) ────────────────────

    function test_SubsequentDeposit_ProportionalAmountsAccepted() public {
        _seedPool();
        _approveBob();

        // Seed ratio is 10 cirBTC : 200 WETH = 1 : 20
        // Bob deposits 1 cirBTC + 20 WETH exactly
        uint256 bobBalBeforeA = cirBtc.balanceOf(bob);
        uint256 bobBalBeforeB = weth.balanceOf(bob);

        vm.prank(bob);
        uint256 lpShares = pool.addLiquidity(1 * DEC8, 20 * DEC18, 0, type(uint256).max);

        assertGt(lpShares, 0);
        assertEq(bobBalBeforeA - cirBtc.balanceOf(bob), 1 * DEC8);
        assertEq(bobBalBeforeB - weth.balanceOf(bob), 20 * DEC18);
    }

    function test_SubsequentDeposit_ExcessTokenBCapped_NotDonated() public {
        _seedPool();
        _approveBob();

        // Bob specifies 1 cirBTC and offers up to 50 WETH (excessive; optimal is 20 WETH)
        // Pool should only pull 20 WETH and NOT 50 WETH!
        uint256 bobBalBeforeB = weth.balanceOf(bob);

        vm.prank(bob);
        pool.addLiquidity(1 * DEC8, 50 * DEC18, 0, type(uint256).max);

        assertEq(bobBalBeforeB - weth.balanceOf(bob), 20 * DEC18, "Only optimal WETH should be pulled");
    }

    function test_SubsequentDeposit_ExcessTokenACapped_NotDonated() public {
        _seedPool();
        _approveBob();

        // Bob offers 5 cirBTC and 20 WETH.
        // Ratio is 1 : 20, so optimal cirBTC for 20 WETH is 1 cirBTC.
        // Pool should only pull 1 cirBTC, not 5!
        uint256 bobBalBeforeA = cirBtc.balanceOf(bob);

        vm.prank(bob);
        pool.addLiquidity(5 * DEC8, 20 * DEC18, 0, type(uint256).max);

        assertEq(bobBalBeforeA - cirBtc.balanceOf(bob), 1 * DEC8, "Only optimal cirBTC should be pulled");
    }

    function test_RemoveLiquidity_WorksWhilePaused() public {
        _seedPool();

        pool.pause();

        uint256 aliceLp = pool.balanceOf(alice);
        uint256 btcBefore = cirBtc.balanceOf(alice);
        uint256 wethBefore = weth.balanceOf(alice);

        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(aliceLp, 0, 0);

        assertGt(outA, 0);
        assertGt(outB, 0);
        assertEq(cirBtc.balanceOf(alice) - btcBefore, outA);
        assertEq(weth.balanceOf(alice) - wethBefore, outB);
    }

    // ── Real Yield Harvest Tests ──────────────────────────────────────────────

    function test_HarvestAccruedFees() public {
        _seedPool();
        _approveBob();

        // Bob performs swaps to generate fees in both tokens
        vm.prank(bob);
        pool.swap(address(cirBtc), address(weth), 1 * DEC8, 0, type(uint256).max);

        vm.prank(bob);
        pool.swap(address(weth), address(cirBtc), 20 * DEC18, 0, type(uint256).max);

        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertGt(pendingA, 0, "Alice should have pending cirBTC fees");
        assertGt(pendingB, 0, "Alice should have pending WETH fees");

        uint256 btcBefore = cirBtc.balanceOf(alice);
        uint256 wethBefore = weth.balanceOf(alice);

        vm.prank(alice);
        (uint256 feeA, uint256 feeB) = pool.harvest();

        assertEq(feeA, pendingA);
        assertEq(feeB, pendingB);
        assertEq(cirBtc.balanceOf(alice) - btcBefore, feeA);
        assertEq(weth.balanceOf(alice) - wethBefore, feeB);

        // After harvest, pending fees should be 0
        (uint256 postA, uint256 postB) = pool.pendingFees(alice);
        assertEq(postA, 0);
        assertEq(postB, 0);
    }

    function test_Harvest_WorksWhilePaused() public {
        _seedPool();
        _approveBob();

        vm.prank(bob);
        pool.swap(address(cirBtc), address(weth), 1 * DEC8, 0, type(uint256).max);

        pool.pause();

        vm.prank(alice);
        (uint256 feeA,) = pool.harvest();
        assertGt(feeA, 0, "LPs must be able to harvest fees while paused");
    }

    // ── Token Recovery (Skim) & Ownership ─────────────────────────────────────

    function test_SkimExcessTokens() public {
        _seedPool();

        // Direct donation of 2 cirBTC to pool
        cirBtc.mint(address(pool), 2 * DEC8);

        address recipient = address(0x999);
        pool.skim(address(cirBtc), recipient);

        assertEq(cirBtc.balanceOf(recipient), 2 * DEC8);
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

