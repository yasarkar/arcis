// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";
import {DeployCirBtcWethPool} from "../script/DeployCirBtcWethPool.s.sol";

/// @notice F-11: the deploy script validates the token pair BEFORE calling decimals().
/// @dev The script reads configuration from process environment variables, which are shared by every test running
///      in parallel; all env-driven scenarios therefore run sequentially inside ONE test function, and each
///      scenario sets every variable it depends on. No other test in the suite reads these variables.
contract DeployCirBtcWethPoolScriptTest is Test {
    DeployCirBtcWethPool internal script;
    MockERC20 internal btc;
    MockERC20 internal weth;
    address internal eoa = makeAddr("eoaToken");
    address internal ownerAddr = makeAddr("poolOwner");

    function setUp() public {
        script = new DeployCirBtcWethPool();
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        weth = new MockERC20("WETH", "WETH", 18);
        vm.chainId(script.ARC_TESTNET_CHAIN_ID());
    }

    function _env(address cirBtc, address wethAddr) internal {
        vm.setEnv("CIRBTC_ADDRESS", vm.toString(cirBtc));
        vm.setEnv("WETH_ADDRESS", vm.toString(wethAddr));
        vm.setEnv("OWNER_ADDRESS", vm.toString(ownerAddr));
        vm.setEnv("SWAP_FEE_BPS", "30");
    }

    function _expectScriptRevert(string memory reason) internal {
        vm.expectRevert(bytes(reason));
        script.run();
    }

    function test_Script_RejectsBadTokenPairsBeforeDecimalsAndDeploysValidPair() public {
        // F-11: identical addresses (both with code, valid decimals) are rejected
        _env(address(btc), address(btc));
        _expectScriptRevert("cirBTC and WETH must differ");
        _env(address(weth), address(weth));
        _expectScriptRevert("cirBTC and WETH must differ");

        // identical addresses WITHOUT code: the difference check fires first, not the code check
        _env(eoa, eoa);
        _expectScriptRevert("cirBTC and WETH must differ");

        // a token address without code is rejected with the explicit message -- not a bare revert from calling
        // decimals() on an EOA (which would carry no reason string)
        _env(eoa, address(weth));
        _expectScriptRevert("cirBTC must have code");
        _env(address(btc), eoa);
        _expectScriptRevert("WETH must have code");
        _env(eoa, makeAddr("anotherEoa"));
        _expectScriptRevert("cirBTC must have code");

        // zero address
        _env(address(0), address(weth));
        _expectScriptRevert("cirBTC and WETH addresses required");
        _env(address(btc), address(0));
        _expectScriptRevert("cirBTC and WETH addresses required");

        // decimals are still checked once code exists
        _env(address(weth), address(btc)); // swapped: cirBTC slot has 18 decimals
        _expectScriptRevert("cirBTC must have 8 decimals");
        MockERC20 sixDec = new MockERC20("WETH6", "WETH6", 6);
        _env(address(btc), address(sixDec));
        _expectScriptRevert("WETH must have 18 decimals");

        // wrong network
        _env(address(btc), address(weth));
        vm.chainId(1);
        _expectScriptRevert("DeployCirBtcWethPool: wrong network -- expected Arc Testnet (5042002)");
        vm.chainId(script.ARC_TESTNET_CHAIN_ID());

        // a valid pair deploys the pool with the requested owner and fee
        ConstantProductPoolCirBtcWethV4 pool = script.run();
        assertGt(address(pool).code.length, 0);
        assertEq(address(pool.tokenA()), address(btc));
        assertEq(address(pool.tokenB()), address(weth));
        assertEq(pool.owner(), ownerAddr);
        assertEq(pool.swapFeeBps(), 30);

        _canonicalAddressesNeedCode();
    }

    /// vm.etch variant: bytecode planted at the canonical Arc addresses is accepted, an empty canonical address is
    /// rejected. Runs inside the single env-driven test (shared process environment).
    function _canonicalAddressesNeedCode() internal {
        address cirBtc = script.CANONICAL_CIRBTC();
        address wethAddr = script.CANONICAL_WETH();
        assertEq(cirBtc.code.length, 0);
        assertEq(wethAddr.code.length, 0);
        _env(cirBtc, wethAddr);
        _expectScriptRevert("cirBTC must have code");

        vm.etch(cirBtc, address(new FixedDecimals(8)).code); // immutables live in code, so the clone keeps them
        _expectScriptRevert("WETH must have code");

        vm.etch(wethAddr, address(new FixedDecimals(18)).code);
        ConstantProductPoolCirBtcWethV4 pool = script.run();
        assertEq(address(pool.tokenA()), cirBtc);
        assertEq(address(pool.tokenB()), wethAddr);
    }
}

/// @dev Minimal token stand-in whose decimals are immutable (survive vm.etch).
contract FixedDecimals {
    uint8 internal immutable _d;

    constructor(uint8 d) {
        _d = d;
    }

    function decimals() external view returns (uint8) {
        return _d;
    }

    function symbol() external pure returns (string memory) {
        return "FIX";
    }
}
