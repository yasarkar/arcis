// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test, console2} from "forge-std/Test.sol";
import {SessionKeyModule} from "../src/SessionKeyModule.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Foundry test for SessionKeyModule (ERC-6900).
contract SessionKeyModuleTest is Test {
    SessionKeyModule public module;
    MockERC20 public token;
    address public owner = makeAddr("owner");
    address public msca = makeAddr("msca");
    address public sessionKey = makeAddr("sessionKey");
    address public stranger = makeAddr("stranger");

    event SessionKeyRegistered(address indexed sessionKey, uint48 validUntil, uint128 maxSpendWei, uint128 maxPerTxWei);
    event SessionKeyRevoked(address indexed sessionKey);

    function setUp() public {
        vm.prank(msca);
        module = new SessionKeyModule(msca, owner);
        token = new MockERC20("USD Coin", "USDC", 6);
        token.mint(address(module), 1_000_000 * 1e6);
    }

    // ── Construction ──
    function test_Construction() public view {
        assertEq(module.msca(), msca);
        assertEq(module.owner(), owner);
        assertEq(module.registeredKeyCount(), 0);
    }

    function test_RevertZeroMsca() public {
        vm.expectRevert(SessionKeyModule.ZeroAddress.selector);
        new SessionKeyModule(address(0), owner);
    }

    function test_RevertZeroOwner() public {
        vm.expectRevert(SessionKeyModule.ZeroAddress.selector);
        new SessionKeyModule(msca, address(0));
    }

    // ── Registration ──
    function test_RegisterSessionKey() public {
        uint48 expiry = uint48(block.timestamp + 365 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100_000_000, 10_000_000); // 100 USDC budget, 10 USDC/tx

        (bool active,,,) = module.getSessionStatus(sessionKey);
        assertTrue(active);
    }

    function test_RevertNonOwnerRegistration() public {
        vm.expectRevert(SessionKeyModule.NotOwner.selector);
        vm.prank(stranger);
        module.registerSessionKey(sessionKey, uint48(block.timestamp + 1 days), 100, 10);
    }

    function test_RevertDuplicateRegistration() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100, 10);
        vm.expectRevert(SessionKeyModule.SessionKeyAlreadyRegistered.selector);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100, 10);
    }

    // ── Revoke ──
    function test_RevokeSessionKey() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100, 10);

        vm.prank(owner);
        module.revokeSessionKey(sessionKey);

        (bool active,,,) = module.getSessionStatus(sessionKey);
        assertFalse(active);
    }

    // ── Execution ──
    function test_ExecuteFromSessionKey() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100_000_000, 10_000_000);

        // Simple ETH transfer (no revert expected on zero target — just an example)
        vm.prank(msca);
        module.executeFromSessionKey(sessionKey, address(0), 0, "");
    }

    function test_RevertExpiredKeyExecution() public {
        uint48 expiry = uint48(block.timestamp + 10);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100, 10);

        vm.warp(block.timestamp + 11);
        vm.expectRevert(SessionKeyModule.SessionKeyExpired.selector);
        vm.prank(msca);
        module.executeFromSessionKey(sessionKey, address(0), 0, "");
    }

    function test_RevertExceedsMaxPerTx() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100, 10); // max 10 per tx

        vm.expectRevert(SessionKeyModule.ExceedsMaxPerTx.selector);
        vm.prank(msca);
        module.executeFromSessionKey(sessionKey, address(0), 20, "");
    }

    function test_RevertNonMSCAExecution() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100, 10);

        vm.expectRevert(SessionKeyModule.NotMSCA.selector);
        vm.prank(stranger);
        module.executeFromSessionKey(sessionKey, address(0), 0, "");
    }

    // ── ERC-20 Calldata Security Tests ──
    function test_RevertERC20ExceedsMaxPerTx() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 100_000_000, 10_000_000); // 100 max, 10 per tx

        bytes memory transferCalldata = abi.encodeWithSelector(
            IERC20.transfer.selector,
            stranger,
            25_000_000 // 25 USDC > 10 USDC per tx limit
        );

        vm.expectRevert(SessionKeyModule.ExceedsMaxPerTx.selector);
        vm.prank(msca);
        module.executeFromSessionKey(sessionKey, address(token), 0, transferCalldata);
    }

    function test_RevertERC20ExceedsMaxSpend() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 15_000_000, 10_000_000); // 15 total budget, 10 per tx

        bytes memory transferCalldata = abi.encodeWithSelector(
            IERC20.transfer.selector,
            stranger,
            9_000_000 // 9 USDC
        );

        vm.prank(msca);
        module.executeFromSessionKey(sessionKey, address(token), 0, transferCalldata);

        // Second call: 9 + 9 = 18 USDC > 15 USDC total budget
        vm.expectRevert(SessionKeyModule.ExceedsMaxSpend.selector);
        vm.prank(msca);
        module.executeFromSessionKey(sessionKey, address(token), 0, transferCalldata);
    }

    function test_ERC20TransferWithinLimitSucceeds() public {
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(sessionKey, expiry, 50_000_000, 20_000_000);

        bytes memory transferCalldata = abi.encodeWithSelector(
            IERC20.transfer.selector,
            stranger,
            5_000_000 // 5 USDC
        );

        vm.prank(msca);
        module.executeFromSessionKey(sessionKey, address(token), 0, transferCalldata);

        (bool active,, uint128 remaining,) = module.getSessionStatus(sessionKey);
        assertTrue(active);
        assertEq(remaining, 45_000_000, "Remaining budget should be 45 USDC");
        assertEq(token.balanceOf(stranger), 5_000_000, "Stranger should have received 5 USDC");
    }

    // ── Validation ──
    function test_ValidateInvalidKey() public view {
        uint256 result = module.validateSessionKeySignature(sessionKey, keccak256("test"), hex"");
        assertEq(result, 1); // SIG_VALIDATION_FAILED
    }
}