// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Bounded multi-actor handler for the cirBTC (8 dec) / WETH (18 dec) pool. Every pool call is wrapped in
///      try/catch; unexpected revert reasons and property breaches are recorded in flags that the invariant
///      functions assert on. Contains no test functions of its own.
contract CirBtcWethPoolHandler is Test {
    ConstantProductPoolCirBtcWethV4 public pool;
    MockERC20 public btc;
    MockERC20 public weth;
    address public poolOwner;
    address[3] public actors;
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    bool public kViolated; // k decreased across a successful swap
    bool public restartViolated; // full exit / restart behaved incorrectly
    bool public feeLedgerViolated; // exit / restart disturbed someone's accrued fees
    bool public unexpectedRevert; // a call reverted with a reason outside the documented set
    bool public lockViolated; // F-07: a locked account moved/exited/harvested, an unlocked one was blocked, or a recipient got locked
    bool public recipientViolated; // F-08: caller not debited / funds not delivered to the recipient
    bool public capViolated; // F-10: cap error malformed or an over-cap swap was accepted
    bool public feeViolated; // F-05: swap fee differs from ceilDiv(amountIn * 30, 10000)
    bool public deadTransferSucceeded; // an LP transfer / transferFrom to DEAD did not revert DeadAddressTransferBlocked

    uint256 public swapsOk;
    uint256 public harvestsOk;
    uint256 public removesOk;
    uint256 public addsOk;
    uint256 public restarts;
    uint256 public deadAttempts;
    uint256 public pausedActions;

    constructor(
        ConstantProductPoolCirBtcWethV4 p,
        MockERC20 a,
        MockERC20 b,
        address[3] memory acts,
        address owner_
    ) {
        pool = p;
        btc = a;
        weth = b;
        actors = acts;
        poolOwner = owner_;
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

    function _isLocked(address u) internal view returns (bool) {
        return block.number <= pool.lastLiquidityBlock(u);
    }

    function addLiquidity(uint256 actorSeed, uint256 a, uint256 b) external {
        address u = _actor(actorSeed);
        a = bound(a, 1e5, 1e11);
        b = bound(b, 1e14, 1e22);
        vm.prank(u);
        try pool.addLiquidity(a, b, 0, type(uint256).max) {
            addsOk++;
            if (pool.lastLiquidityBlock(u) != block.number) lockViolated = true; // minter is locked this block
        } catch (bytes memory r) {
            bytes4 s = _sel(r);
            // off-ratio deposits can legitimately be rejected (F-02: caps on either token / zero shares); a pause
            // reverts deposits
            if (
                s != ConstantProductPoolCirBtcWethV4.ExcessiveTokenARequired.selector
                    && s != ConstantProductPoolCirBtcWethV4.ExcessiveTokenBRequired.selector
                    && s != ConstantProductPoolCirBtcWethV4.SlippageExceeded.selector
                    && s != Pausable.EnforcedPause.selector
            ) unexpectedRevert = true;
        }
    }

    function removeLiquidity(uint256 actorSeed, uint256 amtSeed) external {
        _remove(actorSeed, amtSeed, address(0));
    }

    /// @dev F-08 overload: caller is debited, funds go to `to` (any actor, possibly the caller).
    function removeLiquidityTo(uint256 actorSeed, uint256 amtSeed, uint256 toSeed) external {
        _remove(actorSeed, amtSeed, _actor(toSeed));
    }

    /// @dev Exits must never fail for a holder asking for <= balance (even when paused) UNLESS the holder is
    ///      locked by an addLiquidity in this very block, in which case they MUST revert LiquidityLockedThisBlock.
    function _remove(uint256 actorSeed, uint256 amtSeed, address to) internal {
        address u = _actor(actorSeed);
        uint256 bal = pool.balanceOf(u);
        if (bal == 0) return;
        uint256 amt = bound(amtSeed, 1, bal);
        bool locked = _isLocked(u);
        address rcpt = to == address(0) ? u : to;
        uint256 a0 = btc.balanceOf(rcpt);
        uint256 b0 = weth.balanceOf(rcpt);
        bytes memory data = to == address(0)
            ? abi.encodeWithSignature("removeLiquidity(uint256,uint256,uint256)", amt, 0, 0)
            : abi.encodeWithSignature("removeLiquidity(uint256,uint256,uint256,address)", amt, 0, 0, to);
        vm.prank(u);
        (bool ok, bytes memory ret) = address(pool).call(data);
        if (ok) {
            removesOk++;
            if (locked) lockViolated = true;
            (uint256 oa, uint256 ob) = abi.decode(ret, (uint256, uint256));
            if (btc.balanceOf(rcpt) - a0 != oa || weth.balanceOf(rcpt) - b0 != ob) recipientViolated = true;
            if (pool.balanceOf(u) != bal - amt) recipientViolated = true; // caller is debited
        } else if (locked) {
            if (_sel(ret) != ConstantProductPoolCirBtcWethV4.LiquidityLockedThisBlock.selector) lockViolated = true;
        } else {
            unexpectedRevert = true;
        }
    }

    function transferLp(uint256 actorSeed, uint256 toSeed, uint256 amtSeed) external {
        address u = _actor(actorSeed);
        uint256 bal = pool.balanceOf(u);
        if (bal == 0) return;
        address to = actors[toSeed % 3]; // DEAD is not a valid target: see tryTransferToDead
        uint256 amt = bound(amtSeed, 1, bal);
        bool locked = _isLocked(u);
        uint256 toLockBefore = pool.lastLiquidityBlock(to);
        vm.prank(u);
        try pool.transfer(to, amt) {
            if (locked) lockViolated = true;
        } catch (bytes memory r) {
            if (!locked || _sel(r) != ConstantProductPoolCirBtcWethV4.LiquidityLockedThisBlock.selector) {
                unexpectedRevert = true;
            }
        }
        if (pool.lastLiquidityBlock(to) != toLockBefore) lockViolated = true; // incoming LP never locks the recipient
    }

    /// @dev Adversarial action: try to park LP on DEAD (shrinking eligible supply) via transfer or transferFrom.
    ///      Every attempt must revert DeadAddressTransferBlocked, whatever the amount (and whatever the lock).
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
        if (ok || _sel(r) != ConstantProductPoolCirBtcWethV4.DeadAddressTransferBlocked.selector) {
            deadTransferSucceeded = true;
        }
    }

    function swap(uint256 actorSeed, bool aToB, uint256 amtSeed) external {
        address u = _actor(actorSeed);
        uint256 reserveIn = aToB ? pool.reserveA() : pool.reserveB();
        if (reserveIn == 0) return;
        uint256 held = aToB ? btc.balanceOf(u) : weth.balanceOf(u);
        uint256 amt = bound(amtSeed, 1, Math.min(reserveIn, held));
        uint256 k0 = pool.reserveA() * pool.reserveB();
        uint256 reserveOut = aToB ? pool.reserveB() : pool.reserveA();
        uint256 feeBefore = aToB ? pool.feeReserveA() : pool.feeReserveB();
        address tin = aToB ? address(btc) : address(weth);
        address tout = aToB ? address(weth) : address(btc);
        vm.prank(u);
        try pool.swap(tin, tout, amt, 0, type(uint256).max) returns (uint256 out) {
            swapsOk++;
            if (pool.reserveA() * pool.reserveB() < k0) kViolated = true;
            // F-10: an accepted swap never takes more than half of the output reserve
            if (out > reserveOut / 2) capViolated = true;
            // F-05: the fee is exactly ceilDiv(amountIn * 30, 10000)
            uint256 feeAfter = aToB ? pool.feeReserveA() : pool.feeReserveB();
            if (feeAfter - feeBefore != Math.ceilDiv(amt * 30, 10000)) feeViolated = true;
        } catch (bytes memory r) {
            bytes4 s = _sel(r);
            if (s == ConstantProductPoolCirBtcWethV4.OutputCapExceeded.selector) {
                // F-10: dedicated error, carrying (amountOut, reserveOut / 2) with amountOut strictly above the cap
                uint256 o;
                uint256 m;
                assembly {
                    o := mload(add(r, 36))
                    m := mload(add(r, 68))
                }
                if (m != reserveOut / 2 || o <= m) capViolated = true;
            } else if (
                s != ConstantProductPoolCirBtcWethV4.ZeroAmount.selector
                    && s != ConstantProductPoolCirBtcWethV4.NoLiquidityProviders.selector
                    && s != Pausable.EnforcedPause.selector
            ) {
                unexpectedRevert = true;
            }
        }
    }

    function harvest(uint256 actorSeed) external {
        _harvest(actorSeed, address(0));
    }

    /// @dev F-08 overload: the caller's fees are paid to `to`.
    function harvestTo(uint256 actorSeed, uint256 toSeed) external {
        _harvest(actorSeed, _actor(toSeed));
    }

    function _harvest(uint256 actorSeed, address to) internal {
        address u = _actor(actorSeed);
        (uint256 fa, uint256 fb) = pool.pendingFees(u);
        address rcpt = to == address(0) ? u : to;
        uint256 a0 = btc.balanceOf(rcpt);
        uint256 b0 = weth.balanceOf(rcpt);
        bool locked = _isLocked(u);
        bytes memory data =
            to == address(0) ? abi.encodeWithSignature("harvest()") : abi.encodeWithSignature("harvest(address)", to);
        vm.prank(u);
        (bool ok, bytes memory ret) = address(pool).call(data);
        if (ok) {
            harvestsOk++;
            if (locked) lockViolated = true;
            (uint256 ga, uint256 gb) = abi.decode(ret, (uint256, uint256));
            if (ga != fa || gb != fb || btc.balanceOf(rcpt) - a0 != fa || weth.balanceOf(rcpt) - b0 != fb) {
                feeLedgerViolated = true;
            }
            (uint256 pa, uint256 pb) = pool.pendingFees(u);
            if (pa + pb != 0) feeLedgerViolated = true; // nothing left to re-claim
        } else if (locked) {
            if (_sel(ret) != ConstantProductPoolCirBtcWethV4.LiquidityLockedThisBlock.selector) lockViolated = true;
        } else if (_sel(ret) != LpFeeAccounting.NoFeesAccrued.selector || fa + fb != 0) {
            unexpectedRevert = true;
        }
    }

    /// @dev Pause / unpause: exits and harvests must stay live, swaps and deposits revert.
    function setPaused(bool paused) external {
        vm.startPrank(poolOwner);
        if (paused && !pool.paused()) {
            pool.pause();
            pausedActions++;
        } else if (!paused && pool.paused()) {
            pool.unpause();
        }
        vm.stopPrank();
    }

    function roll(uint256 n) external {
        vm.roll(block.number + bound(n, 1, 5));
        vm.warp(block.timestamp + bound(n, 1, 3 hours));
    }

    /// @dev Moves every other actor's LP to one actor so full exits become reachable.
    function consolidate(uint256 actorSeed) external {
        address target = _actor(actorSeed);
        for (uint256 i; i < 3; i++) {
            address from = actors[i];
            uint256 bal = pool.balanceOf(from);
            if (from == target || bal == 0 || _isLocked(from)) continue; // locked LP cannot move this block
            vm.prank(from);
            try pool.transfer(target, bal) {} catch {
                unexpectedRevert = true;
            }
        }
    }

    uint256 internal r2PendA;
    uint256 internal r2PendB;

    function _pendingOf(address who) internal view returns (uint256 a, uint256 b) {
        (a, b) = pool.pendingFees(who);
    }

    /// @dev If one actor holds the entire eligible supply: full exit (sweep), verify the emptied state, verify
    ///      swaps are blocked, then restart the pool with a fresh deposit and verify exact accounting. Fees accrued
    ///      before the exit must survive it and must not be inherited by the restart depositor.
    function exitAndRestart(uint256 a, uint256 b, uint256 restarterSeed) external {
        uint256 dead = pool.balanceOf(DEAD);
        if (dead != pool.MINIMUM_LIQUIDITY()) restartViolated = true;
        uint256 eligible = pool.totalSupply() - dead;
        if (eligible == 0) return;
        address last;
        for (uint256 i; i < 3; i++) {
            if (pool.balanceOf(actors[i]) == eligible) last = actors[i];
        }
        if (last == address(0)) return;
        if (_isLocked(last)) {
            // F-07: the sole LP minted this block, so the full exit must revert until a later block
            vm.prank(last);
            try pool.removeLiquidity(eligible, 0, 0) {
                lockViolated = true;
            } catch (bytes memory lr) {
                if (_sel(lr) != ConstantProductPoolCirBtcWethV4.LiquidityLockedThisBlock.selector) lockViolated = true;
            }
            return;
        }

        (uint256 pendA, uint256 pendB) = _pendingOf(last);
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        vm.prank(last);
        try pool.removeLiquidity(eligible, 0, 0) returns (uint256 oA, uint256 oB) {
            if (oA != rA || oB != rB) restartViolated = true; // the last LP receives exactly the reserves
        } catch {
            unexpectedRevert = true;
            return;
        }
        if (pool.reserveA() != 0 || pool.reserveB() != 0 || pool.totalSupply() != dead) restartViolated = true;
        if (btc.balanceOf(address(pool)) != pool.feeReserveA() || weth.balanceOf(address(pool)) != pool.feeReserveB()) {
            restartViolated = true;
        }
        {
            (uint256 xa, uint256 xb) = _pendingOf(last);
            if (xa != pendA || xb != pendB) feeLedgerViolated = true; // exit keeps accrued fees
        }

        vm.prank(last);
        try pool.swap(address(btc), address(weth), 1e6, 0, type(uint256).max) {
            restartViolated = true;
        } catch (bytes memory r) {
            bytes4 s = _sel(r);
            if (s != ConstantProductPoolCirBtcWethV4.NoLiquidityProviders.selector && s != Pausable.EnforcedPause.selector) {
                restartViolated = true;
            }
        }

        if (pool.paused()) return; // restart deposits need an unpaused pool
        a = bound(a, 1e5, 1e11);
        b = bound(b, 1e14, 1e22);
        address r2 = _actor(restarterSeed);
        (r2PendA, r2PendB) = _pendingOf(r2);
        vm.prank(r2);
        try pool.addLiquidity(a, b, 0, type(uint256).max) returns (uint256 shares) {
            if (shares != Math.sqrt(a * b) * 1e5) restartViolated = true;
            if (pool.reserveA() != a || pool.reserveB() != b) restartViolated = true;
            if (pool.totalSupply() != dead + shares || pool.balanceOf(DEAD) != dead) restartViolated = true;
            restarts++;
            _verifyRestart(r2, last, shares, a, b, pendA, pendB);
        } catch {
            restartViolated = true;
        }
    }

    function _verifyRestart(address r2, address last, uint256 shares, uint256 a, uint256 b, uint256 pendA, uint256 pendB)
        internal
    {
        // a restart deposit neither creates nor transfers fee claims: the depositor's pending (zero for a fresh
        // account) and the exited LP's pending are exactly what they were before the restart
        {
            (uint256 ra, uint256 rb) = _pendingOf(r2);
            if (ra != r2PendA || rb != r2PendB) feeLedgerViolated = true;
            (uint256 la, uint256 lb) = _pendingOf(last);
            if (la != pendA || lb != pendB) feeLedgerViolated = true;
        }
        // F-07: the restart depositor is locked in the block that minted their shares ...
        vm.prank(r2);
        try pool.removeLiquidity(shares, 0, 0) {
            lockViolated = true;
        } catch (bytes memory lr) {
            if (_sel(lr) != ConstantProductPoolCirBtcWethV4.LiquidityLockedThisBlock.selector) lockViolated = true;
        }
        // ... and free in the next block
        vm.roll(block.number + 1);
        // the restart depositor is the only eligible LP: exiting returns exactly the deposit
        vm.prank(r2);
        try pool.removeLiquidity(shares, 0, 0) returns (uint256 outA, uint256 outB) {
            if (outA != a || outB != b) restartViolated = true;
        } catch {
            restartViolated = true;
            return;
        }
        if (pool.balanceOf(DEAD) != pool.MINIMUM_LIQUIDITY()) restartViolated = true;
        // and the pool is live again after a second restart
        vm.prank(r2);
        try pool.addLiquidity(a, b, 0, type(uint256).max) {} catch {
            restartViolated = true;
        }
    }
}
