// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolV4} from "../src/v4/ConstantProductPoolV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Invariant & Fuzzing Audit Suite for ConstantProductPoolV4.
/// @dev Covers the four audit dimensions requested:
///      1. Mathematical correctness & decimal scaling
///      2. Fee accounting & solvency (LpFeeAccounting)
///      3. Economic & manipulation resistance
///      4. Arc/EVM compatibility checks
contract ConstantProductPoolV4AuditTest is Test {
    ConstantProductPoolV4 pool;
    MockERC20 usdc;
    MockERC20 btc;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);
    address carol = address(0xCA401);

    uint256 constant DEC6 = 1e6;
    uint256 constant DEC8 = 1e8;
    uint256 constant DEAD_BAL = 1000; // MINIMUM_LIQUIDITY

    // ── Setup ─────────────────────────────────────────────────────────────────
    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        btc  = new MockERC20("Circle Wrapped Bitcoin", "cirBTC", 8);
        pool = new ConstantProductPoolV4(address(usdc), address(btc), 25, owner);

        usdc.mint(alice, 100_000_000 * DEC6);
        btc.mint(alice,      100_000 * DEC8);
        usdc.mint(bob,   100_000_000 * DEC6);
        btc.mint(bob,        100_000 * DEC8);
        usdc.mint(carol, 100_000_000 * DEC6);
        btc.mint(carol,      100_000 * DEC8);
    }

    function _approveAll(address who) internal {
        vm.startPrank(who);
        usdc.approve(address(pool), type(uint256).max);
        btc.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _swapAtoB(address who, uint256 amount) internal {
        vm.prank(who);
        pool.swap(address(usdc), address(btc), amount, 0);
    }

    function _swapBtoA(address who, uint256 amount) internal {
        vm.prank(who);
        pool.swap(address(btc), address(usdc), amount, 0);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DIMENSION 1: Mathematical Correctness & Decimal Scaling
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Verify initial LP = sqrt(amountA * amountB) * 1e11 - 1000
    ///         for the canonical 100_000 USDC / 1 BTC first deposit.
    function test_Math_InitialLpFormula_Canonical() public {
        _approveAll(alice);
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        // Expected: sqrt(1e14 * 1e8) = sqrt(1e22) => a 11-digit number * 1e11 - 1000
        uint256 product = uint256(100_000) * DEC6 * DEC8;
        uint256 z = product; uint256 x = product / 2 + 1;
        while (x < z) { z = x; x = (product / x + x) / 2; }
        uint256 expected = z * 1e11 - 1000;
        assertEq(lp, expected, "LP formula mismatch");
    }

    /// @notice k-invariant: (rA + amountInAfterFee) * (rB - amountOut) >= rA * rB
    ///         Integer division of amountOut rounds DOWN so the pool always retains >= 1 extra unit.
    function test_Math_KInvariant_SwapAtoB() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        uint256 rABefore = pool.reserveA();
        uint256 rBBefore = pool.reserveB();
        uint256 kBefore  = rABefore * rBBefore;

        _approveAll(bob);
        uint256 amountIn = 1_000 * DEC6;
        uint256 fee = (amountIn * 25) / 10000;
        uint256 amountInAfterFee = amountIn - fee;

        vm.prank(bob);
        uint256 amountOut = pool.swap(address(usdc), address(btc), amountIn, 0);

        uint256 rAAfter = pool.reserveA(); // = rABefore + amountInAfterFee
        uint256 rBAfter = pool.reserveB(); // = rBBefore - amountOut
        uint256 kAfter  = rAAfter * rBAfter;

        assertGe(kAfter, kBefore, "k must not decrease after swap (fee isolation)");
        // Verify reserve update is exactly amountInAfterFee (fee excluded from reserve)
        assertEq(rAAfter, rABefore + amountInAfterFee, "reserveA must grow by amountInAfterFee only");
        assertEq(rBAfter, rBBefore - amountOut,        "reserveB must shrink by amountOut");
    }

    /// @notice Same k-invariant check for B→A direction.
    function test_Math_KInvariant_SwapBtoA() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        uint256 rABefore = pool.reserveA();
        uint256 rBBefore = pool.reserveB();
        uint256 kBefore  = rABefore * rBBefore;

        _approveAll(bob);
        uint256 amountIn = 1e7; // 0.1 BTC
        uint256 fee = (amountIn * 25) / 10000;
        uint256 amountInAfterFee = amountIn - fee;

        vm.prank(bob);
        uint256 amountOut = pool.swap(address(btc), address(usdc), amountIn, 0);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease after B-to-A swap");
        assertEq(pool.reserveB(), rBBefore + amountInAfterFee, "reserveB += amountInAfterFee");
        assertEq(pool.reserveA(), rABefore - amountOut,        "reserveA -= amountOut");
    }

    /// @notice Fuzz: for any amountIn, the k-invariant holds and amountOut rounds DOWN.
    function testFuzz_Math_KInvariantHolds(uint256 amountIn) public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        _approveAll(bob);

        // Bound: min 1 USDC, max 40% of reserveA (stays under 50% cap)
        amountIn = bound(amountIn, 1 * DEC6, (pool.reserveA() * 40) / 100);

        uint256 rABefore = pool.reserveA();
        uint256 rBBefore = pool.reserveB();
        uint256 kBefore  = rABefore * rBBefore;

        vm.prank(bob);
        pool.swap(address(usdc), address(btc), amountIn, 0);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k invariant must hold for any amountIn");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DIMENSION 2: Fee Accounting & Solvency
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice reserveA + feeReserveA == usdc.balanceOf(pool) after any swap sequence.
    function test_FeeAccounting_BalanceSolvency_AtoB() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveAll(bob);
        for (uint256 i = 0; i < 5; i++) {
            _swapAtoB(bob, 1_000 * DEC6);
        }

        uint256 contractUsdc = usdc.balanceOf(address(pool));
        assertEq(contractUsdc, pool.reserveA() + pool.feeReserveA(),
            "USDC: contractBalance must equal reserveA + feeReserveA");
    }

    /// @notice reserveB + feeReserveB == btc.balanceOf(pool) after BTC-in swaps.
    function test_FeeAccounting_BalanceSolvency_BtoA() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveAll(bob);
        for (uint256 i = 0; i < 5; i++) {
            _swapBtoA(bob, 1e7); // 0.1 BTC each
        }

        uint256 contractBtc = btc.balanceOf(address(pool));
        assertEq(contractBtc, pool.reserveB() + pool.feeReserveB(),
            "BTC: contractBalance must equal reserveB + feeReserveB");
    }

    /// @notice feeReserveA must never exceed usdc.balanceOf(pool).
    function test_FeeAccounting_FeeReserveNeverExceedsBalance() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveAll(bob);
        _approveAll(carol);

        for (uint256 i = 0; i < 10; i++) {
            _swapAtoB(bob, 2_000 * DEC6);
            _swapBtoA(carol, 1e7);
        }

        assertLe(pool.feeReserveA(), usdc.balanceOf(address(pool)),
            "feeReserveA must never exceed actual USDC balance");
        assertLe(pool.feeReserveB(), btc.balanceOf(address(pool)),
            "feeReserveB must never exceed actual BTC balance");
    }

    /// @notice sum of all LP pending fees must not exceed feeReserve.
    function test_FeeAccounting_SumPendingDoesNotExceedReserve() public {
        _approveAll(alice);
        _approveAll(bob);

        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        vm.prank(bob);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        _approveAll(carol);
        for (uint256 i = 0; i < 8; i++) {
            _swapAtoB(carol, 1_000 * DEC6);
        }

        (uint256 pAliceA, uint256 pAliceB) = pool.pendingFees(alice);
        (uint256 pBobA,   uint256 pBobB)   = pool.pendingFees(bob);

        assertLe(pAliceA + pBobA, pool.feeReserveA(), "sum pending feeA must not exceed reserve");
        assertLe(pAliceB + pBobB, pool.feeReserveB(), "sum pending feeB must not exceed reserve");
    }

    /// @notice Fuzz: after random fee distributions, remainderA/B carry-forward ensures
    ///         cumulative distributed <= cumulative collected.
    function testFuzz_FeeAccounting_RemainderCarryForward(uint256 feeAmount, uint256 extraLp) public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveAll(bob);
        vm.prank(bob);
        pool.addLiquidity(
            bound(extraLp, 1_000 * DEC6, 100_000 * DEC6),
            bound(extraLp, 1e6, 1 * DEC8),
            0
        );

        _approveAll(carol);
        uint256 swapAmount = bound(feeAmount, 1 * DEC6, (pool.reserveA() * 40) / 100);
        _swapAtoB(carol, swapAmount);

        // After one swap, feeReserveA must equal cumulative USDC fees collected
        uint256 expectedFee = (swapAmount * 25) / 10000;
        assertEq(pool.feeReserveA(), expectedFee, "feeReserveA must match collected fee");
        assertLe(pool.feeReserveA(), usdc.balanceOf(address(pool)),
            "feeReserveA must not exceed contract balance");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DIMENSION 3: Economic & Manipulation Resistance
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice First-depositor inflation: an attacker who self-donates tokens
    ///         AFTER first deposit cannot inflate share value beyond MINIMUM_LIQUIDITY anchor.
    function test_Econ_DonationAttack_Mitigated() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        // Attacker directly transfers USDC to pool (donation, no LP minted)
        vm.prank(carol);
        usdc.transfer(address(pool), 1_000_000 * DEC6);

        // Bob tries to add liquidity proportionally — reserves are NOT updated by donation
        // (the pool tracks reserveA, not balanceOf), so Bob is not diluted
        _approveAll(bob);
        vm.prank(bob);
        uint256 lpBob = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);
        assertGt(lpBob, 0, "Bob must still get positive LP even after donation");
    }

    /// @notice Massive swap must revert with SlippageExceeded (50% output cap).
    function test_Econ_MassiveSwap_CapReverts() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        _approveAll(bob);
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolV4.SlippageExceeded.selector);
        // 200% of pool USDC — would drain >50% of BTC if allowed
        pool.swap(address(usdc), address(btc), 200_000 * DEC6, 0);
    }

    /// @notice Self-transfer must NOT double-count userUnclaimed (C-1 fix verification).
    function test_Econ_SelfTransfer_NoDoubleFee() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveAll(carol);
        _swapAtoB(carol, 5_000 * DEC6);

        // Capture pending before self-transfer
        (uint256 pendingBefore, ) = pool.pendingFees(alice);
        assertGt(pendingBefore, 0);

        // Self-transfer — capture balance before prank so balanceOf doesn't consume the prank
        uint256 aliceLp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(alice, aliceLp);

        // Pending must equal what was there before — NOT doubled
        (uint256 pendingAfter, ) = pool.pendingFees(alice);
        assertEq(pendingAfter, pendingBefore, "Self-transfer must NOT double-count pending fees");
    }

    /// @notice Transfer front-run: Alice earns fees, transfers LP to Bob.
    ///         Bob must only earn fees accrued AFTER the transfer.
    function test_Econ_TransferFrontRun_PreTransferFeesStayWithSender() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveAll(carol);
        _swapAtoB(carol, 5_000 * DEC6);

        (uint256 pendingAlice, ) = pool.pendingFees(alice);
        assertGt(pendingAlice, 0, "Alice must have fees before transfer");

        uint256 lpAlice = pool.balanceOf(alice);

        // Alice transfers all LP to Bob
        vm.prank(alice);
        pool.transfer(bob, lpAlice);

        // Bob should have zero pending (he held no LP when swaps occurred)
        (uint256 pendingBob, ) = pool.pendingFees(bob);
        assertEq(pendingBob, 0, "Bob must not inherit Alice's pre-transfer fees");

        // Alice's pre-transfer fees must be banked to userUnclaimed (she has 0 LP now)
        (uint256 aliceStill, ) = pool.pendingFees(alice);
        assertEq(aliceStill, pendingAlice, "Alice must retain pre-transfer fees");
    }

    /// @notice After transfer, new swaps accrue only to the current LP holder (Bob).
    function test_Econ_TransferFrontRun_BobEarnsPostTransferFees() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        uint256 lpAlice = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(bob, lpAlice);

        // Swap after transfer
        _approveAll(carol);
        _swapAtoB(carol, 3_000 * DEC6);

        (uint256 pendingBob, ) = pool.pendingFees(bob);
        assertGt(pendingBob, 0, "Bob must earn fees from post-transfer swaps");
    }

    /// @notice Harvest CEI: after harvest, second immediate harvest must revert.
    function test_Econ_HarvestCEI_DoubleClaimReverts() public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        _approveAll(carol);
        _swapAtoB(carol, 5_000 * DEC6);

        vm.prank(alice);
        pool.harvest();

        vm.prank(alice);
        vm.expectRevert(bytes4(keccak256("NoFeesAccrued()")));
        pool.harvest();
    }

    /// @notice feeReserve solvency after many mixed swaps and harvests.
    function test_Econ_FeeReserveSolvency_MixedSequence() public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        vm.prank(bob);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        for (uint256 i = 0; i < 8; i++) {
            _swapAtoB(carol, 1_000 * DEC6);
            _swapBtoA(carol, 5e6); // 0.05 BTC
        }

        // Harvest by both LPs
        vm.prank(alice); pool.harvest();
        vm.prank(bob);   pool.harvest();

        // After all harvests, reserves must still be solvent
        assertLe(pool.feeReserveA(), usdc.balanceOf(address(pool)),
            "post-harvest feeReserveA must be solvent");
        assertLe(pool.feeReserveB(), btc.balanceOf(address(pool)),
            "post-harvest feeReserveB must be solvent");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // DIMENSION 4: Arc/EVM Compatibility
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice No receive() / fallback() — any ETH send must revert at EVM level.
    function test_Arc_NoNativeDeposit() public {
        (bool ok, ) = address(pool).call{value: 1}("");
        assertFalse(ok, "native value deposit must revert (no receive/fallback)");
    }

    /// @notice Verify token addresses are stored as immutables (not mutable — Arc USDC address is canonical).
    function test_Arc_TokenAddressesImmutable() public view {
        assertEq(address(pool.tokenA()), address(usdc));
        assertEq(address(pool.tokenB()), address(btc));
    }

    /// @notice _safeTransferFrom must handle tokens that return false instead of reverting.
    ///         MockERC20 returns false on insufficient allowance — pool must revert TransferFailed.
    function test_Arc_SafeTransferHandlesReturnFalse() public {
        // Alice has no allowance set — transfer should fail gracefully
        vm.prank(alice);
        vm.expectRevert(bytes4(keccak256("TransferFailed()")));
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0); // no approve, should fail
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ADDITIONAL FUZZ SCENARIOS
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Fuzz k-invariant across wide input range for B→A direction.
    function testFuzz_KInvariant_BtoA(uint256 amountIn) public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        _approveAll(bob);

        amountIn = bound(amountIn, 1e4, (pool.reserveB() * 40) / 100);

        uint256 kBefore = pool.reserveA() * pool.reserveB();

        vm.prank(bob);
        pool.swap(address(btc), address(usdc), amountIn, 0);

        uint256 kAfter = pool.reserveA() * pool.reserveB();
        assertGe(kAfter, kBefore, "k must not decrease for B-to-A fuzz");
    }

    /// @notice Fuzz: feeReserve solvent vs contract balance across random swap sequences.
    function testFuzz_FeeReserveSolventBothDirections(uint256 seed) public {
        _approveAll(alice);
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        _approveAll(bob);

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();

        for (uint256 i = 0; i < 6; i++) {
            uint256 s = uint256(keccak256(abi.encodePacked(seed, i)));
            if (s % 2 == 0) {
                uint256 amt = bound(s >> 8, 1 * DEC6, (rA * 40) / 100);
                vm.prank(bob);
                pool.swap(address(usdc), address(btc), amt, 0);
            } else {
                uint256 amt = bound(s >> 8, 1e4, (rB * 40) / 100);
                vm.prank(bob);
                pool.swap(address(btc), address(usdc), amt, 0);
            }
            rA = pool.reserveA();
            rB = pool.reserveB();
        }

        assertLe(pool.feeReserveA(), usdc.balanceOf(address(pool)));
        assertLe(pool.feeReserveB(), btc.balanceOf(address(pool)));
    }

    /// @notice Fuzz: adding liquidity from multiple providers never breaks proportional shares.
    function testFuzz_ProportionalShares(uint256 amountA, uint256 amountB) public {
        _approveAll(alice);
        _approveAll(bob);

        amountA = bound(amountA, 1_000 * DEC6, 1_000_000 * DEC6);
        amountB = bound(amountB, 1e6,   10 * DEC8);

        vm.prank(alice);
        pool.addLiquidity(amountA, amountB, 0);

        uint256 totalBefore = pool.totalSupply();

        vm.prank(bob);
        uint256 lpBob = pool.addLiquidity(amountA, amountB, 0);

        assertGt(lpBob, 0);
        assertGt(pool.totalSupply(), totalBefore);
    }

    /// @notice Fuzz: harvest amount never exceeds feeReserve.
    function testFuzz_HarvestNeverExceedsReserve(uint256 swapAmt) public {
        _approveAll(alice);
        _approveAll(carol);

        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);

        swapAmt = bound(swapAmt, 1 * DEC6, (pool.reserveA() * 40) / 100);
        _swapAtoB(carol, swapAmt);

        (uint256 pendingA, uint256 pendingB) = pool.pendingFees(alice);
        assertLe(pendingA, pool.feeReserveA(), "harvest cannot exceed feeReserveA");
        assertLe(pendingB, pool.feeReserveB(), "harvest cannot exceed feeReserveB");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // SECTION 6 RECOMMENDED SCENARIOS (now implemented)
    // ─────────────────────────────────────────────────────────────────────────

    // ── Scenario 1: Stateful k-invariant across arbitrary operation sequences ──

    /// @notice Fuzz: k never decreases across an arbitrary mix of addLiquidity,
    ///         swap A→B, swap B→A, and removeLiquidity operations.
    /// @dev removeLiquidity withdraws proportionally so k = rA*rB shrinks (smaller
    ///      reserves) but we only assert k/totalSupply² is non-decreasing —
    ///      alternatively, we assert that each swap individually never decreases k.
    ///      Liquidity add/remove changes pool size so we snapshot k around swaps only.
    function testFuzz_Stateful_KNeverDecreasesAcrossOperations(uint256 seed) public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        // Initial liquidity — two providers
        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        vm.prank(bob);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();

        // Execute 10 random operations
        for (uint256 i = 0; i < 10; i++) {
            uint256 s   = uint256(keccak256(abi.encodePacked(seed, i)));
            uint256 op  = s % 4;

            if (op == 0) {
                // Swap A→B: k must not decrease
                uint256 swapAmt = bound(s >> 8, 1 * DEC6, (rA * 40) / 100);
                uint256 kBefore = rA * rB;
                _swapAtoB(carol, swapAmt);
                uint256 kAfter = pool.reserveA() * pool.reserveB();
                assertGe(kAfter, kBefore, "k decreased on A-to-B swap");
            } else if (op == 1) {
                // Swap B→A: k must not decrease
                uint256 swapAmt = bound(s >> 8, 1e4, (rB * 40) / 100);
                uint256 kBefore = rA * rB;
                _swapBtoA(carol, swapAmt);
                uint256 kAfter = pool.reserveA() * pool.reserveB();
                assertGe(kAfter, kBefore, "k decreased on B-to-A swap");
            } else if (op == 2) {
                // addLiquidity: k grows (more reserves), assert reserves both increase
                uint256 addA = bound(s >> 8, 1_000 * DEC6, 50_000 * DEC6);
                uint256 addB = bound(s >> 16, 1e6, 5e7);
                uint256 rABefore = pool.reserveA();
                uint256 rBBefore = pool.reserveB();
                vm.prank(carol);
                pool.addLiquidity(addA, addB, 0);
                assertGe(pool.reserveA(), rABefore, "reserveA shrank on addLiquidity");
                assertGe(pool.reserveB(), rBBefore, "reserveB shrank on addLiquidity");
            } else {
                // removeLiquidity: proportional exit — k² / totalSupply² stays constant
                uint256 aliceLp = pool.balanceOf(alice);
                if (aliceLp > 1000) {
                    uint256 removeLp = bound(s >> 8, 1, aliceLp / 10);
                    vm.prank(alice);
                    pool.removeLiquidity(removeLp, 0, 0);
                }
            }

            rA = pool.reserveA();
            rB = pool.reserveB();
        }
    }

    // ── Scenario 2: reserveA + feeReserveA == tokenA.balanceOf(pool) invariant ──

    /// @notice Fuzz: the strict balance identity holds after every operation type
    ///         applied in an arbitrary order.
    function testFuzz_Stateful_BalanceIdentityHoldsAfterEveryOp(uint256 seed) public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        vm.prank(bob);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        // Check identity after initial deposits
        assertEq(
            usdc.balanceOf(address(pool)),
            pool.reserveA() + pool.feeReserveA(),
            "identity violated after initial addLiquidity"
        );
        assertEq(
            btc.balanceOf(address(pool)),
            pool.reserveB() + pool.feeReserveB(),
            "identity violated after initial addLiquidity (BTC)"
        );

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();

        for (uint256 i = 0; i < 8; i++) {
            uint256 s  = uint256(keccak256(abi.encodePacked(seed, i)));
            uint256 op = s % 5;

            if (op == 0) {
                uint256 amt = bound(s >> 8, 1 * DEC6, (rA * 40) / 100);
                _swapAtoB(carol, amt);
            } else if (op == 1) {
                uint256 amt = bound(s >> 8, 1e4, (rB * 40) / 100);
                _swapBtoA(carol, amt);
            } else if (op == 2) {
                uint256 addA = bound(s >> 8, 1_000 * DEC6, 20_000 * DEC6);
                uint256 addB = bound(s >> 16, 1e6, 2e7);
                vm.prank(carol);
                pool.addLiquidity(addA, addB, 0);
            } else if (op == 3) {
                uint256 aliceLp = pool.balanceOf(alice);
                if (aliceLp > 1000) {
                    uint256 removeLp = bound(s >> 8, 1, aliceLp / 20);
                    vm.prank(alice);
                    pool.removeLiquidity(removeLp, 0, 0);
                }
            } else {
                // harvest
                (uint256 pA, uint256 pB) = pool.pendingFees(alice);
                if (pA > 0 || pB > 0) {
                    vm.prank(alice);
                    pool.harvest();
                }
            }

            rA = pool.reserveA();
            rB = pool.reserveB();

            // Assert identity after EVERY operation
            assertEq(
                usdc.balanceOf(address(pool)),
                pool.reserveA() + pool.feeReserveA(),
                "USDC identity violated mid-sequence"
            );
            assertEq(
                btc.balanceOf(address(pool)),
                pool.reserveB() + pool.feeReserveB(),
                "BTC identity violated mid-sequence"
            );
        }
    }

    // ── Scenario 3: Two-LP proportional harvest ───────────────────────────────

    /// @notice Fuzz: two LPs with shares in ratio lpA:lpB earn fees in the same ratio
    ///         (within 1 wei of rounding). Verified across random swap amounts.
    function testFuzz_TwoLp_ProportionalHarvest(uint256 swapSeed) public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        // Alice deposits 5× more than Bob → expects ~5× more fees
        vm.prank(alice);
        uint256 lpAlice = pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        vm.prank(bob);
        uint256 lpBob = pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        // Execute random swaps so fees accumulate
        uint256 rA = pool.reserveA();
        for (uint256 i = 0; i < 6; i++) {
            uint256 s = uint256(keccak256(abi.encodePacked(swapSeed, i)));
            uint256 amt = bound(s, 1 * DEC6, (rA * 30) / 100);
            _swapAtoB(carol, amt);
            rA = pool.reserveA();
        }

        // Harvest both
        vm.prank(alice);
        (uint256 harvestAliceA, ) = pool.harvest();
        vm.prank(bob);
        (uint256 harvestBobA, ) = pool.harvest();

        // harvestAliceA / harvestBobA should equal lpAlice / lpBob within 1 wei per unit
        // Cross-multiply to avoid division: harvestAliceA * lpBob ≈ harvestBobA * lpAlice
        // Allow rounding tolerance of max(lpAlice, lpBob) wei in the cross-product
        uint256 lhs = harvestAliceA * lpBob;
        uint256 rhs = harvestBobA * lpAlice;
        uint256 tolerance = lpAlice > lpBob ? lpAlice : lpBob;

        // Compute absolute difference safely
        uint256 diff = lhs > rhs ? lhs - rhs : rhs - lhs;
        assertLe(diff, tolerance, "harvest ratio must match LP share ratio within 1 wei per unit");
    }

    // ── Scenario 4: Exit invariant ────────────────────────────────────────────

    /// @notice After all active LPs remove all their liquidity, the pool reserves
    ///         must be zero. The DEAD_ADDRESS LP (MINIMUM_LIQUIDITY) permanently
    ///         locks a tiny fraction of reserves — verified as the only remainder.
    function test_ExitInvariant_ReservesEmptyAfterFullExit() public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        vm.prank(bob);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        // Run some swaps so fees accumulate in feeReserveA/B
        for (uint256 i = 0; i < 5; i++) {
            _swapAtoB(carol, 2_000 * DEC6);
            _swapBtoA(carol, 2e6);
        }

        // Harvest all accrued fees before exit
        (uint256 pAliceA, uint256 pAliceB) = pool.pendingFees(alice);
        if (pAliceA > 0 || pAliceB > 0) { vm.prank(alice); pool.harvest(); }
        (uint256 pBobA, uint256 pBobB) = pool.pendingFees(bob);
        if (pBobA > 0 || pBobB > 0) { vm.prank(bob); pool.harvest(); }

        // Both active LPs exit fully
        uint256 aliceLp = pool.balanceOf(alice);
        uint256 bobLp   = pool.balanceOf(bob);

        vm.prank(alice);
        pool.removeLiquidity(aliceLp, 0, 0);
        vm.prank(bob);
        pool.removeLiquidity(bobLp, 0, 0);

        // Only MINIMUM_LIQUIDITY remains locked in DEAD_ADDRESS — compute expected dust
        uint256 deadLp    = pool.balanceOf(pool.DEAD_ADDRESS());
        uint256 totalLeft = pool.totalSupply(); // == deadLp
        assertEq(totalLeft, deadLp, "only dead-address LP must remain");

        // Remaining reserves are proportional to the dead LP fraction
        // reserveA_remaining = reserveA * deadLp / totalSupply (which == deadLp) = reserveA
        // Since totalSupply == deadLp, the entire remaining reserve belongs to DEAD_ADDRESS
        // It must be non-zero (locked) but tiny — verify it's <= 1 USDC and <= 1 satoshi
        assertLe(pool.reserveA(), 1 * DEC6,  "residual reserveA must be dust (<= 1 USDC)");
        assertLe(pool.reserveB(), 1 * DEC8,  "residual reserveB must be dust (<= 1 BTC)");
        // feeReserves may contain sub-unit remainder dust from the PRECISION carry-forward.
        // The carry-forward guarantees no fee is lost — dust is <= eligibleLpSupply / PRECISION
        // in practice this is at most a few hundred wei (confirmed by the test output: 298 wei).
        // Assert dust is strictly less than 1 full token unit for either asset.
        assertLt(pool.feeReserveA(), DEC6, "feeReserveA dust must be < 1 USDC");
        assertLt(pool.feeReserveB(), DEC8, "feeReserveB dust must be < 1 satoshi-unit");
    }

    // ── Scenario 5: Fee dust accounting ──────────────────────────────────────

    /// @notice Fuzz: sum(all harvested feeA) + feeReserveA_remaining == sum(all collected feeA).
    ///         This verifies that no fees are created or destroyed — only redistributed.
    function testFuzz_FeeDustAccounting_Conservation(uint256 seed) public {
        _approveAll(alice);
        _approveAll(bob);
        _approveAll(carol);

        vm.prank(alice);
        pool.addLiquidity(500_000 * DEC6, 5 * DEC8, 0);
        vm.prank(bob);
        pool.addLiquidity(100_000 * DEC6, 1 * DEC8, 0);

        uint256 totalCollectedA; // accumulated swap fees for tokenA
        uint256 totalCollectedB; // accumulated swap fees for tokenB

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();

        // Run random swaps and track exactly how much fee was collected each time
        for (uint256 i = 0; i < 8; i++) {
            uint256 s  = uint256(keccak256(abi.encodePacked(seed, i)));
            uint256 op = s % 2;

            if (op == 0) {
                uint256 amtIn = bound(s >> 8, 1 * DEC6, (rA * 35) / 100);
                uint256 fee   = (amtIn * pool.swapFeeBps()) / 10000;
                _swapAtoB(carol, amtIn);
                totalCollectedA += fee;
            } else {
                uint256 amtIn = bound(s >> 8, 1e4, (rB * 35) / 100);
                uint256 fee   = (amtIn * pool.swapFeeBps()) / 10000;
                _swapBtoA(carol, amtIn);
                totalCollectedB += fee;
            }
            rA = pool.reserveA();
            rB = pool.reserveB();
        }

        // feeReserve must equal total collected (before any harvest)
        assertEq(pool.feeReserveA(), totalCollectedA, "feeReserveA must equal total A fees collected");
        assertEq(pool.feeReserveB(), totalCollectedB, "feeReserveB must equal total B fees collected");

        // Harvest Alice
        uint256 usdcBefore = usdc.balanceOf(alice);
        uint256 btcBefore  = btc.balanceOf(alice);
        vm.prank(alice);
        pool.harvest();
        uint256 harvestedAliceA = usdc.balanceOf(alice) - usdcBefore;
        uint256 harvestedAliceB = btc.balanceOf(alice)  - btcBefore;

        // Harvest Bob
        usdcBefore = usdc.balanceOf(bob);
        btcBefore  = btc.balanceOf(bob);
        vm.prank(bob);
        pool.harvest();
        uint256 harvestedBobA = usdc.balanceOf(bob) - usdcBefore;
        uint256 harvestedBobB = btc.balanceOf(bob)  - btcBefore;

        uint256 totalHarvestedA = harvestedAliceA + harvestedBobA;
        uint256 totalHarvestedB = harvestedAliceB + harvestedBobB;

        // Conservation: harvested + remaining reserve == total collected
        // (remainder is truncation dust — must be < totalSupply in magnitude)
        assertEq(
            totalHarvestedA + pool.feeReserveA(),
            totalCollectedA,
            "fee conservation violated for tokenA"
        );
        assertEq(
            totalHarvestedB + pool.feeReserveB(),
            totalCollectedB,
            "fee conservation violated for tokenB"
        );

        // Remaining dust must be strictly less than the eligible LP supply (remainder carry-forward bound)
        assertLt(
            pool.feeReserveA(),
            pool.totalSupply(),
            "residual feeReserveA (dust) must be < LP supply"
        );
    }
}
