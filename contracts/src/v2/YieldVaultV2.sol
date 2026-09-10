// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

// ─────────────────────────────────────────────────────────────────────────────
// RETIRED / SUPERSEDED — DO NOT DEPLOY NEW INSTANCES.
// Use src/v3/YieldVaultV3.sol for all new deployments (testnet + mainnet).
// Existing V2 testnet deployments (0x971d...) remain functional but are frozen.
// ─────────────────────────────────────────────────────────────────────────────

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @notice Arcis USDC Yield Vault V2 (ERC-4626).
/// @dev Enhancements in V2:
///      1. Pausable emergency circuit breaker.
///      2. Explicit deposit/mint pausing under extreme market conditions.
///      3. Direct USDC yield distribution to appreciate share price without inflationary tokens.
contract YieldVaultV2 is ERC4626, Ownable, Pausable {
    /// @notice Total yield ever distributed into the vault (gross, before fee).
    uint256 public totalYieldDistributed;

    /// @notice Performance fee on yield, in basis points (e.g. 100 = 1%).
    uint256 public immutable performanceFeeBps;

    uint256 public constant MAX_FEE_BPS = 1000; // 10%

    event YieldDistributed(uint256 netAmount, uint256 feeAmount);

    error ZeroAmount();
    error FeeTooHigh();
    error NativeDepositsNotAllowed();

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

    /// @notice Block native value transfers (protects native USDC balance).
    receive() external payable {
        revert NativeDepositsNotAllowed();
    }

    /// @notice Emergency circuit breaker pause.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Unpause vault deposits.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Platform owner distributes real USDC yield into the vault.
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
}
