// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ConstantProductPoolCirBtcWethV4} from "../src/v4/ConstantProductPoolCirBtcWethV4.sol";
import {MockERC20} from "../src/mocks/MockERC20.sol";

/// @dev Token that tries to re-enter the pool while the pool transfers it out (skim recovery path).
contract ReentrantRecoveryToken is MockERC20 {
    ConstantProductPoolCirBtcWethV4 public pool;
    bytes public lastRevert;
    bool public attempted;

    constructor() MockERC20("Callback", "CB", 18) {}

    function setPool(ConstantProductPoolCirBtcWethV4 p) external {
        pool = p;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (msg.sender == address(pool) && !attempted) {
            attempted = true;
            // Re-enter an owner-only function and a public one while the pool still holds the lock.
            try pool.skim(address(this), to) {} catch (bytes memory err) {
                lastRevert = err;
            }
        }
        return super.transfer(to, amount);
    }
}

contract CirBtcWethSkimTest is Test {
    ConstantProductPoolCirBtcWethV4 pool;
    MockERC20 btc;
    MockERC20 weth;
    ReentrantRecoveryToken cb;
    address recipient = address(0xBEEF);

    event SkimExecuted(address indexed token, address indexed to, uint256 amount);

    function setUp() public {
        btc = new MockERC20("cirBTC", "cirBTC", 8);
        weth = new MockERC20("WETH", "WETH", 18);
        pool = new ConstantProductPoolCirBtcWethV4(address(btc), address(weth), 30, address(this));
        cb = new ReentrantRecoveryToken();
        cb.setPool(pool);
    }

    function test_Skim_ReentrancyIsBlocked() public {
        cb.mint(address(pool), 1_000 ether);
        pool.skim(address(cb), recipient);
        assertEq(cb.balanceOf(recipient), 1_000 ether, "recovery still succeeds");
        assertTrue(cb.attempted(), "token attempted to re-enter");
        assertEq(
            bytes4(cb.lastRevert()),
            ReentrancyGuard.ReentrancyGuardReentrantCall.selector,
            "re-entry hit the pool lock"
        );
    }

    function test_Skim_EmitsEventAndOnlyOwner() public {
        cb.mint(address(pool), 5 ether);
        vm.prank(address(0xBAD));
        vm.expectRevert();
        pool.skim(address(cb), recipient);

        vm.expectEmit(true, true, false, true, address(pool));
        emit SkimExecuted(address(cb), recipient, 5 ether);
        pool.skim(address(cb), recipient);
    }

    function test_Skim_NeverTouchesTrackedReserves() public {
        btc.mint(address(this), 10 * 1e8);
        weth.mint(address(this), 200 ether);
        btc.approve(address(pool), type(uint256).max);
        weth.approve(address(pool), type(uint256).max);
        pool.addLiquidity(10 * 1e8, 200 ether, 0, type(uint256).max);
        btc.mint(address(pool), 123); // stray donation
        pool.skim(address(btc), recipient);
        assertEq(btc.balanceOf(recipient), 123);
        assertEq(btc.balanceOf(address(pool)), pool.reserveA() + pool.feeReserveA());
    }
}
