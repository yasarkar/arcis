// src/utils/__tests__/sanitizeCopilotHtml.test.ts
// Adversarial coverage for the Copilot message sanitizer.

import { describe, it, expect } from 'vitest'
import {
  sanitizeCopilotHtml,
  stripCopilotHtml,
  stripNetworkTokens,
  splitCopilotNetworkSegments,
} from '../sanitizeCopilotHtml'

const ALLOWED_TAG = /<\/?(?:strong|em|code|br|p|ul|ol|li)>/g

/**
 * True when the sanitized output still contains markup that is not on the allowlist. Because the
 * output is inserted with dangerouslySetInnerHTML, "no unexpected '<'" is exactly the property that
 * guarantees nothing outside the allowlist can be parsed as a tag.
 */
function hasUnexpectedMarkup(html: string): boolean {
  return html.replace(ALLOWED_TAG, '').includes('<')
}

describe('sanitizeCopilotHtml', () => {
  const hostilePayloads = [
    '<img src=x onerror=alert(1)>',
    '<script>alert(1)</script>',
    '<svg/onload=alert(1)>',
    '<iframe src="javascript:alert(1)"></iframe>',
    '<a href="javascript:alert(1)">click</a>',
    '<body onload=alert(1)>',
    // Unterminated tag at EOF — HTML parsers still treat this as a tag.
    '<img src=x onerror=alert(1)',
    '<<img src=x onerror=alert(1)>>',
    // Valid tag followed by a hostile one.
    '<strong>ok</strong><img src=x onerror=alert(1)>',
    // Attribute injected onto an otherwise allowlisted tag.
    '<strong onclick="steal()">bold</strong>',
  ]

  it.each(hostilePayloads)('leaves no unexpected markup in %s', (payload) => {
    expect(hasUnexpectedMarkup(sanitizeCopilotHtml(payload))).toBe(false)
  })

  it('escapes the canonical XSS payload into inert literal text', () => {
    expect(sanitizeCopilotHtml('<img src=x onerror=alert(1)>')).toBe(
      '&lt;img src=x onerror=alert(1)&gt;'
    )
  })

  it('drops attributes but keeps allowlisted formatting', () => {
    expect(sanitizeCopilotHtml('<strong class="x" onclick="steal()">hi</strong>')).toBe(
      '<strong>hi</strong>'
    )
    expect(sanitizeCopilotHtml('<CODE>1 + 1</CODE>')).toBe('<code>1 + 1</code>')
    expect(sanitizeCopilotHtml('a<br/>b')).toBe('a<br>b')
    expect(sanitizeCopilotHtml('<ul><li>one</li></ul>')).toBe('<ul><li>one</li></ul>')
    expect(sanitizeCopilotHtml('<p>Total: <em>1</em> USDC</p>')).toBe('<p>Total: <em>1</em> USDC</p>')
  })

  it('handles empty, plain, and non-tag input', () => {
    expect(sanitizeCopilotHtml('')).toBe('')
    expect(sanitizeCopilotHtml('plain text')).toBe('plain text')
    expect(sanitizeCopilotHtml('a < b')).toBe('a &lt; b')
  })
})

describe('stripCopilotHtml', () => {
  it('returns plain text with no tags for the clipboard and inline editor', () => {
    expect(stripCopilotHtml('<strong>Total:</strong> <code>1 USDC</code>')).toBe('Total: 1 USDC')
  })

  it('decodes escaped markup back to literal text', () => {
    expect(stripCopilotHtml('<img src=x onerror=alert(1)>')).toBe('<img src=x onerror=alert(1)>')
  })

  it('handles empty input', () => {
    expect(stripCopilotHtml('')).toBe('')
  })

  it('renders network markers as plain chain names for the clipboard and inline editor', () => {
    expect(stripCopilotHtml('• <strong>Network:</strong> [[network:Arc Testnet]]')).toBe(
      '• Network: Arc Testnet'
    )
    expect(stripNetworkTokens('[[network:Base Sepolia]]')).toBe('Base Sepolia')
  })
})

describe('splitCopilotNetworkSegments', () => {
  it('separates sanitized HTML from inline network markers', () => {
    const segments = splitCopilotNetworkSegments('• <strong>Network:</strong> [[network:Arc Testnet]]!')

    expect(segments).toEqual([
      { type: 'html', value: '• <strong>Network:</strong> ' },
      { type: 'network', value: 'Arc Testnet' },
      { type: 'html', value: '!' },
    ])
  })

  it('keeps HTML segments sanitized so a network marker cannot smuggle markup', () => {
    const segments = splitCopilotNetworkSegments('<img src=x onerror=alert(1)>[[network:Arc Testnet]]')

    expect(segments[0]).toEqual({ type: 'html', value: '&lt;img src=x onerror=alert(1)&gt;' })
    expect(segments[1]).toEqual({ type: 'network', value: 'Arc Testnet' })
  })

  it('returns a single html segment when no marker is present', () => {
    expect(splitCopilotNetworkSegments('plain text')).toEqual([{ type: 'html', value: 'plain text' }])
  })
})
