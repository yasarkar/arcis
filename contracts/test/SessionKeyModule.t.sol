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

    // ─────────────────────────────────────────────────────────
    //  M-3 / M-4: Signed execution path (executeFromSessionKeySigned)
    //  M-3: v-normalization so modern 0/1 y-parity recovers correctly.
    //  M-4: valid signature is REQUIRED; invalid signatures are rejected.
    // ─────────────────────────────────────────────────────────
    uint256 constant SK_PK = 0xB0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B0B;

    function _encodeSig(uint8 v, bytes32 r, bytes32 s) internal pure returns (bytes memory) {
        return abi.encodePacked(r, s, v); // 65 bytes: r(32) || s(32) || v(1)
    }

    function _registerRealKey() internal returns (address skAddr) {
        skAddr = vm.addr(SK_PK);
        uint48 expiry = uint48(block.timestamp + 1 days);
        vm.prank(owner);
        module.registerSessionKey(skAddr, expiry, 1_000_000_000, 500_000_000);
    }

    /// @notice M-4 positive: a session key signed with its own private key (v = 0/1 modern
    ///         convention, normalized by M-3) can execute an ERC-20 transfer within budget.
    function test_ExecuteSignedValidSignatureSucceeds() public {
        address skAddr = _registerRealKey();

        bytes memory transferCalldata = abi.encodeWithSelector(
            IERC20.transfer.selector,
            stranger,
            5_000_000 // 5 USDC
        );
        bytes32 userOpHash = keccak256(abi.encodePacked(address(token), uint256(0), transferCalldata));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SK_PK, userOpHash);
        bytes memory signature = _encodeSig(v, r, s);

        vm.prank(msca);
        module.executeFromSessionKeySigned(skAddr, address(token), 0, transferCalldata, signature);

        assertEq(token.balanceOf(stranger), 5_000_000, "signed transfer must succeed");
    }

    /// @notice M-4 negative: an unsigned/empty signature must be rejected by InvalidSignature.
    function test_ExecuteSignedRevertsInvalidSignature() public {
        address skAddr = _registerRealKey();
        bytes memory transferCalldata = abi.encodeWithSelector(
            IERC20.transfer.selector,
            stranger,
            1_000_000
        );
        bytes memory badSignature = hex"00"; // < 65 bytes

        vm.expectRevert(SessionKeyModule.InvalidSignature.selector);
        vm.prank(msca);
        module.executeFromSessionKeySigned(skAddr, address(token), 0, transferCalldata, badSignature);
    }

    /// @notice M-4 negative: a signature from a DIFFERENT key must be rejected.
    function test_ExecuteSignedRevertsWrongSigner() public {
        address skAddr = _registerRealKey();
        bytes memory transferCalldata = abi.encodeWithSelector(
            IERC20.transfer.selector,
            stranger,
            1_000_000
        );
        bytes32 userOpHash = keccak256(abi.encodePacked(address(token), uint256(0), transferCalldata));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(0xCAFE_CAFE, userOpHash); // different key
        bytes memory signature = _encodeSig(v, r, s);

        vm.expectRevert(SessionKeyModule.InvalidSignature.selector);
        vm.prank(msca);
        module.executeFromSessionKeySigned(skAddr, address(token), 0, transferCalldata, signature);
    }

    /// @notice M-3: validateSessionKeySignature recovers the signer with a modern v=0/1
    ///         signature (it must normalize to 27/28 internally).
    function test_ValidateSignatureWithModernV() public {
        address skAddr = _registerRealKey();
        bytes32 userOpHash = keccak256("sample-op");
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SK_PK, userOpHash);
        bytes memory signature = _encodeSig(v, r, s);
        uint256 result = module.validateSessionKeySignature(skAddr, userOpHash, signature);
        assertEq(result, 0, "modern v/y-parity signature must validate after M-3 normalization");
    }
}