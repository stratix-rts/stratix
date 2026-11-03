# task_096 HUD v3.4 地基：信息三层级系统

## 描述

hud 全局层级状态机（L1 常驻 / L2 事件 / L3 沉浸）+ CSS 变量驱动对比度切换：L3 激活时 L1 降到 18% 对比、L2 收起，退出恢复。层级状态经 core 契约暴露给 world（导演取景框等 L3 元素需要知道）。顶栏暂不动，只交付层级机制与演示开关。

## Requirements

方案依据 docs/hud-redesign-proposal.html §2.3（信息三层级）；分支 demo/v3.3（commit 前缀 v3.4）；遵守总线铁律；常量进 visual-spec；tsc 零错；既有测试全绿；不引入新依赖；最小改动。

## Acceptance

- [x] 三档切换即时生效
- [x] L3 时 L1 元素对比度下降、L2 收起、退出全恢复
- [x] 层级状态可被 world 侧订阅（经 core 契约）
- [x] 独立 commit

## deliverables

hud 层级状态机 + CSS 对比度变量 + core 契约事件 + 演示开关

---

## 实现记录（2026-11-03）

### ① 交付物

| 文件 | 职责 |
|---|---|
| `src/core/info-layer.ts` | 层级纯语义（core 侧唯一口径）：词表 / 缺省 / 合法性判定 / 归一化 / 各档对比与收起口径 |
| `src/core/types.ts` | 契约增补：`type InfoLayer`、`WorldState.infoLayer?`、`HudCommand` 的 `hud.layer.set` |
| `src/core/store.ts` | `applyInfoLayer`（纯函数，值没变即同一引用）+ `setInfoLayer` |
| `src/core/runtime.ts` | `hud.layer.set` → 写状态 → 广播（core 零 DOM） |
| `src/core/theme/visual-spec.ts` | `HUD_LAYER_METRICS`（0.18 等）+ `blendOver` + `contrastRatio`（WCAG） |
| `src/hud/layers/info-layer.ts` | HUD 层级状态机（呈现层）：根 CSS 变量 + 注入样式表 + 分区→层级映射表 + 控制器 |
| `src/hud/layers/layer-switch.ts` | 演示用三档开关（三枚按钮 + 两个样例区 + aria-pressed 回显） |
| `src/app/main/main-entry.ts` | 组合根接线（控制器 + 开关挂 `#hud-side`；pagehide 完整退订） |
| `src/hud/dev/hud-dev-entry.ts` | dev 页同一套接线，`window.__srfHud.layerController` 可直接驱动 |
| `src/stratix-gateway/api/websocket/world-sync/protocol.ts` | `hud.layer.set` 入册远程命令白名单 |
| `src/core/__tests__/info-layer.test.ts` | core 单测 6 例 |
| `src/hud/layers/__tests__/info-layer.test.ts` | HUD 集成测试（jsdom）9 例（含实测对比度） |
| `src/hud/layers/__tests__/layer-switch.test.ts` | 开关单测 5 例 |
| `src/world/__tests__/info-layer.test.ts` | world 侧最小订阅用例 3 例 |
| `docs/rubric/agent_task_096_hud_layers.md` | 工作文档 |

### ② 关键设计决策

1. 真相在 core（`WorldState.infoLayer`）—— 层级要被 world 订阅，而 HUD ↔ world 零直接调用（总线铁律），唯一合法通道是 core 的 state 广播；HUD 不存第二份真相。
2. 切档 = 改根元素上的四个 CSS 变量（`--srf-layer-*`），样式表把分区选择器映射到这些变量 —— 一次重绘、`opacity`/`visibility` 不触发布局重排；变量写在 `documentElement` 上能继承进 shadow DOM。
3. **分区 → 层级映射收在机制层一张表（`HUD_LAYER_REGIONS`，用 CSS 选择器）** —— 本任务「顶栏/底栏/事件轨不动」与「L3 时 L1 降对比」这对矛盾由此解开：**顶栏 / 事件轨代码一行未改**。
4. 通用属性口径 `[data-srf-layer="L1"|"L2"]` 给后续任务「标一个属性即可入层」的入口。
5. L2 收起用 `visibility: hidden`（不是 `display: none` —— display 会与元素自身 display 规则打架）。
6. 「降到 18% 对比」是可复算的数字：`HUD_LAYER_METRICS.l1DimOpacity = 0.18` 唯一口径；实测对比度用 `blendOver` + `contrastRatio`（WCAG）算 —— 15.53:1 → 1.61:1，退出回到 15.53:1。
7. 对比度公式落唯一事实源 visual-spec（此后降/提对比、无障碍校验共用同一公式）。
8. `applyInfoLayer` 纯函数（值没变 → 原样返回同一引用 → store「引用未变即不广播」自动生效）；非法档位归一化为 L1。
9. 挂 `#hud-side` 不挂 `#hud-root`（主屏每次重绘重写 `#hud-root`，task_084/086 同一口径）。
10. 资源可清理：控制器 `destroy()` 撤样式表/变量/标记/订阅者；开关 `unmount()` 退订 + 摘 DOM；组合根 pagehide 三件套收干净。
11. 远程模式：`hud.layer.set` 入册 gateway 命令白名单（远程渲染进程不起 core runtime，真相在 service 侧）。
12. 零新依赖、零范围外改动；`src/world` 只新增测试文件。

### ③ 验证（原样贴出）

```
$ npx tsc --noEmit
tsc exit: 0
（无输出 = 零错）

$ npx jest src/hud src/world --silent --maxWorkers=2
FAIL src/world/appearance/__tests__/brand-presets.test.ts
  ● Test suite failed to run
    ENOENT: no such file or directory, open '/Users/kingj/code/Stratix-demo/dist/frontend/spritesheets/item-metadata.json'

Test Suites: 1 failed, 74 passed, 75 total
Tests:       1345 passed, 1345 total
Snapshots:   0 total
Time:        6.179 s
（唯一失败为既有的环境问题：缺构建产物 dist/frontend/spritesheets/item-metadata.json —— 本仓未内置 LPC 素材，与本任务无关）

$ npx jest src/core src/app --silent --maxWorkers=2
Test Suites: 93 passed, 93 total
Tests:       1527 passed, 1527 total

$ npx jest --silent --maxWorkers=2（全量）
Test Suites: 1 failed, 248 passed, 249 total
Tests:       6 skipped, 4638 passed, 4644 total
（失败项同上）

真实浏览器验证（Chromium + vite dev server，1280×720，等待过渡结束后测量）：
L1  : topbar/rail-left/rail-right/bottom-bar opacity=1；marquee/toast opacity=1 visibility=visible
L3  : topbar/rail-left/rail-right/bottom-bar opacity=0.18；marquee/toast opacity=0 visibility=hidden
回 L1: 全部恢复 opacity=1 / visibility=visible
开关位置: { x: 16, y: 389.2, width: 173.6, height: 78 }（不压底栏）
错误: []
```

### ④ 未尽事项

- 真实触发源未接（回放 / 里程碑 / 导演取景）—— 机制与命令口径已就位，后续任务换触发方即可。
- L3 元素本体（导演取景框 / 里程碑大字）未做 —— 入口已留（`[data-srf-layer="L3"]` + `WorldState.infoLayer` 订阅）。
- 顶栏 7 元素化等结构改造属后续任务（本任务顶栏/底栏/事件轨组件零改动）。
- `brand-presets.test.ts` 的既有失败未修（缺 LPC 素材构建产物，不在本任务范围）。
