// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Arcis USDC Yield Vault V4 (ERC-4626).
/// @dev Hardened with:
///      1) First-depositor inflation attack defense (_decimalsOffset = 3 -> 9 share decimals).
///      2) Guarded entrypoints: depositWithMinShares and redeemWithMinAssets.
///      3) On-chain cost-basis accounting (principalAssets) and real harvest().
///      4) Owner/Relayer yield injection via distributeYield with optional performance fee.
contract YieldVaultV4 is ERC4626, Ownable, Pausable {
    /// @notice Total yield ever distributed into the vault (gross, before fee).
    uint256 public totalYieldDistributed;

    /// @notice Performance fee on yield, in basis points (e.g. 100 = 1%).
    uint256 public immutable performanceFeeBps;

    uint256 public constant MAX_FEE_BPS = 1000; // 10%

    /// @notice On-chain cost basis: user principal assets deposited (net of withdrawals).
    mapping(address => uint256) public principalAssets;

    event YieldDistributed(uint256 netAmount, uint256 feeAmount);
    event YieldHarvested(address indexed user, uint256 amount);

    error ZeroAmount();
    error FeeTooHigh();
    error NativeDepositsNotAllowed();
    error InsufficientShares();
    error InsufficientAssets();

    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        uint256 _performanceFeeBps,
        address _initialOwner
    ) ERC20(_name, _symbol) ERC4626(_asset) Ownable(_initialOwner) {
        if (_performanceFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        performanceFeeBps = _performanceFeeBps;
    }

    /// @dev First-depositor inflation attack hardening via virtual shares.
    ///      Adds 3 decimal places to shares: 6 + 3 = 9 decimals.
    function _decimalsOffset() internal pure virtual override returns (uint8) {
        return 3;
    }

    /// @notice Block native value transfers (protects native USDC balance).
    receive() external payable {
        revert NativeDepositsNotAllowed();
    }

    /// @notice Emergency circuit breaker pause.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause vault deposits and withdrawals.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Platform owner/relayer distributes real USDC yield into the vault.
    function distributeYield(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();

        uint256 fee = (amount * performanceFeeBps) / 10000;
        uint256 netAmount = amount - fee;

        IERC20 assetToken = IERC20(asset());
        SafeERC20.safeTransferFrom(assetToken, msg.sender, address(this), amount);
        if (fee > 0) {
            SafeERC20.safeTransfer(assetToken, owner(), fee);
        }

        totalYieldDistributed += netAmount;
        emit YieldDistributed(netAmount, fee);
    }

    /// @dev Override deposit to enforce whenNotPaused.
    function deposit(uint256 assets, address receiver) public override whenNotPaused returns (uint256) {
        return super.deposit(assets, receiver);
    }

    /// @dev Override mint to enforce whenNotPaused.
    function mint(uint256 shares, address receiver) public override whenNotPaused returns (uint256) {
        return super.mint(shares, receiver);
    }

    /// @dev Override withdraw to enforce whenNotPaused.
    function withdraw(uint256 assets, address receiver, address owner_) public override whenNotPaused returns (uint256) {
        return super.withdraw(assets, receiver, owner_);
    }

    /// @dev Override redeem to enforce whenNotPaused.
    function redeem(uint256 shares, address receiver, address owner_) public override whenNotPaused returns (uint256) {
        return super.redeem(shares, receiver, owner_);
    }

    /// @notice Deposit with an explicit minimum-shares guard.
    function depositWithMinShares(uint256 assets, address receiver, uint256 minShares)
        external
        whenNotPaused
        returns (uint256)
    {
        if (previewDeposit(assets) < minShares) revert InsufficientShares();
        return super.deposit(assets, receiver);
    }

    /// @notice Redeem with an explicit minimum-assets guard.
    function redeemWithMinAssets(uint256 shares, address receiver, address owner_, uint256 minAssets)
        external
        whenNotPaused
        returns (uint256)
    {
        if (previewRedeem(shares) < minAssets) revert InsufficientAssets();
        return super.redeem(shares, receiver, owner_);
    }

    /// @notice User's accrued real yield in underlying asset units.
    function pendingYield(address user) public view returns (uint256) {
        uint256 shares = balanceOf(user);
        if (shares == 0) return 0;
        uint256 currentAssets = convertToAssets(shares);
        uint256 principal = principalAssets[user];
        if (currentAssets > principal) {
            return currentAssets - principal;
        }
        return 0;
    }

    /// @notice Harvest accrued real yield.
    function harvest() external whenNotPaused returns (uint256 amount) {
        uint256 shares = balanceOf(msg.sender);
        if (shares == 0) revert ZeroAmount();

        uint256 currentAssets = convertToAssets(shares);
        uint256 principal = principalAssets[msg.sender];
        if (currentAssets <= principal) revert ZeroAmount();

        uint256 yieldAssets = currentAssets - principal;
        uint256 sharesToBurn = convertToShares(yieldAssets);
        if (sharesToBurn == 0) revert ZeroAmount();

        if (sharesToBurn > shares) {
            sharesToBurn = shares;
        }

        amount = convertToAssets(sharesToBurn);
        if (amount == 0) revert ZeroAmount();

        super._withdraw(msg.sender, msg.sender, msg.sender, amount, sharesToBurn);

        emit YieldHarvested(msg.sender, amount);
        return amount;
    }

    /// @dev Track principal cost basis on deposits.
    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        super._deposit(caller, receiver, assets, shares);
        principalAssets[receiver] += assets;
    }

    /// @dev Proportionally deduct principal cost basis on withdrawals.
    function _withdraw(address caller, address receiver, address owner_, uint256 assets, uint256 shares) internal override {
        uint256 prevShares = balanceOf(owner_);
        uint256 prevPrincipal = principalAssets[owner_];

        super._withdraw(caller, receiver, owner_, assets, shares);

        if (prevShares > 0 && prevPrincipal > 0) {
            uint256 principalSub = (prevPrincipal * shares) / prevShares;
            if (principalSub > prevPrincipal) {
                principalAssets[owner_] = 0;
            } else {
                principalAssets[owner_] = prevPrincipal - principalSub;
            }
        } else {
            principalAssets[owner_] = 0;
        }
    }

    /// @dev Transfer proportional principal cost basis when share tokens are transferred.
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0) && value > 0) {
            uint256 fromShares = balanceOf(from);
            uint256 fromPrincipal = principalAssets[from];
            if (fromShares > 0 && fromPrincipal > 0) {
                uint256 transferredPrincipal = (fromPrincipal * value) / fromShares;
                if (transferredPrincipal > fromPrincipal) transferredPrincipal = fromPrincipal;
                principalAssets[from] = fromPrincipal - transferredPrincipal;
                principalAssets[to] += transferredPrincipal;
            }
        }
        super._update(from, to, value);
    }
}
