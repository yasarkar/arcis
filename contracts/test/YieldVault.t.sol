// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @notice Unit tests for YieldVault (ERC-4626 USDC).
contract YieldVaultTest is Test {
    YieldVault vault;
    MockERC20 usdc;

    address depositor = address(0x1);
    address owner = address(this);
    address treasury = address(0x3);

    uint256 constant DEC6 = 1e6;

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new YieldVault(usdc, "ArcFlow USDC Yield", "af-USDC", 100); // 1% fee
        usdc.mint(depositor, 10_000 * DEC6);
    }

    function test_Deposit() public {
        vm.startPrank(depositor);
        usdc.approve(address(vault), type(uint256).max);
        uint256 shares = vault.deposit(1_000 * DEC6, depositor);
        assertGt(shares, 0);
        assertEq(vault.balanceOf(depositor), shares);
        assertEq(vault.previewRedeem(shares), 1_000 * DEC6);
        vm.stopPrank();
    }

    function test_YieldDistributionAppreciatesShares() public {
        vm.startPrank(depositor);
        usdc.approve(address(vault), type(uint256).max);
        uint256 shares = vault.deposit(1_000 * DEC6, depositor);
        vm.stopPrank();

        // Platform distributes 100 USDC of real yield
        usdc.mint(owner, 100 * DEC6);
        usdc.approve(address(vault), 100 * DEC6);
        vault.distributeYield(100 * DEC6); // 1% fee -> 99 net

        // 1 share now redeems for more than 1 USDC
        uint256 redeemValue = vault.previewRedeem(shares);
        assertGt(redeemValue, 1_000 * DEC6, "Yield should appreciate shares");

        // Fee was taken
        assertEq(usdc.balanceOf(owner), 1 * DEC6);
    }

    function test_Redeem() public {
        vm.startPrank(depositor);
        usdc.approve(address(vault), type(uint256).max);
        uint256 shares = vault.deposit(1_000 * DEC6, depositor);
        uint256 balanceBefore = usdc.balanceOf(depositor);
        vault.redeem(shares, depositor, depositor);
        assertEq(usdc.balanceOf(depositor), balanceBefore + 1_000 * DEC6);
        vm.stopPrank();
    }

    function test_OnlyOwnerCanDistribute() public {
        vm.startPrank(address(0x9));
        vm.expectRevert();
        vault.distributeYield(1);
        vm.stopPrank();
    }

    function test_NativeReceiveReverts() public {
        (bool ok,) = address(vault).call{value: 1}("");
        assertFalse(ok, "native deposit must revert");
    }
}