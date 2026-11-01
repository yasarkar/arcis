// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Bounded multi-actor handler. Every pool call is wrapped in try/catch; unexpected revert reasons and
///      property breaches are recorded in flags that the invariant functions assert on.
contract EurcCirBtcPoolHandler is Test {
    ConstantProductPoolEurcCirBtcV4 public pool;
    MockERC20 public eurc;
    MockERC20 public btc;
    address[3] public actors;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    bool public kViolated; // k decreased across a successful swap
    bool public restartViolated; // full exit / restart behaved incorrectly
    bool public unexpectedRevert; // a call reverted with a reason outside the documented set
    bool public deadTransferSucceeded; // an LP transfer / transferFrom to DEAD did not revert DeadAddressTransferBlocked

    uint256 public swapsOk;
    uint256 public harvestsOk;
    uint256 public removesOk;
    uint256 public addsOk;
    uint256 public restarts;
    uint256 public lockReverts;
    uint256 public deadAttempts;

    constructor(ConstantProductPoolEurcCirBtcV4 p, MockERC20 a, MockERC20 b, address[3] memory acts) {
        pool = p;
        eurc = a;
        btc = b;
        actors = acts;
    }

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % 3];
    }

    function _sel(bytes memory r) internal pure returns (bytes4 s) {
        if (r.length >= 4) {
            assembly {
                s := mload(add(r, 32))
            }
        }
    }

    function _lock() internal pure returns (bytes4) {
        return ConstantProductPoolEurcCirBtcV4.LiquidityLockedThisBlock.selector;
    }

    function addLiquidity(uint256 actorSeed, uint256 a, uint256 b) external {
        address u = _actor(actorSeed);
        a = bound(a, 1e3, 1e12);
        b = bound(b, 1e3, 1e10);
        vm.prank(u);
        try pool.addLiquidity(a, b, 0, type(uint256).max) {
            addsOk++;
        } catch {}
    }

    function removeLiquidity(uint256 actorSeed, uint256 amtSeed, uint256 toSeed) external {
        address u = _actor(actorSeed);
        uint256 bal = pool.balanceOf(u);
        if (bal == 0) return;
        uint256 amt = bound(amtSeed, 1, bal);
        address to = _actor(toSeed);
        vm.prank(u);
        try pool.removeLiquidity(amt, 0, 0, to) {
            removesOk++;
        } catch (bytes memory r) {
            if (_sel(r) == _lock()) lockReverts++;
            else unexpectedRevert = true;
        }
    }

    function transferLp(uint256 actorSeed, uint256 toSeed, uint256 amtSeed) external {
        address u = _actor(actorSeed);
        uint256 bal = pool.balanceOf(u);
        if (bal == 0) return;
        address to = actors[toSeed % 3]; // DEAD is not a valid target any more: see tryTransferToDead
        uint256 amt = bound(amtSeed, 1, bal);
        vm.prank(u);
        try pool.transfer(to, amt) {} catch (bytes memory r) {
            if (_sel(r) == _lock()) lockReverts++;
            else unexpectedRevert = true;
        }
    }

    /// @dev Adversarial action: try to park LP on DEAD (shrinking eligible supply) via transfer or transferFrom.
    ///      Every attempt must revert DeadAddressTransferBlocked, whatever the lock state or amount.
    function tryTransferToDead(uint256 actorSeed, uint256 amtSeed, bool viaTransferFrom) external {
        address u = _actor(actorSeed);
        uint256 bal = pool.balanceOf(u);
        if (bal == 0) return;
        uint256 amt = bound(amtSeed, 0, bal);
        deadAttempts++;
        bool ok;
        bytes memory r;
        if (viaTransferFrom) {
            address spender = _actor(actorSeed % 3 + 1);
            vm.prank(u);
            pool.approve(spender, amt);
            vm.prank(spender);
            try pool.transferFrom(u, DEAD, amt) {
                ok = true;
            } catch (bytes memory reason) {
                r = reason;
            }
        } else {
            vm.prank(u);
            try pool.transfer(DEAD, amt) {
                ok = true;
            } catch (bytes memory reason) {
                r = reason;
            }
        }
        if (ok || _sel(r) != ConstantProductPoolEurcCirBtcV4.DeadAddressTransferBlocked.selector) {
            deadTransferSucceeded = true;
        }
    }

    function swap(uint256 actorSeed, bool aToB, uint256 amtSeed) external {
        address u = _actor(actorSeed);
        uint256 reserveIn = aToB ? pool.reserveA() : pool.reserveB();
        if (reserveIn == 0) return;
        uint256 amt = bound(amtSeed, 1, reserveIn);
        uint256 k0 = pool.reserveA() * pool.reserveB();
        address tin = aToB ? address(eurc) : address(btc);
        address tout = aToB ? address(btc) : address(eurc);
        vm.prank(u);
        try pool.swap(tin, tout, amt, 0, type(uint256).max) {
            swapsOk++;
            if (pool.reserveA() * pool.reserveB() < k0) kViolated = true;
        } catch (bytes memory r) {
            bytes4 s = _sel(r);
            if (
                s != ConstantProductPoolEurcCirBtcV4.ZeroAmount.selector
                    && s != ConstantProductPoolEurcCirBtcV4.SlippageExceeded.selector
                    && s != ConstantProductPoolEurcCirBtcV4.OutputCapExceeded.selector
                    && s != ConstantProductPoolEurcCirBtcV4.NoLiquidityProviders.selector
            ) unexpectedRevert = true;
        }
    }

    function harvest(uint256 actorSeed, uint256 toSeed, bool useTo) external {
        address u = _actor(actorSeed);
        vm.prank(u);
        if (useTo) {
            try pool.harvest(_actor(toSeed)) {
                harvestsOk++;
            } catch (bytes memory r) {
                _checkHarvestRevert(r);
            }
        } else {
            try pool.harvest() {
                harvestsOk++;
            } catch (bytes memory r) {
                _checkHarvestRevert(r);
            }
        }
    }

    function _checkHarvestRevert(bytes memory r) internal {
        bytes4 s = _sel(r);
        if (s == _lock()) lockReverts++;
        else if (s != LpFeeAccounting.NoFeesAccrued.selector) unexpectedRevert = true;
    }

    function roll(uint256 n) external {
        vm.roll(block.number + bound(n, 1, 5));
    }

    /// @dev Moves every other actor's LP to one actor (after releasing all locks) so full exits become reachable.
    function consolidate(uint256 actorSeed) external {
        vm.roll(block.number + 1);
        address target = _actor(actorSeed);
        for (uint256 i; i < 3; i++) {
            address from = actors[i];
            uint256 bal = pool.balanceOf(from);
            if (from == target || bal == 0) continue;
            vm.prank(from);
            try pool.transfer(target, bal) {} catch {
                unexpectedRevert = true;
            }
        }
    }

    /// @dev If one actor holds the entire eligible supply: full exit (sweep), verify the emptied state, verify
    ///      swaps are blocked, then restart the pool with a fresh deposit and verify exact accounting.
    function exitAndRestart(uint256 a, uint256 b, uint256 restarterSeed) external {
        vm.roll(block.number + 1); // release every lock
        uint256 dead = pool.balanceOf(DEAD);
        if (dead != pool.MINIMUM_LIQUIDITY()) restartViolated = true;
        uint256 eligible = pool.totalSupply() - dead;
        if (eligible == 0) return;
        address last;
        for (uint256 i; i < 3; i++) {
            if (pool.balanceOf(actors[i]) == eligible) last = actors[i];
        }
        if (last == address(0)) return;

        vm.prank(last);
        try pool.removeLiquidity(eligible, 0, 0) {} catch {
            unexpectedRevert = true;
            return;
        }
        if (pool.reserveA() != 0 || pool.reserveB() != 0 || pool.totalSupply() != dead) restartViolated = true;
        if (
            eurc.balanceOf(address(pool)) != pool.feeReserveA() || btc.balanceOf(address(pool)) != pool.feeReserveB()
        ) restartViolated = true;

        vm.prank(last);
        try pool.swap(address(eurc), address(btc), 1000e6, 0, type(uint256).max) {
            restartViolated = true;
        } catch (bytes memory r) {
            if (_sel(r) != ConstantProductPoolEurcCirBtcV4.NoLiquidityProviders.selector) restartViolated = true;
        }

        a = bound(a, 1e6, 1e12);
        b = bound(b, 1e4, 1e10);
        address r2 = _actor(restarterSeed);
        vm.prank(r2);
        try pool.addLiquidity(a, b, 0, type(uint256).max) returns (uint256 shares) {
            if (shares != Math.sqrt(a * b) * 1e11) restartViolated = true;
            if (pool.reserveA() != a || pool.reserveB() != b) restartViolated = true;
            if (pool.totalSupply() != dead + shares || pool.balanceOf(DEAD) != dead) restartViolated = true;
            restarts++;
            _verifyRestartDepositorIsBacked(r2, shares, a, b);
        } catch {
            restartViolated = true;
        }
    }

    /// @dev Solvency of the restart: the restart depositor is the only eligible LP, so exiting returns exactly the
    ///      deposit (the dead shares can never dilute it). Then re-deposits so the pool is live again.
    function _verifyRestartDepositorIsBacked(address r2, uint256 shares, uint256 a, uint256 b) internal {
        vm.roll(block.number + 1);
        if (pool.balanceOf(r2) != shares) {
            restartViolated = true;
            return;
        }
        vm.prank(r2);
        try pool.removeLiquidity(shares, 0, 0) returns (uint256 outA, uint256 outB) {
            if (outA != a || outB != b) restartViolated = true;
        } catch {
            restartViolated = true;
            return;
        }
        if (pool.balanceOf(DEAD) != pool.MINIMUM_LIQUIDITY()) restartViolated = true;
        vm.prank(r2);
        try pool.addLiquidity(a, b, 0, type(uint256).max) {} catch {
            restartViolated = true;
        }
    }
}

