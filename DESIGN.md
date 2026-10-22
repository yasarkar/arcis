# DESIGN.md — Arcis Design System & UI Architecture

Guidance for human developers and AI agents designing and building interfaces in Arcis (`arc-mini-app`).

---

## 1. Design Philosophy & Visual Identity

Arcis embodies an **"Aave Luxury + Arc Blockchain High-Fi Obsidian"** aesthetic. It is an institutional-grade, dark-mode-first Web3 fintech application engineered for sub-second finality on Arc Testnet, seamless cross-chain liquidity (Circle CCTP & Gateway), and autonomous agent payments.

### Core Tenets:
1. **Dark & Deep Obsidian Foundations**: Deep void backgrounds (`#07080d`, `#090a0f`) layered with ambient radial glow fields (`rgba(99, 102, 241, 0.06)` and `rgba(168, 85, 247, 0.06)`). Never use stark black or bright light-mode backgrounds.
2. **Glassmorphism with Restraint**: Panels use subtle dark glass (`rgba(15, 17, 26, 0.7)` to `rgba(22, 25, 42, 0.85)`) with high-blur backdrops (`blur(16px)` to `blur(28px)`) and hairline borders (`1px solid rgba(255, 255, 255, 0.04 - 0.08)`).
3. **Living Interface (Micro-Animations)**: Interfaces feel reactive and alive through subtle micro-animations (e.g. ECG heartbeat pulses, levitating token tokens, rotating chronometer sweeps) while strictly respecting CPU paint diets and accessibility preferences.
4. **Precision Financial Typography**: High-contrast, tabular numeric figures (`font-variant-numeric: tabular-nums`) paired with technical monospace labels.

---

## 2. Typography System

