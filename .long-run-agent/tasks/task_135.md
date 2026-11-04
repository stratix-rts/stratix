# task_135

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_135.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

像素细节B：图标真像素路径+组件像素细节-模块

## requirements

- 像素皮肤下顶栏与面板的**全部**既有图标走真像素路径（8×8 / 16×16 网格的方块矩形组合，无曲线指令），现代皮肤图标零变化。
- 皮肤切换时各自命中各自的图标位（不重建 DOM → 布局骨架零变化）。
- 按钮 / 面板 / 对话框 / 横幅四类组件带双线边框或四角角块细节，且**不引起任何尺寸 / 位置 / 流变化**。
- 截图落 `reports/shots/` 并带 `-r5` 前缀；`npx tsc --noEmit` 与皮肤相关 jest 全绿。

## acceptance

- 像素皮：顶栏图标 `viewBox=0 0 16 16`、`fill=currentColor / stroke=none`，每条 path 只含 `M/h/v/z`（DOM 断言 + 截图肉眼方块感）。
- 现代皮：顶栏图标 `viewBox=0 0 24 24`、`fill=none / stroke=currentColor`，与改动前逐字节一致。
- 组件细节：按钮 / 面板 / 对话框 / 横幅的 computed `box-shadow` 含 inset、背景含四角角块（截图对比可见）。
- 骨架对比：像素 / 现代两皮肤下关键元素 boundingRect 的 dx/dy/dw/dh 全部 ≤ 1px（实测全 0）。
- `npx tsc --noEmit` 绿；`npx jest`（pixel-icon-set / skin-switch / icon-system）全绿；playwright pixel-icons.spec.ts 全绿。

## 交付物

- `src/hud/widgets/icon-set.ts` —— 填掉预留的 **pixel 图标位**：`PIXEL_ICON_SET`（23 个图标，8×8 美术网格 → 16×16 viewBox，每块一个
  `M/h/v/z` 直角路径，`fill=currentColor / stroke=none / shape-rendering=crispEdges`）；`IconSet` 接口加 `mode` / `viewBox` /
  `shapeRendering`；新增 `setActiveIconSet` / `getActiveIconSet` / `refreshIconsInDom`（就地换图形，不重建 DOM）。
  **现代图标集 path 数据一个字节未动**。
- `src/hud/theme/skin-icons.ts`（新）—— 皮肤 → 图标集映射（`pixel → pixel`，其余 → `modern`）+ `syncIconsForSkin()`。
- `src/hud/theme/theme-controller.ts` —— 构造时按初始皮肤定图标集、`apply()` 切皮时同步换图标集（不改 DOM 结构 → 骨架零变化）。
- `src/hud/theme/skin-pixel-layer.css` —— 新增像素细节参数（`--srf-inner-line` / `--srf-double-shadow` / `--srf-notch-color` /
  `--srf-notch-size` / `--srf-press-shadow` / `--srf-outer-border-width`）+ §⑥ 顶栏 / 面板容器双线边框与四角角块。
- `src/hud/widgets/strat-button.ts` / `src/hud/components/gateway-banner/gateway-banner.ts` /
  `src/hud/components/new-task-dialog/new-task-dialog.ts` / `src/hud/panels/{agent-panel,session-panel,command-panel,log-drawer,mission-confirm}.ts`
  —— 按钮 / 面板 / 对话框 / 横幅四类组件统一加「1px 外实 + 1px 内衬」双线边框 + 四角 2×2 角块 + 按压内衬硬边。
  全部用 `var(--srf-xxx, 兜底)` 写法 —— **现代皮拿不到这些变量 = 绘制落空 = 一个像素都不变**。
- 截图：`reports/shots/pixel-icons-r5-modern.png` / `pixel-icons-r5-pixel.png`（-r5 前缀，供肉眼验收）。
- 测试：`src/hud/__tests__/pixel-icon-set.test.ts`（新，6 例）、`tests/e2e/pixel-icons.spec.ts`（新，3 例）。

## 验证证据（完成前必填）

- [x] **实现证明**: 像素图标 = 8×8 美术网格手工排方块，每块输出一个直角路径（`M/h/v/z`，整数坐标，无 C/Q/A 曲线），
  16×16 viewBox + `shape-rendering: crispEdges`；组件细节 = inset 阴影（双线内侧线）+ background 定位的 2×2 渐变方块（四角角块），
  两者都**不参与布局**，且外圈宽度从 2px 单线换成 1px 外实 + 1px 内衬（总厚度不变、外框尺寸不变）→ 两皮肤 boundingRect 完全一致。
- [x] **测试验证**: `npx tsc --noEmit` 绿；`npx jest src/hud/__tests__/pixel-icon-set.test.ts src/hud/__tests__/skin-switch.test.ts
  src/hud/__tests__/icon-system.test.ts` → 3 suites / 29 tests 全绿；`npx playwright test --config=tests/e2e/playwright.hud.config.ts
  tests/e2e/pixel-icons.spec.ts` → 3 passed，骨架 diff 全为 0。
- [x] **影响范围**: 只碰图标与组件细节层。现代皮肤图标 / token 值零改动；布局骨架零变化（e2e 断言 dx/dy/dw/dh = 0）；
  不动 gateway/、不引 npm 依赖。

### 测试步骤
1. `npx tsc --noEmit`
2. `npx jest src/hud/__tests__/pixel-icon-set.test.ts src/hud/__tests__/skin-switch.test.ts src/hud/__tests__/icon-system.test.ts --maxWorkers=1`
3. `npx playwright test --config=tests/e2e/playwright.hud.config.ts tests/e2e/pixel-icons.spec.ts`
4. 肉眼比对 `reports/shots/pixel-icons-r5-modern.png` 与 `reports/shots/pixel-icons-r5-pixel.png`

### 验证结果

```
Test Suites: 3 passed, 3 total
Tests:       29 passed, 29 total

[task_135] 骨架 diff  : {"topbar":{"dx":0,"dy":0,"dw":0,"dh":0},"bottomBar":{"dx":0,"dy":0,"dw":0,"dh":0},
"agentPanel":{"dx":0,"dy":0,"dw":0,"dh":0},"themeButton":{"dx":0,"dy":0,"dw":0,"dh":0},
"soundButton":{"dx":0,"dy":0,"dw":0,"dh":0},"overflowButton":{"dx":0,"dy":0,"dw":0,"dh":0}}
  3 passed (6.3s)
```

提交：`5224ae0 v3.8(135): 图标真像素路径+组件像素细节`（18 files, +860/−18）。
