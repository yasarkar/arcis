import { createHash } from 'crypto';
// In keccak256:
import { keccak_256 } from '@noble/hashes/sha3';

function selector(sig) {
  const hash = Buffer.from(keccak_256(sig)).toString('hex');
  return '0x' + hash.slice(0, 8);
}

console.log('reserveA():', selector('reserveA()'));
console.log('reserveB():', selector('reserveB()'));
console.log('totalLp():', selector('totalLp()'));
console.log('totalSupply():', selector('totalSupply()'));
console.log('totalAssets():', selector('totalAssets()'));
console.log('accumulatedFeeA():', selector('accumulatedFeeA()'));
console.log('accumulatedFeeB():', selector('accumulatedFeeB()'));
console.log('unclaimedFeeA():', selector('unclaimedFeeA()'));
console.log('swapFeeBps():', selector('swapFeeBps()'));
console.log('tokenA():', selector('tokenA()'));
console.log('tokenB():', selector('tokenB()'));
