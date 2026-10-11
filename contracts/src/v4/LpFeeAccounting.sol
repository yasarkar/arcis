// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Per-LP on-chain swap fee accounting and harvest engine for Arcis V4 pools.
/// @dev Implements Synthetix/MasterChef style cumulative reward per share (O(1) gas cost).
///      Swap fees are isolated into `feeReserveA` and `feeReserveB` and paid out directly
///      upon calling `harvest()`, without touching LP principal or diluting AMM trading reserves.
abstract contract LpFeeAccounting {
    uint256 internal constant PRECISION = 1e18;

    uint256 public feeReserveA;
    uint256 public feeReserveB;

    uint256 public accFeePerShareA;
    uint256 public accFeePerShareB;

    mapping(address => uint256) public userRewardDebtA;
    mapping(address => uint256) public userRewardDebtB;
    mapping(address => uint256) public userUnclaimedA;
    mapping(address => uint256) public userUnclaimedB;

    event FeesHarvested(address indexed lp, uint256 feeA, uint256 feeB);

    error NoFeesAccrued();
    error TransferFailed();

    /// @notice Returns the eligible LP supply for fee distribution (excluding dead address).
    function _eligibleLpSupply() internal view virtual returns (uint256);

    /// @notice Returns the LP token balance of an account.
    function _lpBalanceOf(address account) internal view virtual returns (uint256);

    /// @notice Distributes a swap fee to all LP token holders proportionally.
    function _distributeSwapFee(uint256 feeA, uint256 feeB) internal {
        uint256 supply = _eligibleLpSupply();
        if (supply == 0) return;

        if (feeA > 0) {
            feeReserveA += feeA;
            accFeePerShareA += (feeA * PRECISION) / supply;
        }
        if (feeB > 0) {
            feeReserveB += feeB;
            accFeePerShareB += (feeB * PRECISION) / supply;
        }
    }

    /// @notice Updates user fee state before balance change.
    function _beforeLpBalanceChange(address account) internal {
        if (account == address(0)) return;
        uint256 bal = _lpBalanceOf(account);
        if (bal > 0) {
            uint256 pendingA = (bal * accFeePerShareA) / PRECISION;
            if (pendingA > userRewardDebtA[account]) {
                userUnclaimedA[account] += (pendingA - userRewardDebtA[account]);
            }
            uint256 pendingB = (bal * accFeePerShareB) / PRECISION;
            if (pendingB > userRewardDebtB[account]) {
                userUnclaimedB[account] += (pendingB - userRewardDebtB[account]);
            }
        }
    }

    /// @notice Updates user fee debt after balance change.
    function _afterLpBalanceChange(address account) internal {
        if (account == address(0)) return;
        uint256 bal = _lpBalanceOf(account);
        userRewardDebtA[account] = (bal * accFeePerShareA) / PRECISION;
        userRewardDebtB[account] = (bal * accFeePerShareB) / PRECISION;
    }

    /// @notice View claimable swap fees accrued to a given LP address.
    function pendingFees(address lp) public view returns (uint256 feeA, uint256 feeB) {
        feeA = userUnclaimedA[lp];
        feeB = userUnclaimedB[lp];
        uint256 bal = _lpBalanceOf(lp);
        if (bal > 0) {
            uint256 currentA = (bal * accFeePerShareA) / PRECISION;
            if (currentA > userRewardDebtA[lp]) {
                feeA += (currentA - userRewardDebtA[lp]);
            }
            uint256 currentB = (bal * accFeePerShareB) / PRECISION;
            if (currentB > userRewardDebtB[lp]) {
                feeB += (currentB - userRewardDebtB[lp]);
            }
        }
    }
}
