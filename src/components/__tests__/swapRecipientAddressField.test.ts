import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve } from 'path'

describe('SwapModal vs BridgeModal Recipient Address Field Parity', () => {
  const swapModalSource = readFileSync(
    resolve(__dirname, '../SwapModal.tsx'),
    'utf-8'
  )
  const bridgeModalSource = readFileSync(
    resolve(__dirname, '../BridgeModal.tsx'),
    'utf-8'
  )

  it('uses standard recipient state and does not use legacy customRecipient / useCustomRecipient', () => {
    expect(swapModalSource).toContain("const [recipient, setRecipient] = useState('')")
    expect(swapModalSource).not.toContain('customRecipient')
    expect(swapModalSource).not.toContain('useCustomRecipient')
    expect(swapModalSource).not.toContain('recipientIsOwnAddress')
    expect(swapModalSource).not.toContain('CLEAR RECIPIENT FOR ARC')
  })

  it('does not display the legacy Arc Testnet pool swap warning text', () => {
    expect(swapModalSource).not.toContain('Arc Testnet pool swaps always deliver output to the connected wallet')
  })

  it('has identical RecipientAddressField props and structure between SwapModal and BridgeModal', () => {
    // Both modals must use label="RECIPIENT ADDRESS"
    expect(swapModalSource).toContain('label="RECIPIENT ADDRESS"')
    expect(bridgeModalSource).toContain('label="RECIPIENT ADDRESS"')

    // Both modals must use rightBadge={recipientBadge}
    expect(swapModalSource).toContain('rightBadge={recipientBadge}')
    expect(bridgeModalSource).toContain('rightBadge={recipientBadge}')

    // Both modals must use value={recipient} and isValid={recipientIsValid}
    expect(swapModalSource).toContain('value={recipient}')
    expect(bridgeModalSource).toContain('value={recipient}')
    expect(swapModalSource).toContain('isValid={recipientIsValid}')
    expect(bridgeModalSource).toContain('isValid={recipientIsValid}')
  })

  it('has identical quick-fill recipient badges including "Use Connected Wallet"', () => {
    expect(swapModalSource).toContain('Use Connected Wallet')
    expect(bridgeModalSource).toContain('Use Connected Wallet')

    // Solana & Injective quick fill buttons match
    expect(swapModalSource).toContain("NetworkIcon name=\"solana\"")
    expect(swapModalSource).toContain("NetworkIcon name=\"injective\"")
  })

  it('has identical action button states for missing or invalid recipient', () => {
    expect(swapModalSource).toContain("'ENTER RECIPIENT ADDRESS'")
    expect(bridgeModalSource).toContain("'ENTER RECIPIENT ADDRESS'")

    expect(swapModalSource).toContain("'INVALID RECIPIENT ADDRESS'")
    expect(bridgeModalSource).toContain("'INVALID RECIPIENT ADDRESS'")
  })
})
