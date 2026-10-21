# Core Layer（引擎无关核心）

V3 总线契约与业务逻辑的唯一来源。零渲染依赖、可被 jest 直接单测。

## Allowed
- `import` 内部子目录（`./types`、`./store`、`./bus`、`./unit`、`./mission`、`./character`、`./agent-link`）。
- `mitt`、`lodash-es` 等纯逻辑依赖；纯函数 / 状态机 / 类型。

## Forbidden（铁律 — `docs/REFACTOR_PLAN_V3.md` §1、§5）
- `import` `phaser` / `vue` / `react` / `lit` 或任何渲染层。
- `import` `src/hud/` 或 `src/world/`（core 是被依赖方，禁止反向依赖）。
- `types.ts` 出现 `any`；引入 DOM/`window`/定时器等运行时副作用（agent-link、mission 的 IO 边界除外）。

## Layout
- `types.ts` — ★ 总线契约 `WorldState` / `HudCommand` / `WorldEvent`
- `store.ts` / `bus.ts` — 极简响应式 + mitt 封装
- `unit/` 选择编组 · `mission/` 任务状态机 · `character/` persona+growth · `agent-link/` D4 重做
