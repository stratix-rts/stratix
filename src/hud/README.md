# HUD Layer (Web Components)

DOM-layer shell for V3. Zero framework deps: vanilla Custom Elements + Shadow DOM + CSS tokens.

## Allowed
- Import from `core/` (bus, types) via `bridge/bus-adapter.ts` only.
- Reference CSS variables `--srf-*` defined by `theme/tokens-*.css`.

## Forbidden（铁律 — `docs/REFACTOR_PLAN_V3.md` §1、§3）
- `import` from `world/`、`stratix-rts/`、Vue/React/Pinia；任何渲染库或业务决策。
- Hard-coded color / font / border / radius literals in components.
- Bypass `bus-adapter.ts` to emit commands or subscribe to state directly.

## Layout
- `screens/main-screen.ts` — shell renderer
- `widgets/strat-button.ts` — base button (Shadow DOM, CSS-var only)
- `theme/tokens-default.css` / `tokens-pixel.css` — skin tokens
- `theme/theme-controller.ts` — theme switching
- `bridge/bus-adapter.ts` — sole core gateway
- `dev/hud-dev.html` + `dev/hud-dev-entry.ts` — dev-only mount entry
