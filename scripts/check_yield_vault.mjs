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

const YIELD_VAULT = '0x4a4f0c1dd34c5433a228cbc3a499fabf18e3156d';

async function main() {
  const abi = [
    { type: 'function', name: 'totalYieldDistributed', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
    { type: 'function', name: 'performanceFeeBps', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint256' }] },
  ];
  try {
    const [yd, fee] = await Promise.all([
      client.readContract({ address: YIELD_VAULT, abi, functionName: 'totalYieldDistributed' }),
      client.readContract({ address: YIELD_VAULT, abi, functionName: 'performanceFeeBps' }),
    ]);
    console.log('YieldVault stats:', {
      totalYieldDistributed: formatUnits(yd, 6),
      performanceFeeBps: Number(fee),
    });
  } catch (e) {
    console.error(e);
  }
}

main();
