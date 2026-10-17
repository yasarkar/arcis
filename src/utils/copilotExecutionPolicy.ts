// src/utils/copilotExecutionPolicy.ts
// ARC-025: the Copilot prompt used to say "ALWAYS execute explicit user transactional commands …
// NEVER refuse", which reads as "never refuse anything that looks like a command". One owner for
// the sentence, imported by both prompt builders (api/copilot.ts and src/services/llmService.ts),
// so the server and the client fallback cannot drift apart.
//
// The policy keeps the useful half — a fully specified command is prepared, never deflected to the
// faucet — and states the boundary: no action for questions, hypotheticals, negations or commands
// missing their parameters, and no implied execution (the user confirms in the action card).

export const COPILOT_EXECUTION_POLICY =
  'Prepare an explicit transactional command that names its amount — and, for a transfer, its recipient — by calling the matching tool ' +
  '(execute_send, execute_swap, execute_deposit_yield, execute_bridge), and never answer such a command with a faucet message; ' +
  'the execution engine and session-key limits validate the real-time balance. ' +
  'This never authorises acting on a question, a hypothetical, a negated/cancelled request (e.g. "…yapma", "don\'t send"), ' +
  'or a command missing an amount or recipient — ask for the missing parameter instead. ' +
  'You never sign or broadcast anything yourself: the user confirms in the action card, which is where the risk warnings are shown.'
