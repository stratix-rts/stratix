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
- `layout/hud-layout.ts` — 边角件版面纯计算（@since v3.4，task_093：Z3 小地图 / Z4 控制岛 / Z5 时间戳角标的盒子与间距；把「≥40px 间距」「角标不压顶栏」写成可单测断言的纯函数，度量取自 core/theme/visual-spec）
- `components/toast/toast-host.ts` — 轻提示 toast 宿主（task_039：右上角 `<strat-toast-host>`，show(text, tone) 3s 自动消失，皮肤 token；组合根接 task-report 的 toast 口，零订阅零派发）
- `components/task-output/` — 任务实时输出面板（task_046：嵌挂于 chat-drawer 头部下的 `<strat-task-output-panel>` 折叠区；流式端口 appendTaskOutput(characterId, chunk) 接组合根的 onTaskChunk，相位读 WorldState.tasks；32k 截头保尾、自动滚底 + 暂停跟随，完成态保留、下次派发清空重开）
- `panels/agent-panel.ts` — Agent 侧栏（单选详情/编组；task_038：角色任务队列读数 40 字摘要+排队数，与「派任务」自由文本表单 → task.assign 命令；task_050：表单增「交给谁」选择器 —— 自动（推荐）/手动指定承接人，卡片 kind 徽标 + 忙闲实时 + 推荐角标，全忙提示排队预计）
- `panels/task-assign-catalog.ts` — 派发智能推荐纯函数（task_050：score = 空闲加分 + suitableKinds 反向专属度 + 历史成功率（无历史 0.5 中性），权重常量集中可调；输出排序 + 理由短语「空闲 · 擅长此类 · 成功率 86%」；零 DOM 零 IO，历史统计经注入）
- `theme/tokens-*.css` — skin tokens（8 套：default / pixel / crimson / forest / ocean / sunset / mono / aurora）
- `theme/skin-registry.ts` — skin registry: `listSkins()` / `randomSkin(seed?)` / `resolveAccent()`
- `theme/theme-controller.ts` — theme switching
- `bridge/bus-adapter.ts` — sole core gateway
- `dev/hud-dev.html` + `dev/hud-dev-entry.ts` — dev-only mount entry
