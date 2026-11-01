// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ConstantProductPoolEurcCirBtcV4} from "../src/v4/ConstantProductPoolEurcCirBtcV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Shared fixture for the DEAD_ADDRESS transfer-block tests. Contains no test functions.
abstract contract EurcCirBtcDeadBase is Test {
    ConstantProductPoolEurcCirBtcV4 internal pool;
    MockERC20 internal eurc;
    MockERC20 internal btc;

    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;
    uint256 internal constant MIN_LIQ = 1000;
    uint256 internal constant SEED_A = 600_000e6;
    uint256 internal constant SEED_B = 10e8;

    address internal alice = makeAddr("alice"); // attacker in the adversarial scenarios
    address internal bob = makeAddr("bob"); // victim in the adversarial scenarios
    address internal carol = makeAddr("carol");

    function setUp() public virtual {
        eurc = new MockERC20("EURC", "EURC", 6);
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        pool = new ConstantProductPoolEurcCirBtcV4(address(eurc), address(btc), 25, address(this));
        address[3] memory users = [alice, bob, carol];
        for (uint256 i; i < 3; i++) {
            eurc.mint(users[i], 1e18);
            btc.mint(users[i], 1e18);
            vm.startPrank(users[i]);
            eurc.approve(address(pool), type(uint256).max);
            btc.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _roll() internal {
        vm.roll(block.number + 1);
    }

    function _deadSel() internal pure returns (bytes4) {
        return ConstantProductPoolEurcCirBtcV4.DeadAddressTransferBlocked.selector;
    }

    /// @dev `who` deposits (a, b) and returns the minted LP. Does NOT roll.
    function _add(address who, uint256 a, uint256 b) internal returns (uint256 lp) {
        vm.prank(who);
        lp = pool.addLiquidity(a, b, 0, type(uint256).max);
    }

    /// @dev alice seeds the pool at 1 BTC = 60,000 EURC and the chain advances one block (alice unlocked).
    function _seed() internal returns (uint256 lp) {
        lp = _add(alice, SEED_A, SEED_B);
        _roll();
    }

    /// @dev bob swaps both legs to generate fees and move the price.
    function _swapBothLegs() internal {
        vm.startPrank(bob);
        pool.swap(address(eurc), address(btc), 60_000e6, 0, type(uint256).max);
        pool.swap(address(btc), address(eurc), 1e8, 0, type(uint256).max);
        vm.stopPrank();
    }
}
