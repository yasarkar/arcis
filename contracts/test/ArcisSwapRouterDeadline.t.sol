// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {ArcisSwapRouter} from "../src/ArcisSwapRouter.sol";
import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {ConstantProductPoolV4} from "../src/v4/ConstantProductPoolV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Minimal 5-arg pool that records what the router forwards, can under-deliver, and can re-enter the router.
contract RecordingDeadlinePool {
    ArcisSwapRouter public router;
    uint256 public calls;
    uint256 public lastAmountIn;
    uint256 public lastMinOut;
    uint256 public lastDeadline;
    uint256 public payout;
    uint8 public mode; // 0 normal, 1 re-enter swapWithFeeAndDeadline, 2 re-enter swapWithFee

    constructor(ArcisSwapRouter r) {
        router = r;
    }

    function configure(uint256 payout_, uint8 mode_) external {
        payout = payout_;
        mode = mode_;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        external
        returns (uint256)
    {
        calls++;
        lastAmountIn = amountIn;
        lastMinOut = minOut;
        lastDeadline = deadline;
        if (mode == 1) {
            router.swapWithFeeAndDeadline(address(this), tokenIn, tokenOut, 1, 0, address(0), 0, deadline);
        } else if (mode == 2) {
            router.swapWithFee(address(this), tokenIn, tokenOut, 1, 0, address(0), 0);
        }
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenOut).transfer(msg.sender, payout);
        return payout;
    }
}

/// @dev Token that, like USDT, rejects non-zero -> non-zero approvals.
contract ResetToken is MockERC20 {
    constructor() MockERC20("Reset Token", "RST", 6) {}

    function approve(address spender, uint256 value) public override returns (bool) {
        require(value == 0 || allowance(msg.sender, spender) == 0, "reset first");
        return super.approve(spender, value);
    }
}

/// @dev Token whose holder balance can be reduced by anyone (models a balance-decreasing token).
contract ShrinkToken is MockERC20 {
    constructor() MockERC20("Shrink", "SHR", 8) {}

    function shrink(address a, uint256 x) external {
        _burn(a, x);
    }
}

/// @dev Fee-on-transfer token: transfers whose recipient is `taxTo` lose `taxBps` (burned from the sender)
///      and optionally credit `bonus` extra tokens to the recipient. Mints are never taxed.
contract TaxToken is MockERC20 {
    address public taxTo;
    uint256 public taxBps;
    uint256 public bonus;

    constructor() MockERC20("Tax Token", "TAX", 6) {}

    function configure(address taxTo_, uint256 taxBps_, uint256 bonus_) external {
        taxTo = taxTo_;
        taxBps = taxBps_;
        bonus = bonus_;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && to == taxTo) {
            uint256 tax = (value * taxBps) / 10000;
            super._update(from, to, value - tax);
            if (tax > 0) super._update(from, address(0), tax);
            if (bonus > 0) super._update(address(0), to, bonus);
        } else {
            super._update(from, to, value);
        }
    }
}

/// @dev Fully configurable fake pool (both 4-arg and 5-arg swap). Pulls `pullIn` of tokenIn (ALL = net amount),
///      sends `sendOut` of tokenOut from its own balance, and reports `reported` regardless of what it did.
contract FakePool {
    uint256 internal constant ALL = type(uint256).max;
    uint256 public pullIn = ALL;
    uint256 public sendOut;
    uint256 public reported;
    uint256 public burnOut;
    uint256 public allowanceDuring;
    uint256 public lastAmountIn;
    uint256 public calls;

    function configure(uint256 pullIn_, uint256 sendOut_, uint256 reported_) external {
        pullIn = pullIn_;
        sendOut = sendOut_;
        reported = reported_;
    }

    function setBurn(uint256 b) external {
        burnOut = b;
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256) external returns (uint256) {
        return _swap(tokenIn, tokenOut, amountIn);
    }

    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256, uint256) external returns (uint256) {
        return _swap(tokenIn, tokenOut, amountIn);
    }

    /// @dev Attempt to pull tokens from `from` using whatever allowance `from` granted this pool.
    function pull(address token, address from, uint256 amount) external {
        IERC20(token).transferFrom(from, address(this), amount);
    }

    function _swap(address tokenIn, address tokenOut, uint256 amountIn) internal returns (uint256) {
        calls++;
        lastAmountIn = amountIn;
        allowanceDuring = IERC20(tokenIn).allowance(msg.sender, address(this));
        uint256 p = pullIn == ALL ? amountIn : pullIn;
        if (p > 0) IERC20(tokenIn).transferFrom(msg.sender, address(this), p);
        if (burnOut > 0) ShrinkToken(tokenOut).shrink(msg.sender, burnOut);
        if (sendOut > 0) IERC20(tokenOut).transfer(msg.sender, sendOut);
        return reported;
    }
}

