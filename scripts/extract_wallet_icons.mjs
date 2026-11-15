import fs from 'fs'
import path from 'path'

function nodeToSvg(node) {
  if (!node) return ''
  const [tag, attrs, children] = node
  let attrStr = ''
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'style') continue
      let attrName = k
      if (k === 'fillRule') attrName = 'fill-rule'
      else if (k === 'clipRule') attrName = 'clip-rule'
      else if (k === 'strokeWidth') attrName = 'stroke-width'
      else if (k === 'strokeLinecap') attrName = 'stroke-linecap'
      else if (k === 'strokeLinejoin') attrName = 'stroke-linejoin'
      else if (k === 'clipPath') attrName = 'clip-path'
      else if (k === 'gradientUnits') attrName = 'gradientUnits'
      else if (k === 'gradientTransform') attrName = 'gradientTransform'
      else if (k === 'stopColor') attrName = 'stop-color'
      else if (k === 'stopOpacity') attrName = 'stop-opacity'
      attrStr += ` ${attrName}="${v}"`
    }
  }
  let inner = ''
  if (Array.isArray(children)) {
    inner = children.map(nodeToSvg).join('')
  }
  if (!inner) {
    return `<${tag}${attrStr} />`
  }
  return `<${tag}${attrStr}>${inner}</${tag}>`
}

const map = {
  metamask: '@web3icons/react/icons/wallets/WalletMetamask',
  okx: '@web3icons/react/icons/wallets/WalletOkx',
  phantom: '@web3icons/react/icons/wallets/WalletPhantom',
  rabby: '@web3icons/react/icons/wallets/WalletRabby',
  coinbase: '@web3icons/react/icons/wallets/WalletCoinbase',
  trust: '@web3icons/react/icons/wallets/WalletTrust',
  rainbow: '@web3icons/react/icons/wallets/WalletRainbow',
  zerion: '@web3icons/react/icons/wallets/WalletZerion',
  walletconnect: '@web3icons/react/icons/wallets/WalletWalletConnect',
  solflare: '@web3icons/react/icons/wallets/WalletSolflare',
  backpack: '@web3icons/react/icons/wallets/WalletBackpack',
  binance: '@web3icons/react/icons/exchanges/ExchangeBinance',
}

const outputDir = path.resolve('src/assets/wallets')
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true })
}

for (const [key, modName] of Object.entries(map)) {
  const mod = await import(modName)
  const iconNode = mod.__iconNode
  if (!iconNode) {
    console.error('No __iconNode in', modName)
    continue
  }
  // Extract background if available for official squircle tile emblem, else branded
  const nodes = iconNode.background || iconNode.branded
  const innerSvg = nodes.map(nodeToSvg).join('\n  ')
  const fullSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  ${innerSvg}
</svg>
`
  const outFile = path.join(outputDir, `${key}.svg`)
  fs.writeFileSync(outFile, fullSvg, 'utf8')
  console.log(`Saved ${key}.svg (${fullSvg.length} bytes)`)
}

// Add other-wallets.svg for the "Other Wallets" row
const otherWalletsSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="24" height="24" rx="6" fill="#2A1B3D" />
  <rect x="4" y="6.5" width="16" height="11" rx="2.5" stroke="#FF007A" stroke-width="1.6" />
  <circle cx="16" cy="12" r="1.2" fill="#FF007A" />
</svg>
`
fs.writeFileSync(path.join(outputDir, 'other-wallets.svg'), otherWalletsSvg, 'utf8')
console.log('Saved other-wallets.svg')
