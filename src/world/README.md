# World Layer（Phaser 3.90 战场）

战场渲染层。Phaser 3.90（MIT，锁定版本）。只读 `WorldState` 渲染 + 上报交互事件。

## Allowed
- `import 'phaser'`、`src/core/{types,store,bus}`（经 `bridge/bus-adapter.ts` 单向）。
- `world/theme.ts` 镜像 `hud/theme/tokens-*.css` 的同名 token，常量同步换肤。

## Forbidden（铁律 — `docs/REFACTOR_PLAN_V3.md` §1、§3）
- `import` `src/hud/` 任何文件；直接 `document.*`/`window.addEventListener`。
- `import` `vue`/`react`/`lit`/Web Components/DOM 组件库。
- 写死颜色 / 字体 / 边框字面量（必须走主题 token）；在场景内跑业务决策。
- `core` 状态真相在 core —— 桥接层只转发，不缓存不判断。

## Layout
- `scenes/BattlefieldScene.ts` · `objects/` Unit/SelectionBox/Registry · `camera/` 镜头
- `bridge/bus-adapter.ts` 唯一与 core 通信通道 · `theme.ts` 镜像 token · `dev/` 独立挂载