contract EurcCirBtcPoolInvariantTest is StdInvariant, Test {
    ConstantProductPoolEurcCirBtcV4 internal pool;
    MockERC20 internal eurc;
    MockERC20 internal btc;
    EurcCirBtcPoolHandler internal handler;
    address[3] internal actors;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function setUp() public {
        eurc = new MockERC20("EURC", "EURC", 6);
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        pool = new ConstantProductPoolEurcCirBtcV4(address(eurc), address(btc), 25, address(this));
        actors = [makeAddr("alice"), makeAddr("bob"), makeAddr("carol")];
        for (uint256 i; i < 3; i++) {
            eurc.mint(actors[i], 1e30);
            btc.mint(actors[i], 1e30);
            vm.startPrank(actors[i]);
            eurc.approve(address(pool), type(uint256).max);
            btc.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
        vm.prank(actors[0]);
        pool.addLiquidity(600_000e6, 10e8, 0, type(uint256).max);
        vm.roll(block.number + 1);

        handler = new EurcCirBtcPoolHandler(pool, eurc, btc, actors);
        targetContract(address(handler));
        bytes4[] memory sels = new bytes4[](10);
        sels[0] = EurcCirBtcPoolHandler.addLiquidity.selector;
        sels[1] = EurcCirBtcPoolHandler.removeLiquidity.selector;
        sels[2] = EurcCirBtcPoolHandler.transferLp.selector;
        sels[3] = EurcCirBtcPoolHandler.swap.selector;
        sels[4] = EurcCirBtcPoolHandler.harvest.selector;
        sels[5] = EurcCirBtcPoolHandler.roll.selector;
        sels[6] = EurcCirBtcPoolHandler.exitAndRestart.selector;
        sels[7] = EurcCirBtcPoolHandler.swap.selector; // weight swaps higher
        sels[8] = EurcCirBtcPoolHandler.consolidate.selector;
        sels[9] = EurcCirBtcPoolHandler.tryTransferToDead.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: sels}));
    }

    /// PROPERTY: sum of every holder's claimable fees never exceeds the isolated fee reserve (per token).
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_FeeClaimsNeverExceedFeeReserve() public view {
        uint256 sumA;
        uint256 sumB;
        for (uint256 i; i < 3; i++) {
            (uint256 fa, uint256 fb) = pool.pendingFees(actors[i]);
            sumA += fa;
            sumB += fb;
        }
        (uint256 da, uint256 db) = pool.pendingFees(DEAD);
        assertEq(da + db, 0, "DEAD never accrues");
        assertLe(sumA, pool.feeReserveA(), "sum pendingFees A <= feeReserveA");
        assertLe(sumB, pool.feeReserveB(), "sum pendingFees B <= feeReserveB");
    }

    /// PROPERTY: the pool always holds at least reserve + feeReserve of each token (no insolvency).
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_PoolBalanceCoversReservesAndFees() public view {
        assertGe(eurc.balanceOf(address(pool)), pool.reserveA() + pool.feeReserveA());
        assertGe(btc.balanceOf(address(pool)), pool.reserveB() + pool.feeReserveB());
    }

    /// PROPERTY: x*y never decreases across a successful swap.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_KNonDecreasingAcrossSwaps() public view {
        assertFalse(handler.kViolated());
    }

    /// PROPERTY: full exit sweeps to zero, swaps then revert NoLiquidityProviders, restart deposit is exact.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_RestartAfterFullExitWorks() public view {
        assertFalse(handler.restartViolated());
    }

    /// PROPERTY: no pool call reverts with a reason outside the documented set (e.g. no panics / underflows).
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_NoUnexpectedReverts() public view {
        assertFalse(handler.unexpectedRevert());
    }

    /// PROPERTY: LP supply is conserved across transfers / mints / burns among the known holders.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_LpSupplyEqualsSumOfBalances() public view {
        uint256 sum = pool.balanceOf(DEAD);
        for (uint256 i; i < 3; i++) {
            sum += pool.balanceOf(actors[i]);
        }
        assertEq(pool.totalSupply(), sum);
    }

    /// PROPERTY: the dead balance is exactly MINIMUM_LIQUIDITY at all times (minted once, never added to).
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_DeadBalanceIsExactlyMinimumLiquidity() public view {
        assertEq(pool.balanceOf(DEAD), pool.MINIMUM_LIQUIDITY());
        assertEq(pool.balanceOf(DEAD), 1000);
        (uint256 da, uint256 db) = pool.pendingFees(DEAD);
        assertEq(da + db, 0);
    }

    /// PROPERTY: every transfer / transferFrom to DEAD reverts DeadAddressTransferBlocked.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_TransfersToDeadAlwaysRevert() public view {
        assertFalse(handler.deadTransferSucceeded());
    }

    /// PROPERTY: the eligible supply is always backed by reserves -- no eligible LP exists against empty reserves,
    ///           and an emptied pool holds nothing but the 1000 dead shares.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_EligibleSupplyIsBackedByReserves() public view {
        uint256 eligible = pool.totalSupply() - pool.balanceOf(DEAD);
        if (eligible > 0) {
            assertGt(pool.reserveA(), 0);
            assertGt(pool.reserveB(), 0);
        } else {
            assertEq(pool.reserveA(), 0);
            assertEq(pool.reserveB(), 0);
        }
    }

    /// PROPERTY: live reserves are either both zero (emptied pool) or both positive.
    /// forge-config: default.invariant.runs = 128
    /// forge-config: default.invariant.depth = 100
    function invariant_ReservesBothZeroOrBothPositive() public view {
        assertEq(pool.reserveA() == 0, pool.reserveB() == 0);
    }

    /// @dev Coverage telemetry (visible with -vv): shows the interesting paths are really exercised.
    function afterInvariant() public view {
        console2.log("swaps/harvests/removes", handler.swapsOk(), handler.harvestsOk(), handler.removesOk());
        console2.log("adds/restarts/lockReverts", handler.addsOk(), handler.restarts(), handler.lockReverts());
        console2.log("deadTransferAttempts", handler.deadAttempts());
    }

    // ── Deterministic sanity: the handler paths are actually reachable (guards against vacuous invariants) ──

    function test_Handler_FullExitAndRestartIsReachable() public {
        handler.swap(0, true, 1e10);
        handler.swap(1, false, 1e7);
        assertEq(handler.swapsOk(), 2);
        handler.exitAndRestart(5e11, 5e8, 1);
        assertEq(handler.restarts(), 1, "alice was the sole eligible LP, so exit + restart ran");
        assertFalse(handler.restartViolated());
        assertFalse(handler.unexpectedRevert());
        assertEq(pool.balanceOf(DEAD), 1000);
    }

    function test_Handler_LockAndHarvestPathsReachable() public {
        handler.addLiquidity(1, 6e10, 1e9);
        assertEq(handler.addsOk(), 1);
        handler.removeLiquidity(1, type(uint256).max, 1); // bob minted this block => locked
        assertEq(handler.lockReverts(), 1);
        handler.swap(0, true, 1e10);
        handler.harvest(0, 2, true);
        assertEq(handler.harvestsOk(), 1);
        assertFalse(handler.unexpectedRevert());
    }

    function test_Handler_DeadTransferAttemptsAreBlocked() public {
        // alice (unlocked after setUp roll) tries both routes; each must revert DeadAddressTransferBlocked
        handler.tryTransferToDead(0, type(uint256).max, false);
        handler.tryTransferToDead(0, type(uint256).max, true);
        handler.tryTransferToDead(0, 12345, false);
        assertEq(handler.deadAttempts(), 3);
        assertFalse(handler.deadTransferSucceeded());
        assertEq(pool.balanceOf(DEAD), 1000);
    }
}
