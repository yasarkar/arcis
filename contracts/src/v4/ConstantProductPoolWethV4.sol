// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "../interfaces/IERC20Like.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {LpFeeAccounting} from "./LpFeeAccounting.sol";

/// @notice Arcis USDC / WETH Constant-Product Pool V4 (x * y = k) with Real-Yield Fee Harvest.
/// @dev Pair: USDC (6 decimals, tokenA) / WETH (18 decimals, tokenB).
///      LP token: 18 decimals — initial shares = sqrt(amountA * amountB) * 1e6.
///      The 1e6 scalar normalises geometric-mean units (6+18=24 dec / 2 = 12 dec raw sqrt)
///      up to standard 18-decimal ERC-20 shares. MINIMUM_LIQUIDITY = 1000 wei LP locked to
///      DEAD_ADDRESS on the first deposit to anchor the exchange rate and prevent inflation attacks.
///
///      Arc Network Note: native gas on Arc IS USDC (18 dec), but this contract interacts
///      only with the 6-decimal USDC ERC-20 interface. No receive() / fallback() is defined,
///      so any attempt to send native value reverts at the EVM level.
contract ConstantProductPoolWethV4 is ERC20, ReentrancyGuard, Pausable, Ownable, LpFeeAccounting {
    // ── Immutables & Constants ────────────────────────────────────────────────
    IERC20Like public immutable tokenA; // USDC (6 decimals)
    IERC20Like public immutable tokenB; // WETH (18 decimals)

    uint256 public immutable swapFeeBps;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    // ── Mutable Pool State ────────────────────────────────────────────────────
    uint256 public reserveA; // live USDC reserve (excludes feeReserveA)
    uint256 public reserveB; // live WETH reserve (excludes feeReserveB)

    // 24-hour rolling volume counters, lazy-reset on swap
    uint256 public e24hVolumeA;
    uint256 public e24hVolumeB;
    uint256 public e24hWindowStart;

    // ── Custom Errors ─────────────────────────────────────────────────────────
    error ZeroAmount();
    error InvalidFeeBps();
    error NotEnoughLP();
    error SlippageExceeded();
    error InvalidTokenPair();
    error ZeroAddress();
    error KInvariantViolated();

    // ── Events ────────────────────────────────────────────────────────────────
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpMinted);
    event LiquidityRemoved(address indexed provider, uint256 lpAmount, uint256 amountA, uint256 amountB);
    event Swapped(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _tokenA,
        address _tokenB,
        uint256 _swapFeeBps,
        address _initialOwner
    )
        ERC20("Arcis USDC-WETH LP v4", "af-USDC-WETH-v4")
        Ownable(_initialOwner)
    {
        if (_tokenA == address(0) || _tokenB == address(0)) revert ZeroAddress();
        if (_tokenA == _tokenB) revert InvalidTokenPair();
        if (_swapFeeBps > 1000) revert InvalidFeeBps();
        // H-1: verify both addresses are deployed contracts, not EOAs or zero-bytecode addresses
        if (address(_tokenA).code.length == 0) revert ZeroAddress();
        if (address(_tokenB).code.length == 0) revert ZeroAddress();

        tokenA = IERC20Like(_tokenA);
        tokenB = IERC20Like(_tokenB);
        swapFeeBps = _swapFeeBps;
        e24hWindowStart = block.timestamp;
    }

    // ── Backward-Compatible Getters ───────────────────────────────────────────
    function totalLp() external view returns (uint256) { return totalSupply(); }
    function unclaimedFeeA() external view returns (uint256) { return feeReserveA; }
    function unclaimedFeeB() external view returns (uint256) { return feeReserveB; }

    function volume24hA() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeA;
    }
    function volume24hB() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeB;
    }

    // ── LpFeeAccounting Hooks ─────────────────────────────────────────────────

    /// @dev Eligible supply excludes permanently locked DEAD_ADDRESS shares so the
    ///      "dead" LP never accrues harvestable fees, preventing permanent fee lock.
    function _eligibleLpSupply() internal view override returns (uint256) {
        uint256 dead = balanceOf(DEAD_ADDRESS);
        uint256 total = totalSupply();
        return total > dead ? total - dead : 0;
    }

    function _lpBalanceOf(address account) internal view override returns (uint256) {
        return balanceOf(account);
    }

    /// @dev C-1 fix: self-transfers (from == to) skip fee accounting entirely to prevent
    ///      double-counting of userUnclaimedA/B.
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

    /// @notice Add USDC + WETH liquidity. Slippage protected.
    /// @dev L-1 fix: tokens are pulled from caller BEFORE _mint so that any revert
    ///      in _safeTransferFrom rolls back without having issued LP shares first (CEI).
    ///      Initial LP = sqrt(amountA * amountB) * 1e6 to standardise both 6-dec and
    ///      18-dec inputs to an 18-dec LP token (sqrt of 24-dec product = 12-dec raw * 1e6 = 18-dec).
    function addLiquidity(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 lpShares)
    {
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 total = totalSupply();

        if (total == 0) {
            // geometric-mean normalisation: sqrt(6-dec * 18-dec) = 12-dec; * 1e6 = 18-dec LP
            uint256 rawSqrt = _sqrt(amountAIn * amountBIn);
            uint256 initialLp = rawSqrt * 1e6;
            if (initialLp <= MINIMUM_LIQUIDITY) revert ZeroAmount();

            // Pull tokens first (CEI) — if transfer fails, no LP is ever minted
            _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
            _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
            reserveA += amountAIn;
            reserveB += amountBIn;

            // Lock MINIMUM_LIQUIDITY permanently — anti-inflation anchor
            _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
            lpShares = initialLp - MINIMUM_LIQUIDITY;
        } else {
            uint256 lpA = (amountAIn * total) / reserveA;
            uint256 lpB = (amountBIn * total) / reserveB;
            lpShares = lpA < lpB ? lpA : lpB;

            if (lpShares == 0 || lpShares < minLpShares) revert SlippageExceeded();

            _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
            _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
            reserveA += amountAIn;
            reserveB += amountBIn;
        }

        if (lpShares == 0 || lpShares < minLpShares) revert SlippageExceeded();

        _mint(msg.sender, lpShares);

        emit LiquidityAdded(msg.sender, amountAIn, amountBIn, lpShares);
        return lpShares;
    }

    /// @notice Remove liquidity proportionally and burn LP shares.
    /// @dev Intentionally NOT gated by whenNotPaused — LPs must always be able to exit
    ///      even when trading is paused, to prevent "trapped LP" scenarios.
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

        // Burn before transfers (CEI)
        _burn(msg.sender, lpAmount);
        reserveA -= outA;
        reserveB -= outB;

        _safeTransfer(tokenA, msg.sender, outA);
        _safeTransfer(tokenB, msg.sender, outB);

        emit LiquidityRemoved(msg.sender, lpAmount, outA, outB);
        return (outA, outB);
    }

    // ── Swap ──────────────────────────────────────────────────────────────────

    /// @notice Swap tokenIn for tokenOut using x*y=k with fee isolation.
    /// @dev Fee is subtracted from amountIn BEFORE constant-product calculation.
    ///      M-1: 50% single-swap output cap prevents flash-loan price manipulation.
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
            // USDC → WETH
            amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);
            if (amountOut == 0) revert ZeroAmount();
            if (amountOut >= reserveB) revert KInvariantViolated();
            // M-1: 50% single-swap output cap
            if (amountOut > reserveB / 2) revert SlippageExceeded();
            if (amountOut < minOut) revert SlippageExceeded();

            _safeTransferFrom(tokenA, msg.sender, address(this), amountIn);
            _safeTransfer(tokenB, msg.sender, amountOut);

            reserveA += amountInAfterFee;
            reserveB -= amountOut;

            _distributeSwapFee(fee, 0);
            e24hVolumeA += amountIn;

        } else if (tokenIn == address(tokenB) && tokenOut == address(tokenA)) {
            // WETH → USDC
            amountOut = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee);
            if (amountOut == 0) revert ZeroAmount();
            if (amountOut >= reserveA) revert KInvariantViolated();
            // M-1: 50% single-swap output cap
            if (amountOut > reserveA / 2) revert SlippageExceeded();
            if (amountOut < minOut) revert SlippageExceeded();

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

    /// @notice Claim accrued swap fees in both USDC and WETH without exiting LP position.
    function harvest() external nonReentrant returns (uint256 feeA, uint256 feeB) {
        address lp = msg.sender;
        (feeA, feeB) = pendingFees(lp);
        if (feeA == 0 && feeB == 0) revert NoFeesAccrued();

        // Effects: settle state before any transfer
        userUnclaimedA[lp] = 0;
        userUnclaimedB[lp] = 0;
        userRewardDebtA[lp] = (balanceOf(lp) * accFeePerShareA) / PRECISION;
        userRewardDebtB[lp] = (balanceOf(lp) * accFeePerShareB) / PRECISION;

        // Interactions: transfer after state is clean
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

    // ── Internal Helpers ──────────────────────────────────────────────────────

    /// @dev Babylonian integer square root (rounds down).
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
