# Design System Rule for Arcis UI

When creating, editing, or refactoring UI components in Arcis:
1. Refer to [DESIGN.md](file:///c:/arc-mini-app/DESIGN.md) as the single source of truth for all styling, typography, colors, animations, and component conventions.
2. Adhere strictly to the "Aave Luxury + Arc Obsidian" visual identity.
3. Use semantic CSS variables (`var(--color-brand-*)`, `var(--primary-colors-*)`, `var(--earned-green)`, `var(--purple-1)`) instead of hardcoded or generic Tailwind colors.
4. Apply the defined font hierarchy: `Space Grotesk` (balances & stats with `tabular-nums`), `Space Mono` (eyebrow labels, badges, hashes), `Inter` (body & forms), `Outfit`/`DM Sans` (headers).
5. Respect the "Paint Diet" performance rule: freeze animations when tabs are hidden (`.tab-hidden`), and provide full `@media (prefers-reduced-motion: reduce)` fallbacks.