contract ArcisSwapRouterDeadlineTest is Test {
    ArcisSwapRouter internal router;
    ConstantProductPoolEurcCirBtcV4 internal pool;
    ConstantProductPoolV4 internal legacyPool;
    MockERC20 internal eurc;
    MockERC20 internal btc;

    address internal poolOwner = address(this);
    address internal alice = makeAddr("alice"); // LP
    address internal user = makeAddr("user");
    address internal treasury = makeAddr("treasury");

    uint256 internal constant DEC6 = 1e6;
    uint256 internal constant DEC8 = 1e8;
    uint256 internal constant T0 = 1_700_000_000;

    function setUp() public {
        vm.warp(T0);
        eurc = new MockERC20("Euro Coin", "EURC", 6);
        btc = new MockERC20("Circle BTC", "cirBTC", 8);
        router = new ArcisSwapRouter();
        pool = new ConstantProductPoolEurcCirBtcV4(address(eurc), address(btc), 25, poolOwner);
        legacyPool = new ConstantProductPoolV4(address(eurc), address(btc), 25, poolOwner);

        eurc.mint(alice, 10_000_000 * DEC6);
        btc.mint(alice, 1_000 * DEC8);
        eurc.mint(user, 1_000_000 * DEC6);
        btc.mint(user, 100 * DEC8);

        vm.startPrank(alice);
        eurc.approve(address(pool), type(uint256).max);
        btc.approve(address(pool), type(uint256).max);
        eurc.approve(address(legacyPool), type(uint256).max);
        btc.approve(address(legacyPool), type(uint256).max);
        pool.addLiquidity(600_000 * DEC6, 10 * DEC8, 0, type(uint256).max);
        legacyPool.addLiquidity(600_000 * DEC6, 10 * DEC8, 0);
        vm.stopPrank();
        vm.roll(block.number + 1);

        vm.startPrank(user);
        eurc.approve(address(router), type(uint256).max);
        btc.approve(address(router), type(uint256).max);
        vm.stopPrank();
    }

    // ── helpers ───────────────────────────────────────────────────────────────

    /// @dev Pool quote for an EURC/cirBTC pool swap of `net` (pool fee 25 bps, rounded up).
    function _quote(uint256 net, bool aToB) internal view returns (uint256) {
        uint256 afterFee = net - Math.ceilDiv(net * 25, 10000);
        (uint256 rIn, uint256 rOut) = aToB ? (pool.reserveA(), pool.reserveB()) : (pool.reserveB(), pool.reserveA());
        return (rOut * afterFee) / (rIn + afterFee);
    }

    function _swap(uint256 amountIn, uint256 minOut, address t, uint256 feeBps, uint256 deadline)
        internal
        returns (uint256)
    {
        vm.prank(user);
        return router.swapWithFeeAndDeadline(
            address(pool), address(eurc), address(btc), amountIn, minOut, t, feeBps, deadline
        );
    }

    function _assertRouterEmpty() internal view {
        assertEq(eurc.balanceOf(address(router)), 0, "router EURC");
        assertEq(btc.balanceOf(address(router)), 0, "router cirBTC");
    }

    // ── happy paths ───────────────────────────────────────────────────────────

    function test_HappyPath_FeeZero() public {
        uint256 amountIn = 1_000 * DEC6;
        uint256 expOut = _quote(amountIn, true);
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);

        vm.expectEmit(true, true, false, true, address(router));
        emit ArcisSwapRouter.SwapWithFee(user, address(pool), address(eurc), address(btc), amountIn, expOut, 0, treasury);
        uint256 out = _swap(amountIn, expOut, treasury, 0, block.timestamp + 1 hours);

        assertEq(out, expOut);
        assertEq(eurc.balanceOf(user), uE - amountIn);
        assertEq(btc.balanceOf(user), uB + expOut);
        assertEq(eurc.balanceOf(treasury), 0);
        assertEq(btc.balanceOf(treasury), 0);
        _assertRouterEmpty();
    }

    function test_HappyPath_Fee25Bps_ToTreasury() public {
        uint256 amountIn = 10_000 * DEC6;
        uint256 fee = (amountIn * 25) / 10000;
        uint256 expOut = _quote(amountIn - fee, true);
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);
        uint256 poolE = eurc.balanceOf(address(pool));

        vm.expectEmit(true, true, false, true, address(router));
        emit ArcisSwapRouter.SwapWithFee(user, address(pool), address(eurc), address(btc), amountIn, expOut, fee, treasury);
        uint256 out = _swap(amountIn, expOut, treasury, 25, block.timestamp + 1 hours);

        assertEq(fee, 25 * DEC6);
        assertEq(out, expOut);
        assertEq(eurc.balanceOf(user), uE - amountIn, "user pays gross amountIn");
        assertEq(btc.balanceOf(user), uB + expOut);
        assertEq(eurc.balanceOf(treasury), fee, "treasury receives fee");
        assertEq(btc.balanceOf(treasury), 0);
        assertEq(eurc.balanceOf(address(pool)), poolE + amountIn - fee, "pool receives net amount");
        _assertRouterEmpty();
    }

    function test_HappyPath_BToA_Direction() public {
        uint256 amountIn = 1 * DEC8;
        uint256 fee = (amountIn * 100) / 10000;
        uint256 expOut = _quote(amountIn - fee, false);
        vm.prank(user);
        uint256 out = router.swapWithFeeAndDeadline(
            address(pool), address(btc), address(eurc), amountIn, expOut, treasury, 100, block.timestamp
        );
        assertEq(out, expOut);
        assertEq(btc.balanceOf(treasury), fee);
        assertEq(eurc.balanceOf(user), 1_000_000 * DEC6 + expOut);
        _assertRouterEmpty();
    }

    function test_FeeBpsPositiveButTreasuryZero_TakesNoFee() public {
        uint256 amountIn = 1_000 * DEC6;
        uint256 expOut = _quote(amountIn, true);
        vm.expectEmit(true, true, false, true, address(router));
        emit ArcisSwapRouter.SwapWithFee(user, address(pool), address(eurc), address(btc), amountIn, expOut, 0, address(0));
        _swap(amountIn, 0, address(0), 100, block.timestamp);
        _assertRouterEmpty();
    }

    function test_MaxFee500Bps_Allowed() public {
        _swap(10_000 * DEC6, 0, treasury, 500, block.timestamp);
        assertEq(eurc.balanceOf(treasury), 500 * DEC6);
        _assertRouterEmpty();
    }

    function test_SecondSwap_RevokesAllowanceAndStaysClean() public {
        _swap(1_000 * DEC6, 0, treasury, 25, block.timestamp);
        // hardened: allowance is exact-per-call and revoked afterwards (no standing max approval)
        assertEq(eurc.allowance(address(router), address(pool)), 0);
        _swap(2_000 * DEC6, 0, treasury, 25, block.timestamp);
        assertEq(eurc.allowance(address(router), address(pool)), 0);
        _assertRouterEmpty();
    }

    // ── deadline ──────────────────────────────────────────────────────────────

    function test_DeadlineEqualToBlockTimestamp_Succeeds() public {
        uint256 out = _swap(1_000 * DEC6, 0, treasury, 25, block.timestamp);
        assertGt(out, 0);
    }

    function test_ExpiredDeadline_RevertsAndMovesNoFunds() public {
        uint256 deadline = block.timestamp - 1;
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);
        uint256 poolE = eurc.balanceOf(address(pool));

        vm.expectRevert(ArcisSwapRouter.DeadlineExpired.selector);
        _swap(1_000 * DEC6, 0, treasury, 25, deadline);

        assertEq(eurc.balanceOf(user), uE);
        assertEq(btc.balanceOf(user), uB);
        assertEq(eurc.balanceOf(treasury), 0);
        assertEq(eurc.balanceOf(address(pool)), poolE);
        assertEq(eurc.allowance(address(router), address(pool)), 0, "no approval granted");
        _assertRouterEmpty();
    }

    function test_DeadlineZero_Reverts() public {
        vm.expectRevert(ArcisSwapRouter.DeadlineExpired.selector);
        _swap(1_000 * DEC6, 0, treasury, 25, 0);
    }

    function test_DeadlineExpiresAfterWarp() public {
        uint256 deadline = block.timestamp + 100;
        vm.warp(block.timestamp + 101);
        vm.expectRevert(ArcisSwapRouter.DeadlineExpired.selector);
        _swap(1_000 * DEC6, 0, treasury, 25, deadline);
    }

    function test_DeadlineChecked_BeforeOtherValidation() public {
        vm.expectRevert(ArcisSwapRouter.DeadlineExpired.selector);
        _swap(0, 0, treasury, 9999, block.timestamp - 1);
    }

    function test_DeadlineAndNetAmountForwardedToPool() public {
        RecordingDeadlinePool mock = new RecordingDeadlinePool(router);
        btc.mint(address(mock), 1_000 * DEC8);
        mock.configure(7 * DEC8, 0);
        uint256 deadline = block.timestamp + 12345;
        uint256 amountIn = 4_000 * DEC6;

        vm.prank(user);
        uint256 out = router.swapWithFeeAndDeadline(
            address(mock), address(eurc), address(btc), amountIn, 5 * DEC8, treasury, 50, deadline
        );
        assertEq(out, 7 * DEC8);
        assertEq(mock.calls(), 1);
        assertEq(mock.lastDeadline(), deadline, "deadline forwarded unchanged");
        assertEq(mock.lastMinOut(), 5 * DEC8);
        assertEq(mock.lastAmountIn(), amountIn - (amountIn * 50) / 10000, "pool sees net amount");
        assertEq(btc.balanceOf(user), 100 * DEC8 + 7 * DEC8);
        _assertRouterEmpty();
    }

    // ── input validation ──────────────────────────────────────────────────────

    function test_ZeroPool_Reverts() public {
        vm.prank(user);
        vm.expectRevert(ArcisSwapRouter.ZeroAddress.selector);
        router.swapWithFeeAndDeadline(address(0), address(eurc), address(btc), 1e6, 0, treasury, 0, block.timestamp);
    }

    function test_ZeroTokenIn_Reverts() public {
        vm.prank(user);
        vm.expectRevert(ArcisSwapRouter.ZeroAddress.selector);
        router.swapWithFeeAndDeadline(address(pool), address(0), address(btc), 1e6, 0, treasury, 0, block.timestamp);
    }

    function test_ZeroTokenOut_Reverts() public {
        vm.prank(user);
        vm.expectRevert(ArcisSwapRouter.ZeroAddress.selector);
        router.swapWithFeeAndDeadline(address(pool), address(eurc), address(0), 1e6, 0, treasury, 0, block.timestamp);
    }

    function test_ZeroAmount_Reverts() public {
        vm.expectRevert(ArcisSwapRouter.ZeroAmount.selector);
        _swap(0, 0, treasury, 25, block.timestamp);
    }

    function test_FeeTooHigh_Reverts() public {
        vm.expectRevert(ArcisSwapRouter.FeeTooHigh.selector);
        _swap(1_000 * DEC6, 0, treasury, 501, block.timestamp);
    }

    function test_FeeTooHigh_MaxUint_Reverts() public {
        vm.expectRevert(ArcisSwapRouter.FeeTooHigh.selector);
        _swap(1_000 * DEC6, 0, treasury, type(uint256).max, block.timestamp);
    }

    // ── slippage, cap, pause ──────────────────────────────────────────────────

    function test_MinOutTooHigh_RevertsWithPoolSlippage_NoFundsMoved() public {
        uint256 amountIn = 1_000 * DEC6;
        uint256 fee = (amountIn * 25) / 10000;
        uint256 expOut = _quote(amountIn - fee, true);
        uint256 uE = eurc.balanceOf(user);

        vm.expectRevert(
            abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.SlippageExceeded.selector, expOut + 1, expOut)
        );
        _swap(amountIn, expOut + 1, treasury, 25, block.timestamp);

        assertEq(eurc.balanceOf(user), uE);
        assertEq(eurc.balanceOf(treasury), 0, "fee transfer rolled back");
        _assertRouterEmpty();
    }

    function test_MinOutExactlyQuote_Succeeds() public {
        uint256 amountIn = 1_000 * DEC6;
        uint256 expOut = _quote(amountIn - (amountIn * 25) / 10000, true);
        assertEq(_swap(amountIn, expOut, treasury, 25, block.timestamp), expOut);
    }

    function test_RouterOwnSlippageCheck_WhenPoolUnderDelivers() public {
        RecordingDeadlinePool mock = new RecordingDeadlinePool(router);
        btc.mint(address(mock), 100 * DEC8);
        mock.configure(50, 0);
        vm.prank(user);
        vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
        router.swapWithFeeAndDeadline(
            address(mock), address(eurc), address(btc), 1_000 * DEC6, 100, treasury, 25, block.timestamp
        );
    }

    function test_PoolOutputCap_BubblesOutputCapExceeded() public {
        uint256 amountIn = 700_000 * DEC6; // pushes output above 50% of the cirBTC reserve
        uint256 fee = (amountIn * 25) / 10000;
        uint256 outB = _quote(amountIn - fee, true);
        uint256 half = pool.reserveB() / 2;
        assertGt(outB, half);

        uint256 uE = eurc.balanceOf(user);
        vm.expectRevert(abi.encodeWithSelector(ConstantProductPoolEurcCirBtcV4.OutputCapExceeded.selector, outB, half));
        _swap(amountIn, 0, treasury, 25, block.timestamp);
        assertEq(eurc.balanceOf(user), uE);
        assertEq(eurc.balanceOf(treasury), 0);
        _assertRouterEmpty();
    }

    function test_PausedPool_Reverts() public {
        pool.pause();
        vm.expectRevert(Pausable.EnforcedPause.selector);
        _swap(1_000 * DEC6, 0, treasury, 25, block.timestamp);
        assertEq(eurc.balanceOf(treasury), 0);
        _assertRouterEmpty();
    }

    function test_InsufficientUserAllowance_RevertsTransferFailed() public {
        address stranger = makeAddr("stranger");
        eurc.mint(stranger, 1_000 * DEC6);
        vm.prank(stranger);
        vm.expectRevert(ArcisSwapRouter.TransferFailed.selector);
        router.swapWithFeeAndDeadline(
            address(pool), address(eurc), address(btc), 1_000 * DEC6, 0, treasury, 25, block.timestamp
        );
    }

    // ── legacy swapWithFee ────────────────────────────────────────────────────

    function test_Legacy_AgainstEurcCirBtcPool_RevertsNoFourArgSelector() public {
        uint256 uE = eurc.balanceOf(user);
        vm.prank(user);
        vm.expectRevert(); // pool has no swap(address,address,uint256,uint256) and no fallback
        router.swapWithFee(address(pool), address(eurc), address(btc), 1_000 * DEC6, 0, treasury, 25);
        assertEq(eurc.balanceOf(user), uE, "state rolled back");
        assertEq(eurc.balanceOf(treasury), 0);
        _assertRouterEmpty();
    }

    function test_Legacy_AgainstOlderV4Pool_StillWorks() public {
        uint256 amountIn = 10_000 * DEC6;
        uint256 fee = (amountIn * 25) / 10000;
        uint256 net = amountIn - fee;
        uint256 afterPoolFee = net - (net * 25) / 10000; // ConstantProductPoolV4 rounds the fee down
        uint256 expOut = (legacyPool.reserveB() * afterPoolFee) / (legacyPool.reserveA() + afterPoolFee);

        vm.expectEmit(true, true, false, true, address(router));
        emit ArcisSwapRouter.SwapWithFee(user, address(legacyPool), address(eurc), address(btc), amountIn, expOut, fee, treasury);
        vm.prank(user);
        uint256 out =
            router.swapWithFee(address(legacyPool), address(eurc), address(btc), amountIn, expOut, treasury, 25);

        assertEq(out, expOut);
        assertEq(eurc.balanceOf(treasury), fee);
        assertEq(btc.balanceOf(user), 100 * DEC8 + expOut);
        _assertRouterEmpty();
    }

    function test_DeadlineVariant_AgainstOlderV4Pool_Reverts() public {
        vm.prank(user);
        vm.expectRevert(); // legacy pool has no 5-arg swap
        router.swapWithFeeAndDeadline(
            address(legacyPool), address(eurc), address(btc), 1_000 * DEC6, 0, treasury, 25, block.timestamp
        );
    }

    // ── reentrancy ────────────────────────────────────────────────────────────

    function test_Reentrancy_SameFunction_Blocked() public {
        RecordingDeadlinePool mock = new RecordingDeadlinePool(router);
        btc.mint(address(mock), 100 * DEC8);
        mock.configure(1, 1);
        vm.prank(user);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        router.swapWithFeeAndDeadline(
            address(mock), address(eurc), address(btc), 1_000 * DEC6, 0, treasury, 25, block.timestamp
        );
    }

    function test_Reentrancy_CrossFunctionIntoLegacy_Blocked() public {
        RecordingDeadlinePool mock = new RecordingDeadlinePool(router);
        btc.mint(address(mock), 100 * DEC8);
        mock.configure(1, 2);
        vm.prank(user);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        router.swapWithFeeAndDeadline(
            address(mock), address(eurc), address(btc), 1_000 * DEC6, 0, treasury, 25, block.timestamp
        );
    }

    // ── hardening helpers ─────────────────────────────────────────────────────

    uint256 internal constant ALL = type(uint256).max;
    uint256 internal constant AMT = 1_000 * DEC6; // gross amountIn used by fake-pool tests
    uint256 internal constant FEE = 10 * DEC6; // 100 bps of AMT
    uint256 internal constant NET = 990 * DEC6;
    uint256 internal constant OUT = 5 * DEC8;

    function _fake(uint256 pullIn, uint256 sendOut, uint256 reported) internal returns (FakePool p) {
        p = new FakePool();
        btc.mint(address(p), 10_000 * DEC8);
        eurc.mint(address(p), 10_000 * DEC6);
        p.configure(pullIn, sendOut, reported);
    }

    function _donate(uint256 e, uint256 b) internal {
        eurc.mint(address(router), e);
        btc.mint(address(router), b);
    }

    function _run(
        bool dl,
        address p,
        MockERC20 tin,
        MockERC20 tout,
        uint256 amountIn,
        uint256 minOut,
        address t,
        uint256 feeBps
    ) internal returns (uint256) {
        vm.prank(user);
        if (dl) {
            return router.swapWithFeeAndDeadline(
                p, address(tin), address(tout), amountIn, minOut, t, feeBps, block.timestamp
            );
        }
        return router.swapWithFee(p, address(tin), address(tout), amountIn, minOut, t, feeBps);
    }

    function _runEurcBtc(bool dl, address p, uint256 minOut, address t) internal returns (uint256) {
        return _run(dl, p, eurc, btc, AMT, minOut, t, 100);
    }

    function _assertNoAllowance(address p) internal view {
        assertEq(eurc.allowance(address(router), p), 0, "eurc allowance");
        assertEq(btc.allowance(address(router), p), 0, "btc allowance");
    }

    // ── allowance hygiene ─────────────────────────────────────────────────────

    function _allowanceZeroHonest(bool dl) internal {
        address p = dl ? address(pool) : address(legacyPool);
        _run(dl, p, eurc, btc, 10_000 * DEC6, 0, treasury, 25);
        _assertNoAllowance(p);
        _assertRouterEmpty();
    }

    function test_Allowance_ZeroAfterHonestSwap_Deadline() public {
        _allowanceZeroHonest(true);
    }

    function test_Allowance_ZeroAfterHonestSwap_Legacy() public {
        _allowanceZeroHonest(false);
    }

    function _allowanceExactDuring(bool dl) internal {
        FakePool p = _fake(ALL, OUT, OUT);
        _runEurcBtc(dl, address(p), 0, treasury);
        assertEq(p.allowanceDuring(), NET, "pool saw exactly netAmountIn allowance");
        assertEq(p.lastAmountIn(), NET);
        _assertNoAllowance(address(p));
    }

    function test_Allowance_ExactNetDuringSwap_Deadline() public {
        _allowanceExactDuring(true);
    }

    function test_Allowance_ExactNetDuringSwap_Legacy() public {
        _allowanceExactDuring(false);
    }

    function _staleAllowanceCleared(bool dl) internal {
        FakePool p = _fake(ALL, OUT, OUT);
        vm.prank(address(router));
        eurc.approve(address(p), type(uint256).max); // stale standing approval
        _runEurcBtc(dl, address(p), 0, treasury);
        assertEq(p.allowanceDuring(), NET, "stale allowance replaced by exact net");
        _assertNoAllowance(address(p));
    }

    function test_Allowance_StaleMaxApprovalReplaced_Deadline() public {
        _staleAllowanceCleared(true);
    }

    function test_Allowance_StaleMaxApprovalReplaced_Legacy() public {
        _staleAllowanceCleared(false);
    }

    function _resetToken() internal returns (ResetToken rt) {
        rt = new ResetToken();
        rt.mint(user, 1_000_000 * DEC6);
        vm.prank(user);
        rt.approve(address(router), type(uint256).max);
    }

    function test_ResetToken_RejectsNonZeroToNonZeroApprove_Sanity() public {
        ResetToken rt = _resetToken();
        vm.startPrank(address(router));
        rt.approve(alice, 5);
        vm.expectRevert("reset first");
        rt.approve(alice, 6);
        vm.stopPrank();
    }

    function _resetTokenStale(bool dl, bool seedStale) internal {
        ResetToken rt = _resetToken();
        FakePool p = _fake(ALL, OUT, OUT);
        if (seedStale) {
            vm.prank(address(router));
            rt.approve(address(p), 7);
        }
        _run(dl, address(p), rt, btc, AMT, 0, treasury, 100);
        assertEq(p.allowanceDuring(), NET);
        assertEq(rt.allowance(address(router), address(p)), 0);
        assertEq(rt.balanceOf(address(router)), 0);
        assertEq(btc.balanceOf(user), 100 * DEC8 + OUT);
    }

    function test_ResetToken_StaleAllowanceZeroedBeforeApprove_Deadline() public {
        _resetTokenStale(true, true);
    }

    function test_ResetToken_StaleAllowanceZeroedBeforeApprove_Legacy() public {
        _resetTokenStale(false, true);
    }

    function test_ResetToken_NoStale_Deadline() public {
        _resetTokenStale(true, false);
    }

    function test_ResetToken_NoStale_Legacy() public {
        _resetTokenStale(false, false);
    }

    function test_ResetToken_PartialConsumption_ThenSecondSwapWorks() public {
        ResetToken rt = _resetToken();
        FakePool p = _fake(100 * DEC6, OUT, OUT);
        _run(true, address(p), rt, btc, AMT, 0, treasury, 100);
        assertEq(rt.allowance(address(router), address(p)), 0, "leftover allowance revoked");
        _run(false, address(p), rt, btc, AMT, 0, treasury, 100);
        assertEq(rt.allowance(address(router), address(p)), 0);
        assertEq(rt.balanceOf(address(router)), 0);
    }

    function _pullAfterCall(bool dl) internal {
        _donate(500 * DEC6, 50 * DEC8);
        FakePool p = _fake(100 * DEC6, OUT, OUT); // consumes only part of net -> leftover would be exploitable
        _runEurcBtc(dl, address(p), 0, treasury);
        vm.expectRevert();
        p.pull(address(eurc), address(router), 1);
        vm.expectRevert();
        p.pull(address(btc), address(router), 1);
        assertEq(eurc.balanceOf(address(router)), 500 * DEC6);
        assertEq(btc.balanceOf(address(router)), 50 * DEC8);
    }

    function test_MaliciousPool_CannotPullRouterTokensAfterCall_Deadline() public {
        _pullAfterCall(true);
    }

    function test_MaliciousPool_CannotPullRouterTokensAfterCall_Legacy() public {
        _pullAfterCall(false);
    }

    function _pullMoreThanNet(bool dl) internal {
        _donate(500 * DEC6, 0);
        FakePool p = _fake(NET + 1, OUT, OUT);
        vm.expectRevert(abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(p), NET, NET + 1));
        _runEurcBtc(dl, address(p), 0, treasury);
        assertEq(eurc.balanceOf(address(router)), 500 * DEC6, "donation untouched");
    }

    function test_MaliciousPool_CannotPullBeyondNetDuringCall_Deadline() public {
        _pullMoreThanNet(true);
    }

    function test_MaliciousPool_CannotPullBeyondNetDuringCall_Legacy() public {
        _pullMoreThanNet(false);
    }

    // ── fabricated amountOut / drain attempts ─────────────────────────────────

    function _fabricatedRevertsWithMinOut(bool dl) internal {
        _donate(500 * DEC6, 50 * DEC8);
        FakePool p = _fake(ALL, 0, type(uint256).max / 2);
        uint256 uB = btc.balanceOf(user);
        vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
        _runEurcBtc(dl, address(p), 1, treasury);
        assertEq(btc.balanceOf(address(router)), 50 * DEC8, "donated tokenOut intact");
        assertEq(btc.balanceOf(user), uB);
    }

    function test_FabricatedAmountOut_CannotDrainDonatedTokenOut_Deadline() public {
        _fabricatedRevertsWithMinOut(true);
    }

    function test_FabricatedAmountOut_CannotDrainDonatedTokenOut_Legacy() public {
        _fabricatedRevertsWithMinOut(false);
    }

    /// @dev With minOut == 0 the caller accepts zero output: no revert, but nothing is drained either.
    function _fabricatedZeroMinOutNoDrain(bool dl) internal {
        _donate(500 * DEC6, 50 * DEC8);
        FakePool p = _fake(ALL, 0, type(uint256).max / 2);
        uint256 uB = btc.balanceOf(user);
        uint256 out = _runEurcBtc(dl, address(p), 0, treasury);
        assertEq(out, 0, "returned amountOut is measured delta, not fabricated value");
        assertEq(btc.balanceOf(user), uB, "user got nothing from donated balance");
        assertEq(btc.balanceOf(address(router)), 50 * DEC8);
        assertEq(eurc.balanceOf(address(router)), 500 * DEC6);
    }

    function test_FabricatedAmountOut_ZeroMinOut_NoDrain_Deadline() public {
        _fabricatedZeroMinOutNoDrain(true);
    }

    function test_FabricatedAmountOut_ZeroMinOut_NoDrain_Legacy() public {
        _fabricatedZeroMinOutNoDrain(false);
    }

    function _fabricatedCannotDrainTokenIn(bool dl) internal {
        _donate(500 * DEC6, 50 * DEC8);
        FakePool p = _fake(0, OUT, type(uint256).max); // consumes nothing, delivers OUT, lies about amount
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);
        uint256 out = _runEurcBtc(dl, address(p), 0, treasury);
        assertEq(out, OUT);
        assertEq(btc.balanceOf(user), uB + OUT);
        assertEq(eurc.balanceOf(user), uE - FEE, "only fee lost; unspent net refunded, nothing extra");
        assertEq(eurc.balanceOf(address(router)), 500 * DEC6, "donated tokenIn intact");
        assertEq(btc.balanceOf(address(router)), 50 * DEC8, "donated tokenOut intact");
        assertEq(eurc.balanceOf(treasury), FEE);
    }

    function test_FabricatedAmountOut_CannotDrainDonatedTokenIn_Deadline() public {
        _fabricatedCannotDrainTokenIn(true);
    }

    function test_FabricatedAmountOut_CannotDrainDonatedTokenIn_Legacy() public {
        _fabricatedCannotDrainTokenIn(false);
    }

    function _balanceDecrease(bool dl) internal {
        ShrinkToken sht = new ShrinkToken();
        sht.mint(address(router), 10 * DEC8);
        FakePool p = _fake(ALL, 0, 1);
        sht.mint(address(p), 100 * DEC8);
        p.setBurn(3 * DEC8);
        vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
        _run(dl, address(p), eurc, sht, AMT, 0, treasury, 100);
        assertEq(sht.balanceOf(address(router)), 10 * DEC8);
    }

    function test_TokenOutBalanceDecrease_Reverts_Deadline() public {
        _balanceDecrease(true);
    }

    function test_TokenOutBalanceDecrease_Reverts_Legacy() public {
        _balanceDecrease(false);
    }

    // ── pool under-delivers vs reports ────────────────────────────────────────

    function _reportsLessThanDelivered(bool dl) internal {
        FakePool p = _fake(ALL, 10, 5);
        vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
        _runEurcBtc(dl, address(p), 0, treasury);
    }

    function test_PoolReportsLessThanDelivered_Reverts_Deadline() public {
        _reportsLessThanDelivered(true);
    }

    function test_PoolReportsLessThanDelivered_Reverts_Legacy() public {
        _reportsLessThanDelivered(false);
    }

    function _underDeliversVsReported(bool dl) internal {
        FakePool p = _fake(ALL, 40, 100);
        vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
        _runEurcBtc(dl, address(p), 50, treasury); // reported 100 >= 50 but measured 40 < 50
        uint256 uB = btc.balanceOf(user);
        uint256 out = _runEurcBtc(dl, address(p), 40, treasury);
        assertEq(out, 40);
        assertEq(btc.balanceOf(user), uB + 40, "user gets measured delta, not reported");
    }

    function test_PoolUnderDeliversVsReported_Deadline() public {
        _underDeliversVsReported(true);
    }

    function test_PoolUnderDeliversVsReported_Legacy() public {
        _underDeliversVsReported(false);
    }

    // ── fuzz ──────────────────────────────────────────────────────────────────

    function testFuzz_Swap_ConservesFundsAndRouterRetainsNothing(uint256 amountIn, uint256 feeBps, bool aToB) public {
        feeBps = bound(feeBps, 0, 500);
        amountIn = aToB ? bound(amountIn, 10_000, 500_000 * DEC6) : bound(amountIn, 100, 3 * DEC8);
        uint256 fee = (amountIn * feeBps) / 10000;
        uint256 expOut = _quote(amountIn - fee, aToB);
        vm.assume(expOut > 0);
        _fuzzSwapAndCheck(aToB ? eurc : btc, aToB ? btc : eurc, amountIn, feeBps, fee, expOut);
    }

    function _fuzzSwapAndCheck(
        MockERC20 tin,
        MockERC20 tout,
        uint256 amountIn,
        uint256 feeBps,
        uint256 fee,
        uint256 expOut
    ) internal {
        uint256[4] memory b = [
            tin.balanceOf(user),
            tout.balanceOf(user),
            tin.balanceOf(address(pool)),
            tout.balanceOf(address(pool))
        ];
        vm.prank(user);
        uint256 out = router.swapWithFeeAndDeadline(
            address(pool), address(tin), address(tout), amountIn, expOut, treasury, feeBps, block.timestamp
        );

        assertEq(out, expOut);
        assertEq(tin.balanceOf(user), b[0] - amountIn);
        assertEq(tout.balanceOf(user), b[1] + expOut);
        assertEq(tin.balanceOf(treasury), fee);
        assertEq(tout.balanceOf(treasury), 0);
        assertEq(tin.balanceOf(address(pool)), b[2] + amountIn - fee);
        assertEq(tout.balanceOf(address(pool)), b[3] - expOut);
        _assertRouterEmpty();
    }

    // ── partial consumption / refund ──────────────────────────────────────────

    function _partialRefund(bool dl) internal {
        _donate(77 * DEC6, 9 * DEC8);
        uint256 pulled = 400 * DEC6;
        FakePool p = _fake(pulled, OUT, OUT);
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);
        uint256 pE = eurc.balanceOf(address(p));

        uint256 out = _runEurcBtc(dl, address(p), 0, treasury);

        assertEq(out, OUT);
        assertEq(eurc.balanceOf(user), uE - FEE - pulled, "user bears fee + consumed amount only");
        assertEq(btc.balanceOf(user), uB + OUT);
        assertEq(eurc.balanceOf(address(p)), pE + pulled);
        assertEq(eurc.balanceOf(treasury), FEE);
        assertEq(eurc.balanceOf(address(router)), 77 * DEC6, "donated tokenIn stays");
        assertEq(btc.balanceOf(address(router)), 9 * DEC8, "donated tokenOut stays");
        _assertNoAllowance(address(p));
    }

    function test_PartialConsumption_ExactRemainderRefunded_Deadline() public {
        _partialRefund(true);
    }

    function test_PartialConsumption_ExactRemainderRefunded_Legacy() public {
        _partialRefund(false);
    }

    function _noConsumption(bool dl) internal {
        _donate(77 * DEC6, 0);
        FakePool p = _fake(0, OUT, OUT);
        uint256 uE = eurc.balanceOf(user);
        _runEurcBtc(dl, address(p), 0, treasury);
        assertEq(eurc.balanceOf(user), uE - FEE, "full net refunded");
        assertEq(eurc.balanceOf(address(router)), 77 * DEC6);
    }

    function test_ZeroConsumption_FullNetRefunded_Deadline() public {
        _noConsumption(true);
    }

    function test_ZeroConsumption_FullNetRefunded_Legacy() public {
        _noConsumption(false);
    }

    // ── treasury == router ────────────────────────────────────────────────────

    /// @dev treasury == router with a charged fee (feeBps > 0) now reverts before any transfer.
    function _treasuryIsRouterReverts(bool dl) internal {
        _donate(77 * DEC6, 9 * DEC8);
        FakePool p = _fake(400 * DEC6, OUT, OUT);
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);
        uint256 pE = eurc.balanceOf(address(p));
        vm.expectRevert(ArcisSwapRouter.TreasuryIsRouter.selector);
        _runEurcBtc(dl, address(p), 0, address(router));
        assertEq(p.calls(), 0, "pool never called");
        assertEq(eurc.balanceOf(user), uE, "no funds pulled");
        assertEq(btc.balanceOf(user), uB);
        assertEq(eurc.balanceOf(address(p)), pE);
        assertEq(eurc.balanceOf(address(router)), 77 * DEC6, "donation untouched");
        assertEq(btc.balanceOf(address(router)), 9 * DEC8);
        _assertNoAllowance(address(p));
    }

    function test_TreasuryIsRouter_Reverts_Deadline() public {
        _treasuryIsRouterReverts(true);
    }

    function test_TreasuryIsRouter_Reverts_Legacy() public {
        _treasuryIsRouterReverts(false);
    }

    function _treasuryIsRouterHonestPoolReverts(bool dl) internal {
        _donate(33 * DEC6, 4 * DEC8);
        address p = dl ? address(pool) : address(legacyPool);
        uint256 uE = eurc.balanceOf(user);
        vm.expectRevert(ArcisSwapRouter.TreasuryIsRouter.selector);
        _runEurcBtc(dl, p, 0, address(router));
        assertEq(eurc.balanceOf(user), uE);
        assertEq(eurc.balanceOf(address(router)), 33 * DEC6);
        assertEq(btc.balanceOf(address(router)), 4 * DEC8);
    }

    function test_TreasuryIsRouter_RealPool_Reverts_Deadline() public {
        _treasuryIsRouterHonestPoolReverts(true);
    }

    function test_TreasuryIsRouter_RealPool_Reverts_Legacy() public {
        _treasuryIsRouterHonestPoolReverts(false);
    }

    /// @dev The check precedes every transfer: a caller with no balance/allowance sees TreasuryIsRouter, not TransferFailed.
    function _treasuryIsRouterBeforeTransfer(bool dl) internal {
        address stranger = makeAddr("stranger");
        vm.startPrank(stranger);
        vm.expectRevert(ArcisSwapRouter.TreasuryIsRouter.selector);
        if (dl) {
            router.swapWithFeeAndDeadline(
                address(pool), address(eurc), address(btc), AMT, 0, address(router), 1, block.timestamp
            );
        } else {
            router.swapWithFee(address(legacyPool), address(eurc), address(btc), AMT, 0, address(router), 1);
        }
        vm.stopPrank();
    }

    function test_TreasuryIsRouter_BeforeAnyTransfer_Deadline() public {
        _treasuryIsRouterBeforeTransfer(true);
    }

    function test_TreasuryIsRouter_BeforeAnyTransfer_Legacy() public {
        _treasuryIsRouterBeforeTransfer(false);
    }

    function test_TreasuryIsRouter_ValidationOrdering() public {
        vm.startPrank(user);
        // FeeTooHigh and SameToken come first; deadline is first on the deadline entry point
        vm.expectRevert(ArcisSwapRouter.FeeTooHigh.selector);
        router.swapWithFee(address(pool), address(eurc), address(btc), AMT, 0, address(router), 501);
        vm.expectRevert(ArcisSwapRouter.SameToken.selector);
        router.swapWithFee(address(pool), address(eurc), address(eurc), AMT, 0, address(router), 100);
        vm.expectRevert(ArcisSwapRouter.DeadlineExpired.selector);
        router.swapWithFeeAndDeadline(
            address(pool), address(eurc), address(btc), AMT, 0, address(router), 100, block.timestamp - 1
        );
        vm.stopPrank();
    }

    /// @dev treasury == router with feeBps == 0 charges no fee and still works.
    function _treasuryIsRouterZeroFeeWorks(bool dl) internal {
        _donate(33 * DEC6, 4 * DEC8);
        address p = dl ? address(pool) : address(legacyPool);
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);
        uint256 out = _run(dl, p, eurc, btc, AMT, 0, address(router), 0);
        assertGt(out, 0);
        assertEq(eurc.balanceOf(user), uE - AMT);
        assertEq(btc.balanceOf(user), uB + out);
        assertEq(eurc.balanceOf(address(router)), 33 * DEC6, "no fee retained");
        assertEq(btc.balanceOf(address(router)), 4 * DEC8);
        _assertNoAllowance(p);
    }

    function test_TreasuryIsRouter_ZeroFee_Works_Deadline() public {
        _treasuryIsRouterZeroFeeWorks(true);
    }

    function test_TreasuryIsRouter_ZeroFee_Works_Legacy() public {
        _treasuryIsRouterZeroFeeWorks(false);
    }

    function test_TreasuryIsRouter_ZeroFee_EmitsZeroFeeAndRouterTreasury() public {
        uint256 expOut = _quote(AMT, true);
        vm.expectEmit(true, true, false, true, address(router));
        emit ArcisSwapRouter.SwapWithFee(user, address(pool), address(eurc), address(btc), AMT, expOut, 0, address(router));
        assertEq(_run(true, address(pool), eurc, btc, AMT, expOut, address(router), 0), expOut);
    }

    /// @dev treasury == 0 with feeBps > 0 charges no fee (unchanged behaviour).
    function _treasuryZeroWorks(bool dl) internal {
        address p = dl ? address(pool) : address(legacyPool);
        uint256 uE = eurc.balanceOf(user);
        uint256 out = _run(dl, p, eurc, btc, AMT, 0, address(0), 500);
        assertGt(out, 0);
        assertEq(eurc.balanceOf(user), uE - AMT);
        _assertRouterEmpty();
    }

    function test_TreasuryZero_FeeBpsPositive_Works_Deadline() public {
        _treasuryZeroWorks(true);
    }

    function test_TreasuryZero_FeeBpsPositive_Works_Legacy() public {
        _treasuryZeroWorks(false);
    }

    // ── SameToken ─────────────────────────────────────────────────────────────

    function _sameToken(bool dl) internal {
        uint256 uE = eurc.balanceOf(user);
        vm.expectRevert(ArcisSwapRouter.SameToken.selector);
        _run(dl, address(pool), eurc, eurc, AMT, 0, treasury, 25);
        assertEq(eurc.balanceOf(user), uE, "no transfer happened");
        assertEq(eurc.balanceOf(treasury), 0);
        _assertRouterEmpty();
    }

    function test_SameToken_Reverts_Deadline() public {
        _sameToken(true);
    }

    function test_SameToken_Reverts_Legacy() public {
        _sameToken(false);
    }

    function test_SameToken_Ordering() public {
        // zero checks come first
        vm.startPrank(user);
        vm.expectRevert(ArcisSwapRouter.ZeroAddress.selector);
        router.swapWithFee(address(pool), address(0), address(0), AMT, 0, treasury, 0);
        vm.expectRevert(ArcisSwapRouter.ZeroAddress.selector);
        router.swapWithFeeAndDeadline(address(pool), address(0), address(0), AMT, 0, treasury, 0, block.timestamp);
        vm.expectRevert(ArcisSwapRouter.ZeroAmount.selector);
        router.swapWithFee(address(pool), address(eurc), address(eurc), 0, 0, treasury, 0);
        vm.expectRevert(ArcisSwapRouter.ZeroAmount.selector);
        router.swapWithFeeAndDeadline(address(pool), address(eurc), address(eurc), 0, 0, treasury, 0, block.timestamp);
        // SameToken precedes the fee check
        vm.expectRevert(ArcisSwapRouter.SameToken.selector);
        router.swapWithFee(address(pool), address(eurc), address(eurc), AMT, 0, treasury, 9999);
        vm.expectRevert(ArcisSwapRouter.SameToken.selector);
        router.swapWithFeeAndDeadline(address(pool), address(eurc), address(eurc), AMT, 0, treasury, 9999, block.timestamp);
        // deadline is still checked first on the deadline entry point
        vm.expectRevert(ArcisSwapRouter.DeadlineExpired.selector);
        router.swapWithFeeAndDeadline(address(pool), address(eurc), address(eurc), AMT, 0, treasury, 0, block.timestamp - 1);
        vm.stopPrank();
    }

    // ── preservation / events ─────────────────────────────────────────────────

    function _preservesDonations(bool dl) internal {
        _donate(33 * DEC6, 4 * DEC8);
        address p = dl ? address(pool) : address(legacyPool);
        uint256 out = _run(dl, p, eurc, btc, 10_000 * DEC6, 0, treasury, 25);
        assertGt(out, 0);
        assertEq(btc.balanceOf(address(router)), 4 * DEC8, "pre-existing tokenOut preserved");
        assertEq(eurc.balanceOf(address(router)), 33 * DEC6, "pre-existing tokenIn preserved");
    }

    function test_PreexistingRouterBalances_Preserved_Deadline() public {
        _preservesDonations(true);
    }

    function test_PreexistingRouterBalances_Preserved_Legacy() public {
        _preservesDonations(false);
    }

    function _eventIsMeasuredDelta(bool dl) internal {
        _donate(0, 9 * DEC8);
        FakePool p = _fake(ALL, OUT, 9 * DEC8); // reports more than it delivered
        vm.expectEmit(true, true, false, true, address(router));
        emit ArcisSwapRouter.SwapWithFee(user, address(p), address(eurc), address(btc), AMT, OUT, FEE, treasury);
        uint256 out = _runEurcBtc(dl, address(p), 0, treasury);
        assertEq(out, OUT);
    }

    function test_EventAmountOutEqualsMeasuredDelta_Deadline() public {
        _eventIsMeasuredDelta(true);
    }

    function test_EventAmountOutEqualsMeasuredDelta_Legacy() public {
        _eventIsMeasuredDelta(false);
    }

    // ── hardening fuzz ────────────────────────────────────────────────────────

    function testFuzz_RouterConservation_HonestPool(
        uint256 amountIn,
        uint256 feeBps,
        uint256 donE,
        uint256 donB,
        bool dl
    ) public {
        amountIn = bound(amountIn, 10_000, 500_000 * DEC6);
        feeBps = bound(feeBps, 0, 500);
        donE = bound(donE, 0, 1e12);
        donB = bound(donB, 0, 1e12);
        _donate(donE, donB);
        address p = dl ? address(pool) : address(legacyPool);
        _run(dl, p, eurc, btc, amountIn, 0, treasury, feeBps);
        assertEq(eurc.balanceOf(address(router)), donE, "router tokenIn conserved");
        assertEq(btc.balanceOf(address(router)), donB, "router tokenOut conserved");
        _assertNoAllowance(p);
    }

    function testFuzz_TreasuryIsRouter_ChargedFee_RevertsAndConserves(
        uint256 amountIn,
        uint256 feeBps,
        uint256 donE,
        bool dl
    ) public {
        amountIn = bound(amountIn, 1, 500_000 * DEC6);
        feeBps = bound(feeBps, 1, 500);
        donE = bound(donE, 0, 1e12);
        _donate(donE, 0);
        address p = dl ? address(pool) : address(legacyPool);
        uint256 uE = eurc.balanceOf(user);
        vm.expectRevert(ArcisSwapRouter.TreasuryIsRouter.selector);
        _run(dl, p, eurc, btc, amountIn, 0, address(router), feeBps);
        assertEq(eurc.balanceOf(user), uE);
        assertEq(eurc.balanceOf(address(router)), donE);
        assertEq(btc.balanceOf(address(router)), 0);
    }

    function testFuzz_RouterConservation_TreasuryIsRouter_ZeroFee(uint256 amountIn, uint256 donE, bool dl) public {
        amountIn = bound(amountIn, 10_000, 500_000 * DEC6);
        donE = bound(donE, 0, 1e12);
        _donate(donE, 0);
        address p = dl ? address(pool) : address(legacyPool);
        uint256 uE = eurc.balanceOf(user);
        _run(dl, p, eurc, btc, amountIn, 0, address(router), 0);
        assertEq(eurc.balanceOf(user), uE - amountIn);
        assertEq(eurc.balanceOf(address(router)), donE, "no fee retained");
        assertEq(btc.balanceOf(address(router)), 0);
    }

    struct PartialCfg {
        uint256 amountIn;
        uint256 feeBps;
        uint256 pulled;
        uint256 sendOut;
        uint256 donE;
        uint256 donB;
        bool toRouter;
        bool dl;
    }

    function testFuzz_PartialConsumption_Conservation(
        uint256 amountIn,
        uint256 feeBps,
        uint256 pulled,
        uint256 sendOut,
        uint256 donE,
        uint256 donB,
        bool toRouter,
        bool dl
    ) public {
        PartialCfg memory c;
        c.amountIn = bound(amountIn, 1, 1e12);
        // treasury == router is only valid with no charged fee (feeBps > 0 reverts, tested separately)
        c.feeBps = toRouter ? 0 : bound(feeBps, 0, 500);
        c.donE = bound(donE, 0, 1e12);
        c.donB = bound(donB, 0, 1e12);
        c.sendOut = bound(sendOut, 0, 1e12);
        c.pulled = bound(pulled, 0, c.amountIn - (c.amountIn * c.feeBps) / 10000);
        c.toRouter = toRouter;
        c.dl = dl;
        _partialFuzz(c);
    }

    function _partialFuzz(PartialCfg memory c) internal {
        uint256 fee = (c.amountIn * c.feeBps) / 10000;
        _donate(c.donE, c.donB);
        FakePool p = _fake(c.pulled, c.sendOut, c.sendOut);
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);

        uint256 out = _run(
            c.dl, address(p), eurc, btc, c.amountIn, 0, c.toRouter ? address(router) : treasury, c.feeBps
        );

        assertEq(out, c.sendOut);
        assertEq(eurc.balanceOf(user), uE - fee - c.pulled, "user pays fee + consumed only");
        assertEq(btc.balanceOf(user), uB + c.sendOut);
        assertEq(eurc.balanceOf(address(router)), c.donE, "router retains only its donation");
        assertEq(eurc.balanceOf(treasury), c.toRouter ? 0 : fee);
        assertEq(btc.balanceOf(address(router)), c.donB);
        _assertNoAllowance(address(p));
    }

    function testFuzz_FabricatedReport_NeverDrainsRouter(uint256 reportedOut, uint256 donE, uint256 donB, uint256 minOut, bool dl)
        public
    {
        donE = bound(donE, 0, 1e12);
        donB = bound(donB, 0, 1e12);
        minOut = bound(minOut, 1, 1e12);
        _donate(donE, donB);
        FakePool p = _fake(ALL, 0, reportedOut); // delivers nothing, claims anything
        vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
        _runEurcBtc(dl, address(p), minOut, treasury);
        assertEq(eurc.balanceOf(address(router)), donE);
        assertEq(btc.balanceOf(address(router)), donB);
    }

    function testFuzz_DeadlineSemantics(uint256 deadline) public {
        if (block.timestamp > deadline) {
            vm.expectRevert(ArcisSwapRouter.DeadlineExpired.selector);
            _swap(1_000 * DEC6, 0, treasury, 25, deadline);
        } else {
            assertGt(_swap(1_000 * DEC6, 0, treasury, 25, deadline), 0);
        }
    }

    // ── taxed (fee-on-transfer) INPUT token ───────────────────────────────────

    uint256 internal constant DON_TAX = 50 * DEC6;

    /// @dev Taxed input token: every transfer INTO the router loses `bps` (+ optional bonus). Router holds a donation.
    function _taxIn(uint256 bps, uint256 bonus) internal returns (TaxToken t) {
        t = new TaxToken();
        t.mint(user, 1_000_000 * DEC6);
        t.mint(address(router), DON_TAX);
        vm.prank(user);
        t.approve(address(router), type(uint256).max);
        t.configure(address(router), bps, bonus);
    }

    function _assertTaxInNothingMoved(TaxToken t, FakePool p, uint256 uT, uint256 uB) internal view {
        assertEq(t.balanceOf(user), uT, "user input untouched");
        assertEq(btc.balanceOf(user), uB, "user output untouched");
        assertEq(t.balanceOf(address(router)), DON_TAX, "donated balance untouched");
        assertEq(t.balanceOf(treasury), 0, "no fee forwarded");
        assertEq(t.balanceOf(address(p)), 0, "pool received nothing");
        assertEq(p.calls(), 0, "pool never called");
        assertEq(t.allowance(address(router), address(p)), 0, "no approval granted");
    }

    function _taxedInputReverts(bool dl, uint256 bps, uint256 bonus, uint256 feeBps, address tsy) internal {
        TaxToken t = _taxIn(bps, bonus);
        FakePool p = _fake(ALL, OUT, OUT);
        uint256 uT = t.balanceOf(user);
        uint256 uB = btc.balanceOf(user);
        vm.expectRevert(ArcisSwapRouter.UnsupportedToken.selector);
        _run(dl, address(p), t, btc, AMT, 0, tsy, feeBps);
        _assertTaxInNothingMoved(t, p, uT, uB);
    }

    function test_TaxedInput_Reverts_UnsupportedToken_Deadline() public {
        _taxedInputReverts(true, 1000, 0, 100, treasury);
    }

    function test_TaxedInput_Reverts_UnsupportedToken_Legacy() public {
        _taxedInputReverts(false, 1000, 0, 100, treasury);
    }

    function test_TaxedInput_OneBpsTax_Reverts_Deadline() public {
        _taxedInputReverts(true, 1, 0, 100, treasury);
    }

    function test_TaxedInput_OneBpsTax_Reverts_Legacy() public {
        _taxedInputReverts(false, 1, 0, 100, treasury);
    }

    function test_TaxedInput_NoFee_StillReverts_Deadline() public {
        _taxedInputReverts(true, 500, 0, 0, address(0));
    }

    function test_TaxedInput_NoFee_StillReverts_Legacy() public {
        _taxedInputReverts(false, 500, 0, 0, address(0));
    }

    /// @dev A token that credits MORE than amountIn is rejected too (delta must be exact).
    function test_TaxedInput_BonusCredit_Reverts_Deadline() public {
        _taxedInputReverts(true, 0, 3, 100, treasury);
    }

    function test_TaxedInput_BonusCredit_Reverts_Legacy() public {
        _taxedInputReverts(false, 0, 3, 100, treasury);
    }

    /// @dev Zero-tax configuration of the same token works: the check is on the measured delta, not the token type.
    function _zeroTaxInputWorks(bool dl) internal {
        TaxToken t = _taxIn(0, 0);
        FakePool p = _fake(ALL, OUT, OUT);
        uint256 uT = t.balanceOf(user);
        uint256 out = _run(dl, address(p), t, btc, AMT, 0, treasury, 100);
        assertEq(out, OUT);
        assertEq(t.balanceOf(user), uT - AMT);
        assertEq(t.balanceOf(treasury), FEE);
        assertEq(t.balanceOf(address(router)), DON_TAX);
    }

    function test_ZeroTaxInput_Works_Deadline() public {
        _zeroTaxInputWorks(true);
    }

    function test_ZeroTaxInput_Works_Legacy() public {
        _zeroTaxInputWorks(false);
    }

    function testFuzz_TaxedInput_AlwaysReverts(uint256 bps, uint256 amountIn, uint256 feeBps, bool dl) public {
        bps = bound(bps, 1, 10_000);
        amountIn = bound(amountIn, 10_000, 1_000_000 * DEC6);
        feeBps = bound(feeBps, 0, 500);
        TaxToken t = _taxIn(bps, 0);
        FakePool p = _fake(ALL, OUT, OUT);
        uint256 uT = t.balanceOf(user);
        vm.expectRevert(ArcisSwapRouter.UnsupportedToken.selector);
        _run(dl, address(p), t, btc, amountIn, 0, treasury, feeBps);
        assertEq(t.balanceOf(user), uT);
        assertEq(t.balanceOf(address(router)), DON_TAX);
        assertEq(t.balanceOf(treasury), 0);
    }

    // ── taxed (fee-on-transfer) OUTPUT token ──────────────────────────────────

    uint256 internal constant TAX_OUT_BPS = 1000; // 10%
    uint256 internal constant RECEIVED = OUT - (OUT * TAX_OUT_BPS) / 10000; // 4.5e8

    /// @dev Output token taxes transfers into `user`; the pool-to-router leg is untaxed, so only the payout leg shrinks.
    function _taxOut(uint256 bps) internal returns (TaxToken t, FakePool p) {
        t = new TaxToken();
        t.configure(user, bps, 0);
        p = _fake(ALL, OUT, OUT);
        t.mint(address(p), 10_000 * DEC6);
        t.mint(address(router), 9 * DEC6); // donation
    }

    function _taxedOutputBelowMinOutReverts(bool dl, uint256 minOut) internal {
        (TaxToken t, FakePool p) = _taxOut(TAX_OUT_BPS);
        uint256 uE = eurc.balanceOf(user);
        uint256 uT = t.balanceOf(user);
        vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
        _run(dl, address(p), eurc, t, AMT, minOut, treasury, 100);
        assertEq(eurc.balanceOf(user), uE, "state rolled back");
        assertEq(t.balanceOf(user), uT);
        assertEq(eurc.balanceOf(treasury), 0, "fee transfer rolled back");
        assertEq(eurc.balanceOf(address(router)), 0);
        assertEq(t.balanceOf(address(router)), 9 * DEC6, "donation untouched");
    }

    /// @dev minOut equals the pre-tax payout the pool delivered to the router: the user would get 10% less.
    function test_TaxedOutput_MinOutAbovePostTax_Reverts_Deadline() public {
        _taxedOutputBelowMinOutReverts(true, OUT);
    }

    function test_TaxedOutput_MinOutAbovePostTax_Reverts_Legacy() public {
        _taxedOutputBelowMinOutReverts(false, OUT);
    }

    function test_TaxedOutput_MinOutOneAboveReceived_Reverts_Deadline() public {
        _taxedOutputBelowMinOutReverts(true, RECEIVED + 1);
    }

    function test_TaxedOutput_MinOutOneAboveReceived_Reverts_Legacy() public {
        _taxedOutputBelowMinOutReverts(false, RECEIVED + 1);
    }

    function _taxedOutputSucceeds(bool dl, uint256 minOut) internal {
        (TaxToken t, FakePool p) = _taxOut(TAX_OUT_BPS);
        uint256 uT = t.balanceOf(user);
        uint256 uE = eurc.balanceOf(user);

        vm.expectEmit(true, true, false, true, address(router));
        emit ArcisSwapRouter.SwapWithFee(user, address(p), address(eurc), address(t), AMT, RECEIVED, FEE, treasury);
        uint256 out = _run(dl, address(p), eurc, t, AMT, minOut, treasury, 100);

        assertEq(out, RECEIVED, "returned amountOut == user's measured received amount");
        assertEq(t.balanceOf(user) - uT, RECEIVED, "user actually received it");
        assertLt(RECEIVED, OUT);
        assertEq(eurc.balanceOf(user), uE - AMT);
        assertEq(eurc.balanceOf(treasury), FEE);
        assertEq(eurc.balanceOf(address(router)), 0);
        assertEq(t.balanceOf(address(router)), 9 * DEC6, "donation untouched; router retains none of the payout");
        assertEq(t.balanceOf(treasury), 0);
    }

    function test_TaxedOutput_MinOutExactlyReceived_Succeeds_Deadline() public {
        _taxedOutputSucceeds(true, RECEIVED);
    }

    function test_TaxedOutput_MinOutExactlyReceived_Succeeds_Legacy() public {
        _taxedOutputSucceeds(false, RECEIVED);
    }

    function test_TaxedOutput_MinOutBelowPostTax_Succeeds_Deadline() public {
        _taxedOutputSucceeds(true, RECEIVED / 2);
    }

    function test_TaxedOutput_MinOutBelowPostTax_Succeeds_Legacy() public {
        _taxedOutputSucceeds(false, RECEIVED / 2);
    }

    function test_TaxedOutput_MinOutZero_ReportsExactReceived_Deadline() public {
        _taxedOutputSucceeds(true, 0);
    }

    function test_TaxedOutput_MinOutZero_ReportsExactReceived_Legacy() public {
        _taxedOutputSucceeds(false, 0);
    }

    function _fullTaxOutput(bool dl) internal {
        (TaxToken t, FakePool p) = _taxOut(10_000); // user receives nothing
        uint256 uT = t.balanceOf(user);
        vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
        _run(dl, address(p), eurc, t, AMT, 1, treasury, 100);
        assertEq(t.balanceOf(user), uT);
        assertEq(_run(dl, address(p), eurc, t, AMT, 0, treasury, 100), 0, "measured received is zero");
        assertEq(t.balanceOf(user), uT);
    }

    function test_TaxedOutput_FullTax_Deadline() public {
        _fullTaxOutput(true);
    }

    function test_TaxedOutput_FullTax_Legacy() public {
        _fullTaxOutput(false);
    }

    function testFuzz_TaxedOutput_MinOutVsReceived(uint256 bps, uint256 minOut, bool dl) public {
        bps = bound(bps, 0, 10_000);
        minOut = bound(minOut, 0, OUT);
        uint256 received = OUT - (OUT * bps) / 10000;
        (TaxToken t, FakePool p) = _taxOut(bps);
        uint256 uT = t.balanceOf(user);
        uint256 uE = eurc.balanceOf(user);
        if (minOut > received) {
            vm.expectRevert(ArcisSwapRouter.SlippageExceeded.selector);
            _run(dl, address(p), eurc, t, AMT, minOut, treasury, 100);
            assertEq(t.balanceOf(user), uT);
            assertEq(eurc.balanceOf(user), uE);
            assertEq(eurc.balanceOf(treasury), 0);
        } else {
            uint256 out = _run(dl, address(p), eurc, t, AMT, minOut, treasury, 100);
            assertEq(out, received);
            assertEq(t.balanceOf(user), uT + received);
            assertEq(eurc.balanceOf(user), uE - AMT);
            assertEq(eurc.balanceOf(treasury), FEE);
        }
        assertEq(eurc.balanceOf(address(router)), 0);
        assertEq(t.balanceOf(address(router)), 9 * DEC6);
    }

    // ── normal tokens unchanged, both entry points ────────────────────────────

    function _normalTokens(bool dl) internal {
        uint256 amountIn = 10_000 * DEC6;
        uint256 fee = (amountIn * 25) / 10000;
        uint256 net = amountIn - fee;
        address p = dl ? address(pool) : address(legacyPool);
        uint256 expOut;
        if (dl) {
            expOut = _quote(net, true);
        } else {
            uint256 afterPoolFee = net - (net * 25) / 10000;
            expOut = (legacyPool.reserveB() * afterPoolFee) / (legacyPool.reserveA() + afterPoolFee);
        }
        uint256 uE = eurc.balanceOf(user);
        uint256 uB = btc.balanceOf(user);

        vm.expectEmit(true, true, false, true, address(router));
        emit ArcisSwapRouter.SwapWithFee(user, p, address(eurc), address(btc), amountIn, expOut, fee, treasury);
        uint256 out = _run(dl, p, eurc, btc, amountIn, expOut, treasury, 25);

        assertEq(out, expOut, "returned amount == pool output");
        assertEq(btc.balanceOf(user) - uB, out, "returned amount == user's balance increase");
        assertEq(eurc.balanceOf(user), uE - amountIn);
        assertEq(eurc.balanceOf(treasury), fee);
        _assertRouterEmpty();
        _assertNoAllowance(p);
        // minOut one above the real output reverts for the same swap
        vm.expectRevert();
        _run(dl, p, eurc, btc, amountIn, type(uint256).max, treasury, 25);
    }

    function test_NormalTokens_ExactAccounting_Deadline() public {
        _normalTokens(true);
    }

    function test_NormalTokens_ExactAccounting_Legacy() public {
        _normalTokens(false);
    }

    function testFuzz_NormalTokens_UserDeltaEqualsReturn(uint256 amountIn, uint256 feeBps, bool dl) public {
        amountIn = bound(amountIn, 10_000, 500_000 * DEC6);
        feeBps = bound(feeBps, 0, 500);
        address p = dl ? address(pool) : address(legacyPool);
        uint256 uB = btc.balanceOf(user);
        uint256 uE = eurc.balanceOf(user);
        uint256 out = _run(dl, p, eurc, btc, amountIn, 0, treasury, feeBps);
        assertEq(btc.balanceOf(user) - uB, out);
        assertEq(uE - eurc.balanceOf(user), amountIn);
        assertEq(eurc.balanceOf(treasury), (amountIn * feeBps) / 10000);
        _assertRouterEmpty();
    }
}
