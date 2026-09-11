import { createPublicClient, http, parseAbiItem } from 'viem';

const client = createPublicClient({
  transport: http('https://rpc.testnet.arc.network')
});

const cpAddr = '0xe692555EFe37dEa7731d0944B8ca96fb4f90D2B7';

async function main() {
  const currentBlock = await client.getBlockNumber();
  console.log('Current block:', currentBlock);
  // Scan 2000 blocks at a time back from currentBlock to creationBlock 61396886n
  let from = 61396886n;
  const to = currentBlock;
  console.log(`Checking logs from ${from} to ${to}...`);

  while (from <= to) {
    const chunkTo = from + 2000n > to ? to : from + 2000n;
    try {
      const logs = await client.getLogs({
        address: cpAddr,
        fromBlock: from,
        toBlock: chunkTo,
      });
      if (logs.length > 0) {
        console.log(`Found ${logs.length} logs in [${from}, ${chunkTo}]:`);
        for (const l of logs) {
          console.log('Log topics:', l.topics, 'txHash:', l.transactionHash);
        }
      }
    } catch (e) {
      console.log(`Error in [${from}, ${chunkTo}]:`, e.shortMessage || e.message);
    }
    from = chunkTo + 1n;
  }
}
main();
