import { createPublicClient, http, parseAbi } from 'viem';

const client = createPublicClient({
  transport: http('https://rpc.testnet.arc.network')
});

const cpAddr = '0xe692555EFe37dEa7731d0944B8ca96fb4f90D2B7';
const abi = parseAbi([
  'function swap(address tokenIn, address tokenOut, uint256 amountIn, uint256 minOut) returns (uint256)',
  'function reserveA() view returns (uint256)',
  'function reserveB() view returns (uint256)',
  'function tokenA() view returns (address)',
  'function tokenB() view returns (address)',
]);

async function main() {
  const [tokenA, tokenB, resA, resB] = await Promise.all([
    client.readContract({ address: cpAddr, abi, functionName: 'tokenA' }),
    client.readContract({ address: cpAddr, abi, functionName: 'tokenB' }),
    client.readContract({ address: cpAddr, abi, functionName: 'reserveA' }),
    client.readContract({ address: cpAddr, abi, functionName: 'reserveB' }),
  ]);
  console.log('tokenA:', tokenA, 'tokenB:', tokenB);
  console.log('resA:', resA, 'resB:', resB);

  // Try simulating a swap of 1 USDC (1_000_000) for cirBTC with minOut = 0
  try {
    const sim = await client.simulateContract({
      address: cpAddr,
      abi,
      functionName: 'swap',
      args: [tokenA, tokenB, 1000000n, 0n],
      account: '0x3d839c9B5729aA3eA286d9BF7eBA5B7C542de772',
    });
    console.log('Simulate 1 USDC -> cirBTC succeeded! Output cirBTC units:', sim.result);
  } catch (err) {
    console.log('Simulate 1 USDC -> cirBTC failed:', err.shortMessage || err.message);
  }
}
main();
