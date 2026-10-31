// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "../interfaces/IERC20Like.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {LpFeeAccounting} from "./LpFeeAccounting.sol";

/// @notice Arcis cirBTC / WETH Constant-Product Pool V4 (x * y = k) with Real-Yield Fee Harvest.
/// @dev Pair: cirBTC (8 decimals, tokenA) / WETH (18 decimals, tokenB).
///      LP token: 18 decimals -- initial shares = sqrt(amountA * amountB) * 1e5.
///      The 1e5 scalar normalises geometric-mean units (8+18=26 dec / 2 = 13 dec raw sqrt)
///      up to standard 18-decimal ERC-20 shares (18 - 13 = 5 -> * 1e5).
///      MINIMUM_LIQUIDITY = 1000 wei LP locked to DEAD_ADDRESS on the first deposit to
///      anchor the exchange rate and prevent first-depositor inflation attacks.
///
///      Audit Readiness & Security Features (Arc Studio Ready):
///        - H-01: Off-ratio deposits revert or cap -- only optimal proportional amounts are transferred.
///        - M-01: Ownable2Step prevents irreversible misdirection of contract ownership.
///        - M-02: swapFeeBps >= 1 enforced at construction -- zero-fee pools are explicitly rejected.
///        - M-04: e24hVolumeA/B internal; volume24hA()/volume24hB() provide safe view surfaces.
///        - H-1: NoLiquidityProviders guard in swap() -- fees never orphaned when eligible supply = 0.
///        - H-3: DustSwapNotAllowed guard -- fee must be >= 1 wei to prevent zero-fee micro-swaps.
///        - M-1: Strict CEI in swap() -- reserve state written BEFORE output token is pushed.
///        - M-2: minLpShares checked BEFORE tokens are pulled on the initial deposit path.
///        - M-3: deadline parameter added to swap() and addLiquidity() -- MEV staleness protection.
///        - M-5: skim() function recovers stray token donations above tracked reserves.
///        - 50% single-swap output cap prevents flash-loan reserve drainage and price manipulation.
///        - Non-blocking emergency exits: removeLiquidity() and harvest() remain live during pause.
contract ConstantProductPoolCirBtcWethV4 is ERC20, ReentrancyGuard, Pausable, Ownable2Step, LpFeeAccounting {
    // ── Immutables & Constants ────────────────────────────────────────────────
    IERC20Like public immutable tokenA; // cirBTC (8 decimals)
    IERC20Like public immutable tokenB; // WETH   (18 decimals)

    uint256 public immutable swapFeeBps;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    // ── Mutable Pool State ────────────────────────────────────────────────────
    uint256 public reserveA; // live cirBTC reserve (excludes feeReserveA)
    uint256 public reserveB; // live WETH   reserve (excludes feeReserveB)

    uint256 internal e24hVolumeA;
    uint256 internal e24hVolumeB;
    uint256 internal e24hWindowStart;

    // ── Custom Errors ─────────────────────────────────────────────────────────
    error ZeroAmount();
    error InvalidFeeBps(uint256 provided);
    error NotEnoughLP();
    error SlippageExceeded(uint256 minExpected, uint256 actual);
    error InvalidTokenPair(address tokenIn, address tokenOut);
    error ZeroAddress(address provided);
    error KInvariantViolated();
    error NoLiquidityProviders();
    error DustSwapNotAllowed();
    error DeadlineExpired();
    error ExcessiveTokenBRequired(uint256 required, uint256 maxAllowed);
    error ExcessiveTokenARequired(uint256 required, uint256 maxAllowed);

    // ── Events ────────────────────────────────────────────────────────────────
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpMinted);
    event LiquidityRemoved(address indexed provider, uint256 lpAmount, uint256 amountA, uint256 amountB);
    event Swapped(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);
    event SkimExecuted(address indexed token, address indexed to, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _tokenA,
        address _tokenB,
        uint256 _swapFeeBps,
        address _initialOwner
    )
        ERC20("Arcis cirBTC-WETH LP v4", "af-cirBTC-WETH-v4")
        Ownable(_initialOwner)
    {
        if (_tokenA == address(0)) revert ZeroAddress(_tokenA);
        if (_tokenB == address(0)) revert ZeroAddress(_tokenB);
        if (_tokenA == _tokenB) revert InvalidTokenPair(_tokenA, _tokenB);
        if (_swapFeeBps == 0 || _swapFeeBps > 1000) revert InvalidFeeBps(_swapFeeBps);
        if (address(_tokenA).code.length == 0) revert ZeroAddress(_tokenA);
        if (address(_tokenB).code.length == 0) revert ZeroAddress(_tokenB);

        tokenA = IERC20Like(_tokenA);
        tokenB = IERC20Like(_tokenB);
        swapFeeBps = _swapFeeBps;
        e24hWindowStart = block.timestamp;
    }

    // ── Backward-Compatible Getters ───────────────────────────────────────────
    function totalLp() external view returns (uint256) { return totalSupply(); }
    function unclaimedFeeA() external view returns (uint256) { return feeReserveA; }
    function unclaimedFeeB() external view returns (uint256) { return feeReserveB; }

    /// @notice Returns rolling 24-hour cirBTC volume. Returns 0 when the window has expired.
    function volume24hA() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeA;
    }

    /// @notice Returns rolling 24-hour WETH volume. Returns 0 when the window has expired.
    function volume24hB() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeB;
    }

    // ── LpFeeAccounting Hooks ─────────────────────────────────────────────────

    /// @dev Eligible supply excludes permanently locked DEAD_ADDRESS shares so dead LP never accrues fees.
    function _eligibleLpSupply() internal view override returns (uint256) {
        uint256 dead = balanceOf(DEAD_ADDRESS);
        uint256 total = totalSupply();
        return total > dead ? total - dead : 0;
    }

    function _lpBalanceOf(address account) internal view override returns (uint256) {
        return balanceOf(account);
    }

    /// @dev Self-transfers skip fee accounting to prevent double-counting.
    function _update(address from, address to, uint256 value) internal override {
        if (from == to) {
            super._update(from, to, value);
            return;
        }
        _beforeLpBalanceChange(from);
        _beforeLpBalanceChange(to);
        super._update(from, to, value);
        _afterLpBalanceChange(from);
        _afterLpBalanceChange(to);
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    // ── Liquidity Management ──────────────────────────────────────────────────

    /// @notice Add cirBTC + WETH liquidity with deadline protection.
    function addLiquidity(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares, uint256 deadline)
        public
        nonReentrant
        whenNotPaused
        returns (uint256 lpShares)
    {
        return _addLiquidityInternal(amountAIn, amountBIn, minLpShares, deadline);
    }

    /// @notice Backward-compatible overload without deadline (defaults to 20 min).
    function addLiquidity(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 lpShares)
    {
        return _addLiquidityInternal(amountAIn, amountBIn, minLpShares, block.timestamp + 1200);
    }

    function _addLiquidityInternal(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares, uint256 deadline)
        internal
        returns (uint256 lpShares)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 total = totalSupply();

        if (total == 0) {
            // Initial deposit: geometric-mean normalization
            // sqrt(8-dec * 18-dec) = 13-dec; * 1e5 = 18-dec LP
            uint256 rawSqrt = _sqrt(amountAIn * amountBIn);
            if (rawSqrt < 1e6) revert ZeroAmount();
            uint256 initialLp = rawSqrt * 1e5;
            if (initialLp <= MINIMUM_LIQUIDITY) revert ZeroAmount();

            lpShares = initialLp - MINIMUM_LIQUIDITY;
            if (lpShares < minLpShares) revert SlippageExceeded(minLpShares, lpShares);

            _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
            _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
            reserveA += amountAIn;
            reserveB += amountBIn;

            _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
        } else {
            // Subsequent deposits: optimal proportional amounts (H-01 audit protection)
            uint256 optimalB = (amountAIn * reserveB) / reserveA;

            uint256 actualA;
            uint256 actualB;

            if (optimalB <= amountBIn) {
                actualA = amountAIn;
                actualB = optimalB;
            } else {
                uint256 optimalA = (amountBIn * reserveA) / reserveB;
                if (optimalA > amountAIn) revert ExcessiveTokenARequired(optimalA, amountAIn);
                actualA = optimalA;
                actualB = amountBIn;
            }

            lpShares = (actualA * total) / reserveA;
            if (lpShares == 0 || lpShares < minLpShares) revert SlippageExceeded(minLpShares, lpShares);

            _safeTransferFrom(tokenA, msg.sender, address(this), actualA);
            _safeTransferFrom(tokenB, msg.sender, address(this), actualB);
            reserveA += actualA;
            reserveB += actualB;

            emit LiquidityAdded(msg.sender, actualA, actualB, lpShares);
            _mint(msg.sender, lpShares);
            return lpShares;
        }

        _mint(msg.sender, lpShares);
        emit LiquidityAdded(msg.sender, amountAIn, amountBIn, lpShares);
        return lpShares;
    }

    /// @notice Remove liquidity proportionally and burn LP shares.
    /// @dev Intentionally NOT gated by whenNotPaused -- LPs must always be able to exit.
    function removeLiquidity(uint256 lpAmount, uint256 minOutA, uint256 minOutB)
        external
        nonReentrant
        returns (uint256 outA, uint256 outB)
    {
        if (lpAmount == 0) revert ZeroAmount();
        uint256 total = totalSupply();
        if (lpAmount > total) revert NotEnoughLP();
        if (lpAmount > balanceOf(msg.sender)) revert NotEnoughLP();

        outA = (reserveA * lpAmount) / total;
        outB = (reserveB * lpAmount) / total;

        if (outA < minOutA) revert SlippageExceeded(minOutA, outA);
        if (outB < minOutB) revert SlippageExceeded(minOutB, outB);

        _burn(msg.sender, lpAmount);
        reserveA -= outA;
        reserveB -= outB;

        _safeTransfer(tokenA, msg.sender, outA);
        _safeTransfer(tokenB, msg.sender, outB);

        emit LiquidityRemoved(msg.sender, lpAmount, outA, outB);
        return (outA, outB);
    }

    // ── Swap ──────────────────────────────────────────────────────────────────

    /// @notice Swap tokenIn for tokenOut using x*y=k with fee isolation and deadline protection.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        public
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        return _swapInternal(tokenIn, tokenOut, amountIn, minOut, deadline);
    }

    /// @notice Backward-compatible swap overload (defaults to 20 min deadline).
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        return _swapInternal(tokenIn, tokenOut, amountIn, minOut, block.timestamp + 1200);
    }

    function _swapInternal(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        internal
        returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountIn == 0) revert ZeroAmount();

        uint256 eligibleSupply = _eligibleLpSupply();
        if (eligibleSupply == 0) revert NoLiquidityProviders();

        uint256 fee = (amountIn * swapFeeBps) / 10000;
        if (fee == 0 && swapFeeBps > 0) revert DustSwapNotAllowed();
        uint256 amountInAfterFee = amountIn - fee;

        if (block.timestamp - e24hWindowStart >= 1 days) {
            e24hVolumeA = 0;
            e24hVolumeB = 0;
            e24hWindowStart = block.timestamp;
        }

        if (tokenIn == address(tokenA) && tokenOut == address(tokenB)) {
            // cirBTC -> WETH
            amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);
            if (amountOut == 0) revert ZeroAmount();
            if (amountOut >= reserveB) revert KInvariantViolated();
            // 50% single-swap output cap
            if (amountOut > reserveB / 2) revert SlippageExceeded(minOut, amountOut);
            if (amountOut < minOut) revert SlippageExceeded(minOut, amountOut);

            _safeTransferFrom(tokenA, msg.sender, address(this), amountIn);
            reserveA += amountInAfterFee;
            reserveB -= amountOut;
            _distributeSwapFeeWithSupply(fee, 0, eligibleSupply);
            e24hVolumeA += amountIn;
            _safeTransfer(tokenB, msg.sender, amountOut);

        } else if (tokenIn == address(tokenB) && tokenOut == address(tokenA)) {
            // WETH -> cirBTC
            amountOut = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee);
            if (amountOut == 0) revert ZeroAmount();
            if (amountOut >= reserveA) revert KInvariantViolated();
            // 50% single-swap output cap
            if (amountOut > reserveA / 2) revert SlippageExceeded(minOut, amountOut);
            if (amountOut < minOut) revert SlippageExceeded(minOut, amountOut);

            _safeTransferFrom(tokenB, msg.sender, address(this), amountIn);
            reserveB += amountInAfterFee;
            reserveA -= amountOut;
            _distributeSwapFeeWithSupply(0, fee, eligibleSupply);
            e24hVolumeB += amountIn;
            _safeTransfer(tokenA, msg.sender, amountOut);

        } else {
            revert InvalidTokenPair(tokenIn, tokenOut);
        }

        emit Swapped(msg.sender, tokenIn, amountIn, amountOut);
        return amountOut;
    }

    // ── Real Yield Harvest ────────────────────────────────────────────────────

    /// @notice Claim accrued swap fees in both cirBTC and WETH without exiting LP position.
    function harvest() external nonReentrant returns (uint256 feeA, uint256 feeB) {
        address lp = msg.sender;
        (feeA, feeB) = pendingFees(lp);
        if (feeA == 0 && feeB == 0) revert NoFeesAccrued();

        userUnclaimedA[lp] = 0;
        userUnclaimedB[lp] = 0;
        userRewardDebtA[lp] = (balanceOf(lp) * accFeePerShareA) / PRECISION;
        userRewardDebtB[lp] = (balanceOf(lp) * accFeePerShareB) / PRECISION;

        if (feeA > 0) {
            feeReserveA -= feeA;
            _safeTransfer(tokenA, lp, feeA);
        }
        if (feeB > 0) {
            feeReserveB -= feeB;
            _safeTransfer(tokenB, lp, feeB);
        }

        emit FeesHarvested(lp, feeA, feeB);
        return (feeA, feeB);
    }

    // ── Token Recovery ────────────────────────────────────────────────────────

    /// @notice Recover excess tokens (stray donations) above tracked reserves.
    function skim(address token, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress(to);
        uint256 contractBal = IERC20Like(token).balanceOf(address(this));
        uint256 tracked;
        if (token == address(tokenA)) {
            tracked = reserveA + feeReserveA;
        } else if (token == address(tokenB)) {
            tracked = reserveB + feeReserveB;
        }
        uint256 excess = contractBal > tracked ? contractBal - tracked : 0;
        if (excess == 0) return;
        _safeTransfer(IERC20Like(token), to, excess);
        emit SkimExecuted(token, to, excess);
    }

    // ── Internal Helpers ──────────────────────────────────────────────────────

    function _sqrt(uint256 y) internal pure returns (uint256 z) {
        if (y > 3) {
            z = y;
            uint256 x = y / 2 + 1;
            while (x < z) {
                z = x;
                x = (y / x + x) / 2;
            }
        } else if (y != 0) {
            z = 1;
        }
    }

    function _safeTransfer(IERC20Like token, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20Like.transfer.selector, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(IERC20Like token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = address(token).call(
            abi.encodeWithSelector(IERC20Like.transferFrom.selector, from, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }
}

