# HUD Layer (Web Components)

DOM-layer shell for V3. Zero framework deps: vanilla Custom Elements + Shadow DOM + CSS tokens.

## Allowed
- Import from `core/` (bus, types) via `bridge/bus-adapter.ts` only.
- Reference CSS variables `--srf-*` defined by `theme/tokens-*.css`.

## Forbidden
- `import` from `world/`, `stratix-rts/`, Vue/React/Pinia.
- Hard-coded color / font / border / radius literals in components.
- Bypass `bus-adapter.ts` to emit commands or subscribe to state directly.

## Layout
- `screens/main-screen.ts` — shell renderer
- `widgets/strat-button.ts` — base button (Shadow DOM, CSS-var only)
- `theme/tokens-default.css` / `tokens-pixel.css` — skin tokens
- `theme/theme-controller.ts` — theme switching
- `bridge/bus-adapter.ts` — sole core gateway
- `dev/hud-dev.html` + `dev/hud-dev-entry.ts` — dev-only mount entry
