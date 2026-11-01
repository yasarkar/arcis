// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "forge-std/Vm.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {CirBtcWethV4Base} from "./CirBtcWeth.Base.t.sol";
import {ConstantProductPoolCirBtcWethV4 as Pool} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {LpFeeAccounting} from "../src/v4/LpFeeAccounting.sol";

/// @dev Test token whose transfers to a blocked address revert (USDC-style blocklist), and which can optionally
///      reject zero-value transfers.
contract BlocklistERC20 is ERC20 {
    uint8 private immutable _dec;
    mapping(address => bool) public blocked;
    bool public rejectZero;

    error BlockedRecipient(address to);
    error ZeroValueTransfer();

    constructor(string memory n, string memory s, uint8 d) ERC20(n, s) {
        _dec = d;
    }

    function decimals() public view override returns (uint8) {
        return _dec;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setBlocked(address who, bool b) external {
        blocked[who] = b;
    }

    function setRejectZero(bool b) external {
        rejectZero = b;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (blocked[to]) revert BlockedRecipient(to);
        if (rejectZero && value == 0) revert ZeroValueTransfer();
        super._update(from, to, value);
    }
}

/// @notice F-08 recipient overloads on the regular mock tokens, plus removed selectors and deadline behaviour.
contract CirBtcWethRecipientTest is CirBtcWethV4Base {
    bytes32 internal constant REMOVED_TOPIC = keccak256("LiquidityRemoved(address,uint256,uint256,uint256)");
    bytes32 internal constant HARVEST_TOPIC = keccak256("FeesHarvested(address,uint256,uint256)");

    event LiquidityRemoved(address indexed provider, uint256 lpAmount, uint256 amountA, uint256 amountB);
    event FeesHarvested(address indexed lp, uint256 feeA, uint256 feeB);

    function _seedWithFees(uint256 ratio) internal returns (uint256 lp) {
        lp = _seed(ratio);
        _swap(bob, true, SAT / 10);
        _swap(carol, false, ratio * ETH / 10);
    }

    // ── removeLiquidity(..., to) ──

    function test_RemoveTo_DebitsCallerPaysRecipient() public {
        uint256 lp = _seed(20);
        address rcpt = makeAddr("rcpt");
        uint256 aBtc = btc.balanceOf(alice);
        uint256 aWeth = weth.balanceOf(alice);
        uint256 total = pool.totalSupply();
        uint256 rA = pool.reserveA();
        uint256 rB = pool.reserveB();
        uint256 amt = lp / 3;
        vm.expectEmit(true, false, false, true, address(pool));
        emit LiquidityRemoved(alice, amt, (rA * amt) / total, (rB * amt) / total);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(amt, 0, 0, rcpt);
        assertEq(outA, (rA * amt) / total);
        assertEq(outB, (rB * amt) / total);
        assertEq(btc.balanceOf(rcpt), outA, "recipient gets cirBTC");
        assertEq(weth.balanceOf(rcpt), outB, "recipient gets WETH");
        assertEq(btc.balanceOf(alice), aBtc, "caller receives nothing");
        assertEq(weth.balanceOf(alice), aWeth);
        assertEq(pool.balanceOf(alice), lp - amt, "caller is debited");
        assertEq(pool.balanceOf(rcpt), 0);
        assertEq(pool.reserveA(), rA - outA);
        assertEq(pool.reserveB(), rB - outB);
    }

    function test_RemoveThreeArg_StillPaysMsgSender() public {
        uint256 lp = _seed(20);
        uint256 a0 = btc.balanceOf(alice);
        uint256 w0 = weth.balanceOf(alice);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp / 2, 0, 0);
        assertEq(btc.balanceOf(alice) - a0, outA);
        assertEq(weth.balanceOf(alice) - w0, outB);
    }

    function test_RemoveTo_SlippageStillEnforced() public {
        uint256 lp = _seed(20);
        uint256 expA = (pool.reserveA() * (lp / 2)) / pool.totalSupply();
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.SlippageExceeded.selector, expA + 1, expA));
        pool.removeLiquidity(lp / 2, expA + 1, 0, bob);
    }

    function test_RemoveTo_ZeroAddressReverts() public {
        uint256 lp = _seed(20);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.ZeroAddress.selector, address(0)));
        pool.removeLiquidity(lp, 0, 0, address(0));
        // the recipient check comes first, even for an otherwise invalid amount
        vm.expectRevert(abi.encodeWithSelector(Pool.ZeroAddress.selector, address(0)));
        pool.removeLiquidity(0, 0, 0, address(0));
        vm.stopPrank();
        assertEq(pool.balanceOf(alice), lp, "nothing burned");
    }

    function test_RemoveTo_CannotBurnSomeoneElsesLp() public {
        uint256 lp = _seed(20);
        vm.prank(bob);
        vm.expectRevert(Pool.NotEnoughLP.selector);
        pool.removeLiquidity(lp, 0, 0, bob);
        assertEq(pool.balanceOf(alice), lp);
    }

    function test_RemoveTo_LastLpSweepsAllReservesToRecipient() public {
        uint256 lp = _seed(20);
        address rcpt = makeAddr("rcpt");
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(lp, 0, 0, rcpt);
        assertEq(outA, SAT);
        assertEq(outB, 20 * ETH);
        assertEq(btc.balanceOf(rcpt), SAT);
        assertEq(weth.balanceOf(rcpt), 20 * ETH);
        assertEq(pool.reserveA(), 0);
        assertEq(pool.reserveB(), 0);
    }

    function test_RemoveTo_WorksWhilePaused() public {
        uint256 lp = _seed(20);
        pool.pause();
        vm.prank(alice);
        (uint256 outA,) = pool.removeLiquidity(lp / 2, 0, 0, bob);
        assertEq(btc.balanceOf(bob) - 1e18, outA);
    }

    function test_RemoveTo_LockIsKeyedOnCallerNotRecipient() public {
        uint256 lp = _seed(20);
        _add(bob, SAT / 10, 2 * ETH); // bob (the recipient) is locked; alice (the caller) is not
        vm.prank(alice);
        pool.removeLiquidity(lp / 2, 0, 0, bob);
        // reverse: caller locked, recipient free
        vm.prank(bob);
        vm.expectRevert(_lockedSel());
        pool.removeLiquidity(1, 0, 0, alice);
    }

    function testFuzz_RemoveTo_ConservesTokens(uint8 sel, uint256 amtSeed, address rcpt) public {
        vm.assume(rcpt != address(0) && rcpt != address(pool) && rcpt != DEAD);
        uint256 lp = _seed(_ratio(sel));
        _add(bob, SAT / 2, _ratio(sel) * ETH / 2);
        _roll();
        uint256 amt = bound(amtSeed, 1, lp);
        uint256 poolA = btc.balanceOf(address(pool));
        uint256 poolB = weth.balanceOf(address(pool));
        uint256 r0A = btc.balanceOf(rcpt);
        uint256 r0B = weth.balanceOf(rcpt);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = pool.removeLiquidity(amt, 0, 0, rcpt);
        assertEq(btc.balanceOf(rcpt) - r0A, outA);
        assertEq(weth.balanceOf(rcpt) - r0B, outB);
        assertEq(poolA - btc.balanceOf(address(pool)), outA);
        assertEq(poolB - weth.balanceOf(address(pool)), outB);
        assertEq(pool.balanceOf(alice), lp - amt);
    }

    // ── harvest(to) ──

    function test_HarvestTo_PaysRecipientAndDebitsCaller() public {
        _seedWithFees(20);
        address rcpt = makeAddr("rcpt");
        (uint256 pa, uint256 pb) = pool.pendingFees(alice);
        assertGt(pa, 0);
        assertGt(pb, 0);
        uint256 a0 = btc.balanceOf(alice);
        uint256 w0 = weth.balanceOf(alice);
        vm.expectEmit(true, false, false, true, address(pool));
        emit FeesHarvested(alice, pa, pb);
        vm.prank(alice);
        (uint256 fa, uint256 fb) = pool.harvest(rcpt);
        assertEq(fa, pa);
        assertEq(fb, pb);
        assertEq(btc.balanceOf(rcpt), pa);
        assertEq(weth.balanceOf(rcpt), pb);
        assertEq(btc.balanceOf(alice), a0, "caller receives nothing");
        assertEq(weth.balanceOf(alice), w0);
        (uint256 qa, uint256 qb) = pool.pendingFees(alice);
        assertEq(qa + qb, 0, "caller's claim is consumed");
        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        pool.harvest(rcpt);
    }

    function test_HarvestNoArg_StillPaysMsgSender() public {
        _seedWithFees(20);
        (uint256 pa, uint256 pb) = pool.pendingFees(alice);
        uint256 a0 = btc.balanceOf(alice);
        uint256 w0 = weth.balanceOf(alice);
        vm.prank(alice);
        pool.harvest();
        assertEq(btc.balanceOf(alice) - a0, pa);
        assertEq(weth.balanceOf(alice) - w0, pb);
    }

    function test_HarvestTo_ZeroAddressReverts() public {
        _seedWithFees(20);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Pool.ZeroAddress.selector, address(0)));
        pool.harvest(address(0));
        // and for a caller with nothing to claim the zero-recipient error still wins
        vm.prank(makeAddr("nobody"));
        vm.expectRevert(abi.encodeWithSelector(Pool.ZeroAddress.selector, address(0)));
        pool.harvest(address(0));
        (uint256 pa,) = pool.pendingFees(alice);
        assertGt(pa, 0, "fees untouched");
    }

    function test_HarvestTo_CallerCannotClaimOthersFees() public {
        _seedWithFees(20);
        vm.prank(bob); // bob holds no LP
        vm.expectRevert(LpFeeAccounting.NoFeesAccrued.selector);
        pool.harvest(bob);
    }

    function test_HarvestTo_WorksWhilePaused() public {
        _seedWithFees(20);
        pool.pause();
        vm.prank(alice);
        (uint256 fa,) = pool.harvest(carol);
        assertGt(fa, 0);
    }

    // ── events are emitted BEFORE the token transfers (checks-effects-interactions) ──

    function _firstIndex(Vm.Log[] memory logs, address emitter, bytes32 topic0) internal pure returns (uint256) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == emitter && (topic0 == 0 || logs[i].topics[0] == topic0)) return i;
        }
        return type(uint256).max;
    }

    function test_RemoveTo_EventPrecedesTokenTransfers() public {
        uint256 lp = _seed(20);
        vm.recordLogs();
        vm.prank(alice);
        pool.removeLiquidity(lp / 2, 0, 0, bob);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 iEvt = _firstIndex(logs, address(pool), REMOVED_TOPIC);
        uint256 iA = _firstIndex(logs, address(btc), 0);
        uint256 iB = _firstIndex(logs, address(weth), 0);
        assertLt(iEvt, logs.length, "event emitted");
        assertLt(iEvt, iA, "LiquidityRemoved before the cirBTC transfer");
        assertLt(iEvt, iB, "LiquidityRemoved before the WETH transfer");
        assertEq(logs[iEvt].topics[1], bytes32(uint256(uint160(alice))), "provider is the caller, not the recipient");
    }

    function test_HarvestTo_EventPrecedesTokenTransfers() public {
        _seedWithFees(20);
        vm.recordLogs();
        vm.prank(alice);
        pool.harvest(bob);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        uint256 iEvt = _firstIndex(logs, address(pool), HARVEST_TOPIC);
        assertLt(iEvt, logs.length, "event emitted");
        assertLt(iEvt, _firstIndex(logs, address(btc), 0));
        assertLt(iEvt, _firstIndex(logs, address(weth), 0));
        assertEq(logs[iEvt].topics[1], bytes32(uint256(uint160(alice))));
    }

    // ── removed no-deadline selectors / deadlines on the remaining entry points ──

    function test_RemovedSelectorsRevertOnLowLevelCall() public {
        _seed(20);
        vm.startPrank(bob);
        (bool ok, bytes memory ret) = address(pool).call(
            abi.encodeWithSignature("swap(address,address,uint256,uint256)", address(btc), address(weth), 1e6, 0)
        );
        assertFalse(ok, "swap(address,address,uint256,uint256) removed");
        assertEq(ret.length, 0, "no fallback: bare revert");
        (ok, ret) = address(pool).call(
            abi.encodeWithSignature("addLiquidity(uint256,uint256,uint256)", SAT / 10, 2 * ETH, 0)
        );
        assertFalse(ok, "addLiquidity(uint256,uint256,uint256) removed");
        assertEq(ret.length, 0);
        vm.stopPrank();
        // the deadline versions are the only entry points
        vm.prank(bob);
        (ok,) = address(pool).call(
            abi.encodeWithSignature(
                "swap(address,address,uint256,uint256,uint256)", address(btc), address(weth), 1e6, 0, block.timestamp
            )
        );
        assertTrue(ok);
    }

    function test_DeadlinesExpire_SwapAndAdd() public {
        _seed(20);
        uint256 deadline = block.timestamp + 100;
        vm.warp(deadline); // == deadline: still valid
        vm.startPrank(bob);
        pool.swap(address(btc), address(weth), 1e6, 0, deadline);
        pool.addLiquidity(SAT / 10, 2 * ETH, 0, deadline);
        vm.warp(deadline + 1);
        vm.expectRevert(Pool.DeadlineExpired.selector);
        pool.swap(address(btc), address(weth), 1e6, 0, deadline);
        vm.expectRevert(Pool.DeadlineExpired.selector);
        pool.addLiquidity(SAT / 10, 2 * ETH, 0, deadline);
        vm.stopPrank();
    }

    function test_RecipientOverloadsExistAsDistinctSelectors() public {
        uint256 lp = _seed(20);
        vm.startPrank(alice);
        (bool ok,) = address(pool).call(
            abi.encodeWithSignature("removeLiquidity(uint256,uint256,uint256,address)", lp / 4, 0, 0, bob)
        );
        assertTrue(ok);
        (ok,) = address(pool).call(abi.encodeWithSignature("removeLiquidity(uint256,uint256,uint256)", lp / 4, 0, 0));
        assertTrue(ok);
        vm.stopPrank();
        _swap(bob, true, SAT / 10);
        vm.startPrank(alice);
        (ok,) = address(pool).call(abi.encodeWithSignature("harvest(address)", bob));
        assertTrue(ok);
        vm.stopPrank();
    }

    function test_PausedSwapStillReverts_ButRecipientExitWorks() public {
        _seed(20);
        pool.pause();
        vm.prank(bob);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        pool.swap(address(btc), address(weth), 1e6, 0, type(uint256).max);
    }
}

