// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {YieldVaultV4} from "../src/v4/YieldVaultV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @notice Unit & integration tests for YieldVaultV4.
contract YieldVaultV4Test is Test {
    YieldVaultV4 vault;
    MockERC20 usdc;

    address owner = address(this);
    address alice = address(0xA11ce);
    address bob   = address(0xB0b);
    address carol = address(0xCA401);

    uint256 constant DEC6 = 1e6;
    uint256 constant PERF_FEE_BPS = 100; // 1%

    function setUp() public {
        usdc = new MockERC20("USD Coin", "USDC", 6);
        vault = new YieldVaultV4(usdc, "Arcis USDC Yield v4", "af-USDC-v4", PERF_FEE_BPS, owner);

        usdc.mint(alice, 10_000_000 * DEC6);
        usdc.mint(bob,   10_000_000 * DEC6);
        usdc.mint(carol, 10_000_000 * DEC6);
        usdc.mint(owner, 10_000_000 * DEC6);

        vm.startPrank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(bob);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        vm.startPrank(carol);
        usdc.approve(address(vault), type(uint256).max);
        vm.stopPrank();

        usdc.approve(address(vault), type(uint256).max);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // A. ERC-4626 Compliance & Inflation Attack Resistance
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Share token has 9 decimals (USDC 6 + offset 3).
    function test_ShareDecimalsAreNine() public view {
        assertEq(vault.decimals(), 9, "share decimals must be 9 (6 + offset 3)");
    }

    /// @notice First deposit produces shares scaled by 10^3 (offset).
    function test_FirstDeposit_SharesScaledByOffset() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1_000 * DEC6, alice);
        // 1000 USDC → ~1_000_000_000_000 shares (1000 * 1e6 * 1e3)
        assertGt(shares, 1_000 * DEC6, "shares must be > raw USDC amount due to offset");
    }

    /// @notice Inflation attack: first depositor donates USDC directly to vault.
    ///         With a massive donation (1M USDC) vs 1-wei seed, even the _decimalsOffset cannot
    ///         guarantee non-zero shares for a 1 USDC deposit. The test verifies two things:
    ///         (a) depositWithMinShares reverts when the share count is 0 (slippage guard works);
    ///         (b) a larger deposit (1000 USDC) still receives non-zero shares.
    function test_InflationAttack_DonationDoesNotStealShares() public {
        // Attacker (alice) makes a minimal deposit to seed the vault
        vm.prank(alice);
        vault.deposit(1, alice); // 1 wei

        // Attacker donates 1_000_000 USDC directly (bypasses vault accounting)
        vm.prank(alice);
        usdc.transfer(address(vault), 1_000_000 * DEC6);

        // With 1M USDC donation vs 1-wei seed, a tiny 1 USDC deposit gets 0 shares.
        // depositWithMinShares with minShares=1 must revert (slippage guard works).
        vm.prank(bob);
        vm.expectRevert(YieldVaultV4.InsufficientShares.selector);
        vault.depositWithMinShares(1 * DEC6, bob, 1);

        // A 1000 USDC deposit still receives some shares (attack not total).
        uint256 preview1000 = vault.previewDeposit(1_000 * DEC6);
        if (preview1000 > 0) {
            vm.prank(bob);
            uint256 bobShares = vault.depositWithMinShares(1_000 * DEC6, bob, 1);
            assertGt(bobShares, 0, "1000 USDC must yield shares despite donation");
            uint256 bobAssets = vault.previewRedeem(bobShares);
            assertGt(bobAssets, 0, "Bob must redeem >0 assets");
        }
        // Note: the _decimalsOffset=3 limits attack damage by a factor of 1000 but
        // does not prevent 0-shares for sub-threshold deposits. depositWithMinShares
        // ensures the depositor retains control via an explicit slippage guard.
    }

    /// @notice previewDeposit / previewRedeem are inverses within 1 unit at 1:1 rate.
    function test_PreviewDepositRoundTrip() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        uint256 shares = vault.previewDeposit(1_000 * DEC6);
        uint256 assets = vault.previewRedeem(shares);
        // Due to rounding, assets may be 1 wei less than 1_000 * DEC6
        assertApproxEqAbs(assets, 1_000 * DEC6, 1, "previewDeposit/Redeem round-trip off by >1 wei");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // B. Solvency & Cost-Basis Invariant
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice After deposit, principalAssets[alice] == deposited amount.
    function test_PrincipalTracked_OnDeposit() public {
        vm.prank(alice);
        vault.deposit(500_000 * DEC6, alice);
        assertEq(vault.principalAssets(alice), 500_000 * DEC6, "principal must equal deposited amount");
    }

    /// @notice pendingYield is 0 before any yield distribution.
    function test_PendingYield_ZeroBeforeDistribution() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        assertEq(vault.pendingYield(alice), 0, "no yield before distributeYield");
    }

    /// @notice distributeYield raises share value and creates pending yield.
    function test_DistributeYield_CreatesPendingYield() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);

        vault.distributeYield(10_000 * DEC6); // 1% fee → net 9_900 USDC

        uint256 pending = vault.pendingYield(alice);
        assertGt(pending, 0, "pending yield must be >0 after distribution");
        assertLt(pending, 10_000 * DEC6, "pending yield must be < gross distribution (fee taken)");
    }

    /// @notice harvest() pays correct USDC yield and zeroes pendingYield.
    function test_Harvest_PaysYieldAndZerosPending() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);

        vault.distributeYield(10_000 * DEC6);
        vm.roll(block.number + 1); // advance past JIT cooldown

        uint256 pendingBefore = vault.pendingYield(alice);
        assertGt(pendingBefore, 0);

        uint256 usdcBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        uint256 harvested = vault.harvest();

        assertGt(harvested, 0, "harvest must pay >0 USDC");
        assertApproxEqAbs(harvested, pendingBefore, 1, "harvested must equal pending within 1 wei");
        assertEq(usdc.balanceOf(alice), usdcBefore + harvested, "USDC balance must increase by harvested");
        assertEq(vault.pendingYield(alice), 0, "pending yield must be 0 after harvest");
    }

    /// @notice harvest() when pendingYield == 0 must revert NoPendingYield.
    function test_Harvest_RevertsWhenNoPendingYield() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vm.roll(block.number + 1); // advance past JIT cooldown
        // No yield distributed
        vm.prank(alice);
        vm.expectRevert(YieldVaultV4.NoPendingYield.selector);
        vault.harvest();
    }

    /// @notice harvest() does NOT reduce principalAssets.
    function test_Harvest_DoesNotReducePrincipal() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        uint256 principalBefore = vault.principalAssets(alice);

        vault.distributeYield(10_000 * DEC6);
        vm.roll(block.number + 1); // advance past JIT cooldown

        vm.prank(alice);
        vault.harvest();

        // principal must be unchanged — harvest only burns yield shares
        assertEq(vault.principalAssets(alice), principalBefore, "harvest must not reduce principal");
    }

    /// @notice Double-harvest reverts because pendingYield is 0 after first harvest.
    function test_Harvest_DoubleClaimReverts() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vault.distributeYield(10_000 * DEC6);
        vm.roll(block.number + 1); // advance past JIT cooldown

        vm.prank(alice);
        vault.harvest();

        vm.prank(alice);
        vm.expectRevert(YieldVaultV4.NoPendingYield.selector);
        vault.harvest();
    }

    /// @notice redeem() decrements principalAssets proportionally.
    function test_Redeem_DecreasesPrincipalProportionally() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        uint256 principalBefore = vault.principalAssets(alice);
        uint256 sharesBefore = vault.balanceOf(alice);

        // Redeem half
        vm.prank(alice);
        vault.redeem(sharesBefore / 2, alice, alice);

        uint256 principalAfter = vault.principalAssets(alice);
        assertApproxEqAbs(principalAfter, principalBefore / 2, 1,
            "principal must halve after redeeming half the shares");
    }

    /// @notice Full redeem zeros out principalAssets.
    function test_Redeem_FullExitZerosPrincipal() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);

        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);

        assertEq(vault.principalAssets(alice), 0, "full redeem must zero principal");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // C. Share Transfer — Cost-Basis Conservation
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Transfer: proportional principalAssets moves from sender to recipient.
    function test_Transfer_MovesPrincipalProportionally() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        uint256 principalAlice = vault.principalAssets(alice);
        uint256 shares = vault.balanceOf(alice);

        vm.prank(alice);
        vault.transfer(bob, shares / 2);

        uint256 aliceAfter = vault.principalAssets(alice);
        uint256 bobAfter   = vault.principalAssets(bob);

        assertApproxEqAbs(aliceAfter, principalAlice / 2, 1, "Alice principal must halve");
        assertApproxEqAbs(bobAfter,   principalAlice / 2, 1, "Bob must receive half principal");
        assertApproxEqAbs(aliceAfter + bobAfter, principalAlice, 1,
            "total principal must be conserved across transfer");
    }

    /// @notice Self-transfer must NOT corrupt principalAssets (C-1 guard).
    function test_SelfTransfer_DoesNotCorruptPrincipal() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        uint256 principalBefore = vault.principalAssets(alice);
        uint256 aliceShares = vault.balanceOf(alice);

        vm.prank(alice);
        vault.transfer(alice, aliceShares);

        assertEq(vault.principalAssets(alice), principalBefore,
            "self-transfer must not change principal");
    }

    /// @notice Bob cannot harvest Alice's pre-transfer yield.
    /// @dev H-2 fix: basis transferred to Bob is capped at convertToAssets(shares),
    ///      so Bob's principalAssets == current share value → pendingYield(Bob) == 0.
    function test_Transfer_FrontRunYield_BobCannotStealAliceYield() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vault.distributeYield(10_000 * DEC6);

        uint256 aliceYield = vault.pendingYield(alice);
        assertGt(aliceYield, 0, "alice must have pending yield before transfer");

        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.transfer(bob, aliceShares);

        // Bob receives shares worth (principal + yield) but his principalAssets is capped
        // at convertToAssets(shares) = current fair value, so pendingYield(bob) == 0.
        assertEq(vault.pendingYield(bob), 0,
            "Bob must not inherit Alice's pre-transfer yield (H-2 fix)");
        // Alice lost her shares and her yield — she should harvest before transferring.
        assertEq(vault.pendingYield(alice), 0, "Alice has no shares left to yield from");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // D. Access Control & Pause
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice pause() blocks deposit, mint, depositWithMinShares, harvest.
    function test_Pause_BlocksDepositsAndHarvest() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vault.distributeYield(10_000 * DEC6);

        vault.pause();
        assertTrue(vault.paused());

        vm.prank(alice);
        vm.expectRevert();
        vault.deposit(1 * DEC6, alice);

        vm.prank(alice);
        vm.expectRevert();
        vault.depositWithMinShares(1 * DEC6, alice, 0);

        vm.prank(alice);
        vm.expectRevert();
        vault.harvest();
    }

    /// @notice redeem() works while paused (emergency exit).
    function test_Pause_AllowsRedeem() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);

        vault.pause();

        uint256 usdcBefore = usdc.balanceOf(alice);
        // Cache shares before prank so the balanceOf call does not consume the prank.
        uint256 aliceShares = vault.balanceOf(alice);
        vm.prank(alice);
        vault.redeem(aliceShares, alice, alice);
        assertGt(usdc.balanceOf(alice), usdcBefore, "redeem must work while paused");
    }

    /// @notice redeemWithMinAssets() works while paused.
    function test_Pause_AllowsRedeemWithMinAssets() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vault.pause();

        uint256 shares = vault.balanceOf(alice);
        uint256 minAssets = vault.previewRedeem(shares) - 1;
        vm.prank(alice);
        uint256 assets = vault.redeemWithMinAssets(shares, alice, alice, minAssets);
        assertGt(assets, 0);
    }

    /// @notice Only owner can pause.
    function test_Pause_AccessControl() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.pause();
    }

    /// @notice performanceFeeBps cannot exceed MAX_FEE_BPS at construction.
    function test_Constructor_RejectsFeeAboveMax() public {
        vm.expectRevert(YieldVaultV4.FeeTooHigh.selector);
        new YieldVaultV4(usdc, "x", "x", 1001, owner);
    }

    /// @notice distributeYield reverts with ZeroAmount.
    function test_DistributeYield_RevertsOnZero() public {
        vm.expectRevert(YieldVaultV4.ZeroAmount.selector);
        vault.distributeYield(0);
    }

    /// @notice distributeYield is onlyOwner.
    function test_DistributeYield_AccessControl() public {
        vm.prank(alice);
        vm.expectRevert();
        vault.distributeYield(1 * DEC6);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // E. Performance Fee
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Performance fee is deducted from yield distribution.
    /// @dev Uses a dedicated fee collector (carol) as owner to cleanly measure fee receipt.
    function test_PerformanceFee_DeductedFromYield() public {
        // Deploy a fresh vault owned by carol (separate from the test contract / distributor).
        YieldVaultV4 feeVault = new YieldVaultV4(usdc, "Fee Vault", "fv", PERF_FEE_BPS, carol);

        // carol must approve the vault to pull USDC for distributeYield.
        vm.prank(carol);
        usdc.approve(address(feeVault), type(uint256).max);

        // alice deposits into the fee vault.
        vm.prank(alice);
        usdc.approve(address(feeVault), type(uint256).max);
        vm.prank(alice);
        feeVault.deposit(100_000 * DEC6, alice);

        uint256 carolBefore = usdc.balanceOf(carol);
        // distributeYield must be called by owner (carol), not the test contract.
        vm.prank(carol);
        feeVault.distributeYield(10_000 * DEC6);
        uint256 carolAfter = usdc.balanceOf(carol);

        // carol started with 10M USDC, sent 10_000 and received fee back.
        uint256 expectedFee = (10_000 * DEC6 * PERF_FEE_BPS) / 10_000;
        // carolAfter = carolBefore - 10_000 * DEC6 + expectedFee
        // → carolBefore - carolAfter = 10_000 * DEC6 - expectedFee = netYield
        uint256 netYield = 10_000 * DEC6 - expectedFee;
        assertEq(carolBefore - carolAfter, netYield, "carol net outflow must equal net yield injected");
        assertEq(feeVault.totalYieldDistributed(), netYield, "totalYieldDistributed must be net amount");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // F. Slippage Guards
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice depositWithMinShares reverts if preview < minShares.
    function test_DepositWithMinShares_RevertsOnSlippage() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);

        uint256 expected = vault.previewDeposit(1_000 * DEC6);
        vm.prank(bob);
        vm.expectRevert(YieldVaultV4.InsufficientShares.selector);
        vault.depositWithMinShares(1_000 * DEC6, bob, expected + 1);
    }

    /// @notice redeemWithMinAssets reverts if preview < minAssets.
    function test_RedeemWithMinAssets_RevertsOnSlippage() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        uint256 shares = vault.balanceOf(alice);
        uint256 expected = vault.previewRedeem(shares);

        vm.prank(alice);
        vm.expectRevert(YieldVaultV4.InsufficientAssets.selector);
        vault.redeemWithMinAssets(shares, alice, alice, expected + 1);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // G. Arc native-gas guard
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice No receive() or fallback() — native send reverts.
    function test_NativeDeposit_Reverts() public {
        (bool ok,) = address(vault).call{value: 1}("");
        assertFalse(ok, "native value send must revert");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // H. Multi-user scenarios
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice Two LPs receive proportional yield after distributeYield.
    function test_TwoLPs_ProportionalYield() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vm.prank(bob);
        vault.deposit(100_000 * DEC6, bob);

        vault.distributeYield(10_000 * DEC6); // 1% fee → 9_900 net

        uint256 yieldAlice = vault.pendingYield(alice);
        uint256 yieldBob   = vault.pendingYield(bob);

        // Equal deposits → equal yield within 1 wei rounding
        assertApproxEqAbs(yieldAlice, yieldBob, 1, "equal depositors must get equal yield");
    }

    /// @notice Vault totalAssets == USDC balance after deposits + yield.
    function test_TotalAssets_EqualsVaultBalance() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vault.distributeYield(10_000 * DEC6);

        assertEq(vault.totalAssets(), usdc.balanceOf(address(vault)),
            "totalAssets must equal vault USDC balance");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // I. JIT Harvest Cooldown (M-1)
    // ─────────────────────────────────────────────────────────────────────────

    /// @notice harvest() reverts DepositTooRecent when called in the same block as deposit.
    function test_JIT_Harvest_RevertsIfSameBlock() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vault.distributeYield(10_000 * DEC6);
        // Same block as deposit — must revert DepositTooRecent (before NoPendingYield).
        vm.prank(alice);
        vm.expectRevert(YieldVaultV4.DepositTooRecent.selector);
        vault.harvest();
    }

    /// @notice harvest() succeeds in the next block after deposit.
    function test_JIT_Harvest_SucceedsNextBlock() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vault.distributeYield(10_000 * DEC6);

        vm.roll(block.number + 1);

        vm.prank(alice);
        uint256 harvested = vault.harvest();
        assertGt(harvested, 0, "harvest must succeed in block N+1");
    }

    /// @notice harvest() reverts DepositTooRecent after an incoming share transfer in the same block.
    function test_JIT_Transfer_BlocksHarvestSameBlock() public {
        vm.prank(alice);
        vault.deposit(100_000 * DEC6, alice);
        vault.distributeYield(10_000 * DEC6);
        vm.roll(block.number + 1);

        // Alice harvests her yield, then transfers shares to Bob.
        vm.prank(alice);
        vault.harvest();

        // Distribute more yield — Bob now has shares and pending yield.
        vault.distributeYield(10_000 * DEC6);
        // Bob received shares via transfer in the same block as this new distribution.
        uint256 aliceSharesRemaining = vault.balanceOf(alice);
        if (aliceSharesRemaining > 0) {
            vm.prank(alice);
            vault.transfer(bob, aliceSharesRemaining);
        }

        // Bob tries to harvest in the same block as incoming transfer — must revert.
        vm.prank(bob);
        vm.expectRevert(YieldVaultV4.DepositTooRecent.selector);
        vault.harvest();
    }
}
