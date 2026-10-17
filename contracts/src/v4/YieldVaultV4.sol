// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title  Arcis USDC Yield Vault V4 (ERC-4626)
/// @notice Single-asset yield vault for Circle Native USDC on Arc (chainId 5042002).
///
/// @dev Architecture highlights:
///
///   1. INFLATION DEFENSE — `_decimalsOffset() = 3` makes share decimals = 9 (asset 6 + 3 virtual).
///      The virtual offset means the initial share price is 1 USDC == 1000 shares, making a 1-wei
///      donation attack economically infeasible (attacker must donate 1000x their intended damage).
///
///   2. REAL YIELD — No inflationary share minting. The owner calls `distributeYield(uint256)`
///      to inject USDC directly into the vault, raising `totalAssets` and share value for all holders.
///      A performance fee (capped at MAX_FEE_BPS = 10%) is retained by the protocol.
///
///   3. PRINCIPAL TRACKING — `principalAssets[user]` tracks each user's net cost-basis (sum of
///      assets deposited minus proportional cost-basis of redeemed shares). `pendingYield(user)`
///      = convertToAssets(balanceOf(user)) - principalAssets[user].
///
///   4. HARVEST — `harvest()` burns only the shares corresponding to accrued yield and pays out
///      real USDC without touching the user's principal position. It calls `super._withdraw` to
///      bypass the `principalAssets` decrement that `_withdraw` override normally applies.
///
///   5. SLIPPAGE GUARDS — `depositWithMinShares` and `redeemWithMinAssets` protect against
///      sandwich attacks between preview and execution.
///
///   6. ARC NATIVE GAS GUARD — No `receive()` / `fallback()`. Any native-value send (Arc native
///      USDC gas) reverts at the EVM level with no data.
///
/// @dev Assumes USDC is a standard non-rebasing, non-fee-on-transfer ERC-20.
contract YieldVaultV4 is ERC4626, Ownable, Pausable, ReentrancyGuard {
    using Math for uint256;
    using SafeERC20 for IERC20;

    // ── Constants ─────────────────────────────────────────────────────────────
    /// @notice Maximum allowed performance fee: 10%.
    uint256 public constant MAX_FEE_BPS = 1000;

    // ── Immutables ─────────────────────────────────────────────────────────────
    /// @notice Performance fee on distributed yield, in basis points.
    uint256 public immutable performanceFeeBps;

    // ── State ──────────────────────────────────────────────────────────────────
    /// @notice Total net USDC yield ever distributed into the vault (after fee).
    uint256 public totalYieldDistributed;

    /// @notice Per-user net deposited cost-basis (sum of assets deposited, minus
    ///         proportional basis of any redeemed shares).
    /// @dev    Updated in `_update` (transfer/burn) and `_deposit`.
    mapping(address => uint256) public principalAssets;

    /// @notice Block number of the user's latest deposit or incoming share transfer.
    ///         harvest() requires block.number > lastDepositBlock[user] to prevent same-block
    ///         JIT sandwich attacks on distributeYield (M-1 fix).
    mapping(address => uint256) public lastDepositBlock;

    // ── Errors ─────────────────────────────────────────────────────────────────
    error ZeroAmount();
    error FeeTooHigh();
    error InsufficientShares();
    error InsufficientAssets();
    error NoPendingYield();
    error DepositTooRecent();

    // ── Events ──────────────────────────────────────────────────────────────────
    event YieldDistributed(uint256 netAmount, uint256 feeAmount);
    event YieldHarvested(address indexed user, uint256 usdcPaid, uint256 sharesBurned);

    // ── Constructor ─────────────────────────────────────────────────────────────
    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        uint256 _performanceFeeBps,
        address _initialOwner
    )
        ERC20(_name, _symbol)
        ERC4626(_asset)
        Ownable(_initialOwner)
    {
        if (_performanceFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        performanceFeeBps = _performanceFeeBps;
    }

    // ── Arc native-gas guard ───────────────────────────────────────────────────
    // No receive() or fallback(). Any ETH / Arc-native USDC send reverts at EVM level.

    // ── EIP-4626 decimal offset (inflation defense) ────────────────────────────
    /// @dev Virtual offset raises share supply by 10^3, making the exchange rate start at
    ///      1 USDC = 1000 shares. A 1-wei donation can inflate the rate by at most 0.1%.
    function _decimalsOffset() internal pure override returns (uint8) {
        return 3;
    }

    // ── Admin: pause controls ─────────────────────────────────────────────────
    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    // ── Admin: yield distribution ─────────────────────────────────────────────
    /// @notice Owner/relayer injects real USDC yield into the vault.
    ///         `totalAssets` increases by `netAmount`, raising share value for all holders.
    /// @param  amount  Gross USDC amount to distribute (before performance fee).
    function distributeYield(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();

        uint256 fee = (amount * performanceFeeBps) / 10_000;
        uint256 netAmount = amount - fee;

        IERC20 assetToken = IERC20(asset());
        assetToken.safeTransferFrom(msg.sender, address(this), amount);
        if (fee > 0) {
            assetToken.safeTransfer(owner(), fee);
        }

        totalYieldDistributed += netAmount;
        emit YieldDistributed(netAmount, fee);
    }

    // ── Deposit / mint overrides (pause gate) ─────────────────────────────────
    /// @inheritdoc ERC4626
    function deposit(uint256 assets, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.deposit(assets, receiver);
        // principalAssets is updated in the _update hook triggered by _mint inside super.deposit
    }

    /// @inheritdoc ERC4626
    function mint(uint256 shares, address receiver)
        public
        override
        whenNotPaused
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.mint(shares, receiver);
    }

    // ── Withdraw / redeem overrides (pause gate for deposits only; exits always open) ─
    /// @dev EIP-4626 recommends keeping withdrawals open even when deposits are paused.
    ///      `harvest()` is also gated by `whenNotPaused` so that a paused vault fully
    ///      halts yield extraction while principal exit remains available.
    ///
    ///      M-2: the inherited `withdraw`/`redeem` entry points are overridden only to add the
    ///      `nonReentrant` guard, so every asset-moving exit path holds it (deposit, mint,
    ///      depositWithMinShares, withdraw, redeem, redeemWithMinAssets, harvest, distributeYield).
    ///      Exits are deliberately NOT `whenNotPaused`: principal must always be withdrawable.
    ///      The guard is defence in depth — the vault assumes USDC is a standard, hook-free,
    ///      non-rebasing, non-fee-on-transfer ERC-20, so no callback can re-enter the vault today.

    /// @inheritdoc ERC4626
    function withdraw(uint256 assets, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 shares)
    {
        shares = super.withdraw(assets, receiver, owner_);
    }

    /// @inheritdoc ERC4626
    function redeem(uint256 shares, address receiver, address owner_)
        public
        override
        nonReentrant
        returns (uint256 assets)
    {
        assets = super.redeem(shares, receiver, owner_);
    }

    // ── Slippage-guarded deposit ──────────────────────────────────────────────
    /// @notice Deposit USDC with explicit minimum-shares protection.
    ///         Reverts if `previewDeposit(assets) < minShares` (share price was manipulated).
    function depositWithMinShares(uint256 assets, address receiver, uint256 minShares)
        external
        whenNotPaused
        nonReentrant
        returns (uint256 shares)
    {
        if (assets == 0) revert ZeroAmount();
        if (previewDeposit(assets) < minShares) revert InsufficientShares();
        shares = super.deposit(assets, receiver);
    }

    // ── Slippage-guarded redeem ───────────────────────────────────────────────
    /// @notice Redeem shares with explicit minimum-assets protection.
    ///         Reverts if `previewRedeem(shares) < minAssets` (share price dropped between
    ///         preview and execution).
    function redeemWithMinAssets(
        uint256 shares,
        address receiver,
        address owner_,
        uint256 minAssets
    )
        external
        nonReentrant
        returns (uint256 assets)
    {
        if (shares == 0) revert ZeroAmount();
        if (previewRedeem(shares) < minAssets) revert InsufficientAssets();
        assets = super.redeem(shares, receiver, owner_);
    }

    // ── Harvest: claim accrued yield without exiting the principal position ────
    /// @notice Burns only the shares representing accrued yield and transfers the
    ///         corresponding USDC to the caller. The principal position is untouched.
    ///
    /// @dev    Yield = convertToAssets(balanceOf(msg.sender)) - principalAssets[msg.sender].
    ///
    ///         Rounding discipline (H-1 fix):
    ///         - We compute `sharesToBurn = previewWithdraw(usdcPaid)` which rounds UP,
    ///           i.e., burns at least enough shares to cover `usdcPaid`. This ensures the
    ///           vault never pays out MORE assets than the shares burned represent.
    ///         - We then derive the actual payout as `convertToAssets(sharesToBurn)` which
    ///           may be slightly less than `usdcPaid` (by at most 1 wei) but is always
    ///           vault-favoring under ERC-4626 rounding expectations.
    ///
    ///         We call `super._withdraw` directly to bypass our `_withdraw` override (which
    ///         would incorrectly decrement `principalAssets` for a yield-only exit).
    function harvest() external whenNotPaused nonReentrant returns (uint256 usdcPaid) {
        address lp = msg.sender;
        // M-1: Prevent same-block JIT sandwich. Deposits in the same block as harvest are blocked.
        if (lastDepositBlock[lp] >= block.number) revert DepositTooRecent();
        uint256 pendingYieldAmount = pendingYield(lp);
        //slither-disable-next-line incorrect-equality
        if (pendingYieldAmount == 0) revert NoPendingYield();

        // Round UP: burn at least as many shares as needed to cover the yield payout.
        // previewWithdraw = convertToShares(assets, Math.Rounding.Ceil).
        uint256 sharesToBurn = previewWithdraw(pendingYieldAmount);
        //slither-disable-next-line incorrect-equality
        if (sharesToBurn == 0) revert NoPendingYield();

        // Cap at user's full balance (safety against edge rounding).
        uint256 userBal = balanceOf(lp);
        if (sharesToBurn > userBal) {
            sharesToBurn = userBal;
        }

        // Derive actual payout from the exact shares burned (always vault-favoring).
        usdcPaid = convertToAssets(sharesToBurn);
        //slither-disable-next-line incorrect-equality
        if (usdcPaid == 0) revert NoPendingYield();

        // Call super._withdraw to bypass our override's principal decrement.
        // super._withdraw(caller, receiver, owner, assets, shares) handles _burn + safeTransfer.
        super._withdraw(lp, lp, lp, usdcPaid, sharesToBurn);

        emit YieldHarvested(lp, usdcPaid, sharesToBurn);
    }

    // ── Principal yield query ─────────────────────────────────────────────────
    /// @notice Returns the USDC yield accrued to `user` above their deposited cost-basis.
    /// @dev    Returns 0 if share value has not yet appreciated above cost-basis.
    function pendingYield(address user) public view returns (uint256) {
        uint256 bal = balanceOf(user);
        if (bal == 0) return 0;
        uint256 currentValue = convertToAssets(bal);
        uint256 principal = principalAssets[user];
        return currentValue > principal ? currentValue - principal : 0;
    }

    // ── ERC-20 _update hook: maintain principalAssets on transfers ────────────
    /// @dev Called by OZ ERC20 on every mint, burn, and transfer.
    ///
    ///   mint  (from == 0):  `to` principal += assets deposited (handled in _afterDeposit).
    ///   burn  (to == 0):    `from` principal -= proportional basis of burned shares.
    ///   transfer (both non-zero, non-equal):
    ///                       `from` proportional basis moved to `to`.
    ///   self-transfer (from == to):  no-op (avoids double-counting).
    function _update(address from, address to, uint256 value) internal override {
        // Self-transfers: skip principal accounting to avoid corruption.
        if (from == to) {
            super._update(from, to, value);
            return;
        }

        if (from != address(0) && to != address(0)) {
            // Transfer: set recipient's basis to the CURRENT fair value of the transferred shares
            // so that pendingYield(recipient) == 0 immediately after the transfer.
            //
            // Economic rationale (H-2 fix):
            //   - The recipient receives shares priced at their current market value.
            //     Their "cost basis" is that market value — they have no yield to harvest yet.
            //   - The sender loses their proportional cost-basis. Any difference between
            //     proportional basis and current fair value (i.e., the sender's accrued yield
            //     attributable to the transferred shares) is forfeited; it neither moves to the
            //     recipient nor stays with the sender. Senders should harvest before transferring.
            //   - This design prevents JIT yield-snipe via transfer-then-harvest.
            //
            // Invariant after transfer:
            //   pendingYield(recipient) = convertToAssets(value) - fairValueCap = 0.
            uint256 senderBal = balanceOf(from);
            if (senderBal > 0) {
                // Deduct the proportional cost-basis from the sender.
                uint256 proportionalBasis = principalAssets[from] > 0
                    ? (principalAssets[from] * value) / senderBal
                    : 0;
                if (proportionalBasis > 0) {
                    principalAssets[from] -= proportionalBasis;
                }

                // Credit recipient with the CURRENT fair value (no yield windfall).
                // convertToAssets rounds down, so recipient basis <= actual share value.
                uint256 fairValue = convertToAssets(value);
                principalAssets[to] += fairValue;

                // M-1: incoming transfer counts the same as a deposit for harvest cooldown.
                lastDepositBlock[to] = block.number;
            }
        }

        super._update(from, to, value);

        if (from == address(0)) {
            // Mint handled by deposit()/mint() callers — see _afterDeposit.
        }
        if (to == address(0)) {
            // Burn: principalAssets decremented by _withdraw override (redeem/withdraw path).
            // harvest() bypasses the override via super._withdraw — no decrement here.
        }
    }

    // ── ERC-4626 withdraw/redeem override: decrement principalAssets ──────────
    /// @dev Called by `withdraw` and `redeem` (not harvest, which calls super._withdraw).
    ///      Decrements `principalAssets[owner]` proportional to shares burned.
    function _withdraw(
        address caller,
        address receiver,
        address owner_,
        uint256 assets,
        uint256 shares
    ) internal override {
        // Proportional principal reduction: clamp to principalAssets to avoid underflow.
        uint256 ownerBal = balanceOf(owner_); // pre-burn balance
        uint256 principal = principalAssets[owner_];
        if (ownerBal > 0 && principal > 0) {
            uint256 basisRemoved = (principal * shares) / ownerBal;
            if (basisRemoved > principal) basisRemoved = principal;
            principalAssets[owner_] -= basisRemoved;
        }
        super._withdraw(caller, receiver, owner_, assets, shares);
    }

    // ── ERC-4626 deposit/mint override: set principalAssets ─────────────────
    /// @dev Called after shares are minted. Records the deposited assets as cost-basis
    ///      and updates lastDepositBlock to enforce the JIT harvest cooldown (M-1).
    //slither-disable-next-line dead-code
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares)
        internal
        override
    {
        super._deposit(caller, receiver, assets, shares);
        // Record full asset amount as cost-basis for the receiver.
        principalAssets[receiver] += assets;
        // Mark this block so harvest() cannot be called in the same block.
        lastDepositBlock[receiver] = block.number;
    }
}
