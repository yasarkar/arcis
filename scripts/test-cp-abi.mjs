import { createPublicClient, http, toFunctionSelector } from 'viem';

const client = createPublicClient({
  transport: http('https://rpc.testnet.arc.network')
});

const cpAddr = '0xe692555EFe37dEa7731d0944B8ca96fb4f90D2B7';

const functions = [
  'function reserveA() view returns (uint256)',
  'function reserveB() view returns (uint256)',
  'function totalLp() view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function swapFeeBps() view returns (uint256)',
  'function accumulatedFeeA() view returns (uint256)',
  'function accumulatedFeeB() view returns (uint256)',
  'function unclaimedFeeA() view returns (uint256)',
  'function unclaimedFeeB() view returns (uint256)',
  'function paused() view returns (bool)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function tokenA() view returns (address)',
  'function tokenB() view returns (address)',
];

import { parseAbi } from 'viem';
const abi = parseAbi(functions);

async function main() {
  console.log('Testing cpAddr:', cpAddr);
  for (const item of abi) {
    const sel = toFunctionSelector(item);
    try {
      const res = await client.readContract({
        address: cpAddr,
        abi: [item],
        functionName: item.name,
      });
      console.log(`[${sel}] ${item.name} ->`, res);
    } catch (e) {
      console.log(`[${sel}] ${item.name} -> FAILED:`, e.shortMessage || e.message);
    }
  }
}
main();
