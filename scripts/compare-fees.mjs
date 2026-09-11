import { createPublicClient, http, parseAbi } from 'viem';

const client = createPublicClient({
  transport: http('https://rpc.testnet.arc.network')
});

const ssAddr = '0x753aa59233358e1999554576E0Fc3cA6A54AdAB2';
const cpAddr = '0xe692555EFe37dEa7731d0944B8ca96fb4f90D2B7';

const abi = parseAbi([
  'function reserveA() view returns (uint256)',
  'function reserveB() view returns (uint256)',
  'function accumulatedFeeA() view returns (uint256)',
  'function accumulatedFeeB() view returns (uint256)',
  'function swapFeeBps() view returns (uint256)'
]);

async function main() {
  console.log('--- STABLE SWAP (USDC/EURC) ---');
  const [ssRA, ssRB, ssA, ssB, ssFee] = await Promise.all([
    client.readContract({ address: ssAddr, abi, functionName: 'reserveA' }),
    client.readContract({ address: ssAddr, abi, functionName: 'reserveB' }),
    client.readContract({ address: ssAddr, abi, functionName: 'accumulatedFeeA' }),
    client.readContract({ address: ssAddr, abi, functionName: 'accumulatedFeeB' }),
    client.readContract({ address: ssAddr, abi, functionName: 'swapFeeBps' }),
  ]);
  console.log('resA:', ssRA, 'resB:', ssRB, 'accA:', ssA, 'accB:', ssB, 'feeBps:', ssFee);

  console.log('--- CONSTANT PRODUCT (USDC/cirBTC) ---');
  const [cpRA, cpRB, cpA, cpB, cpFee] = await Promise.all([
    client.readContract({ address: cpAddr, abi, functionName: 'reserveA' }),
    client.readContract({ address: cpAddr, abi, functionName: 'reserveB' }),
    client.readContract({ address: cpAddr, abi, functionName: 'accumulatedFeeA' }),
    client.readContract({ address: cpAddr, abi, functionName: 'accumulatedFeeB' }),
    client.readContract({ address: cpAddr, abi, functionName: 'swapFeeBps' }),
  ]);
  console.log('resA:', cpRA, 'resB:', cpRB, 'accA:', cpA, 'accB:', cpB, 'feeBps:', cpFee);
}
main();
