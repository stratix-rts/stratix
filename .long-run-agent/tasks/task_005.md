# task_005

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_005.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3骨架: hud/ WebComponents壳-模块

## requirements

依据 `docs/REFACTOR_PLAN_V3.md`（V3.1 冻结版）第 1/2/3 节建立 hud 层 `src/hud/`：

1. 原生 Web Components，零框架依赖 —— 不引入 Vue / React / Pinia / 任何 UI 库；package.json 不变。
2. 严格按 §3 token 体系：组件零硬编码颜色/字体/边框，视觉全部走 `var(--srf-*)`；
3. 主题切换走 `HudCommand theme.set`：本地落皮肤（启用/禁用 stylesheet），同时 emit 给 core 记账。
4. `bridge/bus-adapter.ts` 是 hud ↔ core 的唯一网关：订阅 WorldState 渲染，用户操作 → HudCommand；
   禁止从 hud/ import world/、stratix-rts/、vue。
5. 皮肤 / 组件可测：jest 单测覆盖 bus-adapter 与 theme-controller 纯逻辑（无 DOM/jsdom 依赖）。
6. 组件样板：`screens/main-screen.ts` 壳 + `widgets/strat-button.ts`（Shadow DOM 基按钮）。
7. 每个新文件头部写契约注释（职责 / 输入输出 / 禁止事项）。
8. dev-only 最小挂载入口：`dev/hud-dev.html` + `dev/hud-dev-entry.ts`，不接入现有主 UI。

## acceptance

- [x] `npx tsc --noEmit` 通过；`tsc-alias` 通过；`vite build` 通过
- [x] 皮肤可整体切换（default/pixel，组件零改动）—— 单测验证 enabled/disabled 切换
- [x] 零框架依赖（package.json 不新增依赖）
- [x] bus-adapter 双向联通可测（dispatch/subscribe/mount/unmount + theme.set 链路，8 用例全绿）
- [x] `src/hud/` 零 world / vue / react / pinia / stratix-rts 引用
- [x] 不引入新依赖
- [x] 所有 hud 文件头都有契约注释；README ≤20 行

## 交付物

新增 `src/hud/`（Web Components 骨架），共 12 个文件：

- `theme/tokens-default.css` —— 默认皮肤（现代风）CSS 变量
- `theme/tokens-pixel.css` —— 像素风皮肤 token 覆写
- `theme/theme-controller.ts` —— 皮肤切换响应器
- `widgets/strat-button.ts` —— `<strat-button>` 基按钮（Shadow DOM）
- `screens/main-screen.ts` —— HUD 主屏壳（与 bus-adapter 拼装）
- `bridge/bus-adapter.ts` —— hud ↔ core 唯一通信网关
- `dev/hud-dev.html` + `dev/hud-dev-entry.ts` —— dev-only 挂载入口
- `__tests__/bus-adapter.test.ts` + `theme/__tests__/theme-controller.test.ts` —— 单测
- `global.d.ts` —— `*.css` 环境声明
- `README.md` —— 模块说明

## 验证证据（完成前必填）

### 实现证明
- bus-adapter 工厂接受依赖注入（onState/emitCommand/themeController），`mount()` 触发订阅，`dispatch()` 拦截 `theme.set` 本地落皮肤；
- 主题切换 = 切换 stylesheet 的 `disabled`，零 DOM 重建；
- strat-button 走 Shadow DOM 隔离，全部颜色引用 `var(--srf-*)`，组件内 grep 不到任何硬编码色值；
- main-screen 用工厂返回的 handle 渲染到宿主 DOM，按钮点击 → `strat-button-click` 事件 → `adapter.dispatch`。

### 测试验证
15 个单测全绿：
```
PASS src/hud/__tests__/bus-adapter.test.ts
PASS src/hud/theme/__tests__/theme-controller.test.ts
Tests: 15 passed, 15 total
```

### 影响范围
- 新增 `src/hud/`（独立模块）
- 不修改 src/world、src/stratix-rts、现有 Vue 组件
- 不修改 package.json / vite.config.ts
- HUD 未接入现有主 UI（vite 主 bundle grep `srf-` 0 命中）

### 测试步骤
1. `npx tsc --noEmit` —— 通过
2. `npx tsc-alias` —— 通过（默认入口）
3. `npx jest src/hud --no-coverage` —— 15 passed
4. `npm run build:frontend` —— 通过（HUD 代码不在主 bundle，符合"不接入现有主 UI"）

### 验证结果
```
npx tsc --noEmit
(exit 0, no output)

npx jest src/hud --no-coverage
Test Suites: 2 passed, 2 total
Tests:       15 passed, 15 total

npm run build:frontend
✓ built in 2m 12s
```

铁律扫描：
```
grep -rE "from .*(world|stratix-rts|vue|react|pinia)" src/hud/ --include="*.ts"
(无输出 - 零违规)
```