/// @notice F-08 with blocklisting / zero-rejecting tokens: the recipient overload routes around a blocked caller and
///         zero-amount transfers are skipped.
contract CirBtcWethBlocklistTest is CirBtcWethV4Base {
    BlocklistERC20 internal bBtc;
    BlocklistERC20 internal bWeth;
    Pool internal bPool;

    function setUp() public override {
        super.setUp();
        bBtc = new BlocklistERC20("cirBTC", "cirBTC", 8);
        bWeth = new BlocklistERC20("WETH", "WETH", 18);
        bPool = new Pool(address(bBtc), address(bWeth), 30, address(this));
        address[3] memory us = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            bBtc.mint(us[i], 1e18);
            bWeth.mint(us[i], 1e40);
            vm.startPrank(us[i]);
            bBtc.approve(address(bPool), type(uint256).max);
            bWeth.approve(address(bPool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _bSeed(uint256 ratio) internal returns (uint256 lp) {
        vm.prank(alice);
        lp = bPool.addLiquidity(SAT, ratio * ETH, 0, type(uint256).max);
        vm.roll(block.number + 1);
    }

    function _bSwapAToB(address who, uint256 amountIn) internal {
        vm.prank(who);
        bPool.swap(address(bBtc), address(bWeth), amountIn, 0, type(uint256).max);
    }

    function test_BlockedCallerRemove_ThreeArgFails_RecipientOverloadSucceeds() public {
        uint256 lp = _bSeed(20);
        bBtc.setBlocked(alice, true);
        bWeth.setBlocked(alice, true);

        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.TransferFailed.selector);
        bPool.removeLiquidity(lp, 0, 0); // pays msg.sender: blocked
        assertEq(bPool.balanceOf(alice), lp, "failed exit is atomic: LP not burned");

        vm.prank(alice);
        (uint256 outA, uint256 outB) = bPool.removeLiquidity(lp, 0, 0, carol); // routed to a clean address
        assertEq(outA, SAT);
        assertEq(outB, 20 * ETH);
        assertEq(bBtc.balanceOf(carol), 1e18 + SAT);
        assertEq(bWeth.balanceOf(carol), 1e40 + 20 * ETH);
        assertEq(bPool.balanceOf(alice), 0, "caller's LP burned");
    }

    function test_BlockedRecipient_RemoveFailsAtomically() public {
        uint256 lp = _bSeed(20);
        bBtc.setBlocked(carol, true);
        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.TransferFailed.selector);
        bPool.removeLiquidity(lp / 2, 0, 0, carol);
        assertEq(bPool.balanceOf(alice), lp);
        assertEq(bPool.reserveA(), SAT);
    }

    function test_BlockedCallerHarvest_NoArgFails_RecipientOverloadSucceeds() public {
        _bSeed(20);
        _bSwapAToB(bob, SAT / 10);
        (uint256 pa,) = bPool.pendingFees(alice);
        assertGt(pa, 0);
        bBtc.setBlocked(alice, true);

        vm.prank(alice);
        vm.expectRevert(LpFeeAccounting.TransferFailed.selector);
        bPool.harvest();
        (uint256 still,) = bPool.pendingFees(alice);
        assertEq(still, pa, "failed harvest keeps the claim");

        uint256 c0 = bBtc.balanceOf(carol);
        vm.prank(alice);
        (uint256 fa, uint256 fb) = bPool.harvest(carol);
        assertEq(fa, pa);
        assertEq(fb, 0);
        assertEq(bBtc.balanceOf(carol) - c0, pa);
        (uint256 after_,) = bPool.pendingFees(alice);
        assertEq(after_, 0);
    }

    function test_ZeroAmountTransfersAreSkipped_Remove() public {
        // 1 BTC = 100 ETH: total = 1e19. 1 wei of LP is worth 10 wei WETH but 1e8 / 1e19 = 0 sat.
        _bSeed(100);
        bBtc.setRejectZero(true);
        bWeth.setRejectZero(true);
        vm.prank(alice);
        (uint256 outA, uint256 outB) = bPool.removeLiquidity(1, 0, 0);
        assertEq(outA, 0);
        assertEq(outB, 10);
        vm.prank(alice);
        (outA, outB) = bPool.removeLiquidity(1, 0, 0, bob);
        assertEq(outA, 0, "A leg is zero: no zero-value transfer attempted");
        assertGt(outB, 0);
    }

    function test_ZeroAmountTransfersAreSkipped_Harvest() public {
        _bSeed(20);
        _bSwapAToB(bob, SAT / 10); // fees only in cirBTC; the WETH leg of the harvest is zero
        bBtc.setRejectZero(true);
        bWeth.setRejectZero(true);
        (uint256 pa, uint256 pb) = bPool.pendingFees(alice);
        assertGt(pa, 0);
        assertEq(pb, 0);
        vm.prank(alice);
        (uint256 fa, uint256 fb) = bPool.harvest(carol);
        assertEq(fa, pa);
        assertEq(fb, 0);
    }
}
