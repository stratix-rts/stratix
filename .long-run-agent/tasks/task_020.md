# task_020

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_020.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3.x: HUD 改 RTS 悬浮布局——战场全屏，HUD 边缘悬浮（顶栏态势/左单位栏/底命令条/抽屉覆盖），消灭左右分屏-模块

## requirements

- 战场占满视口（Phaser `Scale.RESIZE` 跟随容器），正式入口不再是左右两列分栏。
- HUD 以边缘悬浮形态环绕战场：顶栏态势摘要 / 左单位竖栏 / 右侧态势总览 + 日志抽屉 / 底部命令横条 / 聊天抽屉覆盖层。
- HUD 空白区域 `pointer-events` 穿透到 Phaser 画布（拖拽平移 / 框选 / 滚轮缩放不被遮挡）。
- 层序明确：战场 0 < HUD 浮层 10 < 竖栏 20 < 底横条 25 < 顶栏 30 < 抽屉 40 < 子屏 50。
- 不引入新依赖；不动 core / world 逻辑；不推倒已有改动。

## acceptance

- 布局代码完成 RTS 形态（全屏战场 + 悬浮 HUD + 穿透交互），测试更新覆盖布局断言。
- `npm run typecheck` / `npm run build` / `npx jest src/hud src/app` 全绿。
- dev server 上 `/src/app/main/index.html` 返回 200 且引用完整。

## 交付物

- `src/app/main/index.html`：正式入口骨架改为 **全屏战场 + 悬浮 HUD 覆盖层**（去掉两列 grid）。
- `src/hud/screens/main-screen.ts`：主屏布局改为 RTS 环绕形态（顶栏 / 左竖栏 / 右竖栏 / 底横条 / 抽屉覆盖层）。
- `src/hud/panels/command-panel.ts`：命令分组根节点加 `part="group"`，供底栏把命令排成横排。
- `src/hud/theme/tokens-default.css` / `tokens-pixel.css`：新增 `--srf-panel-overlay` 悬浮层半透明底 token。
- `src/app/__tests__/main-layout.test.ts`（新增）、`src/hud/__tests__/main-screen.test.ts`：布局契约回归断言。

## 验证证据（完成前必填）

- [x] **实现证明**:
  - 入口 `#app` 去掉 `grid-template-columns`，`#battlefield` 改 `position:absolute; inset:0; z-index:0` 铺满视口；
    `#hud-side` 改 `position:absolute; inset:0; z-index:10; pointer-events:none` 覆盖在战场之上。
  - 穿透链：`#hud-side` → `#hud-root` → `.hud-root` 三层均 `pointer-events:none`；
    只有实体面板开 `auto`（`.hud-surface` / `.hud-topbar`）——空白区域事件落到下方 Phaser 画布。
  - 分层 z-index：战场 0 < HUD 浮层 10 < 左/右竖栏 20 < 底横条 25 < 顶栏 30 < 聊天抽屉 40 < 子屏 50。
  - Phaser 以 `Phaser.Scale.RESIZE` 跟随 `#battlefield` 尺寸；`BattlefieldScene.onResize` 调 `view.syncViewport()`，
    全屏容器变尺寸时镜头视口跟着变（既有逻辑，未改）。
  - 底栏命令横排：命令分组根节点加 `part="group"`，主屏样式用 `strat-command-panel::part(group)` 改 `grid-auto-flow: column`。
- [x] **测试验证**:
  - `npm run typecheck` → 0 error；`npx jest src/hud src/app --maxWorkers=1` → 16 suites / 302 tests 全绿；
    `npm run build`（tsc + vite build）→ 成功，产出 `dist/frontend/src/app/main/index.html`。
  - dev server（127.0.0.1:7523）`curl /src/app/main/index.html` → 200；`/src/app/main/main-entry.ts` → 200。
  - 无头浏览器实测（Playwright）：画布 1600×900 铺满；命中测试 战场正中/中上/中下 → `canvas`（穿透成功），
    左栏 → `strat-agent-panel`，顶栏 → 顶栏 div，底栏 → `strat-command-panel`；
    空白区滚轮缩放后画布像素变化 = true（事件确实到了 Phaser）；聊天抽屉展开后 z-index 40 盖住右竖栏（z 20）；
    console errors: []。
- [x] **影响范围**:
  - 只动 HUD 布局层与主题 token，**未动 core / world 逻辑**（`BattlefieldScene` 仅读取，未覆盖 commit d060178 的网格与空状态提示）。
  - `src/app/dev/hello-loop.html` 与 `src/hud/dev/hud-dev.html` 未改：窄容器由主屏样式里的
    `@container (max-width: 700px)` 分支回退成纵向堆叠，dev 联调页形态不变。
  - 无新依赖；不改 `core/`、`world/`；未使用 mock。

### 测试步骤

1. `source ~/.nvm/nvm.sh && nvm use 23`
2. `npm run typecheck`
3. `npx jest src/hud src/app --maxWorkers=1`
4. `npm run build`
5. 起 dev server（`127.0.0.1:7523`），`curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:7523/src/app/main/index.html` → 200
6. Playwright 无头打开 `http://127.0.0.1:7523/src/app/main/index.html`：
   `document.elementFromPoint(800, 450)` 应为 canvas；`page.mouse.wheel` 后画布像素应变化；
   点顶栏「打开聊天」后聊天抽屉应覆盖右竖栏。

### 验证结果

```
> stratix@0.1.0 typecheck
> tsc --noEmit
（0 error，无输出）

Test Suites: 16 passed, 16 total
Tests:       302 passed, 302 total
Snapshots:   0 total
Time:        3.049 s
Ran all test suites matching /src\/hud|src\/app/i.

> stratix@0.1.0 build
> npm run build:backend && npm run build:frontend
✓ 49 modules transformed.
dist/frontend/src/app/main/index.html        2.99 kB │ gzip:   1.55 kB
dist/frontend/assets/main-C5ufvH2m.js      128.63 kB │ gzip:  31.98 kB
✓ built in 1m 53s

curl /src/app/main/index.html → status=200 size=2948
curl /src/app/main/main-entry.ts → status=200

无头浏览器实测：
canvas 1600×900 铺满视口；命中测试
  战场正中 (800,450) → canvas
  战场中上 (800,120) → canvas
  战场中下 (800,560) → canvas
  左栏上 (60,90)     → strat-agent-panel
  顶栏 (700,24)      → div（顶栏）
  底栏命令按钮 (500,795) → strat-command-panel
滚轮缩放：画布像素是否变化 = true
聊天抽屉：hidden=false，z-index=40，覆盖右竖栏（z-index=20）
console errors: []
```

截图（1600×900）：顶栏通栏 + 左 Agent 竖栏 + 右「态势总览 / 日志」竖栏 + 底部命令横条，
战场全屏铺底并保留网格与空状态提示 —— HUD 环绕战场，不再是左右分栏。