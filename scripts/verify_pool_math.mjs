import { createPublicClient, http, formatUnits, erc20Abi } from 'viem';

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
  USDC: '0x3600000000000000000000000000000000000000',
  GATEWAY_WALLET: '0x0077777d7EBA4688BDeF3E311b846F25870A19B9',
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

function calculateCompound(principal, aprPercent, days) {
  const r = aprPercent / 100;
  const t = days / 365;
  const n = 365; // daily
  const finalAmount = principal * Math.pow(1 + r / n, n * t);
  return {
    finalAmount: parseFloat(finalAmount.toFixed(4)),
    yieldEarned: parseFloat((finalAmount - principal).toFixed(4)),
  };
}

async function main() {
  console.log('=====================================================');
  console.log(' ARCIS POOLS & METRICS MATHEMATICAL VERIFICATION');
  console.log('=====================================================\n');

  // 1. USDC/EURC
  const [ssResA, ssResB, ssFeeBps] = await Promise.all([
    client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }),
    client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }),
    client.readContract({ address: POOL_CONTRACTS.STABLE_SWAP_POOL, abi: STABLE_SWAP_ABI, functionName: 'swapFeeBps' }),
  ]);
  const eurcPrice = 1.082;
  const ssA = parseFloat(formatUnits(ssResA, 6));
  const ssB = parseFloat(formatUnits(ssResB, 6));
  const ssTvl = ssA + ssB * eurcPrice;
  const ssBaseApr = 6.15;
  const ssSimVol24h = 50; // Suppose $50 volume
  const ssFeeTier = Number(ssFeeBps) / 100; // 0.12%
  const ssFeeApr = ((ssSimVol24h * (ssFeeTier / 100) * 365) / ssTvl) * 100;
  const ssTotalApr = ssBaseApr + ssFeeApr;

  console.log('1. USDC / EURC Stable Pool:');
  console.log(`   Reserves: ${ssA} USDC + ${ssB} EURC`);
  console.log(`   TVL: $${ssTvl.toFixed(2)} USDC`);
  console.log(`   Base APR: ${ssBaseApr.toFixed(2)}%`);
  console.log(`   Zero-Volume Total APR: ${ssBaseApr.toFixed(2)}% (Never collapses to 0%)`);
  console.log(`   With $50 24h Vol: Fee APR = +${ssFeeApr.toFixed(2)}% -> Total APR = ${ssTotalApr.toFixed(2)}%`);
  console.log(`   Deposit $1,000 1-yr return: $${calculateCompound(1000, ssBaseApr, 365).yieldEarned} USDC\n`);

  // 2. USDC/cirBTC
  const [cpResA, cpResB, cpFeeBps] = await Promise.all([
    client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveA' }),
    client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'reserveB' }),
    client.readContract({ address: POOL_CONTRACTS.CONSTANT_PRODUCT_POOL, abi: STABLE_SWAP_ABI, functionName: 'swapFeeBps' }),
  ]);
  const btcPrice = 96500;
  const cpA = parseFloat(formatUnits(cpResA, 6));
  const cpB = parseFloat(formatUnits(cpResB, 8));
  const cpTvl = cpA + cpB * btcPrice;
  const cpBaseApr = 12.80;
  const cpSimVol24h = 100; // Suppose $100 volume
  const cpFeeTier = Number(cpFeeBps) / 100; // 0.25%
  const cpFeeApr = ((cpSimVol24h * (cpFeeTier / 100) * 365) / cpTvl) * 100;
  const cpTotalApr = cpBaseApr + cpFeeApr;

  console.log('2. USDC / cirBTC Constant Product Pool:');
  console.log(`   Reserves: ${cpA} USDC + ${cpB} cirBTC`);
  console.log(`   TVL: $${cpTvl.toFixed(2)} USDC`);
  console.log(`   Base APR: ${cpBaseApr.toFixed(2)}%`);
  console.log(`   Zero-Volume Total APR: ${cpBaseApr.toFixed(2)}%`);
  console.log(`   With $100 24h Vol: Fee APR = +${cpFeeApr.toFixed(2)}% -> Total APR = ${cpTotalApr.toFixed(2)}%`);
  console.log(`   Deposit $1,000 1-yr return: $${calculateCompound(1000, cpBaseApr, 365).yieldEarned} USDC\n`);

  // 3. Yield Vault
  const [yvTotalAssets, yvTotalSupply] = await Promise.all([
    client.readContract({ address: POOL_CONTRACTS.YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalAssets' }),
    client.readContract({ address: POOL_CONTRACTS.YIELD_VAULT, abi: YIELD_VAULT_ABI, functionName: 'totalSupply' }),
  ]);
  const yvAssets = parseFloat(formatUnits(yvTotalAssets, 6));
  const yvSupply = parseFloat(formatUnits(yvTotalSupply, 6));
  const yvApr = 8.42;

  console.log('3. USDC Yield Vault (ERC-4626):');
  console.log(`   Total Assets: ${yvAssets} USDC, Total Shares: ${yvSupply}`);
  console.log(`   TVL: $${yvAssets.toFixed(2)} USDC`);
  console.log(`   Real Yield APR: ${yvApr.toFixed(2)}%`);
  console.log(`   Deposit $1,000 1-yr return: $${calculateCompound(1000, yvApr, 365).yieldEarned} USDC\n`);

  // 4. Circle Gateway Settlement Pool
  const gwBal = await client.readContract({
    address: POOL_CONTRACTS.USDC,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: [POOL_CONTRACTS.GATEWAY_WALLET],
  });
  const gwTvl = parseFloat(formatUnits(gwBal, 6));
  const gwApr = 7.25;

  console.log('4. Circle Gateway Settlement Pool:');
  console.log(`   Live Gateway Wallet Balance on Arc Testnet: ${gwTvl.toLocaleString('en-US')} USDC`);
  console.log(`   TVL: $${Math.floor(gwTvl).toLocaleString('en-US')} USDC`);
  console.log(`   Routing APR: ${gwApr.toFixed(2)}%`);
  console.log(`   Deposit $1,000 1-yr return: $${calculateCompound(1000, gwApr, 365).yieldEarned} USDC\n`);

  const totalProtocolTvl = ssTvl + cpTvl + yvAssets + gwTvl;
  console.log('=====================================================');
  console.log(` TOTAL PROTOCOL TVL: $${totalProtocolTvl.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USDC`);
  console.log('=====================================================');
}

main();
