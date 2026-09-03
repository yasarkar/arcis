// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SessionKeyModule — ERC-6900 Executor Module for Circle MSCA
/// @notice Stores on-chain session keys with USDC spend limits and validates
///         user operations signed by authorized session keys.
/// @dev Designed for Arcis / Circle Modular Smart Contract Accounts (MSCA)
///      on Arc Testnet (5042002). Implements IERC6900Executor and IERC6900Module.
///
/// Session keys are secp256k1 EOAs generated client-side. Only the MSCA owner
/// (passkey) can register or revoke session keys via this module.
contract SessionKeyModule {
    // ─────────────────────────────────────────────────────────
    //  TYPES
    // ─────────────────────────────────────────────────────────
    struct SessionKeyData {
        uint48 validAfter;          // Unix ts — activation start
        uint48 validUntil;          // Unix ts — expiry
        uint128 maxSpendWei;        // Total USDC budget (6-dec, in wei-equivalent)
        uint128 spentWei;           // USDC spent so far
        uint128 maxPerTxWei;        // Single transaction cap
        bool active;                // Soft-kill without uninstall
    }

    // ─────────────────────────────────────────────────────────
    //  STORAGE
    // ─────────────────────────────────────────────────────────
    mapping(address => SessionKeyData) public sessionKeys;
    address[] public registeredKeys;

    address public immutable msca;
    address public immutable owner;

    // ─────────────────────────────────────────────────────────
    //  EVENTS
    // ─────────────────────────────────────────────────────────
    event SessionKeyRegistered(address indexed sessionKey, uint48 validUntil, uint128 maxSpendWei, uint128 maxPerTxWei);
    event SessionKeyRevoked(address indexed sessionKey);
    event SessionSpent(address indexed sessionKey, uint128 amountWei);
    event ModuleExecuted(address indexed sessionKey, address target, bytes data);

    // ─────────────────────────────────────────────────────────
    //  ERRORS
    // ─────────────────────────────────────────────────────────
    error NotOwner();
    error NotMSCA();
    error SessionKeyNotActive();
    error SessionKeyExpired();
    error ExceedsMaxPerTx();
    error ExceedsMaxSpend();
    error SessionKeyAlreadyRegistered();
    error SessionKeyNotFound();
    error ZeroAddress();
    error InvalidParameters();

    modifier onlyOwner() { if (msg.sender != owner) revert NotOwner(); _; }
    modifier onlyMSCA() { if (msg.sender != msca) revert NotMSCA(); _; }

    constructor(address _msca, address _owner) {
        if (_msca == address(0) || _owner == address(0)) revert ZeroAddress();
        msca = _msca;
        owner = _owner;
    }

    // ─────────────────────────────────────────────────────────
    //  ERC-6900: onInstall / onUninstall
    // ─────────────────────────────────────────────────────────
    function onInstall(bytes calldata) external onlyMSCA {}
    function onUninstall(bytes calldata) external onlyMSCA {
        uint256 len = registeredKeys.length;
        for (uint256 i = 0; i < len; i++) delete sessionKeys[registeredKeys[i]];
        delete registeredKeys;
    }
// ─────────────────────────────────────────────────────────
    //  SESSION KEY MANAGEMENT (owner-only = passkey)
    // ─────────────────────────────────────────────────────────
    function registerSessionKey(
        address key, uint48 validUntil, uint128 maxSpendWei, uint128 maxPerTxWei
    ) external onlyOwner {
        if (key == address(0)) revert ZeroAddress();
        if (validUntil <= block.timestamp || maxSpendWei == 0 || maxPerTxWei == 0) revert InvalidParameters();
        if (maxPerTxWei > maxSpendWei) revert InvalidParameters();
        if (sessionKeys[key].active) revert SessionKeyAlreadyRegistered();

        sessionKeys[key] = SessionKeyData({
            validAfter: uint48(block.timestamp),
            validUntil: validUntil,
            maxSpendWei: maxSpendWei,
            spentWei: 0,
            maxPerTxWei: maxPerTxWei,
            active: true
        });
        registeredKeys.push(key);
        emit SessionKeyRegistered(key, validUntil, maxSpendWei, maxPerTxWei);
    }

    function revokeSessionKey(address key) external onlyOwner {
        if (!sessionKeys[key].active) revert SessionKeyNotFound();
        sessionKeys[key].active = false;
        emit SessionKeyRevoked(key);
    }

    function getSessionStatus(address key)
        external view returns (bool isValid, uint48 expiredAt, uint128 remainingWei, uint128 maxPerTxWei)
    {
        SessionKeyData storage s = sessionKeys[key];
        if (!s.active || block.timestamp > s.validUntil) {
            return (false, s.validUntil, 0, s.maxPerTxWei);
        }
        uint128 remaining = s.maxSpendWei > s.spentWei ? s.maxSpendWei - s.spentWei : 0;
        return (true, s.validUntil, remaining, s.maxPerTxWei);
    }

    function registeredKeyCount() external view returns (uint256) { return registeredKeys.length; }

    // ─────────────────────────────────────────────────────────
    //  EXECUTION (via ERC-6900 executor interface)
    // ─────────────────────────────────────────────────────────
    function executeFromSessionKey(
        address sessionKey, address target, uint256 value, bytes calldata data
    ) external onlyMSCA returns (bytes memory) {
        SessionKeyData storage sk = sessionKeys[sessionKey];
        if (!sk.active) revert SessionKeyNotActive();
        if (block.timestamp > sk.validUntil) revert SessionKeyExpired();

        uint256 effectiveSpend = value;

        // Decode ERC-20 token transfer / approve amounts from calldata (e.g. USDC on Arc)
        if (data.length >= 68) {
            bytes4 selector = bytes4(data[:4]);
            // transfer(address,uint256) -> 0xa9059cbb
            // approve(address,uint256) -> 0x095ea7b3
            if (selector == 0xa9059cbb || selector == 0x095ea7b3) {
                uint256 tokenAmount;
                assembly {
                    tokenAmount := calldataload(add(data.offset, 36))
                }
                effectiveSpend += tokenAmount;
            }
            // transferFrom(address,address,uint256) -> 0x23b872dd
            else if (selector == 0x23b872dd && data.length >= 100) {
                uint256 tokenAmount;
                assembly {
                    tokenAmount := calldataload(add(data.offset, 68))
                }
                effectiveSpend += tokenAmount;
            }
        }

        if (effectiveSpend > type(uint128).max || effectiveSpend > sk.maxPerTxWei) revert ExceedsMaxPerTx();
        uint128 txValue = uint128(effectiveSpend);
        if (uint256(sk.spentWei) + txValue > sk.maxSpendWei) revert ExceedsMaxSpend();

        sk.spentWei += txValue;
        emit SessionSpent(sessionKey, txValue);

        (bool success, bytes memory result) = target.call{value: value}(data);
        if (!success) { assembly { revert(add(result, 32), mload(result)) } }

        emit ModuleExecuted(sessionKey, target, data);
        return result;
    }

    // ─────────────────────────────────────────────────────────
    //  ERC-6900: SIGNATURE VALIDATION
    // ─────────────────────────────────────────────────────────
    function validateSessionKeySignature(
        address sessionKey, bytes32 userOpHash, bytes calldata signature
    ) external view returns (uint256 sigValidation) {
        SessionKeyData storage sk = sessionKeys[sessionKey];
        if (!sk.active || block.timestamp > sk.validUntil) return 1;

        bytes32 r; bytes32 s; uint8 v;
        assembly {
            r := calldataload(signature.offset)
            s := calldataload(add(signature.offset, 0x20))
            v := byte(0, calldataload(add(signature.offset, 0x40)))
        }
        address recovered = ecrecover(userOpHash, v, r, s);
        return recovered == sessionKey ? 0 : 1;
    }
}