// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @dev Local mock: reverts any transfer / mint TO a blocked address (USDC-style blocklist), and can
///      optionally reject zero-amount transfers.
contract BlocklistERC20 is ERC20 {
    error Blocked(address account);
    error ZeroTransfer();

    uint8 private immutable _dec;
    mapping(address => bool) public blocked;
    bool public rejectZeroTransfers;

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address account, bool isBlocked) external {
        blocked[account] = isBlocked;
    }

    function setRejectZeroTransfers(bool v) external {
        rejectZeroTransfers = v;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[to]) revert Blocked(to);
        if (rejectZeroTransfers && value == 0) revert ZeroTransfer();
        super._update(from, to, value);
    }
}

/// @notice Audit PoC / regression tests for the EURC / cirBTC V4 pool.
/// @dev F-01..F-04 are regression tests for fixed findings. F-05..F-08 now assert the FIXED behaviour:
///        F-05 ceil swap fee (DustSwapNotAllowed removed), F-06 last-LP sweep + restart deposit,
///        F-07 same-block (block.number) liquidity lock, F-08 recipient overloads.
///      Every add -> exit/transfer/harvest sequence by the same account rolls a block in between.
contract EurcCirBtcAuditPoC is Test {
    ConstantProductPoolEurcCirBtcV4 pool;
    MockERC20 eurc;
    MockERC20 btc;

    address alice = address(0xA11ce);
    address bob = address(0xB0b);
    address carol = address(0xCA201);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 constant SEED_A = 600_000e6;
    uint256 constant SEED_B = 10e8;

    function _roll() internal {
        vm.roll(block.number + 1);
    }

    /// @dev alice seeds 600,000 EURC / 10 cirBTC and the chain advances one block (alice unlocked).
    function _seed() internal returns (uint256 lp) {
        vm.prank(alice);
        lp = pool.addLiquidity(SEED_A, SEED_B, 0, type(uint256).max);
        _roll();
    }

    function _lockSel() internal pure returns (bytes4) {
        return ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector;
    }

    function setUp() public {
        eurc = new MockERC20("EURC", "EURC", 6);
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        pool = new ConstantProductPoolEurcCirBtcV4(address(eurc), address(btc), 25, address(this));
        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            eurc.mint(users[i], 1e18);
            btc.mint(users[i], 1e18);
            vm.startPrank(users[i]);
            eurc.approve(address(pool), type(uint256).max);
            btc.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    // F-01 (fixed): LP transfer sequence no longer lets claims exceed the fee reserve.
    // Realistic supply: DEAD can no longer absorb LP (DeadAddressTransferBlocked), so the eligible supply cannot be
    // shrunk to 2 wei. Instead the accrual rounding is stressed with odd transfer sizes across three real holders and
    // one-unit fees (fee = ceil(400 * 25 / 10000) = 1 raw unit per swap).
    function test_Regression_F01_FeeClaimsWithinReserve() public {
        vm.prank(alice);
        pool.addLiquidity(1_000_000, 1_000_000, 0, type(uint256).max); // LP = 1e17 - 1000
        _roll(); // F-07: minter cannot move LP in the minting block
        uint256 aliceLp = pool.balanceOf(alice);
        // spread LP over three holders with odd (non-round) amounts
        vm.startPrank(alice);
        pool.transfer(bob, aliceLp / 3 + 1);
        pool.transfer(carol, aliceLp / 7 + 3);
        vm.stopPrank();

        vm.prank(bob);
        pool.swap(address(eurc), address(btc), 400, 0, type(uint256).max); // fee = 1
        vm.prank(alice);
        pool.transfer(bob, 12_345_678_901_234_567);
        vm.prank(bob);
        pool.swap(address(eurc), address(btc), 400, 0, type(uint256).max); // fee = 1
        vm.prank(carol);
        pool.transfer(alice, 1); // 1 wei of LP changes hands mid-stream
        vm.prank(bob);
        pool.swap(address(eurc), address(btc), 400, 0, type(uint256).max); // fee = 1

        (uint256 a,) = pool.pendingFees(alice);
        (uint256 b,) = pool.pendingFees(bob);
        (uint256 c,) = pool.pendingFees(carol);
        assertEq(pool.feeReserveA(), 3, "reserve");
        assertLe(a + b + c, pool.feeReserveA(), "claims must not exceed reserve");
        // Rounding dust (at most one unit per holder plus the accumulator remainder) stays in the reserve.
        assertGe(a + b + c + 4, pool.feeReserveA(), "at most a few dust units unclaimable");

        if (a > 0) {
            vm.prank(alice);
            pool.harvest();
        }
        if (b > 0) {
            vm.prank(bob);
            pool.harvest(); // must not underflow
        }
        if (c > 0) {
            vm.prank(carol);
            pool.harvest();
        }
        assertLe(pool.feeReserveA(), 4, "only dust remains after every holder harvests");
        (uint256 pa,) = pool.pendingFees(DEAD);
        assertEq(pa, 0, "dead address is never claimable");
        assertEq(pool.balanceOf(DEAD), 1000, "dead balance stays at MINIMUM_LIQUIDITY");
    }

    // F-02 (fixed): the depositor must now pay for the cirBTC share (rounded up).
    function test_Regression_F02_DepositPaysTokenB() public {
        vm.prank(alice);
        pool.addLiquidity(1e12, 1e8, 0, type(uint256).max); // 1 BTC = 1,000,000 EURC
        uint256 btcBefore = btc.balanceOf(bob);
        vm.prank(bob);
        uint256 lp = pool.addLiquidity(9_999, 1e8, 0, type(uint256).max);
        assertGt(lp, 0, "LP minted");
        assertEq(btcBefore - btc.balanceOf(bob), 1, "rounded-up cirBTC pulled");
    }

    function test_Regression_F02_ExactProportionalDepositUnchanged() public {
        vm.prank(alice);
        pool.addLiquidity(600_000e6, 10e8, 0, type(uint256).max);
        uint256 a0 = eurc.balanceOf(bob);
        uint256 b0 = btc.balanceOf(bob);
        vm.prank(bob);
        pool.addLiquidity(60_000e6, 1e8, 0, type(uint256).max);
        assertEq(a0 - eurc.balanceOf(bob), 60_000e6);
        assertEq(b0 - btc.balanceOf(bob), 1e8);
    }

    // F-02 (fixed): a deposit/withdraw round trip never returns more than was deposited.
    function testFuzz_Regression_F02_RoundTripNoProfit(uint96 a, uint96 b) public {
        vm.prank(alice);
        pool.addLiquidity(600_000e6, 10e8, 0, type(uint256).max);
        a = uint96(bound(a, 1, 1e12));
        b = uint96(bound(b, 1, 1e9));
        uint256 a0 = eurc.balanceOf(bob);
        uint256 b0 = btc.balanceOf(bob);
        vm.startPrank(bob);
        try pool.addLiquidity(a, b, 0, type(uint256).max) returns (uint256 lp) {
            vm.roll(block.number + 1); // F-07 lock released next block
            pool.removeLiquidity(lp, 0, 0);
        } catch {
            vm.stopPrank();
            return;
        }
        vm.stopPrank();
        assertLe(eurc.balanceOf(bob), a0, "no EURC profit");
        assertLe(btc.balanceOf(bob), b0, "no cirBTC profit");
    }

    // F-03 (fixed): the no-deadline overloads no longer exist.
    function test_Regression_F03_NoDeadlineOverloadsRemoved() public {
        vm.prank(alice);
        pool.addLiquidity(600_000e6, 10e8, 0, type(uint256).max);
        vm.prank(bob);
        (bool ok,) = address(pool).call(
            abi.encodeWithSignature("swap(address,address,uint256,uint256)", address(eurc), address(btc), 1_000e6, 0)
        );
        assertFalse(ok, "4-arg swap must not exist");
        vm.prank(bob);
        (ok,) = address(pool).call(abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256)", 1e6, 1e8, 0));
        assertFalse(ok, "3-arg addLiquidity must not exist");

        vm.warp(block.timestamp + 365 days);
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.DeadlineExpired.selector);
        pool.swap(address(eurc), address(btc), 1_000e6, 0, block.timestamp - 1);
    }

    // F-04 (fixed): renouncing ownership reverts; pause/unpause stay controllable.
    function test_Regression_F04_RenounceDisabled() public {
        pool.pause();
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.RenounceDisabled.selector);
        pool.renounceOwnership();
        assertEq(pool.owner(), address(this));
        pool.unpause();
        assertFalse(pool.paused());

        vm.prank(alice);
        vm.expectRevert();
        pool.renounceOwnership();
    }

    // ── F-05 (fixed): fee = ceilDiv(amountIn * bps, 10000); DustSwapNotAllowed no longer used ──

    function test_Regression_F05_CeilFee_BtcLeg_799Is2() public {
        _seed();
        vm.prank(bob);
        pool.swap(address(btc), address(eurc), 799, 0, type(uint256).max);
        assertEq(pool.feeReserveB(), 2, "ceil(799*25/10000) = 2 (floor would give 1)");
        assertEq(pool.feeReserveA(), 0);
        // fee reserve + live reserve account for the full input
        assertEq(pool.reserveB(), SEED_B + 799 - 2);
    }

    function test_Regression_F05_CeilFee_EurcLeg() public {
        _seed();
        vm.prank(bob);
        pool.swap(address(eurc), address(btc), 799_999, 0, type(uint256).max);
        // ceil(799_999 * 25 / 10000) = ceil(1999.9975) = 2000
        assertEq(pool.feeReserveA(), 2000);
    }

    function test_Regression_F05_SplittingNoLongerReducesFee() public {
        _seed();
        uint256 chunks = 10;
        vm.startPrank(bob);
        for (uint256 i; i < chunks; i++) {
            pool.swap(address(btc), address(eurc), 799, 0, type(uint256).max);
        }
        vm.stopPrank();
        uint256 chunkedFee = pool.feeReserveB();
        assertEq(chunkedFee, 2 * chunks);
        // a single swap of the same total pays ceil(7990*25/10000) = 20 == the chunked total (no discount)
        assertEq(Math.ceilDiv(799 * chunks * 25, 10000), chunkedFee);
    }

    function test_Regression_F05_OneUnitSwapRevertsZeroAmount_BothLegs() public {
        _seed();
        vm.startPrank(bob);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        pool.swap(address(btc), address(eurc), 1, 0, type(uint256).max);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        pool.swap(address(eurc), address(btc), 1, 0, type(uint256).max);
        vm.stopPrank();
    }

    /// @dev PROPERTY: for any successful swap the fee taken is exactly ceilDiv(in*25, 10000) -- never below
    ///      0.25% of the input, and never more than one raw unit above it.
    function testFuzz_Regression_F05_CeilFeeNeverBelowQuarterPercent_BtcLeg(uint256 amountIn) public {
        _seed();
        amountIn = bound(amountIn, 2, SEED_B); // 1 unit reverts ZeroAmount; <= reserve keeps within the 50% cap
        uint256 rB0 = pool.reserveB();
        vm.prank(bob);
        pool.swap(address(btc), address(eurc), amountIn, 0, type(uint256).max);
        uint256 fee = pool.feeReserveB();
        assertGe(fee * 10000, amountIn * 25, "fee >= 0.25% of input");
        assertEq(fee, Math.ceilDiv(amountIn * 25, 10000));
        assertLe(fee, (amountIn * 25) / 10000 + 1, "at most 1 unit above floor");
        assertEq(pool.reserveB(), rB0 + amountIn - fee, "live reserve gets input minus fee");
    }

    function testFuzz_Regression_F05_CeilFeeNeverBelowQuarterPercent_EurcLeg(uint256 amountIn) public {
        _seed();
        amountIn = bound(amountIn, 603, SEED_A); // below ~603 raw EURC the output rounds to 0
        vm.prank(bob);
        pool.swap(address(eurc), address(btc), amountIn, 0, type(uint256).max);
        uint256 fee = pool.feeReserveA();
        assertGe(fee * 10000, amountIn * 25);
        assertEq(fee, Math.ceilDiv(amountIn * 25, 10000));
    }

    // ── F-06 (fixed): last real LP sweeps all reserves; the next deposit is a restart ──

    function _swapBothLegs() internal {
        vm.startPrank(bob);
        pool.swap(address(eurc), address(btc), 60_000e6, 0, type(uint256).max);
        pool.swap(address(btc), address(eurc), 1e8, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_Regression_F06_FullExitSweepsAllReserves() public {
        uint256 lp = _seed();
        _swapBothLegs();
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        assertGt(rA, 0);

        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0);

        assertEq(outA, rA, "last LP receives ALL reserveA");
        assertEq(outB, rB, "last LP receives ALL reserveB");
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
        assertEq(pool.totalSupply(), 1000, "only the dead shares remain");
        assertEq(pool.balanceOf(DEAD), 1000);
        // the pool token balance is exactly the isolated fee reserve -- no stranded trading reserves
        assertEq(eurc.balanceOf(address(pool)), pool.feeReserveA());
        assertEq(btc.balanceOf(address(pool)), pool.feeReserveB());
    }

    function test_Regression_F06_SwapRevertsNoLiquidityProvidersAfterFullExit() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
        vm.startPrank(bob);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.NoLiquidityProviders.selector);
        pool.swap(address(eurc), address(btc), 1_000e6, 0, type(uint256).max);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.NoLiquidityProviders.selector);
        pool.swap(address(btc), address(eurc), 1e6, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_Regression_F06_RestartAtSamePrice_ReservesRatioAndShares() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);

        vm.expectEmit(true, false, false, true, address(pool));
        emit ConstantProductPoolEurcCirBtcV4.LiquidityAdded(bob, SEED_A, SEED_B, Math.sqrt(SEED_A * SEED_B) * 1e11);
        vm.prank(bob);
        uint256 shares = pool.addLiquidity(SEED_A, SEED_B, 0, type(uint256).max);

        assertEq(shares, Math.sqrt(SEED_A * SEED_B) * 1e11, "restart mints the full sqrt(a*b)*1e11");
        assertEq(pool.reserveA(), SEED_A);
        assertEq(pool.reserveB(), SEED_B);
        assertEq(pool.reserveA() / pool.reserveB(), 600, "600 raw EURC per raw cirBTC (1 BTC = 60,000 EURC)");
        assertEq(pool.balanceOf(DEAD), 1000, "no second dead mint");
        assertEq(pool.totalSupply(), 1000 + shares);
        assertEq(pool.balanceOf(bob), shares);
    }

    function test_Regression_F06_RestartAtNewPrice_DepositorSetsPriceFreely() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);

        // 1 BTC = 15,000 EURC: nothing of the old 60,000 price survives
        vm.prank(bob);
        uint256 shares = pool.addLiquidity(150_000e6, 10e8, 0, type(uint256).max);
        assertEq(pool.reserveA(), 150_000e6);
        assertEq(pool.reserveB(), 10e8);
        assertEq(shares, Math.sqrt(150_000e6 * 10e8) * 1e11);

        // the pool is live at the new price: a small BTC sale returns ~15,000 EURC per BTC (minus fee/impact)
        _roll();
        vm.prank(carol);
        uint256 out = pool.swap(address(btc), address(eurc), 1e6, 0, type(uint256).max);
        assertApproxEqRel(out, 150e6, 0.02e18);
    }

    /// @dev PROPERTY: for any restart price/size the pool takes exactly the deposit and mints sqrt(a*b)*1e11.
    function testFuzz_Regression_F06_RestartAnyPrice(uint256 a, uint256 b) public {
        a = bound(a, 1e6, 1e13);
        b = bound(b, 1e4, 1e11);
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);

        vm.prank(bob);
        uint256 shares = pool.addLiquidity(a, b, 0, type(uint256).max);
        assertEq(shares, Math.sqrt(a * b) * 1e11);
        assertEq(pool.reserveA(), a);
        assertEq(pool.reserveB(), b);
        assertEq(pool.totalSupply(), 1000 + shares);
        assertEq(pool.balanceOf(DEAD), 1000);
    }

    function test_Regression_F06_RestartRejectsDustAndHonoursMinShares() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);

        vm.startPrank(bob);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        pool.addLiquidity(100, 100, 0, type(uint256).max); // sqrt < 1e3
        uint256 expected = Math.sqrt(SEED_A * SEED_B) * 1e11;
        vm.expectRevert(
            abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.SlippageExceeded.selector, expected + 1, expected)
        );
        pool.addLiquidity(SEED_A, SEED_B, expected + 1, type(uint256).max);
        vm.stopPrank();
        assertEq(pool.reserveA(), 0, "failed restarts leave the pool empty");
    }

    function test_Regression_F06_AfterRestart_ProportionalDepositsAndSwapsWork() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
        vm.prank(bob);
        pool.addLiquidity(100_000e6, 2e8, 0, type(uint256).max);
        uint256 total = pool.totalSupply();

        vm.prank(carol);
        uint256 carolLp = pool.addLiquidity(50_000e6, 1e8, 0, type(uint256).max);
        assertEq(carolLp, total / 2, "half the reserves buys half the supply");
        assertEq(pool.reserveA(), 150_000e6);
        assertEq(pool.reserveB(), 3e8);
        _roll();

        uint256 k0 = pool.reserveA() * pool.reserveB();
        vm.prank(alice);
        pool.swap(address(eurc), address(btc), 10_000e6, 0, type(uint256).max);
        assertGe(pool.reserveA() * pool.reserveB(), k0);
    }

    function test_Regression_F06_RestartLpDoesNotInheritOrDisturbOldFees() public {
        uint256 lp = _seed();
        _swapBothLegs();
        (uint256 oldA, uint256 oldB) = pool.pendingFees(alice);
        assertGt(oldA, 0);
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);

        vm.prank(bob);
        pool.addLiquidity(SEED_A, SEED_B, 0, type(uint256).max);
        _roll();
        (uint256 bA, uint256 bB) = pool.pendingFees(bob);
        assertEq(bA, 0, "restart LP has no claim on pre-restart fees");
        assertEq(bB, 0);
        (uint256 aA, uint256 aB) = pool.pendingFees(alice);
        assertEq(aA, oldA, "exited LP keeps her entitlement");
        assertEq(aB, oldB);

        vm.prank(carol);
        pool.swap(address(eurc), address(btc), 10_000e6, 0, type(uint256).max);
        (bA,) = pool.pendingFees(bob);
        (aA,) = pool.pendingFees(alice);
        assertGt(bA, 0);
        assertLe(aA + bA, pool.feeReserveA(), "claims never exceed fee reserve");

        // both can cash out in full
        vm.prank(alice);
        pool.harvest();
        vm.prank(bob);
        pool.harvest();
    }

    function test_Regression_F06_SweepWorksForTransferredLp() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.transfer(bob, lp); // bob now holds all eligible supply
        uint256 rA = pool.reserveA();
        vm.prank(bob);
        (uint256 outA,) = pool.removeLiquidity(lp, 0, 0);
        assertEq(outA, rA);
        assertEq(pool.reserveA(), 0);
    }

    /// @dev The 2-wei eligible-supply setup (LP parked on DEAD) is no longer constructible; the equivalent
    ///      realistic scenario: LP split across three holders, two exit proportionally, the last one sweeps the rest.
    function test_Regression_F06_SweepWhenLastOfSeveralHoldersExits() public {
        uint256 lp = _seed();
        vm.startPrank(alice);
        pool.transfer(bob, lp / 3);
        pool.transfer(carol, lp / 3);
        vm.stopPrank();
        uint256 total = pool.totalSupply();

        vm.prank(bob);
        (uint256 bobA, uint256 bobB) = pool.removeLiquidity(lp / 3, 0, 0);
        assertEq(bobA, (SEED_A * (lp / 3)) / total, "proportional exit, dead slice stays in the pool");
        vm.prank(carol);
        pool.removeLiquidity(lp / 3, 0, 0);

        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 aliceLp = pool.balanceOf(alice);
        assertEq(pool.totalSupply() - pool.balanceOf(DEAD), aliceLp, "alice is the last eligible LP");
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(aliceLp, 0, 0);
        assertEq(outA, rA, "last LP sweeps every remaining unit of reserveA");
        assertEq(outB, rB);
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
        assertEq(pool.balanceOf(DEAD), 1000);
        assertGt(bobB, 0);
    }

    function test_Regression_F06_TransferToDeadCannotShrinkEligibleSupply() public {
        uint256 lp = _seed();
        vm.prank(alice);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.DeadAddressTransferBlocked.selector);
        pool.transfer(DEAD, lp - 2);
        assertEq(pool.totalSupply() - pool.balanceOf(DEAD), lp, "eligible supply unchanged");
    }

    function test_Regression_F06_FirstDepositUnchanged_DeadMinted() public {
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(SEED_A, SEED_B, 0, type(uint256).max);
        uint256 initialLp = Math.sqrt(SEED_A * SEED_B) * 1e11;
        assertEq(lp, initialLp - 1000);
        assertEq(pool.balanceOf(DEAD), 1000);
        assertEq(pool.totalSupply(), initialLp);
    }

    // ── F-07 (fixed): dust guard gone -- minimum viable swap per leg is now set only by output rounding ──

    function test_Regression_F07_SmallSwapThresholds_BtcLeg() public {
        _seed();
        vm.startPrank(bob);
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        pool.swap(address(btc), address(eurc), 1, 0, type(uint256).max); // net 0
        assertGt(pool.swap(address(btc), address(eurc), 2, 0, type(uint256).max), 0); // fee 1, net 1
        // 399 / 400 sat were the old dust boundary: both are ordinary swaps now
        assertGt(pool.swap(address(btc), address(eurc), 399, 0, type(uint256).max), 0);
        assertGt(pool.swap(address(btc), address(eurc), 400, 0, type(uint256).max), 0);
        vm.stopPrank();
    }

    function test_Regression_F07_SmallSwapThresholds_EurcLeg() public {
        _seed();
        vm.startPrank(bob);
        // net 600 -> floor(1e9 * 600 / (6e11 + 600)) = 0
        vm.expectRevert(ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector);
        pool.swap(address(eurc), address(btc), 602, 0, type(uint256).max);
        // net 601 -> 1 raw cirBTC out
        assertEq(pool.swap(address(eurc), address(btc), 603, 0, type(uint256).max), 1);
        vm.stopPrank();
    }

    // Design note (original PoC #8): the 50% single-swap cap does not stop a multi-step drain (>66% in two swaps).
    function test_PoC_CapBypassedBySplitting() public {
        vm.prank(alice);
        pool.addLiquidity(600_000e6, 10e8, 0, type(uint256).max);
        uint256 rB0 = pool.reserveB();
        vm.startPrank(bob);
        // each swap buys just under 50% of the *current* reserve
        for (uint256 i; i < 2; i++) {
            uint256 rA = pool.reserveA();
            uint256 amtIn = rA * 995 / 1000; // ~ out 49.7%
            pool.swap(address(eurc), address(btc), amtIn, 0, type(uint256).max);
        }
        vm.stopPrank();
        assertLt(pool.reserveB(), rB0 / 3, "over 66% of cirBTC drained in two swaps");
    }

    // Extreme ratio sanity (original PoC #9): 1 BTC = 10 EURC and 1 BTC = 1,000,000 EURC mint + swap round-trips.
    function test_PoC_ExtremeRatios() public {
        _ratio(10e6, 1e8);
    }

    function test_PoC_ExtremeRatiosHigh() public {
        _ratio(1_000_000e6 * 5, 5e8);
    }

    function _ratio(uint256 a, uint256 b) internal {
        vm.prank(alice);
        pool.addLiquidity(a, b, 0, type(uint256).max);
        uint256 k0 = pool.reserveA() * pool.reserveB();
        vm.prank(bob);
        uint256 out = pool.swap(address(btc), address(eurc), b / 100, 0, type(uint256).max);
        assertGt(out, 0);
        assertGe(pool.reserveA() * pool.reserveB(), k0, "k grows");
    }

    // Fuzz: random multi-user transfer / swap / harvest sequence. Reports claim-vs-reserve breaches.
    function testFuzz_FeeSolvency_TransfersAndSwaps(uint256 seed) public {
        vm.prank(alice);
        pool.addLiquidity(1_000_000, 1_000_000, 0, type(uint256).max);
        _roll(); // F-07: alice may move her LP from the next block on
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 24; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 op = seed % 3;
            if (op == 0) {
                address from = us[(seed >> 8) % 3];
                address to = us[(seed >> 16) % 3];
                uint256 bal = pool.balanceOf(from);
                if (bal == 0) continue;
                uint256 amt = ((seed >> 24) % bal) + 1;
                vm.prank(from);
                pool.transfer(to, amt);
            } else if (op == 1) {
                vm.prank(bob);
                try pool.swap(address(eurc), address(btc), 400 + (seed >> 32) % 5000, 0, type(uint256).max) {} catch {}
            } else {
                vm.prank(carol);
                try pool.swap(address(btc), address(eurc), 400 + (seed >> 32) % 5000, 0, type(uint256).max) {} catch {}
            }
        }
        (uint256 a1, uint256 b1) = pool.pendingFees(alice);
        (uint256 a2, uint256 b2) = pool.pendingFees(bob);
        (uint256 a3, uint256 b3) = pool.pendingFees(carol);
        assertLe(a1 + a2 + a3, pool.feeReserveA(), "fee A claims <= reserve");
        assertLe(b1 + b2 + b3, pool.feeReserveB(), "fee B claims <= reserve");
    }

    // ── F-07 (fixed): same-block liquidity lock defeats JIT liquidity ──

    function test_Regression_F07_JIT_AddThenRemoveSameBlockReverts_OkAfterRoll() public {
        _seed();
        vm.startPrank(bob);
        uint256 lp = pool.addLiquidity(60_000e6, 1e8, 0, type(uint256).max);
        vm.expectRevert(_lockSel());
        pool.removeLiquidity(lp, 0, 0);
        vm.expectRevert(_lockSel());
        pool.removeLiquidity(lp, 0, 0, bob);
        vm.stopPrank();

        _roll();
        vm.prank(bob);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0);
        assertGt(outA, 0);
        assertGt(outB, 0);
    }

    function test_Regression_F07_JIT_SandwichSwapCannotHarvestOrExitInSameBlock() public {
        _seed();
        // block N: bob adds a large position, carol swaps through it, bob tries to cash out immediately
        vm.prank(bob);
        uint256 lp = pool.addLiquidity(6_000_000e6, 100e8, 0, type(uint256).max);
        vm.prank(carol);
        pool.swap(address(eurc), address(btc), 50_000e6, 0, type(uint256).max);
        (uint256 pA,) = pool.pendingFees(bob);
        assertGt(pA, 0, "bob has accrued fees, so the lock is what stops the atomic extraction");

        vm.startPrank(bob);
        vm.expectRevert(_lockSel());
        pool.harvest();
        vm.expectRevert(_lockSel());
        pool.harvest(bob);
        vm.expectRevert(_lockSel());
        pool.transfer(carol, lp); // cannot launder the position to a fresh account either
        vm.expectRevert(_lockSel());
        pool.removeLiquidity(lp, 0, 0);
        vm.stopPrank();

        _roll();
        vm.prank(bob);
        (uint256 feeA,) = pool.harvest();
        assertEq(feeA, pA, "after the lock block the fees are claimable");
    }

    function test_Regression_F07_TransferFromOfLockedMinterReverts() public {
        vm.startPrank(bob);
        uint256 lp = pool.addLiquidity(SEED_A, SEED_B, 0, type(uint256).max);
        pool.approve(carol, lp);
        vm.stopPrank();
        vm.prank(carol);
        vm.expectRevert(_lockSel());
        pool.transferFrom(bob, carol, lp);

        _roll();
        vm.prank(carol);
        pool.transferFrom(bob, carol, lp);
        assertEq(pool.balanceOf(carol), lp);
    }

    function test_Regression_F07_ThirdPartyTransferIn_DoesNotLockVictim() public {
        uint256 lp = _seed();
        // victim = carol (unlocked LP holder), griefer = bob (unlocked LP holder)
        vm.startPrank(alice);
        pool.transfer(carol, lp / 2);
        pool.transfer(bob, lp / 4);
        vm.stopPrank();
        vm.prank(bob);
        pool.swap(address(eurc), address(btc), 60_000e6, 0, type(uint256).max); // fees for carol

        // same block: griefer pokes the victim with LP
        vm.prank(bob);
        pool.transfer(carol, 1);
        assertEq(pool.lastLiquidityBlock(carol), 0, "incoming transfer never writes the lock");

        vm.startPrank(carol);
        (uint256 feeA,) = pool.harvest();
        assertGt(feeA, 0);
        pool.transfer(alice, 1e18);
        (uint256 outA,) = pool.removeLiquidity(lp / 8, 0, 0);
        vm.stopPrank();
        assertGt(outA, 0);
    }

    function test_Regression_F07_GrieferWhoAddsLiquidityCannotPushLockedLpToVictim() public {
        _seed();
        vm.startPrank(bob);
        uint256 lp = pool.addLiquidity(60_000e6, 1e8, 0, type(uint256).max);
        vm.expectRevert(_lockSel());
        pool.transfer(carol, lp);
        vm.stopPrank();
        assertEq(pool.balanceOf(carol), 0);
        assertEq(pool.lastLiquidityBlock(carol), 0);
    }

    function test_Regression_F07_LockIsPerAccount() public {
        _seed(); // alice unlocked
        vm.prank(bob);
        pool.addLiquidity(60_000e6, 1e8, 0, type(uint256).max); // bob locked
        uint256 aliceLp = pool.balanceOf(alice);
        vm.prank(alice); // alice is unaffected by bob's lock, in the same block
        pool.removeLiquidity(aliceLp / 2, 0, 0);
    }

    function test_Regression_F07_TopUpRelocksExistingBalance() public {
        _seed();
        vm.startPrank(alice);
        pool.addLiquidity(60_000e6, 1e8, 0, type(uint256).max);
        vm.expectRevert(_lockSel());
        pool.removeLiquidity(1, 0, 0);
        vm.stopPrank();
    }

    function test_Regression_F07_RestartDepositIsLockedToo() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
        vm.startPrank(bob);
        uint256 shares = pool.addLiquidity(SEED_A, SEED_B, 0, type(uint256).max);
        vm.expectRevert(_lockSel());
        pool.removeLiquidity(shares, 0, 0);
        vm.stopPrank();
    }

    function test_Regression_F07_PauseNeitherBypassesNorAddsToLock() public {
        _seed();
        pool.pause();
        // alice (unlocked) can exit in the very block the owner paused
        uint256 half = pool.balanceOf(alice) / 2;
        vm.prank(alice);
        pool.removeLiquidity(half, 0, 0);
        pool.unpause();

        vm.startPrank(bob);
        uint256 lp = pool.addLiquidity(60_000e6, 1e8, 0, type(uint256).max);
        vm.stopPrank();
        pool.pause();
        vm.startPrank(bob);
        vm.expectRevert(_lockSel());
        pool.removeLiquidity(lp, 0, 0);
        vm.expectRevert(_lockSel());
        pool.transfer(carol, lp);
        vm.stopPrank();

        _roll(); // exactly one block later the paused pool lets bob out
        vm.prank(bob);
        pool.removeLiquidity(lp, 0, 0);
    }

    /// @dev PROPERTY: locked in the minting block, unlocked at any later block.
    function testFuzz_Regression_F07_LockReleasedAtAnyLaterBlock(uint256 blocksLater) public {
        blocksLater = bound(blocksLater, 1, 1e9);
        _seed();
        vm.prank(bob);
        uint256 lp = pool.addLiquidity(60_000e6, 1e8, 0, type(uint256).max);
        vm.prank(bob);
        vm.expectRevert(_lockSel());
        pool.transfer(carol, lp);
        vm.roll(block.number + blocksLater);
        vm.prank(bob);
        pool.transfer(carol, lp);
        assertEq(pool.balanceOf(carol), lp);
    }

    function test_Regression_PendingFeesDead_IsZeroAndNotHarvestable() public {
        uint256 lp = _seed();
        vm.prank(alice);
        pool.transfer(bob, lp / 2); // real LP moves between real holders; DEAD cannot receive any
        _swapBothLegs();
        (uint256 a, uint256 b) = pool.pendingFees(DEAD);
        assertEq(a, 0);
        assertEq(b, 0);
        vm.prank(DEAD);
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        pool.harvest();
        // alice + bob own the whole fee stream since eligible supply excludes DEAD
        (uint256 pa,) = pool.pendingFees(alice);
        (uint256 pb,) = pool.pendingFees(bob);
        assertLe(pa + pb, pool.feeReserveA());
        // only floor dust (<= one accumulator unit per holder ~ supply/1e18 raw tokens) is unclaimable
        assertApproxEqAbs(pa + pb, pool.feeReserveA(), pool.totalSupply() / 1e18 + 2);
    }

    // ── F-08 (fixed): recipient overloads; zero-amount transfers skipped ──

    function _blockPool()
        internal
        returns (ConstantProductPoolEurcCirBtcV4 p, BlocklistERC20 tA, BlocklistERC20 tB)
    {
        tA = new BlocklistERC20("EURC", "EURC", 6);
        tB = new BlocklistERC20("cirBTC", "cirBTC", 8);
        p = new ConstantProductPoolEurcCirBtcV4(address(tA), address(tB), 25, address(this));
        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            tA.mint(users[i], 1e18);
            tB.mint(users[i], 1e18);
            vm.startPrank(users[i]);
            tA.approve(address(p), type(uint256).max);
            tB.approve(address(p), type(uint256).max);
            vm.stopPrank();
        }
        vm.prank(alice);
        p.addLiquidity(SEED_A, SEED_B, 0, type(uint256).max);
        _roll();
        vm.startPrank(bob);
        p.swap(address(tA), address(tB), 60_000e6, 0, type(uint256).max);
        p.swap(address(tB), address(tA), 1e8, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_Regression_F08_RemoveLiquidity_BlockedSender_CanExitViaRecipient() public {
        (ConstantProductPoolEurcCirBtcV4 p, BlocklistERC20 tA, BlocklistERC20 tB) = _blockPool();
        address safe = address(0x5AFE);
        tA.setBlocked(alice, true); // token reverts transfers TO alice
        uint256 lp = p.balanceOf(alice);
        uint256 half = lp / 2;

        // the 3-arg overload pays msg.sender, so it fails; the revert leaves her LP untouched
        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.TransferFailed.selector);
        p.removeLiquidity(half, 0, 0);
        assertEq(p.balanceOf(alice), lp);

        // the recipient overload gets her out; LP is debited from alice, tokens go to `safe`
        vm.prank(alice);
        (uint256 outA, uint256 outB) = p.removeLiquidity(half, 0, 0, safe);
        assertGt(outA, 0);
        assertGt(outB, 0);
        assertEq(tA.balanceOf(safe), outA);
        assertEq(tB.balanceOf(safe), outB);
        assertEq(p.balanceOf(alice), lp - half);
    }

    function test_Regression_F08_Harvest_BlockedSender_CanClaimViaRecipient() public {
        (ConstantProductPoolEurcCirBtcV4 p, BlocklistERC20 tA, BlocklistERC20 tB) = _blockPool();
        address safe = address(0x5AFE);
        tA.setBlocked(alice, true);
        (uint256 pA, uint256 pB) = p.pendingFees(alice);
        assertGt(pA, 0);
        assertGt(pB, 0);

        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.TransferFailed.selector);
        p.harvest();
        (uint256 stillA,) = p.pendingFees(alice);
        assertEq(stillA, pA, "failed harvest leaves the claim intact");

        vm.prank(alice);
        (uint256 feeA, uint256 feeB) = p.harvest(safe);
        assertEq(feeA, pA);
        assertEq(feeB, pB);
        assertEq(tA.balanceOf(safe), pA);
        assertEq(tB.balanceOf(safe), pB);
        (uint256 postA, uint256 postB) = p.pendingFees(alice);
        assertEq(postA, 0, "claim debited from msg.sender");
        assertEq(postB, 0);

        // the recipient gained no claim of its own
        vm.prank(safe);
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        p.harvest();
    }

    function test_Regression_F08_BlockedRecipient_RevertsTransferFailed() public {
        (ConstantProductPoolEurcCirBtcV4 p, BlocklistERC20 tA,) = _blockPool();
        tA.setBlocked(carol, true);
        uint256 lp = p.balanceOf(alice);
        vm.startPrank(alice);
        vm.expectRevert(LpFeeAccounting.TransferFailed.selector);
        p.removeLiquidity(lp / 2, 0, 0, carol);
        vm.expectRevert(LpFeeAccounting.TransferFailed.selector);
        p.harvest(carol);
        vm.stopPrank();
    }

    function test_Regression_F08_ZeroAddressRecipient_Reverts() public {
        uint256 lp = _seed();
        _swapBothLegs();
        bytes memory err = abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.ZeroAddress.selector, address(0));
        vm.startPrank(alice);
        vm.expectRevert(err);
        pool.removeLiquidity(lp / 2, 0, 0, address(0));
        vm.expectRevert(err);
        pool.harvest(address(0));
        vm.stopPrank();
        // reverts leave everything intact
        assertEq(pool.balanceOf(alice), lp);
        (uint256 pA,) = pool.pendingFees(alice);
        assertGt(pA, 0);
    }

    function test_Regression_F08_OriginalOverloadsStillPayMsgSender() public {
        uint256 lp = _seed();
        _swapBothLegs();
        uint256 a0 = eurc.balanceOf(alice);
        uint256 b0 = btc.balanceOf(alice);
        vm.startPrank(alice);
        (uint256 feeA, uint256 feeB) = pool.harvest();
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp / 2, 0, 0);
        vm.stopPrank();
        assertEq(eurc.balanceOf(alice) - a0, feeA + outA);
        assertEq(btc.balanceOf(alice) - b0, feeB + outB);
    }

    function test_Regression_F08_ZeroAmountTransfersSkipped_RemoveLiquidity() public {
        BlocklistERC20 tA = new BlocklistERC20("EURC", "EURC", 6);
        BlocklistERC20 tB = new BlocklistERC20("cirBTC", "cirBTC", 8);
        ConstantProductPoolEurcCirBtcV4 p = new ConstantProductPoolEurcCirBtcV4(address(tA), address(tB), 25, address(this));
        tA.mint(alice, 1e18);
        tB.mint(alice, 1e18);
        vm.startPrank(alice);
        tA.approve(address(p), type(uint256).max);
        tB.approve(address(p), type(uint256).max);
        p.addLiquidity(SEED_A, SEED_B, 0, type(uint256).max);
        vm.stopPrank();
        _roll();
        tA.setRejectZeroTransfers(true);
        tB.setRejectZeroTransfers(true);

        // 1e10 LP wei => outA = 2 raw EURC, outB = floor(0.004) = 0 raw cirBTC
        uint256 b0 = tB.balanceOf(alice);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = p.removeLiquidity(1e10, 0, 0);
        assertGt(outA, 0);
        assertEq(outB, 0);
        assertEq(tB.balanceOf(alice), b0, "no zero-value cirBTC transfer attempted");

        // same through the recipient overload, and with both outputs zero
        vm.prank(alice);
        (outA, outB) = p.removeLiquidity(1e10, 0, 0, carol);
        assertEq(tB.balanceOf(carol), 0);
        vm.prank(alice);
        (outA, outB) = p.removeLiquidity(1, 0, 0, carol);
        assertEq(outA, 0);
        assertEq(outB, 0);
    }

    function test_Regression_F08_Harvest_SkipsZeroSideTransfer() public {
        (ConstantProductPoolEurcCirBtcV4 p, BlocklistERC20 tA, BlocklistERC20 tB) = _blockPool();
        // fresh fees on the EURC side only after alice claims what exists
        vm.prank(alice);
        p.harvest();
        vm.prank(bob);
        p.swap(address(tA), address(tB), 10_000e6, 0, type(uint256).max);
        tB.setRejectZeroTransfers(true);
        (uint256 pA, uint256 pB) = p.pendingFees(alice);
        assertGt(pA, 0);
        assertEq(pB, 0);
        vm.prank(alice);
        p.harvest(carol); // would revert if a zero-value cirBTC transfer were attempted
        assertEq(tA.balanceOf(carol) - 1e18, pA);
    }

    /// @dev Multi-actor fuzz with liquidity adds, partial exits, harvests, transfers, swaps and block rolls.
    ///      PROPERTIES: claims <= fee reserve, pool balance covers reserve + fee reserve, k never decreases on a
    ///      swap, and no unexpected revert (anything other than lock / dust / no-fees conditions) occurs.
    function testFuzz_MultiActor_SolvencyWithLiquidityHarvestAndRolls(uint256 seed) public {
        vm.prank(alice);
        pool.addLiquidity(1_000_000, 1_000_000, 0, type(uint256).max);
        _roll();
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 40; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            address u = us[(seed >> 8) % 3];
            uint256 op = seed % 7;
            uint256 amt = 400 + (seed >> 32) % 20_000;
            if (op == 0) {
                uint256 bal = pool.balanceOf(u);
                if (bal == 0) continue;
                address to = us[(seed >> 16) % 3];
                vm.prank(u);
                try pool.transfer(to, ((seed >> 24) % bal) + 1) {} catch (bytes memory r) {
                    assertEq(bytes4(r), _lockSel());
                }
            } else if (op == 1 || op == 2) {
                bool aToB = op == 1;
                uint256 k0 = pool.reserveA() * pool.reserveB();
                vm.prank(u);
                try pool.swap(aToB ? address(eurc) : address(btc), aToB ? address(btc) : address(eurc), amt, 0, type(uint256).max) {
                    assertGe(pool.reserveA() * pool.reserveB(), k0, "k never decreases on a swap");
                } catch {}
            } else if (op == 3) {
                vm.prank(u);
                try pool.addLiquidity(amt, 1e12, 0, type(uint256).max) {} catch {}
            } else if (op == 4) {
                vm.prank(u);
                try pool.harvest() {} catch (bytes memory r) {
                    bytes4 sel = bytes4(r);
                    assertTrue(sel == _lockSel() || sel == LpFeeAccounting.NoFeesAccrued.selector, "unexpected harvest revert");
                }
            } else if (op == 5) {
                uint256 bal = pool.balanceOf(u);
                if (bal == 0) continue;
                vm.prank(u);
                try pool.removeLiquidity(((seed >> 24) % bal) + 1, 0, 0, us[(seed >> 16) % 3]) {} catch (bytes memory r) {
                    bytes4 sel = bytes4(r);
                    assertTrue(sel == _lockSel() || sel == ConstantProductPoolEurcCirBtcV4.SlippageExceeded.selector || sel == ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector, "unexpected remove revert");
                }
            } else {
                _roll();
            }
        }
        uint256 sumA;
        uint256 sumB;
        for (uint256 j; j < 3; j++) {
            (uint256 fa, uint256 fb) = pool.pendingFees(us[j]);
            sumA += fa;
            sumB += fb;
        }
        assertLe(sumA, pool.feeReserveA(), "fee A claims <= reserve");
        assertLe(sumB, pool.feeReserveB(), "fee B claims <= reserve");
        assertGe(eurc.balanceOf(address(pool)), pool.reserveA() + pool.feeReserveA());
        assertGe(btc.balanceOf(address(pool)), pool.reserveB() + pool.feeReserveB());
    }
}
