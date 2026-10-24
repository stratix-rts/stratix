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
- `components/chat-drawer/` — 角色聊天抽屉（task_034：右侧滑入滑出、多角色会话隔离、流式公开接口 appendStream/finalizeStream；DEMO 假流仅 dev/单测，正式接线 035）
- `components/toast/toast-host.ts` — 轻提示 toast 宿主（task_039：右上角 `<strat-toast-host>`，show(text, tone) 3s 自动消失，皮肤 token；组合根接 task-report 的 toast 口，零订阅零派发）
- `panels/agent-panel.ts` — Agent 侧栏（单选详情/编组；task_038：角色任务队列读数 40 字摘要+排队数，与「派任务」自由文本表单 → task.assign 命令）
- `theme/tokens-*.css` — skin tokens（8 套：default / pixel / crimson / forest / ocean / sunset / mono / aurora）
- `theme/skin-registry.ts` — skin registry: `listSkins()` / `randomSkin(seed?)` / `resolveAccent()`
- `theme/theme-controller.ts` — theme switching
- `bridge/bus-adapter.ts` — sole core gateway
- `dev/hud-dev.html` + `dev/hud-dev-entry.ts` — dev-only mount entry
