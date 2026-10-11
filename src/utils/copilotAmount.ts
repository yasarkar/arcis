// Shared by the browser intent parser and API: never guess a financial amount's locale.
// Existing action interfaces use number; only decimals that round-trip losslessly may cross them.
export type CopilotPromptAmount =
  | { status: 'missing' }
  | { status: 'invalid' | 'ambiguous'; message: string }
  | { status: 'valid'; decimal: string; amount: number }

function canonicalDecimal(value: string): string {
  const [whole, fraction = ''] = value.split('.')
  const integer = whole.replace(/^0+(?=\d)/, '') || '0'
  const trimmedFraction = fraction.replace(/0+$/, '')
  return trimmedFraction ? `${integer}.${trimmedFraction}` : integer
}

/** Expands a finite JS number without rounding through toFixed or multiplying by token decimals. */
export function numberToExactDecimal(value: number): string | null {
  if (!Number.isFinite(value) || value < 0) return null
  const text = value.toString()
  const match = /^(\d+)(?:\.(\d+))?e([+-]?\d+)$/.exec(text)
  if (!match) return canonicalDecimal(text)
  const digits = match[1] + (match[2] || '')
  const point = match[1].length + Number(match[3])
  const expanded = point <= 0
    ? `0.${'0'.repeat(-point)}${digits}`
    : point >= digits.length
      ? digits + '0'.repeat(point - digits.length)
      : `${digits.slice(0, point)}.${digits.slice(point)}`
  return canonicalDecimal(expanded)
}

const INVALID_AMOUNT_MESSAGE =
  'Invalid amount / Geçersiz tutar. Use a positive amount with an explicit decimal separator, e.g. 1.5 or 1,5; do not use scientific notation or malformed grouping.'
const AMBIGUOUS_AMOUNT_MESSAGE =
  'Ambiguous amount / Belirsiz tutar. 1.000 or 1,000 can mean one or one thousand. Please re-enter the amount without thousands separators: 1000 for one thousand, or 1 / 1.0 for one.'

export function parseCopilotAmount(raw: string): Exclude<CopilotPromptAmount, { status: 'missing' }> {
  if (!raw || raw.length > 80 || !/^[\d.,]+$/.test(raw)) {
    return { status: 'invalid', message: INVALID_AMOUNT_MESSAGE }
  }

  let normalized: string
  if (raw.includes('.') && raw.includes(',')) {
    // Both separators explicitly identify the locale, but every grouping must still be valid.
    if (/^[1-9]\d{0,2}(?:\.\d{3})+,\d+$/.test(raw)) normalized = raw.replace(/\./g, '').replace(',', '.')
    else if (/^[1-9]\d{0,2}(?:,\d{3})+\.\d+$/.test(raw)) normalized = raw.replace(/,/g, '')
    else return { status: 'invalid', message: INVALID_AMOUNT_MESSAGE }
  } else if (/^[1-9]\d{0,2}(?:[.,]\d{3}){2,}$/.test(raw)) {
    // Two or more same-separator groups cannot be a valid decimal number.
    normalized = raw.replace(/[.,]/g, '')
  } else if (/^[1-9]\d{0,2}[.,]\d{3}$/.test(raw)) {
    return { status: 'ambiguous', message: AMBIGUOUS_AMOUNT_MESSAGE }
  } else if (/^(?:\d+(?:[.,]\d+)?|[.,]\d+)$/.test(raw)) {
    normalized = raw.replace(',', '.')
  } else {
    return { status: 'invalid', message: INVALID_AMOUNT_MESSAGE }
  }

  const decimal = canonicalDecimal(normalized)
  const amount = Number(decimal)
  if (!Number.isFinite(amount) || amount <= 0) return { status: 'invalid', message: INVALID_AMOUNT_MESSAGE }
  // Prevent loss of integer/fractional digits at the existing number-based payload boundary.
  if ((Number.isInteger(amount) && !Number.isSafeInteger(amount)) || numberToExactDecimal(amount) !== decimal) {
    return { status: 'invalid', message: 'Invalid amount / Geçersiz tutar. This amount cannot be represented exactly by the transaction interface; please use a smaller amount or fewer decimal digits.' }
  }
  return { status: 'valid', decimal, amount }
}

/** Removes addresses, explicit memo tails and slippage values before extracting a whole number token. */
export function parseCopilotPromptAmount(prompt: string): CopilotPromptAmount {
  const cleaned = prompt.replace(/0x[a-fA-F0-9]{40}/gi, '')
    .replace(/(?:\bmemo\b|\breference\b|(?:^|\s)(?:not|açıklama)\s*[:=])[\s\S]*$/i, '')
    .replace(/(?:slippage|kayma|tolerance|tolerans|slip)\s*(?:of|is|to|:|=)?\s*%?\s*[+-]?\d[\d.,]*(?:[eE][+-]?\d+)?\s*%?/gi, '')
    .replace(/[+-]?\d[\d.,]*(?:[eE][+-]?\d+)?\s*%\s*(?:slippage|kayma|tolerance|tolerans|slip)/gi, '')
    .replace(/%\s*[+-]?\d[\d.,]*\s*(?:slippage|kayma|tolerance|tolerans|slip)/gi, '')
  // A spaced amount (1 000 / 1\u202f000) must not silently become its first group, 1.
  if (/\d[\d.,]*[ \u00a0\u202f]+\d/.test(cleaned)) {
    return { status: 'ambiguous', message: AMBIGUOUS_AMOUNT_MESSAGE }
  }
  // Maximal token capture avoids turning -1, 1.2.3 or 1e3 into a valid positive prefix.
  const match = cleaned.match(/(?:^|[\s$€])([+-]?(?:\d[\d.,]*|[.,]\d+)(?:[eE][+-]?\d+)?)(?=$|[\s$€]|[a-zA-Zğüşöçıİ])/i)
  return match ? parseCopilotAmount(match[1]) : { status: 'missing' }
}
