// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "./interfaces/IERC20Like.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Arcis USDC / cirBTC Constant-Product Pool (x * y = k).
/// @dev Tokens: USDC (6 dec) and cirBTC (8 dec). Arc-specific: no WETH adapter.
contract ConstantProductPool is ReentrancyGuard {
    IERC20Like public immutable tokenA; // USDC (6 decimals)
    IERC20Like public immutable tokenB; // cirBTC (8 decimals)

    uint256 public reserveA;
    uint256 public reserveB;
    uint256 public totalLp;
    mapping(address => uint256) public balanceOf;

    /// @notice Swap fee in basis points (e.g. 25 = 0.25%).
    uint256 public immutable swapFeeBps;

    uint256 public unclaimedFeeA;
    uint256 public unclaimedFeeB;
    uint256 public accumulatedFeeA;
    uint256 public accumulatedFeeB;

    string public constant name = "Arcis USDC-cirBTC LP";
    string public constant symbol = "af-USDC-BTC";
    uint8 public constant decimals = 18;

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

    constructor(address _tokenA, address _tokenB, uint256 _swapFeeBps) {
        if (_tokenA == address(0) || _tokenB == address(0)) revert ZeroAddress();
        if (_swapFeeBps > 1000) revert InvalidFeeBps();
        tokenA = IERC20Like(_tokenA);
        tokenB = IERC20Like(_tokenB);
        swapFeeBps = _swapFeeBps;
    }

    receive() external payable {
        revert("native deposits not allowed");
    }

    /// @notice Add 50/50 USDC + cirBTC liquidity.
    function addLiquidity(uint256 amountAIn, uint256 amountBIn) external returns (uint256 lpShares) {
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 r0 = reserveA;
        uint256 r1 = reserveB;

        if (r0 == 0 && r1 == 0) {
            lpShares = _sqrt(amountAIn * amountBIn);
            totalLp = lpShares;
        } else {
            uint256 lpA = (amountAIn * totalLp) / r0;
            uint256 lpB = (amountBIn * totalLp) / r1;
            lpShares = lpA < lpB ? lpA : lpB;
            if (lpShares == 0) revert ZeroAmount();
            totalLp += lpShares;
        }

        balanceOf[msg.sender] += lpShares;

        _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
        _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
        reserveA += amountAIn;
        reserveB += amountBIn;

        emit LiquidityAdded(msg.sender, amountAIn, amountBIn, lpShares);
        return lpShares;
    }

    function removeLiquidity(uint256 lpAmount) external nonReentrant returns (uint256 outA, uint256 outB) {
        if (lpAmount == 0) revert ZeroAmount();
        if (lpAmount > totalLp) revert NotEnoughLP();
        if (lpAmount > balanceOf[msg.sender]) revert NotEnoughLP();

        uint256 feeA = (unclaimedFeeA * lpAmount) / totalLp;
        uint256 feeB = (unclaimedFeeB * lpAmount) / totalLp;
        unclaimedFeeA -= feeA;
        unclaimedFeeB -= feeB;
        accumulatedFeeA += feeA;
        accumulatedFeeB += feeB;

        outA = (reserveA * lpAmount) / totalLp;
        outB = (reserveB * lpAmount) / totalLp;

        reserveA -= outA;
        reserveB -= outB;
        totalLp -= lpAmount;
        balanceOf[msg.sender] -= lpAmount;

        _safeTransfer(tokenA, msg.sender, outA);
        _safeTransfer(tokenB, msg.sender, outB);

        emit LiquidityRemoved(msg.sender, lpAmount, outA, outB);
        return (outA, outB);
    }

    /// @notice Swap using x*y=k invariant with fee.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0) revert ZeroAmount();
        uint256 fee = (amountIn * swapFeeBps) / 10000;
        uint256 amountInAfterFee = amountIn - fee;

        if (tokenIn == address(tokenA) && tokenOut == address(tokenB)) {
            // USDC -> cirBTC
            amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);
            if (amountOut < minOut) revert SlippageExceeded();
            if (amountOut >= reserveB) revert KInvariantViolated();

            _safeTransferFrom(tokenA, msg.sender, address(this), amountIn);
            _safeTransfer(tokenB, msg.sender, amountOut);
            reserveA += amountIn;
            reserveB -= amountOut;
            unclaimedFeeA += fee;
        } else if (tokenIn == address(tokenB) && tokenOut == address(tokenA)) {
            // cirBTC -> USDC
            amountOut = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee);
            if (amountOut < minOut) revert SlippageExceeded();
            if (amountOut >= reserveA) revert KInvariantViolated();

            _safeTransferFrom(tokenB, msg.sender, address(this), amountIn);
            _safeTransfer(tokenA, msg.sender, amountOut);
            reserveB += amountIn;
            reserveA -= amountOut;
            unclaimedFeeB += fee;
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