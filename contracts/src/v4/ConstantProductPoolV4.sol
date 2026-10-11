// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "../interfaces/IERC20Like.sol";
import {LpFeeAccounting} from "./LpFeeAccounting.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title ConstantProductPoolV4
/// @notice Arcis USDC / cirBTC Constant-Product AMM (x * y = k) with Pro-Rata Real Yield Fee Streaming.
/// @dev Implements an isolated fee-reserve architecture (`feeReserveA`, `feeReserveB`).
///      Swap fees do not inflate trading reserves, but are distributed directly to LP token holders
///      via `LpFeeAccounting`. LPs can harvest their accumulated swap revenues at any time in underlying
///      tokens (USDC and cirBTC) without burning or exiting their LP positions.
contract ConstantProductPoolV4 is ERC20, ReentrancyGuard, Pausable, Ownable, LpFeeAccounting {
    uint256 public immutable swapFeeBps; // e.g. 25 = 0.25%
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    uint256 public reserveA; // USDC (6 decimals)
    uint256 public reserveB; // cirBTC (8 decimals)

    IERC20Like public immutable tokenA;
    IERC20Like public immutable tokenB;

    // 24H rolling volume counters with lazy-reset on swap
    uint256 public e24hVolumeA;
    uint256 public e24hVolumeB;
    uint256 public e24hWindowStart;

    error ZeroAmount();
    error InvalidFeeBps();
    error NotEnoughLP();
    error SlippageExceeded();
    error InvalidTokenPair();
    error ZeroAddress();
    error InvalidReserves();

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpMinted);
    event LiquidityRemoved(address indexed provider, uint256 lpAmount, uint256 amountA, uint256 amountB);
    event Swapped(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(
        address _tokenA,
        address _tokenB,
        uint256 _swapFeeBps,
        address _initialOwner
    )
        ERC20("Arcis USDC-cirBTC LP v4", "af-USDC-BTC-v4")
        Ownable(_initialOwner)
    {
        if (_tokenA == address(0) || _tokenB == address(0)) revert ZeroAddress();
        if (_tokenA == _tokenB) revert InvalidTokenPair();
        if (_swapFeeBps > 1000) revert InvalidFeeBps(); // Max 10%
        if (address(_tokenA).code.length == 0) revert ZeroAddress();
        if (address(_tokenB).code.length == 0) revert ZeroAddress();

        tokenA = IERC20Like(_tokenA);
        tokenB = IERC20Like(_tokenB);
        swapFeeBps = _swapFeeBps;
        e24hWindowStart = block.timestamp;
    }

    // ── OpenZeppelin ERC20 Hook Overrides for Fee Accounting ──────────────────
    /// @dev Intercepts all LP balance changes (mint, burn, transfer) to accurately accrue fees.
    ///      Guards against self-transfer fee inflation by skipping pre/post balance hooks if from == to.
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

    /// @dev Eligible LP supply excludes permanently burned dead address tokens.
    function _eligibleLpSupply() internal view override returns (uint256) {
        uint256 deadLp = balanceOf(DEAD_ADDRESS);
        uint256 total = totalSupply();
        if (total <= deadLp) return 0;
        return total - deadLp;
    }

    /// @dev DEAD_ADDRESS LP tokens do not earn fee distribution.
    function _lpBalanceOf(address account) internal view override returns (uint256) {
        if (account == DEAD_ADDRESS) return 0;
        return balanceOf(account);
    }

    // ── Admin Functions ───────────────────────────────────────────────────────
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Liquidity Management ──────────────────────────────────────────────────
    /// @notice Add 50/50 USDC + cirBTC liquidity with standardized 18-decimal LP token.
    function addLiquidity(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 lpShares)
    {
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 total = totalSupply();

        if (total == 0) {
            // sqrt(10^6 * 10^8) = 10^7 -> scale to 18 decimals via 1e11 (18 - 7 = 11)
            uint256 rawSqrt = _sqrt(amountAIn * amountBIn);
            uint256 initialLp = rawSqrt * 1e11;
            if (initialLp <= MINIMUM_LIQUIDITY) revert ZeroAmount();

            // Lock MINIMUM_LIQUIDITY permanently to prevent first-depositor inflation attacks
            _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
            lpShares = initialLp - MINIMUM_LIQUIDITY;
        } else {
            uint256 lpA = (amountAIn * total) / reserveA;
            uint256 lpB = (amountBIn * total) / reserveB;
            lpShares = lpA < lpB ? lpA : lpB;
        }

        if (lpShares == 0 || lpShares < minLpShares) revert SlippageExceeded();

        // slither-disable-next-line reentrancy-no-eth -- protected by nonReentrant
        _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
        _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
        reserveA += amountAIn;
        reserveB += amountBIn;

        _mint(msg.sender, lpShares);

        emit LiquidityAdded(msg.sender, amountAIn, amountBIn, lpShares);
        return lpShares;
    }

    /// @notice Remove liquidity proportionally and burn LP shares.
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

        if (outA < minOutA || outB < minOutB) revert SlippageExceeded();

        _burn(msg.sender, lpAmount);

        reserveA -= outA;
        reserveB -= outB;

        _safeTransfer(tokenA, msg.sender, outA);
        _safeTransfer(tokenB, msg.sender, outB);

        emit LiquidityRemoved(msg.sender, lpAmount, outA, outB);
        return (outA, outB);
    }

    // ── Swaps with Real Yield Distribution ────────────────────────────────────
    /// @notice Execute token swap with x * y = k Constant Product AMM and pro-rata swap fee streaming to LPs.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();

        // Lazy-reset 24-hour volume window
        if (block.timestamp - e24hWindowStart >= 1 days) {
            e24hVolumeA = 0;
            e24hVolumeB = 0;
            e24hWindowStart = block.timestamp;
        }

        uint256 fee = (amountIn * swapFeeBps) / 10000;
        uint256 amountInAfterFee = amountIn - fee;

        if (tokenIn == address(tokenA) && tokenOut == address(tokenB)) {
            // USDC -> cirBTC: amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee)
            amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);

            // Drainage guard: single swap cannot drain more than 50% of output reserve
            if (amountOut > reserveB / 2) revert SlippageExceeded();
            if (amountOut == 0 || amountOut < minOut) revert SlippageExceeded();

            _safeTransferFrom(tokenA, msg.sender, address(this), amountIn);
            _safeTransfer(tokenB, msg.sender, amountOut);

            reserveA += amountInAfterFee;
            reserveB -= amountOut;

            _distributeSwapFee(fee, 0);
            e24hVolumeA += amountIn;
        } else if (tokenIn == address(tokenB) && tokenOut == address(tokenA)) {
            // cirBTC -> USDC: amountOut = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee)
            amountOut = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee);

            // Drainage guard: single swap cannot drain more than 50% of output reserve
            if (amountOut > reserveA / 2) revert SlippageExceeded();
            if (amountOut == 0 || amountOut < minOut) revert SlippageExceeded();

            _safeTransferFrom(tokenB, msg.sender, address(this), amountIn);
            _safeTransfer(tokenA, msg.sender, amountOut);

            reserveB += amountInAfterFee;
            reserveA -= amountOut;

            _distributeSwapFee(0, fee);
            e24hVolumeB += amountIn;
        } else {
            revert InvalidTokenPair();
        }

        emit Swapped(msg.sender, tokenIn, amountIn, amountOut);
        return amountOut;
    }

    // ── Real Yield Harvest ────────────────────────────────────────────────────
    /// @notice Harvest accrued swap fees without burning LP shares.
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

    // ── View Functions ────────────────────────────────────────────────────────
    /// @notice Calculates output amount for a potential swap using current reserves.
    function getAmountOut(address tokenIn, uint256 amountIn) external view returns (uint256 amountOut) {
        if (amountIn == 0) return 0;
        uint256 fee = (amountIn * swapFeeBps) / 10000;
        uint256 amountInAfterFee = amountIn - fee;

        if (tokenIn == address(tokenA)) {
            if (reserveA == 0 || reserveB == 0) return 0;
            amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);
            if (amountOut > reserveB / 2) return 0;
        } else if (tokenIn == address(tokenB)) {
            if (reserveA == 0 || reserveB == 0) return 0;
            amountOut = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee);
            if (amountOut > reserveA / 2) return 0;
        } else {
            revert InvalidTokenPair();
        }
    }

    /// @notice Returns current active AMM reserves.
    function getReserves() external view returns (uint256 _reserveA, uint256 _reserveB) {
        return (reserveA, reserveB);
    }

    /// @notice Returns comprehensive pool state in a single call.
    function getPoolState()
        external
        view
        returns (
            uint256 _reserveA,
            uint256 _reserveB,
            uint256 _totalLp,
            uint256 _feeReserveA,
            uint256 _feeReserveB
        )
    {
        return (reserveA, reserveB, totalSupply(), feeReserveA, feeReserveB);
    }

    function totalLp() external view returns (uint256) {
        return totalSupply();
    }

    function unclaimedFeeA() external view returns (uint256) {
        return feeReserveA;
    }

    function unclaimedFeeB() external view returns (uint256) {
        return feeReserveB;
    }

    function volume24hA() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeA;
    }

    function volume24hB() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeB;
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
