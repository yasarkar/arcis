// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Audit proof-of-concept / regression tests for the cirBTC (8 dec) / WETH (18 dec) V4 pool.
///         test_Regression_* / testFuzz_Regression_* assert the FIXED behaviour (F-01 magnified fee ledger,
///         F-02 ceil deposits, F-03 removed no-deadline overloads, F-04 renounce disabled, F-05 ceil fee,
///         F-06 last-LP sweep + restart, F-07 same-block lock, F-09 dead-address block, F-10 output cap).
///         test_PoC_* tests document intended extreme-ratio and inflation behaviour.
contract CirBtcWethAuditPoC is Test {
    ConstantProductPoolCirBtcWethV4 pool;
    MockERC20 btc;
    MockERC20 weth;

    address alice = address(0xA11ce);
    address bob = address(0xB0b);
    address carol = address(0xCA201);
    address constant DEAD = 0x000000000000000000000000000000000000dEaD;

    uint256 constant SAT = 1e8; // 1 cirBTC
    uint256 constant ETH = 1e18; // 1 WETH

    function setUp() public {
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        weth = new MockERC20("WETH", "WETH", 18);
        pool = new ConstantProductPoolCirBtcWethV4(address(btc), address(weth), 30, address(this));
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            btc.mint(us[i], 1e15);
            weth.mint(us[i], 1e36);
            vm.startPrank(us[i]);
            btc.approve(address(pool), type(uint256).max);
            weth.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    /// @dev alice seeds 1 cirBTC : ethPerBtc WETH, then a block is mined so her F-07 same-block lock has expired.
    function _seed(uint256 ethPerBtc) internal returns (uint256 lp) {
        vm.prank(alice);
        lp = pool.addLiquidity(SAT, ethPerBtc * ETH, 0, type(uint256).max);
        vm.roll(block.number + 1);
    }

    // ── Math at the requested extreme ratios ──────────────────────────────────

    function test_PoC_InitialMint_1BtcEq1Eth() public {
        uint256 lp = _seed(1);
        assertEq(lp + 1000, 1e18, "sqrt(1e8*1e18)=1e13; *1e5 = 1e18 LP");
        assertEq(pool.balanceOf(DEAD), 1000);
    }

    function test_PoC_InitialMint_1BtcEq100Eth() public {
        uint256 lp = _seed(100);
        assertEq(lp + 1000, 1e19, "sqrt(1e8*1e20)=1e14; *1e5 = 1e19 LP");
    }

    function test_PoC_InitialDeposit_ProductOverflowReverts() public {
        btc.mint(alice, type(uint192).max);
        weth.mint(alice, type(uint192).max);
        vm.prank(alice);
        vm.expectRevert(); // checked arithmetic: A*B overflows, no silent wrap
        pool.addLiquidity(type(uint192).max, type(uint192).max, 0, type(uint256).max);
    }

    function test_PoC_InitialDeposit_ThresholdOnlyBoundsGeometricMean() public {
        // (1 satoshi, 1e12 wei) passes the rawSqrt >= 1e6 check: an extreme price can be set by the first depositor.
        vm.prank(alice);
        uint256 lp = pool.addLiquidity(1, 1e12, 0, type(uint256).max);
        assertEq(lp, 1e11 - 1000);
        assertEq(pool.reserveA(), 1);
        assertEq(pool.reserveB(), 1e12);
    }

    // Donation / inflation resistance: reserves are internal counters.
    function test_PoC_InflationAttack_DonationDoesNotMovePrice() public {
        vm.prank(alice);
        pool.addLiquidity(1, 1e12, 0, type(uint256).max); // attacker seeds minimal pool
        btc.mint(address(pool), 1_000 * SAT); // direct donation
        weth.mint(address(pool), 1_000 * ETH);
        uint256 a0 = btc.balanceOf(bob);
        uint256 w0 = weth.balanceOf(bob);
        vm.startPrank(bob);
        // proportional victim deposit at the pool's own price: 1e8 sat needs 1e8 * 1e12 wei
        uint256 lp = pool.addLiquidity(1e8, 1e20, 0, type(uint256).max);
        assertGt(lp, 0);
        vm.roll(block.number + 1);
        pool.removeLiquidity(lp, 0, 0);
        vm.stopPrank();
        assertGe(btc.balanceOf(bob) + 1, a0, "victim keeps cirBTC");
        assertGe(weth.balanceOf(bob) + 1e12, w0, "victim keeps WETH (within 1 wei-per-share rounding)");
    }

    // ── F-01 (FIXED): magnified fee-correction ledger keeps claims <= fee reserve ──
    // The old scenario parked LP on DEAD to shrink the eligible supply to 2 wei. DEAD transfers are now blocked
    // (F-09), so the same rounding stress is rebuilt with realistic multi-holder transfers.

    function _sumPending() internal view returns (uint256 sa, uint256 sb) {
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            (uint256 a, uint256 b) = pool.pendingFees(us[i]);
            sa += a;
            sb += b;
        }
    }

    function test_Regression_F01_MultiHolderTransfersKeepClaimsSolvent() public {
        vm.prank(alice);
        pool.addLiquidity(1_000_000, 1e12, 0, type(uint256).max); // LP = 1e14
        vm.roll(block.number + 1); // F-07: alice may move her LP from the next block
        uint256 aliceLp = pool.balanceOf(alice);

        // spread LP over three real holders, leaving alice with a 2-wei sliver of the odd remainder
        vm.startPrank(alice);
        pool.transfer(bob, aliceLp / 3);
        pool.transfer(carol, aliceLp / 3 - 1);
        vm.stopPrank();

        vm.prank(bob);
        pool.swap(address(btc), address(weth), 400, 0, type(uint256).max); // fee = ceil(400*30/10000) = 2 sat
        vm.prank(alice);
        pool.transfer(bob, 1);
        vm.prank(carol);
        pool.swap(address(btc), address(weth), 400, 0, type(uint256).max); // fee = ceil(400*30/10000) = 2 sat
        vm.prank(bob);
        pool.transfer(carol, 12_345);
        vm.prank(bob);
        pool.swap(address(btc), address(weth), 400, 0, type(uint256).max); // fee = ceil(400*30/10000) = 2 sat

        assertEq(pool.feeReserveA(), 6);
        (uint256 sa,) = _sumPending();
        assertLe(sa, pool.feeReserveA(), "claims never exceed the fee reserve");

        // every holder with a claim can harvest, in any order, without underflowing the reserve
        address[3] memory us = [carol, alice, bob];
        uint256 paid;
        for (uint256 i; i < 3; i++) {
            (uint256 fa, uint256 fb) = pool.pendingFees(us[i]);
            if (fa == 0 && fb == 0) continue;
            uint256 before = btc.balanceOf(us[i]);
            vm.prank(us[i]);
            (uint256 gotA,) = pool.harvest();
            assertEq(gotA, fa);
            assertEq(btc.balanceOf(us[i]) - before, fa);
            paid += gotA;
        }
        assertLe(paid, 6);
        assertEq(pool.feeReserveA(), 6 - paid, "reserve debited by exactly what was paid");
        assertGe(btc.balanceOf(address(pool)), pool.reserveA() + pool.feeReserveA());
    }

    /// Fees earned stay with the earner when LP moves: the sender keeps accrued fees, the receiver starts at zero.
    function test_Regression_F01_TransferDoesNotMoveAccruedFees() public {
        _seed(20);
        vm.prank(bob);
        pool.swap(address(btc), address(weth), 1 * SAT, 0, type(uint256).max);
        (uint256 aBefore, uint256 bBefore) = pool.pendingFees(alice);
        assertGt(aBefore, 0);

        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(carol, lp / 2);
        (uint256 aAfter, uint256 bAfter) = pool.pendingFees(alice);
        assertEq(aAfter, aBefore, "sender keeps fees already earned");
        assertEq(bAfter, bBefore);
        (uint256 cA, uint256 cB) = pool.pendingFees(carol);
        assertEq(cA + cB, 0, "receiver does not inherit past fees");

        vm.prank(bob);
        pool.swap(address(btc), address(weth), 1 * SAT, 0, type(uint256).max);
        (uint256 cA2,) = pool.pendingFees(carol);
        (uint256 aA2,) = pool.pendingFees(alice);
        assertGt(cA2, 0, "receiver earns on new fees");
        assertGt(aA2, aBefore, "sender keeps earning on the retained half");
        assertLe(aA2 + cA2, pool.feeReserveA());
    }

    /// Harvest debits the claimed ledger: a second harvest has nothing, and fees are not re-claimable after a
    /// transfer round-trip.
    function test_Regression_F01_HarvestIsNotReclaimableAfterTransferRoundTrip() public {
        _seed(20);
        vm.prank(bob);
        pool.swap(address(btc), address(weth), 1 * SAT, 0, type(uint256).max);
        vm.prank(alice);
        (uint256 fa,) = pool.harvest();
        assertGt(fa, 0);
        uint256 reserveAfter = pool.feeReserveA();

        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(carol, lp);
        vm.prank(carol);
        pool.transfer(alice, lp);
        (uint256 pa, uint256 pb) = pool.pendingFees(alice);
        assertEq(pa + pb, 0, "no re-claim after harvest + transfer round trip");
        vm.prank(alice);
        vm.expectRevert();
        pool.harvest();
        assertEq(pool.feeReserveA(), reserveAfter);
    }

    struct Run {
        uint256 seedA;
        uint256 seedB;
        uint256 minBtcIn;
        uint256 spanBtcIn;
        uint256 minWethIn;
        uint256 spanWethIn;
    }

    function _feeSolvencyRun(uint256 seed, Run memory r) internal {
        vm.prank(alice);
        pool.addLiquidity(r.seedA, r.seedB, 0, type(uint256).max);
        vm.roll(block.number + 1); // F-07: alice may move her LP from the next block
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 24; i++) {
            seed = uint256(keccak256(abi.encode(seed, i)));
            uint256 op = seed % 4;
            if (op == 0) {
                address from = us[(seed >> 8) % 3];
                address to = us[(seed >> 16) % 3];
                uint256 bal = pool.balanceOf(from);
                if (bal == 0) continue;
                vm.prank(from);
                pool.transfer(to, ((seed >> 24) % bal) + 1);
            } else if (op == 1) {
                vm.prank(bob);
                try pool.swap(address(btc), address(weth), r.minBtcIn + (seed >> 32) % r.spanBtcIn, 0, type(uint256).max) {}
                catch {}
            } else if (op == 2) {
                vm.prank(carol);
                try pool.swap(address(weth), address(btc), r.minWethIn + (seed >> 32) % r.spanWethIn, 0, type(uint256).max) {}
                catch {}
            } else {
                address who = us[(seed >> 8) % 3];
                (uint256 fa, uint256 fb) = pool.pendingFees(who);
                if (fa == 0 && fb == 0) continue;
                uint256 a0 = btc.balanceOf(who);
                uint256 b0 = weth.balanceOf(who);
                vm.prank(who);
                pool.harvest(); // must never revert while a claim exists
                assertEq(btc.balanceOf(who) - a0, fa);
                assertEq(weth.balanceOf(who) - b0, fb);
            }
            (uint256 sa, uint256 sb) = _sumPending();
            assertLe(sa, pool.feeReserveA(), "cirBTC fee claims <= reserve");
            assertLe(sb, pool.feeReserveB(), "WETH fee claims <= reserve");
            assertGe(btc.balanceOf(address(pool)), pool.reserveA() + pool.feeReserveA());
            assertGe(weth.balanceOf(address(pool)), pool.reserveB() + pool.feeReserveB());
        }
        // everybody can drain their claim; the reserve never underflows
        for (uint256 i; i < 3; i++) {
            (uint256 fa, uint256 fb) = pool.pendingFees(us[i]);
            if (fa == 0 && fb == 0) continue;
            vm.prank(us[i]);
            pool.harvest();
            (uint256 pa, uint256 pb) = pool.pendingFees(us[i]);
            assertEq(pa + pb, 0);
        }
    }

    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_FeeSolvency_TransfersAndSwaps(uint256 seed) public {
        _feeSolvencyRun(seed, Run(1_000_000, 1e12, 400, 5000, 1e9, 1e13));
    }

    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_FeeSolvency_RealisticSizes(uint256 seed) public {
        _feeSolvencyRun(seed, Run(10 * SAT, 200 * ETH, 334, SAT, 1e12, 5 * ETH));
    }

    // ── F-02 (FIXED): subsequent deposits mint min(shares) and pull ceil(shares * reserve / total) of each token ──

    /// A-limited branch: shares come from cirBTC; the WETH leg is rounded UP (never below the exact amount).
    function test_Regression_F02_ALimited_PullsCeilOfProportion() public {
        _seed(100);
        uint256 w0 = weth.balanceOf(bob);
        vm.prank(bob);
        pool.addLiquidity(3, 1e30, 0, type(uint256).max);
        assertEq(w0 - weth.balanceOf(bob), 3 * 100 * ETH / SAT, "exactly proportional here (divisible)");

        // skew the ratio with a swap so reserves are no longer divisible, then deposit 7 sat
        vm.prank(carol);
        pool.swap(address(weth), address(btc), 3 * ETH, 0, type(uint256).max);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 total = pool.totalSupply();
        uint256 shares = (7 * total) / rA;
        uint256 expB = Math.ceilDiv(shares * rB, total);
        uint256 expA = Math.ceilDiv(shares * rA, total);
        uint256 w1 = weth.balanceOf(bob);
        uint256 a1 = btc.balanceOf(bob);
        vm.prank(bob);
        uint256 got = pool.addLiquidity(7, 1e30, 0, type(uint256).max);
        assertEq(got, shares);
        assertEq(w1 - weth.balanceOf(bob), expB, "pays ceil(shares*rB/total)");
        assertEq(a1 - btc.balanceOf(bob), expA, "pays ceil(shares*rA/total)");
        assertLe(expA, 7, "never more than the cirBTC offered");
        assertGe(expB * total, shares * rB, "WETH leg is never rounded below the exact amount");
    }

    /// B-limited branch: only ceil(shares*reserve/total) is pulled for the shares minted, never "all of amountBIn".
    function _bLimited(uint256 ethPerBtc, uint256 amtA, uint256 amtB) internal {
        _seed(ethPerBtc);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 total = pool.totalSupply();
        uint256 shares = Math.min((amtA * total) / rA, (amtB * total) / rB);
        uint256 expA = Math.ceilDiv(shares * rA, total);
        uint256 expB = Math.ceilDiv(shares * rB, total);
        uint256 w0 = weth.balanceOf(bob);
        uint256 a0 = btc.balanceOf(bob);
        vm.prank(bob);
        uint256 got = pool.addLiquidity(amtA, amtB, 0, type(uint256).max);
        assertEq(got, shares);
        assertEq(a0 - btc.balanceOf(bob), expA, "cirBTC pulled = ceil for shares minted");
        assertEq(w0 - weth.balanceOf(bob), expB, "WETH pulled = ceil for shares minted");
        assertLe(a0 - btc.balanceOf(bob), amtA);
        assertLe(w0 - weth.balanceOf(bob), amtB);
        assertEq(pool.reserveA(), rA + expA);
        assertEq(pool.reserveB(), rB + expB);
    }

    function test_Regression_F02_BLimited_NoOvercharge_1BtcEq1Eth() public {
        _bLimited(1, 2, 2e10 - 1);
        // the whole 2e10-1 wei is the exact price of the shares minted (A leg rounds up to 2 sat)
        assertEq(pool.reserveA(), SAT + 2);
        assertEq(pool.reserveB(), ETH + 2e10 - 1);
    }

    function test_Regression_F02_BLimited_NoOvercharge_1BtcEq100Eth() public {
        uint256 w0 = weth.balanceOf(bob);
        _bLimited(100, 2, 2e12 - 1);
        assertLt(w0 - weth.balanceOf(bob), 2e12 - 1, "less than the whole offered WETH is pulled now");
    }

    /// Round trip must never be profitable: per token, withdrawal <= deposit (ceil in, floor out).
    function testFuzz_F02_DepositWithdrawNoProfit(uint8 ratioSel, uint96 a, uint96 b, bool skew) public {
        uint256 ethPerBtc = ratioSel % 3 == 0 ? 1 : (ratioSel % 3 == 1 ? 20 : 100);
        _seed(ethPerBtc);
        if (skew) {
            vm.prank(carol);
            pool.swap(address(btc), address(weth), 12_345_678, 0, type(uint256).max);
        }
        a = uint96(bound(a, 1, 1e12));
        b = uint96(bound(b, 1, 1e32));
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 a0 = btc.balanceOf(bob);
        uint256 w0 = weth.balanceOf(bob);
        vm.startPrank(bob);
        try pool.addLiquidity(a, b, 0, type(uint256).max) returns (uint256 lp) {
            vm.roll(block.number + 1);
            pool.removeLiquidity(lp, 0, 0);
        } catch {
            vm.stopPrank();
            return;
        }
        vm.stopPrank();
        int256 dA = int256(btc.balanceOf(bob)) - int256(a0);
        int256 dB = int256(weth.balanceOf(bob)) - int256(w0);
        assertLe(dA, 0, "no cirBTC profit");
        assertLe(dB, 0, "no WETH profit");
        int256 valueChange = dB + (dA * int256(rB)) / int256(rA);
        assertLe(valueChange, 1, "no profit beyond 1 wei of value");
    }

    // ── F-03 / F-04 (FIXED) ───────────────────────────────────────────────────

    /// The no-deadline overloads are gone: the old selectors hit no function (no fallback) and revert.
    function test_Regression_F03_NoDeadlineOverloadsRemoved() public {
        _seed(20);
        vm.warp(block.timestamp + 365 days);
        vm.prank(bob);
        (bool ok,) = address(pool).call(
            abi.encodeWithSignature("swap(address,address,uint256,uint256)", address(btc), address(weth), 1e6, 0)
        );
        assertFalse(ok, "4-arg swap selector removed");
        vm.prank(bob);
        (ok,) = address(pool).call(abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256)", 1e6, 1e30, 0));
        assertFalse(ok, "3-arg addLiquidity selector removed");
        // the explicit-deadline versions still honour an expired deadline
        vm.startPrank(bob);
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.DeadlineExpired.selector);
        pool.swap(address(btc), address(weth), 1e6, 0, block.timestamp - 1);
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.DeadlineExpired.selector);
        pool.addLiquidity(1e6, 1e30, 0, block.timestamp - 1);
        vm.stopPrank();
    }

    function test_Regression_F04_RenounceDisabled_PoolCannotBeBricked() public {
        pool.pause();
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.RenounceDisabled.selector);
        pool.renounceOwnership();
        assertEq(pool.owner(), address(this));
        pool.unpause(); // still works: ownership was not lost
        assertFalse(pool.paused());
    }

    // ── F-05 (FIXED): fee = ceilDiv(amountIn * 30, 10000) ─────────────────────

    function test_Regression_F05_FeeRoundsUp_666Sat() public {
        _seed(20);
        vm.prank(bob);
        pool.swap(address(btc), address(weth), 666, 0, type(uint256).max);
        assertEq(pool.feeReserveA(), 2, "ceil(666*30/10000) = 2 (0.30%), no longer 1 (0.15%)");
    }

    function test_Regression_F05_SmallInputsNowPayFeeAndOneUnitReverts() public {
        _seed(20);
        vm.startPrank(bob);
        // the DustSwapNotAllowed guard is gone: 333 pays a 1-unit fee and succeeds
        pool.swap(address(btc), address(weth), 333, 0, type(uint256).max);
        assertEq(pool.feeReserveA(), 1);
        pool.swap(address(btc), address(weth), 334, 0, type(uint256).max);
        assertEq(pool.feeReserveA(), 3, "334 pays ceil(10020/10000) = 2 on top of the earlier 1");
        // a 1-unit input pays a 1-unit fee, nets 0 and yields no output: ZeroAmount on both legs
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.ZeroAmount.selector);
        pool.swap(address(btc), address(weth), 1, 0, type(uint256).max);
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.ZeroAmount.selector);
        pool.swap(address(weth), address(btc), 1, 0, type(uint256).max);
        // WETH leg: output must be at least 1 sat, so the effective minimum is about 1e11..1e12 wei
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.ZeroAmount.selector);
        pool.swap(address(weth), address(btc), 334, 0, type(uint256).max);
        vm.stopPrank();
    }

    // ── F-06 (FIXED): last real LP sweeps all reserves; the emptied pool restarts cleanly ──

    uint256 internal aliceA;
    uint256 internal aliceB;
    bytes4 internal NO_LP = ConstantProductPoolCirBtcWethV4.NoLiquidityProviders.selector;

    function _ratio(uint256 sel) internal pure returns (uint256) {
        return sel == 0 ? 1 : (sel == 1 ? 20 : 100);
    }

    function _assertEmptied() internal view {
        assertEq(pool.totalSupply(), 1000, "only the dead shares remain");
        assertEq(pool.balanceOf(DEAD), 1000);
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
    }

    function _fullExitSweeps(uint256 ethPerBtc) internal {
        uint256 lp = _seed(ethPerBtc);
        uint256 a0 = btc.balanceOf(alice);
        uint256 w0 = weth.balanceOf(alice);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0);
        assertEq(outA, SAT, "all cirBTC returned");
        assertEq(outB, ethPerBtc * ETH, "all WETH returned");
        assertEq(btc.balanceOf(alice) - a0, SAT);
        assertEq(weth.balanceOf(alice) - w0, ethPerBtc * ETH);
        _assertEmptied();
        assertEq(btc.balanceOf(address(pool)), 0, "no residual stranded in the pool");
        assertEq(weth.balanceOf(address(pool)), 0);

        // no liquidity provider => swaps disabled in both directions
        vm.startPrank(carol);
        vm.expectRevert(NO_LP);
        pool.swap(address(weth), address(btc), 1e12, 0, type(uint256).max);
        vm.expectRevert(NO_LP);
        pool.swap(address(btc), address(weth), 1e6, 0, type(uint256).max);
        vm.stopPrank();
    }

    function test_Regression_F06_FullExitSweepsReserves_1BtcEq1Eth() public {
        _fullExitSweeps(1);
    }

    function test_Regression_F06_FullExitSweepsReserves_1BtcEq20Eth() public {
        _fullExitSweeps(20);
    }

    function test_Regression_F06_FullExitSweepsReserves_1BtcEq100Eth() public {
        _fullExitSweeps(100);
    }

    /// After trading the price moved off the deposit ratio: the last LP still receives exactly the live reserves,
    /// and the pool balance left over is exactly the isolated fee reserve.
    function testFuzz_Regression_F06_FullExitAfterTrading_SweepsLiveReserves(uint8 sel, uint96 x, bool dir) public {
        uint256 ethPerBtc = _ratio(sel % 3);
        uint256 lp = _seed(ethPerBtc);
        vm.startPrank(bob);
        if (dir) {
            pool.swap(address(btc), address(weth), bound(x, 334, SAT), 0, type(uint256).max);
        } else {
            pool.swap(address(weth), address(btc), bound(x, ethPerBtc * 2e10, ethPerBtc * ETH / 2), 0, type(uint256).max);
        }
        vm.stopPrank();
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0);
        assertEq(outA, rA);
        assertEq(outB, rB);
        _assertEmptied();
        assertEq(btc.balanceOf(address(pool)), pool.feeReserveA());
        assertEq(weth.balanceOf(address(pool)), pool.feeReserveB());
    }

    /// A non-last LP gets the proportional share (dead shares included in the denominator); the remaining LP is then
    /// the last real LP and sweeps the rest.
    function test_Regression_F06_OnlyLastLpSweeps() public {
        uint256 lpA = _seed(20);
        vm.prank(bob);
        uint256 lpB = pool.addLiquidity(10 * SAT, 200 * ETH, 0, type(uint256).max);
        vm.roll(block.number + 1);
        uint256 total = pool.totalSupply();
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lpA, 0, 0);
        assertEq(outA, (rA * lpA) / total, "proportional, not a sweep");
        assertEq(outB, (rB * lpA) / total);
        assertGt(pool.reserveA(), 0);
        vm.prank(bob);
        (uint256 bA, uint256 bB) = pool.removeLiquidity(lpB, 0, 0);
        assertEq(bA, rA - outA, "last LP takes everything that is left");
        assertEq(bB, rB - outB);
        _assertEmptied();
    }

    /// Restart at a FRESH price: no residual ratio is forced on the new depositor, full geometric-mean share,
    /// no second dead mint.
    function _restartAtFreshPrice(uint256 oldRatio, uint256 newRatio) internal {
        _fullExitSweeps(oldRatio);
        uint256 a = 3 * SAT;
        uint256 b = 3 * newRatio * ETH;
        uint256 w0 = weth.balanceOf(bob);
        uint256 a0 = btc.balanceOf(bob);
        vm.prank(bob);
        uint256 shares = pool.addLiquidity(a, b, 0, type(uint256).max);
        assertEq(shares, _sqrtU(a * b) * 1e5, "restart share = sqrt(a*b)*1e5 (no 1000 haircut)");
        assertEq(a0 - btc.balanceOf(bob), a, "pays exactly the offered cirBTC");
        assertEq(w0 - weth.balanceOf(bob), b, "pays exactly the offered WETH");
        assertEq(pool.reserveA(), a);
        assertEq(pool.reserveB(), b);
        assertEq(pool.reserveB() / pool.reserveA(), newRatio * 1e10, "ratio is the new price exactly (wei per sat)");
        assertEq(pool.totalSupply(), 1000 + shares, "no extra dead mint");
        assertEq(pool.balanceOf(DEAD), 1000);
        assertEq(pool.balanceOf(bob), shares);
        vm.roll(block.number + 1); // F-07: bob's restart shares unlock in the next block

        // swaps are live again at the new price
        vm.prank(carol);
        uint256 out = pool.swap(address(btc), address(weth), 1e6, 0, type(uint256).max);
        assertGt(out, 0);

        // the restart depositor can leave and gets the deposit back (plus the swap's net effect on reserves)
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        vm.prank(bob);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(shares, 0, 0);
        assertEq(outA, rA);
        assertEq(outB, rB);
        _assertEmptied();
    }

    function _sqrtU(uint256 y) internal pure returns (uint256) {
        return Math.sqrt(y);
    }

    function test_Regression_F06_Restart_1To20() public {
        _restartAtFreshPrice(1, 20);
    }

    function test_Regression_F06_Restart_20To100() public {
        _restartAtFreshPrice(20, 100);
    }

    function test_Regression_F06_Restart_100To1() public {
        _restartAtFreshPrice(100, 1);
    }

    function test_Regression_F06_Restart_SamePrice20() public {
        _restartAtFreshPrice(20, 20);
    }

    /// Without any trading the restart depositor leaves with exactly what they put in, at every ratio.
    function testFuzz_Regression_F06_RestartRoundTripExact(uint8 oldSel, uint8 newSel, uint96 a, uint96 mult) public {
        _fullExitSweeps(_ratio(oldSel % 3));
        uint256 nr = _ratio(newSel % 3);
        uint256 amtA = bound(a, 1e6, 1e12);
        uint256 amtB = bound(mult, 1e6, 1e12) * nr * 1e10;
        uint256 a0 = btc.balanceOf(bob);
        uint256 w0 = weth.balanceOf(bob);
        vm.prank(bob);
        uint256 shares = pool.addLiquidity(amtA, amtB, 0, type(uint256).max);
        assertEq(shares, Math.sqrt(amtA * amtB) * 1e5);
        assertEq(pool.totalSupply(), 1000 + shares);
        vm.roll(block.number + 1);
        vm.prank(bob);
        pool.removeLiquidity(shares, 0, 0);
        assertEq(btc.balanceOf(bob), a0, "principal fully returned");
        assertEq(weth.balanceOf(bob), w0);
        _assertEmptied();
    }

    /// Restart still obeys the dust threshold; a rejected restart leaves the pool untouched.
    function test_Regression_F06_RestartBelowThresholdReverts() public {
        _fullExitSweeps(20);
        vm.prank(bob);
        vm.expectRevert(ConstantProductPoolCirBtcWethV4.ZeroAmount.selector);
        pool.addLiquidity(1, 1e11, 0, type(uint256).max); // sqrt(1e11) < 1e6
        _assertEmptied();
    }

    /// Fees earned before the exit stay harvestable by the exited LP and are not inherited by the restart LP.
    function test_Regression_F06_PendingFeesSurviveExitAndAreNotInherited() public {
        uint256 lp = _seed(20);
        vm.startPrank(bob);
        pool.swap(address(btc), address(weth), SAT / 10, 0, type(uint256).max);
        pool.swap(address(weth), address(btc), 2 * ETH, 0, type(uint256).max);
        vm.stopPrank();
        (aliceA, aliceB) = pool.pendingFees(alice);
        assertGt(aliceA, 0);
        assertGt(aliceB, 0);

        vm.prank(alice);
        pool.removeLiquidity(lp, 0, 0);
        _assertEmptied();
        (uint256 exitA, uint256 exitB) = pool.pendingFees(alice);
        assertEq(exitA, aliceA, "exit does not forfeit accrued cirBTC fees");
        assertEq(exitB, aliceB, "exit does not forfeit accrued WETH fees");
        assertGe(pool.feeReserveA(), exitA, "fee reserve still funds alice");
        assertLe(pool.feeReserveA(), exitA + 10, "...and holds only floor-rounding dust beyond her claim");

        // restart at a fresh price; the new LP starts with zero claim on the old fee pot
        vm.prank(bob);
        uint256 bLp = pool.addLiquidity(2 * SAT, 100 * 2 * ETH, 0, type(uint256).max);
        vm.roll(block.number + 1);
        (uint256 bA, uint256 bB) = pool.pendingFees(bob);
        assertEq(bA + bB, 0, "restart LP inherits nothing");
        (uint256 aA, uint256 aB) = pool.pendingFees(alice);
        assertEq(aA, aliceA);
        assertEq(aB, aliceB);

        // new fees accrue to the restart LP only; alice's entitlement is unchanged
        vm.prank(carol);
        pool.swap(address(btc), address(weth), 1e6, 0, type(uint256).max); // fee 3000 sat
        (uint256 bA2,) = pool.pendingFees(bob);
        assertGe(bA2 + 20, 3000);
        assertLe(bA2, 3000 + 20, "only the new swap's fee (plus sub-wei remainder dust)");
        (uint256 aA2, uint256 aB2) = pool.pendingFees(alice);
        assertEq(aA2, aliceA);
        assertEq(aB2, aliceB);
        (uint256 sa, uint256 sb) = _sumPending();
        assertLe(sa, pool.feeReserveA());
        assertLe(sb, pool.feeReserveB());

        // both can harvest in either order
        vm.prank(alice);
        (uint256 gotA, uint256 gotB) = pool.harvest();
        assertEq(gotA, aliceA);
        assertEq(gotB, aliceB);
        vm.prank(bob);
        pool.harvest();
        // and the restart LP can still exit fully
        vm.prank(bob);
        pool.removeLiquidity(bLp, 0, 0);
        _assertEmptied();
    }



    // ── F-07 (FIXED): atomic JIT add -> harvest/remove in one block is impossible ──

    function test_Regression_F07_JitLiquiditySameBlockHarvestAndRemoveRevert() public {
        _seed(20);
        bytes4 locked = ConstantProductPoolCirBtcWethV4.LiquidityLockedThisBlock.selector;
        vm.prank(carol);
        uint256 lpAtk = pool.addLiquidity(10 * SAT, 200 * ETH, 0, type(uint256).max);
        vm.prank(bob);
        pool.swap(address(btc), address(weth), 5 * SAT, 0, type(uint256).max);
        vm.startPrank(carol);
        vm.expectRevert(locked);
        pool.harvest();
        vm.expectRevert(locked);
        pool.removeLiquidity(lpAtk, 0, 0);
        vm.stopPrank();
        assertEq(pool.balanceOf(carol), lpAtk, "nothing moved");

        // a later block releases the lock (the position still carries real price exposure meanwhile)
        vm.roll(block.number + 1);
        vm.startPrank(carol);
        (uint256 feeA,) = pool.harvest();
        assertGt(feeA, 0, "fee share earned while exposed is claimable after the lock");
        pool.removeLiquidity(lpAtk, 0, 0);
        vm.stopPrank();
    }

    // ── F-09 (FIXED): dead shares never claim fees; LP can never be sent to DEAD ──

    function test_Regression_F09_DeadPendingFeesAreZero() public {
        _seed(20);
        vm.prank(bob);
        pool.swap(address(btc), address(weth), 1 * SAT, 0, type(uint256).max);
        vm.prank(bob);
        pool.swap(address(weth), address(btc), 5 * ETH, 0, type(uint256).max);
        (uint256 deadA, uint256 deadB) = pool.pendingFees(DEAD);
        assertEq(deadA, 0, "no phantom cirBTC fees for dead shares");
        assertEq(deadB, 0, "no phantom WETH fees for dead shares");
        assertEq(pool.balanceOf(DEAD), 1000);
        // the single real LP is owed (almost) the whole fee reserve, so none is parked on DEAD
        (uint256 aA, uint256 aB) = pool.pendingFees(alice);
        assertLe(aA, pool.feeReserveA());
        assertLe(aB, pool.feeReserveB());
        assertGe(aA + 10, pool.feeReserveA()); // gap = sub-share rounding only (< supply / 1e18 wei)
        assertGe(aB + 10, pool.feeReserveB());
        // DEAD has nothing to harvest
        vm.prank(DEAD);
        vm.expectRevert();
        pool.harvest();
    }

    function test_Regression_F09_TransferToDeadReverts() public {
        _seed(20);
        uint256 lp = pool.balanceOf(alice);
        bytes4 sel = ConstantProductPoolCirBtcWethV4.DeadAddressTransferBlocked.selector;
        vm.startPrank(alice);
        vm.expectRevert(sel);
        pool.transfer(DEAD, 1);
        vm.expectRevert(sel);
        pool.transfer(DEAD, lp);
        vm.expectRevert(sel);
        pool.transfer(DEAD, lp - 2);
        vm.expectRevert(sel);
        pool.transfer(DEAD, 0);
        vm.stopPrank();
        assertEq(pool.balanceOf(DEAD), 1000);
        assertEq(pool.balanceOf(alice), lp);
    }

    function test_Regression_F09_TransferFromToDeadReverts() public {
        _seed(20);
        uint256 lp = pool.balanceOf(alice);
        bytes4 sel = ConstantProductPoolCirBtcWethV4.DeadAddressTransferBlocked.selector;
        vm.prank(alice);
        pool.approve(bob, type(uint256).max);
        vm.startPrank(bob);
        vm.expectRevert(sel);
        pool.transferFrom(alice, DEAD, 1);
        vm.expectRevert(sel);
        pool.transferFrom(alice, DEAD, lp - 2);
        vm.expectRevert(sel);
        pool.transferFrom(alice, DEAD, lp);
        vm.stopPrank();
        assertEq(pool.balanceOf(DEAD), 1000);
        assertEq(pool.balanceOf(alice), lp);
    }

    /// Transfers to every other address (including address(pool) and arbitrary EOAs) still work.
    function test_Regression_F09_OtherTransfersStillWork() public {
        _seed(20);
        uint256 lp = pool.balanceOf(alice);
        vm.prank(alice);
        pool.transfer(bob, lp / 4);
        vm.prank(alice);
        pool.approve(carol, lp / 4);
        vm.prank(carol);
        pool.transferFrom(alice, carol, lp / 4);
        assertEq(pool.balanceOf(bob), lp / 4);
        assertEq(pool.balanceOf(carol), lp / 4);
        // initial mint to DEAD is exactly the minimum liquidity and DEAD stays at it
        assertEq(pool.balanceOf(DEAD), pool.MINIMUM_LIQUIDITY());
    }

    function testFuzz_Regression_F09_TransferToDeadAlwaysReverts(uint256 amt, bool viaTransferFrom, uint8 sel) public {
        _seed(_ratio(sel % 3));
        uint256 lp = pool.balanceOf(alice);
        amt = bound(amt, 0, lp);
        bytes4 err = ConstantProductPoolCirBtcWethV4.DeadAddressTransferBlocked.selector;
        if (viaTransferFrom) {
            vm.prank(alice);
            pool.approve(bob, amt);
            vm.prank(bob);
            vm.expectRevert(err);
            pool.transferFrom(alice, DEAD, amt);
        } else {
            vm.prank(alice);
            vm.expectRevert(err);
            pool.transfer(DEAD, amt);
        }
        assertEq(pool.balanceOf(DEAD), 1000);
        assertEq(pool.balanceOf(alice), lp);
        (uint256 da, uint256 db) = pool.pendingFees(DEAD);
        assertEq(da + db, 0);
    }

    /// Fuzz: whatever the swaps, DEAD never has a claim and fee claims stay solvent.
    function testFuzz_Regression_F09_DeadNeverAccrues(uint8 sel, uint96 x, bool dir) public {
        uint256 ethPerBtc = _ratio(sel % 3);
        _seed(ethPerBtc);
        vm.startPrank(bob);
        if (dir) {
            try pool.swap(address(btc), address(weth), bound(x, 334, SAT), 0, type(uint256).max) {} catch {}
        } else {
            try pool.swap(address(weth), address(btc), bound(x, ethPerBtc * 2e10, ethPerBtc * ETH / 2), 0, type(uint256).max) {}
            catch {}
        }
        vm.stopPrank();
        (uint256 da, uint256 db) = pool.pendingFees(DEAD);
        assertEq(da + db, 0);
        (uint256 aA, uint256 aB) = pool.pendingFees(alice);
        assertLe(aA, pool.feeReserveA());
        assertLe(aB, pool.feeReserveB());
    }

    // ── C: invariant growth ───────────────────────────────────────────────────

    function testFuzz_KNeverDecreases(uint8 ratioSel, uint96 amt, bool dir) public {
        uint256 ethPerBtc = ratioSel % 3 == 0 ? 1 : (ratioSel % 3 == 1 ? 20 : 100);
        _seed(ethPerBtc);
        uint256 k0 = pool.reserveA() * pool.reserveB();
        vm.startPrank(bob);
        if (dir) {
            uint256 amtIn = bound(amt, 334, 5 * SAT);
            try pool.swap(address(btc), address(weth), amtIn, 0, type(uint256).max) {} catch {
                vm.stopPrank();
                return;
            }
        } else {
            uint256 amtIn = bound(amt, 1e12, 5 * ethPerBtc * ETH);
            try pool.swap(address(weth), address(btc), amtIn, 0, type(uint256).max) {} catch {
                vm.stopPrank();
                return;
            }
        }
        vm.stopPrank();
        assertGe(pool.reserveA() * pool.reserveB(), k0, "k is weakly increasing");
    }

    /// F-10: the cap is per swap (not cumulative), so two sequential near-cap swaps still drain over 66%.
    function test_Regression_F10_CapIsPerSwapNotCumulative() public {
        _seed(20);
        uint256 rB0 = pool.reserveB();
        vm.startPrank(bob);
        for (uint256 i; i < 2; i++) {
            uint256 rA = pool.reserveA();
            pool.swap(address(btc), address(weth), rA * 995 / 1000, 0, type(uint256).max);
        }
        vm.stopPrank();
        assertLt(pool.reserveB(), rB0 / 3, "over 66% of WETH drained in two swaps (cap is per swap)");
    }

    /// F-10: the cap now reverts with the dedicated OutputCapExceeded(amountOut, reserveOut / 2).
    function test_Regression_F10_CapRevertsWithDedicatedError() public {
        _seed(20);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 amountIn = 20 * SAT; // 20 cirBTC into a 1 cirBTC reserve => output ~ 95% of reserveB
        uint256 net = amountIn - Math.ceilDiv(amountIn * 30, 10000);
        uint256 out = (rB * net) / (rA + net);
        vm.prank(bob);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolCirBtcWethV4.OutputCapExceeded.selector, out, rB / 2));
        pool.swap(address(btc), address(weth), amountIn, 0, type(uint256).max);
    }
}
