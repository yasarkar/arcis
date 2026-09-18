// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "./interfaces/IERC20Like.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISwapPool {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) external returns (uint256 amountOut);
}

/// @title ArcisSwapRouter
/// @notice Single-transaction swap router with atomic platform fee forwarding for Arcis AMM pools on Arc Network.
/// @dev Eliminates secondary approval/transfer popups for EOA wallets (MetaMask) by batching fee collection and pool swap.
contract ArcisSwapRouter is ReentrancyGuard {
    error ZeroAddress();
    error ZeroAmount();
    error FeeTooHigh();
    error SlippageExceeded();
    error TransferFailed();

    uint256 public constant MAX_FEE_BPS = 500; // 5% safety ceiling for platform fee

    event SwapWithFee(
        address indexed user,
        address indexed pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOut,
        uint256 feeAmount,
        address treasury
    );

    /// @notice Execute swap with atomic protocol fee deduction in a single transaction.
    /// @param pool Address of the AMM pool (StableSwapPoolV3 or ConstantProductPoolV3)
    /// @param tokenIn Input ERC-20 token address
    /// @param tokenOut Output ERC-20 token address
    /// @param amountIn Total input amount approved by user
    /// @param minOut Minimum acceptable output amount (slippage protection)
    /// @param treasury Protocol treasury address to receive custom fee
    /// @param feeBps Fee in basis points (1 bps = 0.01%, 100 bps = 1.00%)
    /// @return amountOut The net output tokens sent to the user
    function swapWithFee(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address treasury,
        uint256 feeBps
    ) external nonReentrant returns (uint256 amountOut) {
        if (pool == address(0) || tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();

        // 1. Calculate fee and net swap amount
        uint256 feeAmount = 0;
        if (feeBps > 0 && treasury != address(0)) {
            feeAmount = (amountIn * feeBps) / 10000;
        }
        uint256 netAmountIn = amountIn - feeAmount;

        // 2. Pull amountIn from user to router
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);

        // 3. Forward fee directly to treasury
        if (feeAmount > 0) {
            _safeTransfer(tokenIn, treasury, feeAmount);
        }

        // 4. Ensure pool has allowance to pull netAmountIn from router
        uint256 currentAllowance = IERC20Like(tokenIn).allowance(address(this), pool);
        if (currentAllowance < netAmountIn) {
            _safeApprove(tokenIn, pool, type(uint256).max);
        }

        // 5. Execute pool swap (pool transfers output tokens to router)
        amountOut = ISwapPool(pool).swap(tokenIn, tokenOut, netAmountIn, minOut);
        if (amountOut < minOut) revert SlippageExceeded();

        // 6. Forward output tokens directly to user
        _safeTransfer(tokenOut, msg.sender, amountOut);

        emit SwapWithFee(msg.sender, pool, tokenIn, tokenOut, amountIn, amountOut, feeAmount, treasury);
    }

    function _safeTransfer(address token, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Like.transfer.selector, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeTransferFrom(address token, address from, address to, uint256 value) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Like.transferFrom.selector, from, to, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) revert TransferFailed();
    }

    function _safeApprove(address token, address spender, uint256 value) internal {
        (bool success, bytes memory data) = token.call(
            abi.encodeWithSelector(IERC20Like.approve.selector, spender, value)
        );
        if (!success || (data.length != 0 && !abi.decode(data, (bool)))) {
            // Attempt reset to 0 then set value
            (bool resetSuccess, ) = token.call(
                abi.encodeWithSelector(IERC20Like.approve.selector, spender, 0)
            );
            resetSuccess;
            (bool retrySuccess, bytes memory retryData) = token.call(
                abi.encodeWithSelector(IERC20Like.approve.selector, spender, value)
            );
            if (!retrySuccess || (retryData.length != 0 && !abi.decode(retryData, (bool)))) revert TransferFailed();
        }
    }
}
