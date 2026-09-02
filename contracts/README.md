# ⚡ Arcis Smart Contracts (Foundry)

This repository contains the core Solidity smart contracts for the **Arcis Protocol** on **Arc L1**:
- **`StableSwapPool.sol`**: Low-slippage stableswap pool for USDC / EURC pairs.
- **`ConstantProductPool.sol`**: Standard $xy=k$ AMM pool for volatile pairs (e.g. USDC / cirBTC).
- **`YieldVault.sol`**: ERC-4626 compliant single-asset USDC real-yield vault with `af-USDC` share tokens.
- **`SessionKeyModule.sol`**: Modular session key executor for autonomous AI copilot transactions and spending limits.

---

## 🛠️ Prerequisites

- Install Foundry:
  ```bash
  curl -L https://foundry.paradigm.xyz | bash
  foundryup
  ```

---

## 🚀 Commands & Workflow

### 1. Build Contracts
```bash
forge build
```

### 2. Run Tests
```bash
forge test -vvv
```

### 3. Deploy to Arc Testnet
```bash
# Load your private key into environment
export PRIVATE_KEY=0x_your_private_key_here

# Deploy & Broadcast to Arc Testnet
forge script script/Deploy.s.sol:Deploy \
  --rpc-url arc_testnet \
  --broadcast \
  --verify
```

### 4. Deploy to Arc Mainnet
```bash
export PRIVATE_KEY=0x_your_mainnet_deployer_key_here
export IS_TESTNET=false

# Deploy & Broadcast to Arc Mainnet
forge script script/Deploy.s.sol:Deploy \
  --rpc-url arc_mainnet \
  --broadcast \
  --verify
```

### 5. Deploy Session Key Module
```bash
export MSCA_ADDRESS=0x_your_circle_modular_account_address
forge script script/DeploySessionKey.s.sol:DeploySessionKey \
  --rpc-url arc_testnet \
  --broadcast
```

---

## ⚙️ Updating Frontend Configuration
After deployment, copy the contract addresses printed in the console to `src/config/poolsConfig.ts` under `POOL_CONTRACTS`:
- `STABLE_SWAP_POOL`
- `CONSTANT_PRODUCT_POOL`
- `YIELD_VAULT`
