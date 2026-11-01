// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "./interfaces/IERC20Like.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ISwapPool {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) external returns (uint256 amountOut);
}

/// @notice Pool interface requiring a caller-supplied swap deadline.
interface ISwapPoolDeadline {
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        external returns (uint256 amountOut);
}

/// @title ArcisSwapRouter
/// @notice Single-transaction swap router with atomic platform fee forwarding for Arcis AMM pools on Arc Network.
/// @dev Eliminates secondary approval/transfer popups for EOA wallets (MetaMask) by batching fee collection and pool swap.
///      Supported tokens are plain, balance-stable ERC-20s; taxed or rebasing input tokens are unsupported.
contract ArcisSwapRouter is ReentrancyGuard {
    error ZeroAddress();
    error ZeroAmount();
    error FeeTooHigh();
    error SlippageExceeded();
    error TransferFailed();
    error DeadlineExpired();
    error SameToken();
    error UnsupportedToken();
    error TreasuryIsRouter();

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
    /// @param minOut Minimum acceptable output amount received by the user (slippage protection)
    /// @param treasury Protocol treasury address to receive custom fee
    /// @param feeBps Fee in basis points (1 bps = 0.01%, 100 bps = 1.00%)
    /// @return amountOut The measured net output tokens received by the user
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
        if (tokenIn == tokenOut) revert SameToken();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();

        // 1. Calculate fee and net swap amount
        uint256 feeAmount = 0;
        if (feeBps > 0 && treasury != address(0)) {
            if (treasury == address(this)) revert TreasuryIsRouter();
            feeAmount = (amountIn * feeBps) / 10000;
        }
        uint256 netAmountIn = amountIn - feeAmount;

        // 2. Snapshot existing input funds, then pull amountIn from user to router
        uint256 inputBalanceBefore = IERC20Like(tokenIn).balanceOf(address(this));
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        {
            uint256 inputBalanceAfter = IERC20Like(tokenIn).balanceOf(address(this));
            if (inputBalanceAfter < inputBalanceBefore || inputBalanceAfter - inputBalanceBefore != amountIn) {
                revert UnsupportedToken();
            }
        }

        // 3. Forward fee directly to treasury
        if (feeAmount > 0) {
            _safeTransfer(tokenIn, treasury, feeAmount);
        }

        // 4-5. Approve only this swap's input, execute, revoke and measure output
        amountOut = _executeSwap(pool, tokenIn, tokenOut, netAmountIn, minOut, 0, false);
        _refundUnspent(tokenIn, inputBalanceBefore, netAmountIn);

        // 6. Forward only this swap's output tokens directly to user
        {
            uint256 userBalanceBefore = IERC20Like(tokenOut).balanceOf(msg.sender);
            _safeTransfer(tokenOut, msg.sender, amountOut);
            uint256 userBalanceAfter = IERC20Like(tokenOut).balanceOf(msg.sender);
            if (userBalanceAfter < userBalanceBefore) revert SlippageExceeded();
            amountOut = userBalanceAfter - userBalanceBefore;
            if (amountOut < minOut) revert SlippageExceeded();
        }

        emit SwapWithFee(msg.sender, pool, tokenIn, tokenOut, amountIn, amountOut, feeAmount, treasury);
    }

    /// @notice Execute a swap with atomic protocol fee deduction and an explicit deadline.
    /// @dev Uses the pool's five-argument swap; the deadline is checked before pulling funds
    ///      and forwarded unchanged. Fee, slippage, allowance handling and SwapWithFee emission
    ///      match swapWithFee, which remains the entry point for four-argument pools.
    /// @param pool Address of the AMM pool implementing ISwapPoolDeadline
    /// @param tokenIn Input ERC-20 token address
    /// @param tokenOut Output ERC-20 token address
    /// @param amountIn Total input amount approved by user
    /// @param minOut Minimum acceptable output amount received by the user (slippage protection)
    /// @param treasury Protocol treasury address to receive custom fee
    /// @param feeBps Fee in basis points (1 bps = 0.01%, 100 bps = 1.00%)
    /// @param deadline Last acceptable block timestamp (inclusive), supplied by the caller
    /// @return amountOut The measured net output tokens received by the user
    function swapWithFeeAndDeadline(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 minOut,
        address treasury,
        uint256 feeBps,
        uint256 deadline
    ) external nonReentrant returns (uint256 amountOut) {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (pool == address(0) || tokenIn == address(0) || tokenOut == address(0)) revert ZeroAddress();
        if (amountIn == 0) revert ZeroAmount();
        if (tokenIn == tokenOut) revert SameToken();
        if (feeBps > MAX_FEE_BPS) revert FeeTooHigh();

        // 1. Calculate fee and net swap amount
        uint256 feeAmount = 0;
        if (feeBps > 0 && treasury != address(0)) {
            if (treasury == address(this)) revert TreasuryIsRouter();
            feeAmount = (amountIn * feeBps) / 10000;
        }
        uint256 netAmountIn = amountIn - feeAmount;

        // 2. Snapshot existing input funds, then pull amountIn from user to router
        uint256 inputBalanceBefore = IERC20Like(tokenIn).balanceOf(address(this));
        _safeTransferFrom(tokenIn, msg.sender, address(this), amountIn);
        {
            uint256 inputBalanceAfter = IERC20Like(tokenIn).balanceOf(address(this));
            if (inputBalanceAfter < inputBalanceBefore || inputBalanceAfter - inputBalanceBefore != amountIn) {
                revert UnsupportedToken();
            }
        }

        // 3. Forward fee directly to treasury
        if (feeAmount > 0) {
            _safeTransfer(tokenIn, treasury, feeAmount);
        }

        // 4-5. Execute with the caller's deadline and the same per-call accounting
        amountOut = _executeSwap(pool, tokenIn, tokenOut, netAmountIn, minOut, deadline, true);
        _refundUnspent(tokenIn, inputBalanceBefore, netAmountIn);

        // 6. Forward only this swap's output tokens directly to user
        {
            uint256 userBalanceBefore = IERC20Like(tokenOut).balanceOf(msg.sender);
            _safeTransfer(tokenOut, msg.sender, amountOut);
            uint256 userBalanceAfter = IERC20Like(tokenOut).balanceOf(msg.sender);
            if (userBalanceAfter < userBalanceBefore) revert SlippageExceeded();
            amountOut = userBalanceAfter - userBalanceBefore;
            if (amountOut < minOut) revert SlippageExceeded();
        }

        emit SwapWithFee(msg.sender, pool, tokenIn, tokenOut, amountIn, amountOut, feeAmount, treasury);
    }

    /// @dev Grants an exact, temporary allowance and accounts only for newly received output.
    function _executeSwap(
        address pool,
        address tokenIn,
        address tokenOut,
        uint256 netAmountIn,
        uint256 minOut,
        uint256 deadline,
        bool useDeadline
    ) internal returns (uint256 amountOut) {
        if (IERC20Like(tokenIn).allowance(address(this), pool) != 0) {
            _safeApprove(tokenIn, pool, 0);
        }
        _safeApprove(tokenIn, pool, netAmountIn);

        uint256 outputBalanceBefore = IERC20Like(tokenOut).balanceOf(address(this));
        uint256 reportedAmountOut = useDeadline
            ? ISwapPoolDeadline(pool).swap(tokenIn, tokenOut, netAmountIn, minOut, deadline)
            : ISwapPool(pool).swap(tokenIn, tokenOut, netAmountIn, minOut);
        uint256 outputBalanceAfter = IERC20Like(tokenOut).balanceOf(address(this));
        _safeApprove(tokenIn, pool, 0);
        if (outputBalanceAfter < outputBalanceBefore) revert SlippageExceeded();
        amountOut = outputBalanceAfter - outputBalanceBefore;
        if (reportedAmountOut < amountOut || amountOut < minOut) revert SlippageExceeded();
    }

    /// @dev Refunds at most this call's net input, never the protected input balance.
    function _refundUnspent(address tokenIn, uint256 inputBalanceBefore, uint256 netAmountIn) internal {
        uint256 inputBalanceAfter = IERC20Like(tokenIn).balanceOf(address(this));
        if (inputBalanceAfter > inputBalanceBefore) {
            uint256 unspent = inputBalanceAfter - inputBalanceBefore;
            if (unspent > netAmountIn) unspent = netAmountIn;
            _safeTransfer(tokenIn, msg.sender, unspent);
        }
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
