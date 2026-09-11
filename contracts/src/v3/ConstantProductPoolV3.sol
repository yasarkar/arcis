// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "../interfaces/IERC20Like.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Arcis USDC / cirBTC Constant-Product Pool V3 (x * y = k).
/// @dev V3 is the final, mainnet-bound version. It carries forward all V2 safeguards
///      (18-dec standardized LP, MINIMUM_LIQUIDITY, slippage guards, Pausable) and adds a
///      degenerate-pair guard (tokenA != tokenB).
contract ConstantProductPoolV3 is ERC20, ReentrancyGuard, Pausable, Ownable {
    IERC20Like public immutable tokenA; // USDC (6 decimals)
    IERC20Like public immutable tokenB; // cirBTC (8 decimals)

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    uint256 public reserveA;
    uint256 public reserveB;

    /// @notice Swap fee in basis points (e.g. 25 = 0.25%).
    uint256 public immutable swapFeeBps;

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
    error KInvariantViolated();

    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpMinted);
    event LiquidityRemoved(address indexed provider, uint256 lpAmount, uint256 amountA, uint256 amountB);
    event Swapped(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    constructor(
        address _tokenA,
        address _tokenB,
        uint256 _swapFeeBps,
        address _initialOwner
    )
        ERC20("Arcis USDC-cirBTC LP v3", "af-USDC-BTC-v3")
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

    /// @notice Emergency circuit breaker pause.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause pool operations.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Add 50/50 USDC + cirBTC liquidity with slippage protection.
    function addLiquidity(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 lpShares)
    {
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 total = totalSupply();

        if (total == 0) {
            // sqrt(10^6 * 10^8) = 10^7 -> scale to 18 decimals via 1e11
            uint256 rawSqrt = _sqrt(amountAIn * amountBIn);
            uint256 initialLp = rawSqrt * 1e11;
            if (initialLp <= MINIMUM_LIQUIDITY) revert ZeroAmount();

            _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
            lpShares = initialLp - MINIMUM_LIQUIDITY;
        } else {
            uint256 lpA = (amountAIn * total) / reserveA;
            uint256 lpB = (amountBIn * total) / reserveB;
            lpShares = lpA < lpB ? lpA : lpB;
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

    /// @notice Remove liquidity proportionally with slippage protection.
    /// @dev SECURITY: the slippage-less convenience overloads (`addLiquidity(a,b)` /
    ///      `removeLiquidity(lp)`) were REMOVED — callers must always pass explicit
    ///      minLpShares / minOut values so users can never be silently sandwiched.
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

    /// @notice Swap tokenIn for tokenOut with x * y = k constant product pricing and slippage guard.
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
            amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);
            if (amountOut == 0 || amountOut < minOut) revert SlippageExceeded();

            _safeTransferFrom(tokenA, msg.sender, address(this), amountIn);
            _safeTransfer(tokenB, msg.sender, amountOut);

            reserveA += amountIn;
            reserveB -= amountOut;
            accumulatedFeeA += fee;
            e24hVolumeA += amountIn;
        } else if (tokenIn == address(tokenB) && tokenOut == address(tokenA)) {
            amountOut = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee);
            if (amountOut == 0 || amountOut < minOut) revert SlippageExceeded();

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