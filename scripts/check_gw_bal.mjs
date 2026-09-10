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

const USDC = '0x3600000000000000000000000000000000000000';
const GATEWAY_WALLET = '0x0077777d7EBA4688BDeF3E311b846F25870A19B9';

async function main() {
  try {
    const bal = await client.readContract({
      address: USDC,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [GATEWAY_WALLET],
    });
    console.log('Gateway Wallet USDC balance on Arc Testnet:', formatUnits(bal, 6));
  } catch (e) {
    console.error(e);
  }
}

main();
