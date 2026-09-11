import { toFunctionSelector } from 'viem';

const errors = [
  'error ZeroAmount()',
  'error InvalidFeeBps()',
  'error NotEnoughLP()',
  'error TransferFailed()',
  'error SlippageExceeded()',
  'error InvalidTokenPair()',
  'error ZeroAddress()',
  'error KInvariantViolated()',
  'error ERC20InsufficientBalance(address sender, uint256 balance, uint256 needed)',
  'error ERC20InvalidSender(address sender)',
  'error ERC20InvalidReceiver(address receiver)',
  'error ERC20InsufficientAllowance(address spender, uint256 allowance, uint256 needed)',
  'error ERC20InvalidApprover(address approver)',
  'error ERC20InvalidSpender(address spender)',
  'error EnforcedPause()',
  'error ExpectedPause()'
];

for (const err of errors) {
  const sel = toFunctionSelector(err);
  console.log(sel, err);
  if (sel === '0x90b8ec18') {
    console.log('MATCH!!!', err);
  }
}
