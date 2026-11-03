# task_093 HUD v3.4 · Z3/Z5 边角件

## 描述

小地图 hover 提升亮度 + 与控制岛间距 ≥40px 规则化；回放时间戳角标从与顶栏重叠位置迁到左上 inset top 56px，仅回放激活时显示（L3 层），含日期与 ⏩ 回放中标识。

## Requirements

依据 docs/hud-redesign-proposal.html §2.5 Z3/Z5；tsc 零错；测试全绿；最小改动。

## Acceptance

- [x] 小地图 hover 提亮
- [x] 时间戳角标不再与顶栏重叠（实测）
- [x] 非回放态角标隐藏

## deliverables

小地图交互微调 + 时间戳角标迁移（依赖 task_090 控制岛定型）

## 验证记录（2026-11-03）

### ① 浏览器碰撞断言（scripts/check-hud-island-layout.mjs，Playwright + Chromium）

三档分辨率（1280×720 / 1920×1080 / 1024×768）全过：

```
1280×720 (720p) | 岛 648×60 | 顶栏 40 | 事件轨 x[16,276] 间距 40.0 | 小地图 x[1062,1264] 间距 98.0 | 角标 top 56 / 顶栏底 40
1920×1080 (1080p) | 岛 1075×60 | 顶栏 40 | 事件轨 x[16,276] 间距 146.4 | 小地图 x[1702,1904] 间距 204.4 | 角标 top 56 / 顶栏底 40
1024×768 (窄屏) | 岛 392×60 | 顶栏 40 | 事件轨 x[16,276] 间距 40.0 | 小地图 x[806,1008] 间距 98.0 | 角标 top 56 / 顶栏底 40

✓ 碰撞断言全过：岛高 ≤100px、事件轨 / 小地图零重叠且间距 ≥40px、中轴可用高度 ≥85%、小地图 hover 提亮有过滤渡、角标不压顶栏
```

- 角标与顶栏**包围盒不相交**（角标 top 56px > 顶栏底 40px）—— 本任务修的正是原来 24px inset 压顶栏的问题；
- 小地图 hover：静止 computed filter 无 brightness，悬停后 brightness > 1，且声明了 `transition: filter`；
- 小地图与控制岛水平间距 98 / 204.4 / 98px，均 ≥40px。

### ② 类型 / 测试 / lint

- `npx tsc --noEmit` → 零错；`npx tsc -p tsconfig.test.json --noEmit` → 零错
- `npx jest src/hud --maxWorkers=2 --silent` → 51 套件 / 1012 用例全绿
- `npx jest src/core --maxWorkers=2 --silent` → 38 套件 / 807 用例全绿
- `npx eslint --cache --max-warnings 200 <改动文件>` → 零错

### ③ 关键实现点

- hover 提亮只动 `filter`（合成层属性，不触发布局重排）：`.frame { transition: filter 180ms ease }` +
  `:host(:hover) .frame { filter: brightness(1.12) }`，数值在 `MINIMAP_METRICS`；
- 小地图贴边留边 12px → 16px（与事件轨同口径，`MINIMAP_METRICS.cornerMarginPx`），
  `cornerStackHeightPx` 改为按小地图度量**派生**（154 → 158）；
- 角标顶部 inset **派生**：`REPLAY_CLOCK_TOP_INSET_PX = TOPBAR_METRICS.heightPx + 16 = 56`，
  顶栏高度一改角标落点自动跟着挪；水平 inset 仍是 24px（规格只改垂直位置）；
- 角标挂 L3：`HUD_LAYER_REGIONS.L3 = ['strat-replay-clock']` + 组件自标 `data-srf-layer="L3"`；
- 新增 `src/hud/layout/hud-layout.ts`：把「≥40px 间距」「角标不压顶栏」写成纯函数，jsdom 里也能断言。

详见 `docs/rubric/agent_task_093_corner_pieces.md`。