All five fonts are loaded via Google Fonts in [index.html](file:///c:/arc-mini-app/index.html). Each font has a strict, distinct purpose:

| Font Family | CSS Variable / Token | Role & Usage |
| :--- | :--- | :--- |
| **Space Grotesk** | `var(--fonts--space-grotesk)` | **Hero metrics, display balances, headline stats.** Used for large numbers (`.arc-display-hero`, `.arcis-hero-balance`, `.ub-stat-value`). Always pair with `tabular-nums`. |
| **Space Mono** | `var(--fonts--space-mono)` | **Eyebrow tags, micro-labels, badges, addresses, hashes.** Uppercase with wide letter spacing (`letter-spacing: 2.72px`). Used in `.arc-eyebrow`, `.arcis-label`, `.ub-pct-badge`, `.arc-btn`. |
| **Inter** | `var(--font-app)` or `'Inter', sans-serif` | **Primary UI copy, descriptions, form labels, tooltips.** Default application body font. High legibility at 12–15px. |
| **Outfit** | `var(--font-display)` | **Marketing headers, feature titles, hero section displays.** Clean, modern geometric display sans. |
| **DM Sans** | `var(--fonts--dm-sans)` | **Editorial subheaders and fintech narrative paragraphs.** Smooth and balanced. |

### Typography Scale & Hierarchy:
- **Hero Balance**: `font-family: var(--fonts--space-grotesk); font-size: clamp(2.75rem, 6vw, 4rem); font-weight: 400; letter-spacing: -2px;`
- **Section Eyebrow**: `font-family: var(--fonts--space-mono); font-size: 12px–13px; font-weight: 600; letter-spacing: 2.72px; text-transform: uppercase;`
- **Card Title**: `font-family: var(--font-display); font-size: 18px–20px; font-weight: 600; color: #ffffff;`
- **Body Text**: `font-family: 'Inter', sans-serif; font-size: 14px; line-height: 1.5; color: rgba(255, 255, 255, 0.7);`
- **Micro / Subtext**: `font-size: 11px–12px; color: var(--secondary-colors--sky-sync) or rgba(255, 255, 255, 0.45);`

---

## 3. Color System & Semantic Tokens

### 3.1 Background & Surface Layers
- **App Canvas Base**: `#07080d` / `#090a0f`
- **Surface Elevation 1 (Card Base)**: `#0f111a` (`--color-brand-card`)
- **Surface Elevation 2 (Card Hover / Inset)**: `#161926` (`--color-brand-card-light`)
- **Card Alternative Base**: `#111827` (`.arcis-card`)
- **Border Default**: `#1e2235` / `rgba(255, 255, 255, 0.05 - 0.08)`
- **Border Focus / Hover**: `#3b4261` / `rgba(152, 150, 255, 0.35)`

### 3.2 Brand & Accent Colors
- **Brand Primary (Indigo)**: `#6366f1` (`--color-brand-primary`)
- **Brand Secondary (Purple)**: `#a855f7` (`--color-brand-secondary`)
- **Brand Accent (Cyan / Electric)**: `#06b6d4` (`--color-brand-accent`)
- **Gradient Accent**: `linear-gradient(135deg, #a855f7 0%, #6366f1 50%, #06b6d4 100%)` (`.text-gradient`)

### 3.3 Arc Official Protocol Colors
- **Protocol Navy**: `#1b3158` (`--primary-colors--protocol-navy`)
- **Validator Blue**: `#2f578c` (`--primary-colors--validator-blue`)
- **Sky Sync (Highlight Blue)**: `#acc6e9` (`--secondary-colors--sky-sync`)
- **Static Ether**: `#d5e0e7` (`--secondary-colors--static-ether`)
- **Cipher Violet**: `#412c5c`
- **Blockstream Gold**: `#e9a13f`

### 3.4 Aave Luxury Tokens
- **Earned Green (Success/Live)**: `#01d062` (`--earned-green`) / `#28d358` (`--gho-1`)
- **USDC Blue**: `#2775ca` (`--usdc-1`)
- **Aave Purple 1**: `#9896ff` (`--purple-1`)
- **Aave Purple 2**: `#978eff` (`--purple-2`)
- **Text Tiers**:
  - Pure White: `#ffffff`
  - Secondary Text: `rgba(255, 255, 255, 0.9)` (`--fp-2`)
  - Muted Text: `rgba(255, 255, 255, 0.65)` (`--fp-3`)
  - Subtle Label: `rgba(255, 255, 255, 0.45)` (`--fp-4`)

---

## 4. Component Standards & Reusable Primitives

### 4.1 Cards & Containers

#### 1. `.ub-hero-card` (Flagship Hero Card)
Used for primary balance displays (e.g. Unified Balance hero).
- **Surface**: High-grade gradient (`rgba(22, 25, 42, 0.85)` to `rgba(12, 14, 24, 0.95)`).
- **Blur**: `backdrop-filter: blur(28px)`.
- **Border**: `1px solid rgba(255, 255, 255, 0.08)`.
- **Border Radius**: `28px` (with `corner-shape: superellipse(1.25)` where supported).
- **Ambient Highlight**: Pseudo-element radial gradient at top-left (`rgba(152, 150, 255, 0.12)`).

#### 2. `.arc-card` / `.arcis-card` (Standard Module Card)
Used for secondary cards, deposit forms, pools, bridge modules.
- **Surface**: `rgba(15, 23, 42, 0.75)` or `#111827`.
- **Radius**: `16px`.
- **Border**: `1px solid rgba(47, 87, 140, 0.35)` or `rgba(255, 255, 255, 0.07)`.
- **Hover**: Subtle lift and glow (`box-shadow: 0px 4px 24px rgba(47, 87, 140, 0.25)`).

#### 3. `.glass-panel`
Lightweight utility panel for floating popovers, drawers, and modal backdrops:
- `background: rgba(15, 17, 26, 0.7); backdrop-filter: blur(16px); border: 1px solid rgba(255, 255, 255, 0.03);`

---

### 4.2 Buttons & Controls

#### 1. Arc Webflow Buttons
- **Base Class**: `.arc-btn`
  - Font: `Space Mono`, 14px, weight 700, uppercase, letter-spacing `1.2px`.
  - Radius: `15px`, padding `10px 18px`.
- **Variants**:
  - **Primary** (`.arc-btn-primary`): Solid white `#ffffff`, dark text `#000000`. On hover turns Sky Sync (`#acc6e9`) with soft shadow.
  - **Secondary** (`.arc-btn-secondary`): Sky Sync background with dark text.
  - **Ghost** (`.arc-btn-ghost`): Transparent background, hairline Sky Sync border (`rgba(172, 198, 233, 0.25)`), Sky Sync text.

#### 2. Capsule Action Buttons (`.ub-action-btn`)
Used for quick utility actions (e.g. "Deposit", "Sync", filter pills).
- Pill-shaped (`border-radius: 99px`), padding `7px 16px`.
- Semi-transparent glass with 1px border.
- Hover: Scale `1.02` with smooth bezier (`var(--ease-out-smooth)`).
- Active: Scale `0.98`.
- Primary Active State (`.ub-action-btn-primary`): Violet aura (`rgba(152, 150, 255, 0.18)`), violet border, white text.

---

### 4.3 Form Inputs & Selectors

- **Amount Input (`.ub-amount-input`)**:
  - Space Grotesk font, tabular numbers, font-size 16px.
  - Dark glass surface (`rgba(11, 13, 24, 0.75)`), subtle border.
  - Focus state: Violet outline glow (`border-color: rgba(152, 150, 255, 0.6); box-shadow: 0 0 0 3px rgba(152, 150, 255, 0.16)`).
  - Invalid state: `border-color: #ef4444`.
- **Chain / Token Select Trigger (`.ub-select-trigger`)**:
  - Radius `14px`, 12px 16px padding.
  - Expanded state: violet glow ring.
- **Select Dropdown Menu (`.ub-select-menu`)**:
  - Deterministic 5-row visible height (`--ub-select-row-height: 44px; max-height: calc(5 * var(--ub-select-row-height) + 14px)`).
  - Thin styled scrollbar (`scrollbar-color: rgba(152, 150, 255, 0.45) transparent`).
  - High backdrop blur (`blur(24px)`), z-index 200.

---

### 4.4 Status Badges & Live Indicators

- **Live Heartbeat Badge (`.ub-live-badge`)**:
  - Compact pill (`border-radius: 99px`), green glow.
  - Embeds real-time animated SVG ECG heartbeat path (`.ub-ecg-svg`, `ub-ecg-heartbeat`).
  - Color: `--earned-green` (`#01d062`).
- **Indexer Pending Badge (`.ub-pending-badge`)**:
  - Amber warning pill (`#fbbf24`), used when Circle Gateway indexer is lagging 20-30s behind user deposit.
- **Percentage Share Badge (`.ub-pct-badge`)**:
  - Monospace pill with `--purple-1` color (`#9896ff`).
- **Gasless / Zero-Fee Badge (`GaslessBadge.tsx`)**:
  - Highlights gasless execution enabled by Arc USDC gas precompiles or Circle paymasters.

---

## 5. Micro-Animations & Interaction Rules

Arcis uses bespoke CSS animations to communicate state and blockchain motion:
- **`ub-ecg-heartbeat`**: Dynamic SVG waveform pulse for live indexing connections.
- **`ub-shimmer`**: 2.5s continuous light ray across asset progress bars.
- **`cryptoRainDrop`**: Cascading chain raindrop shower behind multi-chain cards.
- **`chronoSweep` / `speedPulse`**: 22s smooth rotating sweep for sub-second confirmation speed.
- **`floatLevitate`**: Floating coin animation indicating stable liquidity.
- **`aps-chevron-stream`**: Flowing directional arrows for privacy routing & transfers.

---

## 6. Performance & Accessibility ("Paint Diet")

All animations and heavy DOM treatments must observe these non-negotiable rules:

1. **Tab Hidden Freezing**:
   - When the user switches browser tabs, `App.tsx` attaches `.tab-hidden` to the body.
   - Every infinite animation is automatically frozen:
     ```css
     .tab-hidden * { animation-play-state: paused !important; }
     ```
2. **Reduced Motion Compliance**:
   - Under `@media (prefers-reduced-motion: reduce)`, ambient orbs disappear (`display: none !important`) and all continuous decorative animations are killed (`animation: none !important`).
   - One-shot accessibility feedback (such as brief loading indicators or typing dots) remains functional.
3. **Hardware Acceleration**:
   - Animate only `transform` and `opacity`. Always mark animated elements with `will-change: transform, opacity`.
   - Never animate `top`, `left`, `margin`, or `padding` directly.

---

## 7. Rules for AI Agents Working on Arcis UI

When creating new components, modals, or pages in Arcis:

1. **Never use default Tailwind bright colors** (e.g. `bg-blue-600`, `bg-red-500`, `text-green-500`). Use the design system's CSS variables (`var(--color-brand-...)`, `var(--primary-colors-...)`, `var(--earned-green)`).
2. **Never build light-mode variants** unless explicitly instructed. Arcis is an intentional luxury dark obsidian platform.
3. **Always use tabular figures for amounts**: Wrap token balances and currency in `font-variant-numeric: tabular-nums` and prefer `Space Grotesk` or `Space Mono`.
4. **Preserve Component Consistency**:
   - For primary action buttons, use `.arc-btn.arc-btn-primary` or `.ub-action-btn.ub-action-btn-primary`.
   - For metric headers, use `.arc-eyebrow` for the label and `.arc-display-hero` or `.arcis-hero-balance` for the value.
   - For cards, build upon `.ub-hero-card`, `.arc-card`, or `.arcis-card`.
5. **Icon Standard**: Use `lucide-react` with thin-to-medium strokes (size 14–18 for buttons, 20–24 for headers) or dedicated `@web3icons/react` / `PinnedIcons` for chain/token logos.
6. **Accessible States**: Always provide `:focus-visible` ring outlines (`rgba(152, 150, 255, 0.75)`) and `aria-expanded` / `aria-label` tags on interactive buttons and dialogs.
