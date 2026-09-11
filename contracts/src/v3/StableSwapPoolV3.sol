// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "../interfaces/IERC20Like.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Arcis USDC / EURC StableSwap Pool V3 (Curve Amplified Invariant Market Maker).
/// @dev V3 is the final, mainnet-bound version. It inherits all V2 safeguards
///      (MINIMUM_LIQUIDITY burn, slippage guards, Pausable, ReentrancyGuard) and restores
///      the canonical Curve amplification constant `Ann = A * n**n` = A*4 for a 2-coin pool.
///      V2 falsely used Ann = A*2, silently halving the amplification (see
///      test/StableMathComparison.t.sol for the quantified divergence).
contract StableSwapPoolV3 is ERC20, ReentrancyGuard, Pausable, Ownable {
    uint256 public immutable swapFeeBps;
    uint256 public constant A = 100; // Curve Amplification Coefficient
    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    uint256 public reserveA; // USDC (6 decimals)
    uint256 public reserveB; // EURC (6 decimals)

    IERC20Like public immutable tokenA;
    IERC20Like public immutable tokenB;

    uint256 public accumulatedFeeA;
    uint256 public accumulatedFeeB;

    // 24H rolling volume counters with lazy-reset on swap (K3-B)
    uint256 public e24hVolumeA;
    uint256 public e24hVolumeB;
    uint256 public e24hWindowStart;

    error ZeroAmount();
    error InvalidFeeBps();
    error NotEnoughLP();
    error TransferFailed();
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
        ERC20("Arcis USDC-EURC LP v3", "af-USDC-EURC-v3")
        Ownable(_initialOwner)
    {
        if (_tokenA == address(0) || _tokenB == address(0)) revert ZeroAddress();
        if (_tokenA == _tokenB) revert InvalidTokenPair();
        if (_swapFeeBps > 1000) revert InvalidFeeBps();

        tokenA = IERC20Like(_tokenA);
        tokenB = IERC20Like(_tokenB);
        swapFeeBps = _swapFeeBps;
        e24hWindowStart = block.timestamp;
    }

    receive() external payable {
        revert("native deposits not allowed");
    }

    /// @notice Returns total LP supply (kept for backward compatibility with frontend).
    function totalLp() external view returns (uint256) {
        return totalSupply();
    }

    /// @notice Backward-compatible fee getters (map to accumulated fees).
    /// @dev Frontend reads unclaimedFeeA/B for the fee-accrual display.
    function unclaimedFeeA() external view returns (uint256) {
        return accumulatedFeeA;
    }

    /// @notice Backward-compatible fee getter.
    function unclaimedFeeB() external view returns (uint256) {
        return accumulatedFeeB;
    }

    /// @notice Returns 24h rolling volume for token A (resets to 0 if window expired).
    function volume24hA() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeA;
    }

    /// @notice Returns 24h rolling volume for token B (resets to 0 if window expired).
    function volume24hB() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeB;
    }

    /// @notice Owner-only fee collection. Fees accrue inside the pool reserves; when they
    ///         are swept the reserves are decreased by the same amount so the accounting
    ///         stays consistent with the token balances (collectFees fix).
    function collectFees(address to) external onlyOwner returns (uint256 amountA, uint256 amountB) {
        if (to == address(0)) revert ZeroAddress();
        amountA = accumulatedFeeA;
        amountB = accumulatedFeeB;
        accumulatedFeeA = 0;
        accumulatedFeeB = 0;
        if (amountA > 0) {
            reserveA -= amountA;
            _safeTransfer(tokenA, to, amountA);
        }
        if (amountB > 0) {
            reserveB -= amountB;
            _safeTransfer(tokenB, to, amountB);
        }
    }

    /// @notice Emergency pause swaps and liquidity addition.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause pool operations.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Add dual liquidity with slippage protection.
    function addLiquidity(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 lpShares)
    {
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 total = totalSupply();

        if (total == 0) {
            uint256 d0 = _getD(amountAIn, amountBIn);
            uint256 initialLp = d0 * 1e12; // Scale 6-decimal D to 18-decimal ERC20 LP tokens
            if (initialLp <= MINIMUM_LIQUIDITY) revert ZeroAmount();

            // Permanently lock MINIMUM_LIQUIDITY to prevent inflation/donation attacks
            _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
            lpShares = initialLp - MINIMUM_LIQUIDITY;
        } else {
            uint256 d0 = _getD(reserveA, reserveB);
            uint256 d1 = _getD(reserveA + amountAIn, reserveB + amountBIn);
            if (d1 <= d0) revert ZeroAmount();
            lpShares = ((d1 - d0) * total) / d0;
        }

        if (lpShares == 0 || lpShares < minLpShares) revert SlippageExceeded();

        _mint(msg.sender, lpShares);

        _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
        _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
        reserveA += amountAIn;
        reserveB += amountBIn;

        emit LiquidityAdded(msg.sender, amountAIn, amountBIn, lpShares);
        return lpShares;
    }

    /// @notice Remove liquidity proportionally and burn LP shares.
    /// @dev SECURITY: the slippage-less convenience overloads were REMOVED — callers
    ///      must always pass explicit minLpShares / minOut values.
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

    /// @notice Execute token swap using the Curve Stableswap invariant.
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
            uint256 d = _getD(reserveA, reserveB);
            uint256 y = _getY(reserveA + amountInAfterFee, d);
            if (y >= reserveB) revert InvalidReserves();
            amountOut = reserveB - y;

            if (amountOut < minOut) revert SlippageExceeded();

            _safeTransferFrom(tokenA, msg.sender, address(this), amountIn);
            _safeTransfer(tokenB, msg.sender, amountOut);

            reserveA += amountIn;
            reserveB -= amountOut;
            accumulatedFeeA += fee;
            e24hVolumeA += amountIn;
        } else if (tokenIn == address(tokenB) && tokenOut == address(tokenA)) {
            uint256 d = _getD(reserveB, reserveA);
            uint256 y = _getY(reserveB + amountInAfterFee, d);
            if (y >= reserveA) revert InvalidReserves();
            amountOut = reserveA - y;

            if (amountOut < minOut) revert SlippageExceeded();

            _safeTransferFrom(tokenB, msg.sender, address(this), amountIn);
            _safeTransfer(tokenA, msg.sender, amountOut);

            reserveB += amountIn;
            reserveA -= amountOut;
            accumulatedFeeB += fee;
            e24hVolumeB += amountIn;
        } else {
            revert InvalidTokenPair();
        }

        emit Swapped(msg.sender, tokenIn, amountIn, amountOut);
        return amountOut;
    }

    // ── Internal Curve Math: Invariant D computation ──────────────────────────
    /// @dev Canonical Curve amplification: Ann = A * n**n, n=2 -> A*4.
    function _getD(uint256 x, uint256 y) internal pure returns (uint256) {
        uint256 s = x + y;
        if (s == 0) return 0;

        uint256 prevD;
        uint256 d = s;
        uint256 Ann = A * 4;

        for (uint256 i = 0; i < 255; i++) {
            uint256 dP = d;
            dP = (dP * d) / (x * 2);
            dP = (dP * d) / (y * 2);
            prevD = d;
            d = ((Ann * s + dP * 2) * d) / ((Ann - 1) * d + 3 * dP);
            if (d > prevD) {
                if (d - prevD <= 1) return d;
            } else {
                if (prevD - d <= 1) return d;
            }
        }
        return d;
    }

    function _getY(uint256 x, uint256 d) internal pure returns (uint256) {
        uint256 Ann = A * 4;
        uint256 c = (d * d) / (x * 2);
        c = (c * d) / (Ann * 2);
        uint256 b = x + d / Ann;
        uint256 prevY;
        uint256 y = d;

        for (uint256 i = 0; i < 255; i++) {
            prevY = y;
            y = (y * y + c) / (2 * y + b - d);
            if (y > prevY) {
                if (y - prevY <= 1) return y;
            } else {
                if (prevY - y <= 1) return y;
            }
        }
        return y;
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