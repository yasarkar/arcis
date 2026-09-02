// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice ArcFlow USDC Yield Vault (ERC-4626).
/// @dev Assets are USDC (6 decimals) on Arc. Yield is distributed in real USDC
///      by the platform owner via `distributeYield`, which raises totalAssets and
///      therefore the value of every vault share — no fake APY simulation.
contract YieldVault is ERC4626, Ownable {
    /// @notice Total yield ever distributed into the vault (gross, before fee).
    uint256 public totalYieldDistributed;

    /// @notice Performance fee on yield, in basis points (e.g. 100 = 1%).
    uint256 public immutable performanceFeeBps;

    uint256 public constant MAX_FEE_BPS = 1000; // 10%

    event YieldDistributed(uint256 netAmount, uint256 feeAmount);
    event PerformanceFeeUpdated(uint256 oldFee, uint256 newFee);

    error ZeroAmount();
    error FeeTooHigh();
    error NativeDepositsNotAllowed();

    constructor(
        IERC20 _asset,
        string memory _name,
        string memory _symbol,
        uint256 _performanceFeeBps
    ) ERC20(_name, _symbol) ERC4626(_asset) Ownable(msg.sender) {
        if (_performanceFeeBps > MAX_FEE_BPS) revert FeeTooHigh();
        performanceFeeBps = _performanceFeeBps;
    }

    /// @notice Block native value transfers (protects native USDC balance).
    receive() external payable {
        revert NativeDepositsNotAllowed();
    }

    /// @notice Platform owner distributes real USDC yield into the vault.
    /// @dev Leaves an optional performance fee with the owner; the remainder
    ///      is counted toward totalAssets and appreciates all share holders.
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
}