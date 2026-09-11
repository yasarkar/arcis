import { createPublicClient, http } from 'viem';

const client = createPublicClient({
  transport: http('https://rpc.testnet.arc.network')
});

async function main() {
  const receipt = await client.getTransactionReceipt({ hash: '0x3426e10c465a3b16067c76b2a1a2d1e3acddbbc1c9d02eef75eafb2532ef5176' });
  console.log('Creation block:', receipt.blockNumber);
  const currentBlock = await client.getBlockNumber();
  console.log('Current block:', currentBlock);
  console.log('Block diff:', currentBlock - receipt.blockNumber);
}
main();
