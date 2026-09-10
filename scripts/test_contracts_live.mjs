import { createPublicClient, http, formatUnits } from 'viem';
const arcTestnet = {
  id: 5042002,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 },
  rpcUrls: { default: { http: ['https://rpc.testnet.arc.network'] } },
};

const client = createPublicClient({
  chain: arcTestnet,
  transport: http('https://rpc.testnet.arc.network'),
});

const POOL_CONTRACTS = {
  STABLE_SWAP_POOL: '0x6d8fda7557d1c0a945a955557e10a4e70a129d20',
  CONSTANT_PRODUCT_POOL: '0x179c9d7f75b0aee8ffe9451fec060b9639220fe6',
  YIELD_VAULT: '0x4a4f0c1dd34c5433a228cbc3a499fabf18e3156d',
};

const STABLE_SWAP_ABI = [
  { type: 'function', name: 'reserveA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'reserveB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalLp', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'unclaimedFeeA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'unclaimedFeeB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'accumulatedFeeA', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'accumulatedFeeB', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'swapFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

const YIELD_VAULT_ABI = [
  { type: 'function', name: 'totalAssets', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  { type: 'function', name: 'totalSupply', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
];

async function main() {
  console.log('Querying Arc Testnet RPC with viem...');
  try {
    const [rA, rB, tLp, accA, accB, feeBps] = await Promise.all([
      client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }),
      client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }),
      client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }),
      client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'accumulatedFeeA' }),
      client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'accumulatedFeeB' }),
      client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'swapFeeBps' }),
    ]);
    console.log('StableSwapPool (USDC/EURC):', {
      reserveA: formatUnits(rA, 6),
      reserveB: formatUnits(rB, 6),
      totalSupply: formatUnits(tLp, 18),
      accumulatedFeeA: formatUnits(accA, 6),
      accumulatedFeeB: formatUnits(accB, 6),
      swapFeeBps: Number(feeBps),
    });
  } catch (e) {
    console.error('StableSwapPool error:', e.message);
  }

  try {
    const [rA, rB, tLp, accA, accB, feeBps] = await Promise.all([
      client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }),
      client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }),
      client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'totalLp' }),
      client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'accumulatedFeeA' }),
      client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'accumulatedFeeB' }),
      client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'swapFeeBps' }),
    ]);
    console.log('ConstantProductPool (USDC/cirBTC):', {
      reserveA: formatUnits(rA, 6),
      reserveB: formatUnits(rB, 8),
      totalSupply: formatUnits(tLp, 7),
      accumulatedFeeA: formatUnits(accA, 6),
      accumulatedFeeB: formatUnits(accB, 8),
      swapFeeBps: Number(feeBps),
    });
  } catch (e) {
    console.error('ConstantProductPool error:', e.message);
  }

  try {
    const [totalAssets, totalSupply] = await Promise.all([
      client.readContract({ address: POOL_CONTRACTS.YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' }),
      client.readContract({ address: POOL_CONTRACTS.YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalSupply' }),
    ]);
    console.log('YieldVault:', {
      totalAssets: formatUnits(totalAssets, 6),
      totalSupply: formatUnits(totalSupply, 6),
    });
  } catch (e) {
    console.error('YieldVault error:', e.message);
  }
}

main();
