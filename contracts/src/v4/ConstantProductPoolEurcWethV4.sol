// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "../interfaces/IERC20Like.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
// M-01 fix: two-step ownership prevents irreversible misdirection of admin control.
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {LpFeeAccounting} from "./LpFeeAccounting.sol";

/// @notice Arcis EURC / WETH Constant-Product Pool V4 (x * y = k) with Real-Yield Fee Harvest.
/// @dev Pair: EURC (6 decimals, tokenA) / WETH (18 decimals, tokenB).
///      LP token: 18 decimals -- initial shares = sqrt(amountA * amountB) * 1e6.
///      The 1e6 scalar normalises geometric-mean units (6+18=24 dec / 2 = 12 dec raw sqrt)
///      up to standard 18-decimal ERC-20 shares. MINIMUM_LIQUIDITY = 1000 wei LP locked to
///      DEAD_ADDRESS on the first deposit to anchor the exchange rate and prevent inflation attacks.
///
///      Security features (original):
///        H-1: NoLiquidityProviders guard in swap() -- fees never orphaned when eligible supply=0.
///        H-3: DustSwapNotAllowed guard -- fee must be >= 1 wei; prevents free swaps.
///        M-1: Strict CEI in swap() -- reserve state written BEFORE output token is pushed.
///        M-2: minLpShares checked BEFORE tokens are pulled on the initial deposit path.
///        M-3: deadline parameter added to swap() and addLiquidity() -- MEV staleness protection.
///        M-5: skim() function added -- recovers stray token donations above tracked reserves.
///
///      Security features (audit remediation):
///        H-01: Off-ratio deposits revert -- amountBIn must be within maxAmountBIn; only optimal
///              amounts are transferred, protecting depositors from involuntary token donation.
///        M-01: Ownable2Step replaces Ownable -- two-step ownership handover prevents irreversible
///              misdirection to an incorrect or non-operational address.
///        M-02: swapFeeBps >= 1 enforced at construction -- zero-fee pools are explicitly rejected
///              to prevent silent LP starvation from accidental misconfiguration.
///        M-04: e24hVolumeA/B/e24hWindowStart are internal; volume24hA()/volume24hB() are the
///              only safe-to-read external view surfaces (stale-storage griefing via raw reads is closed).
///        L-01: _sqrt dust guard -- initialLp must produce rawSqrt >= 1e6 to prevent sub-1e12
///              anchor deposits that could anchor the pool at a garbage price.
///        L-02: Custom errors carry contextual parameters for on-chain telemetry and incident triage.
///        I-04: _eligibleLpSupply() called once per swap and result passed to _distributeSwapFee
///              (~400 gas saved per swap).
contract ConstantProductPoolEurcWethV4 is ERC20, ReentrancyGuard, Pausable, Ownable2Step, LpFeeAccounting {
    // ── Immutables & Constants ────────────────────────────────────────────────
    IERC20Like public immutable tokenA; // EURC (6 decimals)
    IERC20Like public immutable tokenB; // WETH (18 decimals)

    uint256 public immutable swapFeeBps;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    // ── Mutable Pool State ────────────────────────────────────────────────────
    uint256 public reserveA; // live EURC reserve (excludes feeReserveA)
    uint256 public reserveB; // live WETH reserve (excludes feeReserveB)

    // M-04 fix: 24-hour rolling volume counters made internal -- always read via volume24hA()/volume24hB()
    // to prevent integrators from consuming stale raw storage values after window expiry.
    uint256 internal e24hVolumeA;
    uint256 internal e24hVolumeB;
    uint256 internal e24hWindowStart;

    // ── Custom Errors (L-02 fix: carry contextual parameters) ─────────────────
    error ZeroAmount();
    /// @dev M-02: raised when swapFeeBps is 0 (forbidden) or > 1000 (exceeds 10%).
    error InvalidFeeBps(uint256 provided);
    error NotEnoughLP();
    /// @dev Carries (minOut, actualOut) so callers can see the exact slippage gap.
    error SlippageExceeded(uint256 minOut, uint256 actualOut);
    /// @dev Carries (tokenIn, tokenOut) to identify the invalid direction.
    error InvalidTokenPair(address tokenIn, address tokenOut);
    /// @dev Carries the offending address that was zero or non-contract.
    error ZeroAddress(address provided);
    error KInvariantViolated();
    /// @dev H-1: swap() reverts when no real LP holders remain, preventing fee orphaning.
    error NoLiquidityProviders();
    /// @dev H-3: swap() reverts when amountIn is so small that the fee rounds to zero.
    error DustSwapNotAllowed();
    /// @dev M-3: swap()/addLiquidity() revert when block.timestamp exceeds caller's deadline.
    error DeadlineExpired();
    /// @dev H-01: addLiquidity() reverts when the required tokenB amount exceeds the caller's cap.
    error ExcessiveTokenBRequired(uint256 required, uint256 maxAllowed);
    /// @dev H-01: addLiquidity() reverts when the required tokenA amount exceeds the caller's cap.
    error ExcessiveTokenARequired(uint256 required, uint256 maxAllowed);

    // ── Events ────────────────────────────────────────────────────────────────
    event LiquidityAdded(address indexed provider, uint256 amountA, uint256 amountB, uint256 lpMinted);
    event LiquidityRemoved(address indexed provider, uint256 lpAmount, uint256 amountA, uint256 amountB);
    event Swapped(address indexed user, address tokenIn, uint256 amountIn, uint256 amountOut);
    /// @dev M-5: emitted when the owner recovers stray tokens above tracked reserves.
    event SkimExecuted(address indexed token, address indexed to, uint256 amount);

    // ── Constructor ───────────────────────────────────────────────────────────
    constructor(
        address _tokenA,
        address _tokenB,
        uint256 _swapFeeBps,
        address _initialOwner
    )
        ERC20("Arcis EURC-WETH LP v4", "af-EURC-WETH-v4")
        Ownable(_initialOwner)
    {
        if (_tokenA == address(0)) revert ZeroAddress(_tokenA);
        if (_tokenB == address(0)) revert ZeroAddress(_tokenB);
        if (_tokenA == _tokenB) revert InvalidTokenPair(_tokenA, _tokenB);
        // M-02 fix: swapFeeBps must be >= 1 (zero-fee pools silently starve LPs of revenue).
        if (_swapFeeBps == 0 || _swapFeeBps > 1000) revert InvalidFeeBps(_swapFeeBps);
        // Verify both addresses are deployed contracts, not EOAs or zero-bytecode addresses.
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

    /// @notice Returns the rolling 24-hour EURC volume. Returns 0 when the window has expired.
    /// @dev M-04: always use this view rather than reading e24hVolumeA directly from storage.
    function volume24hA() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeA;
    }

    /// @notice Returns the rolling 24-hour WETH volume. Returns 0 when the window has expired.
    /// @dev M-04: always use this view rather than reading e24hVolumeB directly from storage.
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

    /// @notice Add EURC + WETH liquidity. Slippage and deadline protected.
    /// @param amountAIn    Desired EURC amount. On subsequent deposits this is the reference side;
    ///                     the required WETH is computed proportionally from it.
    /// @param amountBIn    Desired WETH amount. Used as the reference side only on the first deposit.
    ///                     On subsequent deposits this is used as an upper-bound cap (maxAmountBIn).
    /// @param minLpShares  Minimum LP shares the caller accepts (slippage guard).
    /// @param deadline     Unix timestamp after which the call reverts.
    ///
    /// @dev H-01 fix: subsequent deposits compute the exact proportional token amounts from
    ///      reserves and only pull those.  The caller expresses their tolerance via amountBIn
    ///      (treated as maxAmountBIn) and amountAIn (treated as maxAmountAIn on the other side).
    ///      If the required amount exceeds the caller's cap the call reverts -- no silent excess
    ///      donation is possible.
    function addLiquidity(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares, uint256 deadline)
        public
        nonReentrant
        whenNotPaused
        returns (uint256 lpShares)
    {
        return _addLiquidityInternal(amountAIn, amountBIn, minLpShares, deadline);
    }

    /// @notice Backward-compatible overload without deadline (defaults to 20 min from block.timestamp).
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
        // M-3: deadline check
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 total = totalSupply();

        if (total == 0) {
            // ── First deposit ──────────────────────────────────────────────────
            // geometric-mean normalisation: sqrt(6-dec * 18-dec) = 12-dec; * 1e6 = 18-dec LP
            uint256 rawSqrt = _sqrt(amountAIn * amountBIn);
            // L-01 fix: rawSqrt must be >= 1e6 to guarantee at least 1e12 LP before the
            // MINIMUM_LIQUIDITY deduction, preventing garbage-price anchor deposits.
            if (rawSqrt < 1e6) revert ZeroAmount();
            uint256 initialLp = rawSqrt * 1e6;
            if (initialLp <= MINIMUM_LIQUIDITY) revert ZeroAmount();

            // M-2 fix: check slippage BEFORE pulling tokens so a failing check wastes no gas on transfers
            lpShares = initialLp - MINIMUM_LIQUIDITY;
            if (lpShares < minLpShares) revert SlippageExceeded(minLpShares, lpShares);

            // Pull tokens (CEI: checks above, effects below, interactions last for mint)
            _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
            _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
            reserveA += amountAIn;
            reserveB += amountBIn;

            // Lock MINIMUM_LIQUIDITY permanently -- anti-inflation anchor
            _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);

        } else {
            // ── Subsequent deposits (H-01 fix) ────────────────────────────────
            // Compute the optimal proportional tokenB amount from the caller's desired tokenA.
            // Only pull what the pool ratio requires -- no silent excess donation possible.
            //
            // optimalB = amountAIn * reserveB / reserveA (proportional to tokenA side)
            // If optimalB <= amountBIn (caller's cap) use tokenA as the reference side.
            // Otherwise flip: compute optimalA from amountBIn and use tokenB as the reference.
            uint256 optimalB = (amountAIn * reserveB) / reserveA;

            uint256 actualA;
            uint256 actualB;

            if (optimalB <= amountBIn) {
                // tokenA is the limiting side; pull amountAIn and computed optimalB
                actualA = amountAIn;
                actualB = optimalB;
            } else {
                // tokenB is the limiting side; back-compute the required tokenA
                uint256 optimalA = (amountBIn * reserveA) / reserveB;
                if (optimalA > amountAIn) revert ExcessiveTokenARequired(optimalA, amountAIn);
                actualA = optimalA;
                actualB = amountBIn;
            }

            // lpShares proportional to the limiting side
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
    /// @dev Intentionally NOT gated by whenNotPaused -- LPs must always be able to exit
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

        if (outA < minOutA) revert SlippageExceeded(minOutA, outA);
        if (outB < minOutB) revert SlippageExceeded(minOutB, outB);

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

    /// @notice Swap tokenIn for tokenOut using x*y=k with fee isolation and deadline protection.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        public
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        return _swapInternal(tokenIn, tokenOut, amountIn, minOut, deadline);
    }

    /// @notice Backward-compatible swap overload for ArcisSwapRouter and standard AMM callers (defaults to 20 min deadline).
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
        // M-3: deadline check
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountIn == 0) revert ZeroAmount();

        // I-04 fix: compute eligible supply once and reuse in _distributeSwapFee to save ~400 gas.
        uint256 eligibleSupply = _eligibleLpSupply();
        // H-1: refuse swaps when no real LP holders remain -- prevents fee orphaning
        if (eligibleSupply == 0) revert NoLiquidityProviders();

        uint256 fee = (amountIn * swapFeeBps) / 10000;
        // H-3: reject dust swaps whose fee rounds to zero
        if (fee == 0 && swapFeeBps > 0) revert DustSwapNotAllowed();
        uint256 amountInAfterFee = amountIn - fee;

        // Lazy-reset 24-hour volume window
        if (block.timestamp - e24hWindowStart >= 1 days) {
            e24hVolumeA = 0;
            e24hVolumeB = 0;
            e24hWindowStart = block.timestamp;
        }

        if (tokenIn == address(tokenA) && tokenOut == address(tokenB)) {
            // EURC -> WETH
            amountOut = (reserveB * amountInAfterFee) / (reserveA + amountInAfterFee);
            if (amountOut == 0) revert ZeroAmount();
            if (amountOut >= reserveB) revert KInvariantViolated();
            // 50% single-swap output cap
            if (amountOut > reserveB / 2) revert SlippageExceeded(minOut, amountOut);
            if (amountOut < minOut) revert SlippageExceeded(minOut, amountOut);

            // Pull input token
            _safeTransferFrom(tokenA, msg.sender, address(this), amountIn);
            // M-1 fix: update reserves and distribute fee BEFORE pushing output token
            reserveA += amountInAfterFee;
            reserveB -= amountOut;
            _distributeSwapFeeWithSupply(fee, 0, eligibleSupply);
            e24hVolumeA += amountIn;
            // Push output token last (strict CEI -- state already settled above)
            _safeTransfer(tokenB, msg.sender, amountOut);

        } else if (tokenIn == address(tokenB) && tokenOut == address(tokenA)) {
            // WETH -> EURC
            amountOut = (reserveA * amountInAfterFee) / (reserveB + amountInAfterFee);
            if (amountOut == 0) revert ZeroAmount();
            if (amountOut >= reserveA) revert KInvariantViolated();
            // 50% single-swap output cap
            if (amountOut > reserveA / 2) revert SlippageExceeded(minOut, amountOut);
            if (amountOut < minOut) revert SlippageExceeded(minOut, amountOut);

            // Pull input token
            _safeTransferFrom(tokenB, msg.sender, address(this), amountIn);
            // M-1 fix: update reserves and distribute fee BEFORE pushing output token
            reserveB += amountInAfterFee;
            reserveA -= amountOut;
            _distributeSwapFeeWithSupply(0, fee, eligibleSupply);
            e24hVolumeB += amountIn;
            // Push output token last (strict CEI -- state already settled above)
            _safeTransfer(tokenA, msg.sender, amountOut);

        } else {
            revert InvalidTokenPair(tokenIn, tokenOut);
        }

        emit Swapped(msg.sender, tokenIn, amountIn, amountOut);
        return amountOut;
    }

    // ── Real Yield Harvest ────────────────────────────────────────────────────

    /// @notice Claim accrued swap fees in both EURC and WETH without exiting LP position.
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

    // ── Token Recovery ────────────────────────────────────────────────────────

    /// @notice Recover excess tokens (stray donations) sent directly to this contract.
    /// @dev M-5 fix: only withdraws the surplus above (reserveX + feeReserveX) so AMM
    ///      reserves and the fee pool are never touched.
    /// @param token   ERC-20 token to skim.
    /// @param to      Destination address for the excess tokens.
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

    /// @dev Babylonian integer square root (rounds down).
    ///      Returns 0 for y == 0; returns 1 for y in {1, 2, 3} (correct floor).
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
