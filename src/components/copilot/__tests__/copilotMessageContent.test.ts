// src/components/copilot/__tests__/copilotMessageContent.test.ts
// Server-render coverage for the inline network badge in Copilot chat messages.

import { describe, it, expect } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import CopilotMessageContent from '../CopilotMessageContent'

describe('CopilotMessageContent', () => {
  it('renders an Arc network badge (icon + label) for the transfer details template', () => {
    const html = renderToStaticMarkup(
      React.createElement(CopilotMessageContent, {
        content: '📤 <strong>Transfer Details:</strong>\n• <strong>Network:</strong> [[network:Arc Testnet]]',
      })
    )

    // The inline marker must never survive into the DOM as literal text.
    expect(html).not.toContain('[[network:')
    expect(html).toContain('Arc Testnet')
    // Arc resolves to the bundled Arc logo asset.
    expect(html).toContain('<img')
    expect(html).toContain('alt="Arc"')
  })

  it('still renders allowlisted formatting without a network marker', () => {
    const html = renderToStaticMarkup(
      React.createElement(CopilotMessageContent, { content: 'Total: <strong>10 USDC</strong>' })
    )

    expect(html).toContain('<strong>10 USDC</strong>')
  })

  it('escapes hostile markup around a network marker', () => {
    const html = renderToStaticMarkup(
      React.createElement(CopilotMessageContent, {
        content: '<img src=x onerror=alert(1)>[[network:Arc Testnet]]',
      })
    )

    expect(html).not.toContain('<img src=x onerror=alert(1)>')
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')
  })
})
