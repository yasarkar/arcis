// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "./interfaces/IERC20Like.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Arcis USDC / EURC StableSwap Pool (Curve Amplified Invariant Market Maker).
/// @dev Designed for Arc Testnet: both tokens use 6 decimals.
///      Implements standard Curve Stableswap 2-pool invariant to ensure near-zero slippage
///      around 1:1 peg while preventing pool-draining exploits when imbalanced.
///      LP shares are fully compliant OpenZeppelin ERC-20 tokens.
contract StableSwapPool is ERC20, ReentrancyGuard {
    uint256 public immutable swapFeeBps;
    uint256 public constant A = 100; // Curve Amplification Coefficient

    uint256 public reserveA; // USDC (6 decimals)
    uint256 public reserveB; // EURC (6 decimals)

    IERC20Like public immutable tokenA;
    IERC20Like public immutable tokenB;

    uint256 public accumulatedFeeA;
    uint256 public accumulatedFeeB;
    uint256 public unclaimedFeeA;
    uint256 public unclaimedFeeB;

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

    constructor(address _tokenA, address _tokenB, uint256 _swapFeeBps)
        ERC20("Arcis USDC-EURC LP", "af-USDC-EURC")
    {
        if (_tokenA == address(0) || _tokenB == address(0)) revert ZeroAddress();
        if (_swapFeeBps > 1000) revert InvalidFeeBps();

        tokenA = IERC20Like(_tokenA);
        tokenB = IERC20Like(_tokenB);
        swapFeeBps = _swapFeeBps;
    }

    receive() external payable {
        revert("native deposits not allowed");
    }

    /// @notice Returns total LP supply (kept for backward compatibility with frontend).
    function totalLp() external view returns (uint256) {
        return totalSupply();
    }

    /// @notice Add dual liquidity into the Stableswap pool.
    function addLiquidity(uint256 amountAIn, uint256 amountBIn) external nonReentrant returns (uint256 lpShares) {
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 total = totalSupply();

        if (total == 0) {
            uint256 d0 = _getD(amountAIn, amountBIn);
            lpShares = d0 * 1e12; // Scale 6-decimal D to 18-decimal ERC20 LP tokens
        } else {
            uint256 d0 = _getD(reserveA, reserveB);
            uint256 d1 = _getD(reserveA + amountAIn, reserveB + amountBIn);
            if (d1 <= d0) revert ZeroAmount();
            lpShares = ((d1 - d0) * total) / d0;
        }

        if (lpShares == 0) revert ZeroAmount();

        _mint(msg.sender, lpShares);

        _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
        _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
        reserveA += amountAIn;
        reserveB += amountBIn;

        emit LiquidityAdded(msg.sender, amountAIn, amountBIn, lpShares);
        return lpShares;
    }

    /// @notice Remove liquidity proportionally and burn LP shares.
    function removeLiquidity(uint256 lpAmount) external nonReentrant returns (uint256 outA, uint256 outB) {
        if (lpAmount == 0) revert ZeroAmount();
        uint256 total = totalSupply();
        if (lpAmount > total) revert NotEnoughLP();
        if (lpAmount > balanceOf(msg.sender)) revert NotEnoughLP();

        outA = (reserveA * lpAmount) / total;
        outB = (reserveB * lpAmount) / total;

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
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
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
            unclaimedFeeA += fee;
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
            unclaimedFeeB += fee;
        } else {
            revert InvalidTokenPair();
        }

        emit Swapped(msg.sender, tokenIn, amountIn, amountOut);
        return amountOut;
    }

    // ─────────────────────────────────────────────────────────────
    //  CURVE STABLESWAP MATHEMATICAL ENGINE (2-POOL)
    // ─────────────────────────────────────────────────────────────
    /// @dev Calculates invariant D given balances x and y.
    function _getD(uint256 x, uint256 y) internal pure returns (uint256) {
        uint256 s = x + y;
        if (s == 0) return 0;

        uint256 d = s;
        uint256 Ann = A * 4; // A * n^n for n=2 is A * 4

        for (uint256 i = 0; i < 255; ++i) {
            uint256 dP = d;
            dP = (dP * d) / (x * 2);
            dP = (dP * d) / (y * 2);

            uint256 dPrev = d;
            uint256 num = (Ann * s + dP * 2) * d;
            uint256 den = (Ann - 1) * d + dP * 3;
            d = num / den;

            if (d > dPrev) {
                if (d - dPrev <= 1) return d;
            } else {
                if (dPrev - d <= 1) return d;
            }
        }
        return d;
    }

    /// @dev Calculates output balance y given new input balance x and invariant D.
    function _getY(uint256 x, uint256 d) internal pure returns (uint256) {
        uint256 Ann = A * 4;
        uint256 c = d;
        uint256 s = x;

        c = (c * d) / (x * 2);
        c = (c * d) / (Ann * 2);

        uint256 b = s + d / Ann;
        uint256 y = d;

        for (uint256 i = 0; i < 255; ++i) {
            uint256 yPrev = y;
            y = (y * y + c) / (2 * y + b - d);

            if (y > yPrev) {
                if (y - yPrev <= 1) return y;
            } else {
                if (yPrev - y <= 1) return y;
            }
        }
        return y;
    }

    function _safeTransfer(IERC20Like token, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20Like.transfer, (to, value)));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }

    function _safeTransferFrom(IERC20Like token, address from, address to, uint256 value) internal {
        (bool ok, bytes memory data) = address(token).call(abi.encodeCall(IERC20Like.transferFrom, (from, to, value)));
        if (!ok || (data.length > 0 && !abi.decode(data, (bool)))) {
            revert TransferFailed();
        }
    }
}