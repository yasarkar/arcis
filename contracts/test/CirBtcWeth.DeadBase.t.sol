// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Shared fixture for the cirBTC/WETH dead-address adversarial tests. Contains no test functions.
abstract contract CirBtcWethDeadBase is Test {
    ConstantProductPoolCirBtcWethV4 internal pool;
    MockERC20 internal btc; // tokenA, 8 decimals
    MockERC20 internal weth; // tokenB, 18 decimals

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MIN_LIQ = 1000;
    uint256 internal constant SAT = 1e8;
    uint256 internal constant ETH = 1e18;

    address internal alice = makeAddr("alice"); // attacker in the adversarial scenarios
    address internal bob = makeAddr("bob"); // victim in the adversarial scenarios
    address internal carol = makeAddr("carol");

    function setUp() public virtual {
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        weth = new MockERC20("WETH", "WETH", 18);
        pool = new ConstantProductPoolCirBtcWethV4(address(btc), address(weth), 30, address(this));
        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            btc.mint(users[i], 1e18);
            weth.mint(users[i], 1e40);
            vm.startPrank(users[i]);
            btc.approve(address(pool), type(uint256).max);
            weth.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _roll() internal {
        vm.roll(block.number + 1);
    }

    function _deadSel() internal pure returns (bytes4) {
        return ConstantProductPoolCirBtcWethV4.DeadAddressTransferBlocked.selector;
    }

    function _ratio(uint256 sel) internal pure returns (uint256) {
        uint256 s = sel % 3;
        return s == 0 ? 1 : (s == 1 ? 20 : 100);
    }

    /// @dev `who` deposits (a, b) and returns the minted LP. Does NOT roll.
    function _add(address who, uint256 a, uint256 b) internal returns (uint256 lp) {
        vm.prank(who);
        lp = pool.addLiquidity(a, b, 0, type(uint256).max);
    }
}
