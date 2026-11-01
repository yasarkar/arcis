// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Like} from "../interfaces/IERC20Like.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {LpFeeAccounting} from "./LpFeeAccounting.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Arcis EURC / cirBTC Constant-Product Pool V4 (x * y = k) with Real-Yield Fee Harvest.
/// @dev Pair: EURC (6 decimals, tokenA) / cirBTC (8 decimals, tokenB).
///      LP token: 18 decimals -- initial shares = sqrt(amountA * amountB) * 1e11.
///      The 1e11 scalar normalises geometric-mean units (6+8=14 dec / 2 = 7 dec raw sqrt)
///      up to standard 18-decimal ERC-20 shares. MINIMUM_LIQUIDITY = 1000 wei LP locked to
///      DEAD_ADDRESS on the first deposit to anchor the exchange rate and prevent inflation attacks.
///
///      Security features:
///        - H-01: Off-ratio deposits revert or cap -- only optimal proportional amounts are transferred.
///        - M-01: Ownable2Step prevents irreversible misdirection of contract ownership.
///        - M-02: swapFeeBps >= 1 enforced at construction -- zero-fee pools are rejected.
///        - M-04: e24hVolumeA/B internal; volume24hA()/volume24hB() provide safe view surfaces.
///        - H-1: NoLiquidityProviders guard in swap() -- fees never orphaned when eligible supply=0.
///        - F-05: Swap fees round up; non-zero inputs pay at least one raw unit.
///        - M-1: Strict CEI in swap() -- reserve state written BEFORE output token is pushed.
///        - M-2: minLpShares checked BEFORE tokens are pulled on the initial deposit path.
///        - M-3: Explicit deadline required for swap() and addLiquidity() -- MEV staleness protection.
///        - F-01..F-04: Magnified fee corrections, rounded-up deposits, required deadlines, renounce disabled.
///        - F-06: Last real LP sweeps reserves; an emptied pool restarts without relocking dead shares.
///        - F-07: LP added in a block cannot be withdrawn, transferred or harvested until a later block (block.number).
///        - F-08: Withdrawals and harvests support recipients; zero-amount token transfers are skipped.
///        - F-09: Volume getters describe a resettable window, not rolling volume.
///        - M-5: skim() function recovers stray token donations above tracked reserves.
///        - 50% single-swap output cap prevents flash-loan reserve drainage.
contract ConstantProductPoolEurcCirBtcV4 is ERC20, ReentrancyGuard, Pausable, Ownable2Step, LpFeeAccounting {
    // ── Immutables & Constants ────────────────────────────────────────────────
    IERC20Like public immutable tokenA; // EURC   (6 decimals)
    IERC20Like public immutable tokenB; // cirBTC (8 decimals)

    uint256 public immutable swapFeeBps;

    uint256 public constant MINIMUM_LIQUIDITY = 1000;
    address public constant DEAD_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    // ── Mutable Pool State ────────────────────────────────────────────────────
    uint256 public reserveA; // live EURC reserve (excludes feeReserveA)
    uint256 public reserveB; // live cirBTC reserve (excludes feeReserveB)

    uint256 internal e24hVolumeA;
    uint256 internal e24hVolumeB;
    uint256 internal e24hWindowStart;

    mapping(address => uint256) public lastLiquidityBlock;

    // ── Custom Errors ─────────────────────────────────────────────────────────
    error ZeroAmount();
    error InvalidFeeBps(uint256 provided);
    error NotEnoughLP();
    error SlippageExceeded(uint256 minExpected, uint256 actual);
    error OutputCapExceeded(uint256 amountOut, uint256 maxAmountOut);
    error InvalidTokenPair(address tokenIn, address tokenOut);
    error ZeroAddress(address provided);
    error KInvariantViolated();
    error NoLiquidityProviders();
    error DustSwapNotAllowed();
    error DeadlineExpired();
    error ExcessiveTokenBRequired(uint256 required, uint256 maxAllowed);
    error ExcessiveTokenARequired(uint256 required, uint256 maxAllowed);
    error RenounceDisabled();
    error LiquidityLockedThisBlock();
    error DeadAddressTransferBlocked();

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
        ERC20("Arcis EURC-cirBTC LP v4", "af-EURC-cirBTC-v4")
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

    /// @notice Returns EURC volume accumulated in the current window, or 0 once the window has expired.
    /// @dev The window resets at the first swap after 24 hours; this is not a rolling total.
    function volume24hA() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeA;
    }

    /// @notice Returns cirBTC volume accumulated in the current window, or 0 once the window has expired.
    /// @dev The window resets at the first swap after 24 hours; this is not a rolling total.
    function volume24hB() external view returns (uint256) {
        if (block.timestamp - e24hWindowStart >= 1 days) return 0;
        return e24hVolumeB;
    }

    // ── LpFeeAccounting Hooks ─────────────────────────────────────────────────

    /// @dev Eligible supply excludes permanently locked DEAD_ADDRESS shares.
    function _eligibleLpSupply() internal view override returns (uint256) {
        uint256 dead = balanceOf(DEAD_ADDRESS);
        uint256 total = totalSupply();
        return total > dead ? total - dead : 0;
    }

    function _lpBalanceOf(address account) internal view override returns (uint256) {
        return balanceOf(account);
    }

    function _usesMagnifiedCorrections() internal pure override returns (bool) {
        return true;
    }

    function _isFeeExcluded(address account) internal pure override returns (bool) {
        return account == DEAD_ADDRESS;
    }

    /// @dev Self-transfers skip fee accounting to prevent double-counting.
    ///      Transfers out and burns remain locked in the minter's addLiquidity block, even while paused.
    function _update(address from, address to, uint256 value) internal override {
        // The dead balance is fixed at MINIMUM_LIQUIDITY (minted once). Letting holders add more would create
        // shares that no longer match the reserves once the last LP exits and the pool restarts.
        if (to == DEAD_ADDRESS && from != address(0)) revert DeadAddressTransferBlocked();
        if (from != address(0) && block.number <= lastLiquidityBlock[from]) revert LiquidityLockedThisBlock();
        super._update(from, to, value);
        if (from == to) return;
        // Accumulators change only in swaps, never during the balance update above.
        if (from != address(0) && !_isFeeExcluded(from)) {
            corrA[from] += int256(accFeePerShareA * value);
            corrB[from] += int256(accFeePerShareB * value);
        }
        if (to != address(0) && !_isFeeExcluded(to)) {
            corrA[to] -= int256(accFeePerShareA * value);
            corrB[to] -= int256(accFeePerShareB * value);
        }
    }

    // ── Admin ─────────────────────────────────────────────────────────────────
    function pause()   external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }
    function renounceOwnership() public view override onlyOwner { revert RenounceDisabled(); }

    // ── Liquidity Management ──────────────────────────────────────────────────

    /// @notice Add EURC + cirBTC liquidity; an explicit deadline is required.
    /// @dev Uses block.number: LP added in a block cannot be withdrawn, transferred or harvested until a later block.
    ///      Only the minter's lock is updated; incoming LP transfers do not lock recipients.
    ///      The lock covers the minter's whole balance, so a custodian that serves withdrawals for many users
    ///      should not top up in the same block it executes them.
    function addLiquidity(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares, uint256 deadline)
        public
        nonReentrant
        whenNotPaused
        returns (uint256 lpShares)
    {
        lastLiquidityBlock[msg.sender] = block.number;
        return _addLiquidityInternal(amountAIn, amountBIn, minLpShares, deadline);
    }

    function _addLiquidityInternal(uint256 amountAIn, uint256 amountBIn, uint256 minLpShares, uint256 deadline)
        internal
        returns (uint256 lpShares)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountAIn == 0 || amountBIn == 0) revert ZeroAmount();

        uint256 total = totalSupply();

        if (total == 0 || reserveA == 0 || reserveB == 0) {
            // Initial or restart deposit: geometric-mean normalization
            // sqrt(6-dec * 8-dec) = 7-dec; * 1e11 = 18-dec LP
            uint256 rawSqrt = _sqrt(amountAIn * amountBIn);
            if (rawSqrt < 1e3) revert ZeroAmount();
            uint256 initialLp = rawSqrt * 1e11;
            if (initialLp <= MINIMUM_LIQUIDITY) revert ZeroAmount();

            lpShares = total == 0 ? initialLp - MINIMUM_LIQUIDITY : initialLp;
            if (lpShares < minLpShares) revert SlippageExceeded(minLpShares, lpShares);

            _safeTransferFrom(tokenA, msg.sender, address(this), amountAIn);
            _safeTransferFrom(tokenB, msg.sender, address(this), amountBIn);
            reserveA += amountAIn;
            reserveB += amountBIn;

            if (total == 0) _mint(DEAD_ADDRESS, MINIMUM_LIQUIDITY);
        } else {
            // Subsequent deposits: price shares from both tokens, round contributions up.
            lpShares = Math.min((amountAIn * total) / reserveA, (amountBIn * total) / reserveB);
            if (lpShares == 0 || lpShares < minLpShares) revert SlippageExceeded(minLpShares, lpShares);

            uint256 actualA = Math.ceilDiv(lpShares * reserveA, total);
            uint256 actualB = Math.ceilDiv(lpShares * reserveB, total);
            if (actualA > amountAIn) revert ExcessiveTokenARequired(actualA, amountAIn);
            if (actualB > amountBIn) revert ExcessiveTokenBRequired(actualB, amountBIn);

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

    /// @notice Remove liquidity and burn the caller's LP shares, sending tokens to the caller.
    /// @dev Not gated by whenNotPaused; the block.number liquidity lock still applies.
    function removeLiquidity(uint256 lpAmount, uint256 minOutA, uint256 minOutB)
        external
        nonReentrant
        returns (uint256 outA, uint256 outB)
    {
        return _removeLiquidityInternal(lpAmount, minOutA, minOutB, msg.sender);
    }

    /// @notice Remove liquidity and burn the caller's LP shares, sending tokens to a non-zero recipient.
    /// @dev Not gated by whenNotPaused; the block.number liquidity lock still applies.
    function removeLiquidity(uint256 lpAmount, uint256 minOutA, uint256 minOutB, address to)
        external
        nonReentrant
        returns (uint256 outA, uint256 outB)
    {
        return _removeLiquidityInternal(lpAmount, minOutA, minOutB, to);
    }

    function _removeLiquidityInternal(uint256 lpAmount, uint256 minOutA, uint256 minOutB, address to)
        internal
        returns (uint256 outA, uint256 outB)
    {
        if (to == address(0)) revert ZeroAddress(to);
        if (lpAmount == 0) revert ZeroAmount();
        uint256 total = totalSupply();
        if (lpAmount > total) revert NotEnoughLP();
        if (lpAmount > balanceOf(msg.sender)) revert NotEnoughLP();

        if (lpAmount == _eligibleLpSupply()) {
            // The last real LP receives all remaining trading reserves, leaving a restartable pool.
            outA = reserveA;
            outB = reserveB;
        } else {
            outA = (reserveA * lpAmount) / total;
            outB = (reserveB * lpAmount) / total;
        }

        if (outA < minOutA) revert SlippageExceeded(minOutA, outA);
        if (outB < minOutB) revert SlippageExceeded(minOutB, outB);

        _burn(msg.sender, lpAmount);
        reserveA -= outA;
        reserveB -= outB;

        emit LiquidityRemoved(msg.sender, lpAmount, outA, outB);

        if (outA > 0) _safeTransfer(tokenA, to, outA);
        if (outB > 0) _safeTransfer(tokenB, to, outB);
        return (outA, outB);
    }

    // ── Swap ──────────────────────────────────────────────────────────────────

    /// @notice Swap tokenIn for tokenOut using x*y=k with fee isolation; an explicit deadline is required.
    function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        public
        nonReentrant
        whenNotPaused
        returns (uint256 amountOut)
    {
        return _swapInternal(tokenIn, tokenOut, amountIn, minOut, deadline);
    }

    function _swapInternal(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut, uint256 deadline)
        internal
        returns (uint256 amountOut)
    {
        if (block.timestamp > deadline) revert DeadlineExpired();
        if (amountIn == 0) revert ZeroAmount();

        uint256 eligibleSupply = _eligibleLpSupply();
        if (eligibleSupply == 0) revert NoLiquidityProviders();

        uint256 fee = Math.ceilDiv(amountIn * swapFeeBps, 10000);
        uint256 amountInAfterFee = amountIn - fee;

        if (block.timestamp - e24hWindowStart >= 1 days) {
            e24hVolumeA = 0;
            e24hVolumeB = 0;
            e24hWindowStart = block.timestamp;
        }

        uint256 cachedReserveA = reserveA;
        uint256 cachedReserveB = reserveB;

        if (tokenIn == address(tokenA) && tokenOut == address(tokenB)) {
            // EURC -> cirBTC
            amountOut = (cachedReserveB * amountInAfterFee) / (cachedReserveA + amountInAfterFee);
            if (amountOut == 0) revert ZeroAmount();
            // 50% single-swap output cap
            if (amountOut > cachedReserveB / 2) revert OutputCapExceeded(amountOut, cachedReserveB / 2);
            if (amountOut < minOut) revert SlippageExceeded(minOut, amountOut);

            _safeTransferFrom(tokenA, msg.sender, address(this), amountIn);
            reserveA = cachedReserveA + amountInAfterFee;
            reserveB = cachedReserveB - amountOut;
            _distributeSwapFeeWithSupply(fee, 0, eligibleSupply);
            e24hVolumeA += amountIn;
            _safeTransfer(tokenB, msg.sender, amountOut);

        } else if (tokenIn == address(tokenB) && tokenOut == address(tokenA)) {
            // cirBTC -> EURC
            amountOut = (cachedReserveA * amountInAfterFee) / (cachedReserveB + amountInAfterFee);
            if (amountOut == 0) revert ZeroAmount();
            // 50% single-swap output cap
            if (amountOut > cachedReserveA / 2) revert OutputCapExceeded(amountOut, cachedReserveA / 2);
            if (amountOut < minOut) revert SlippageExceeded(minOut, amountOut);

            _safeTransferFrom(tokenB, msg.sender, address(this), amountIn);
            reserveB = cachedReserveB + amountInAfterFee;
            reserveA = cachedReserveA - amountOut;
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

    /// @notice Claim accrued swap fees in both EURC and cirBTC without exiting LP position.
    /// @dev Uses block.number: the caller cannot harvest in the block in which they added liquidity.
    function harvest() external nonReentrant returns (uint256 feeA, uint256 feeB) {
        return _harvestInternal(msg.sender);
    }

    /// @notice Claim the caller's accrued swap fees, sending tokens to a non-zero recipient.
    /// @dev Uses block.number: the caller cannot harvest in the block in which they added liquidity.
    function harvest(address to) external nonReentrant returns (uint256 feeA, uint256 feeB) {
        return _harvestInternal(to);
    }

    function _harvestInternal(address to) internal returns (uint256 feeA, uint256 feeB) {
        address lp = msg.sender;
        if (block.number <= lastLiquidityBlock[lp]) revert LiquidityLockedThisBlock();
        if (to == address(0)) revert ZeroAddress(to);
        (feeA, feeB) = pendingFees(lp);
        if (feeA == 0 && feeB == 0) revert NoFeesAccrued();

        claimedA[lp] += feeA;
        claimedB[lp] += feeB;
        feeReserveA -= feeA;
        feeReserveB -= feeB;

        emit FeesHarvested(lp, feeA, feeB);

        if (feeA > 0) {
            _safeTransfer(tokenA, to, feeA);
        }
        if (feeB > 0) {
            _safeTransfer(tokenB, to, feeB);
        }
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

