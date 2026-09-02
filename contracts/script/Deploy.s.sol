// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockERC20} from "../src/mocks/MockERC20.sol";
import {StableSwapPool} from "../src/StableSwapPool.sol";
import {ConstantProductPool} from "../src/ConstantProductPool.sol";
import {YieldVault} from "../src/YieldVault.sol";
import {SessionKeyModule} from "../src/SessionKeyModule.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Script, console2} from "forge-std/Script.sol";

/// @notice Arcis deployment script — Arc Testnet & Mainnet.
/// @dev Deploys pool contracts + YieldVault + SessionKeyModule.
contract Deploy is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        // Token addresses (configurable via environment variables)
        address usdc = vm.envOr("USDC_ADDRESS", address(0x3600000000000000000000000000000000000000));
        address eurc = vm.envOr("EURC_ADDRESS", address(0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a));
        address cirbtc = vm.envOr("CIRBTC_ADDRESS", address(0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF));
        bool isTestnet = vm.envOr("IS_TESTNET", true);

        vm.startBroadcast(deployerKey);

        // 1) Deploy Core Liquidity Pools & Yield Vault
        StableSwapPool stablePool = new StableSwapPool(usdc, eurc, 12); // 0.12% fee
        ConstantProductPool cpPool = new ConstantProductPool(usdc, cirbtc, 25); // 0.25% fee
        YieldVault yieldVault = new YieldVault(IERC20(usdc), "Arcis USDC Yield", "af-USDC", 100); // 1% fee

        console2.log("=== Arcis Smart Contracts Deployed ===");
        console2.log("Deployer:", deployer);
        console2.log("StableSwapPool (USDC/EURC):", address(stablePool));
        console2.log("ConstantProductPool (USDC/cirBTC):", address(cpPool));
        console2.log("YieldVault (af-USDC):", address(yieldVault));

        // 2) Optional Testnet Mock Token
        if (isTestnet) {
            MockERC20 tcirbtc = new MockERC20("Test cirBTC", "tcirBTC", 8);
            ConstantProductPool cpPoolTc = new ConstantProductPool(usdc, address(tcirbtc), 25);
            tcirbtc.mint(deployer, 10 * 10**8); // 10 tcirBTC for initial liquidity

            console2.log("tcirBTC (Faucet Token):", address(tcirbtc));
            console2.log("ConstantProductPool (USDC/tcirBTC):", address(cpPoolTc));
        }

        // 3) SessionKeyModule (if MSCA_ADDRESS is provided)
        address mscaAddress = vm.envOr("MSCA_ADDRESS", address(0));
        if (mscaAddress != address(0)) {
            SessionKeyModule skModule = new SessionKeyModule(mscaAddress, deployer);
            console2.log("SessionKeyModule:", address(skModule));
        }

        vm.stopBroadcast();
    }
}
