// src/utils/sanitizeCopilotHtml.ts
// Allowlist HTML sanitizer for Copilot chat bubbles.
//
// Copilot message content originates from an LLM and is rendered with dangerouslySetInnerHTML.
// Because prompt injection can steer the model's output, that content must be reduced to a small
// safe subset before it reaches the DOM. The allowlist below is exactly the formatting the Copilot
// system prompt is instructed to emit, plus the tags that preserve list/line structure.

const ALLOWED_TAGS = new Set(['strong', 'em', 'code', 'br', 'p', 'ul', 'ol', 'li'])

/**
 * Inline network marker emitted by Copilot templates, e.g. `[[network:Arc Testnet]]`.
 * The chat renderer swaps it for a real @web3icons chain badge, so the icon is rendered as a
 * React component rather than markup (which the allowlist below would strip).
 */
export const COPILOT_NETWORK_TOKEN_REGEX = /\[\[network:([^\]]+)\]\]/g

/** Replaces inline network markers with their plain chain name (copy / edit / clipboard). */
export function stripNetworkTokens(input: string): string {
  if (!input || typeof input !== 'string') return ''
  return input.replace(COPILOT_NETWORK_TOKEN_REGEX, '$1')
}

export interface CopilotContentSegment {
  type: 'html' | 'network'
  value: string
}

/**
 * Splits Copilot content into sanitized HTML segments and network-name segments so the chat
 * renderer can mount a real @web3icons chain badge wherever a `[[network:<chain>]]` marker appears.
 * Each HTML segment is sanitized independently, so the guarantee of sanitizeCopilotHtml holds.
 */
export function splitCopilotNetworkSegments(content: string): CopilotContentSegment[] {
  return (content || '')
    .split(COPILOT_NETWORK_TOKEN_REGEX)
    .map((part, index) =>
      index % 2 === 1
        ? { type: 'network' as const, value: part.trim() }
        : { type: 'html' as const, value: sanitizeCopilotHtml(part) }
    )
}

// Tags that carry no closing counterpart.
const VOID_TAGS = new Set(['br'])

function escapeForHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Reduces Copilot message HTML to an allowlist of formatting tags with every attribute stripped.
 *
 * Any tag outside the allowlist is escaped and therefore rendered as inert literal text instead of
 * markup, so payloads such as `<img src=x onerror=alert(1)>` cannot execute. The returned string is
 * guaranteed to contain raw `<` only as part of an allowlisted tag.
 */
export function sanitizeCopilotHtml(input: string): string {
  if (!input || typeof input !== 'string') return ''

  let out = ''
  let cursor = 0

  while (cursor < input.length) {
    const open = input.indexOf('<', cursor)

    // No further markup: the remaining slice contains no '<' and can pass through untouched.
    if (open === -1) {
      out += input.slice(cursor)
      break
    }

    out += input.slice(cursor, open)

    // UX-04: If '<' does not begin a tag name (e.g. '<500ms' or '< 10'), escape it directly
    // so it cannot consume subsequent valid closing tags like '</strong>'.
    if (!/^<\/?[a-zA-Z]/.test(input.slice(open))) {
      out += '&lt;'
      cursor = open + 1
      continue
    }

    const close = input.indexOf('>', open)

    // HTML parsers still treat a trailing unterminated tag at EOF as a tag, so escape the rest.
    if (close === -1) {
      out += escapeForHtml(input.slice(open))
      break
    }

    const rawTag = input.slice(open, close + 1)
    const match = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)/.exec(rawTag)
    const tagName = match?.[2]?.toLowerCase()

    if (match && tagName && ALLOWED_TAGS.has(tagName)) {
      // Attributes are dropped entirely, so no event handler or URL can survive.
      out += VOID_TAGS.has(tagName) ? `<${tagName}>` : `<${match[1]}${tagName}>`
    } else {
      // Unknown/unsafe markup is shown as literal text rather than parsed as HTML.
      out += escapeForHtml(rawTag)
    }

    cursor = close + 1
  }

  return out
}

/**
 * Converts Copilot message HTML into plain text for the clipboard and the inline editor, where
 * markup must never be interpreted.
 */
export function stripCopilotHtml(input: string): string {
  if (!input || typeof input !== 'string') return ''

  return stripNetworkTokens(sanitizeCopilotHtml(input))
    .replace(/<[^>]*>/g, '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Decoded last so a literal "&amp;lt;" is not turned into "<".
    .replace(/&amp;/g, '&')
}
