# task_094 HUD v3.4 · Z6 沉浸层

## 描述

L3 接管逻辑接线：里程碑大字 / ▶60秒重演 / 导演取景框激活时进入 L3（联动 task_096 地基：L1 降对比、L2 收起），退出自动恢复；导演模式持续期间中屏保留取景框角标。

## Requirements

依据 docs/hud-redesign-proposal.html §2.5 Z6；tsc 零错；测试全绿；最小改动。

## Acceptance

- [x] 三类 L3 演出各自正确触发层级切换
- [x] 演出中 L1/L2 行为符合规格
- [x] 异常退出（演出中断）层级不卡死

## deliverables

沉浸层接线（依赖 096 地基 + 090 控制岛 + 091 事件轨）

## 验证记录（2026-11-03）

### 机制：占用（hold）语义，不是「切档」语义

三类演出可以同时在演（里程碑大字撞上 60 秒重演）——沿用 `hud.layer.set` 的绝对切档，
先结束的那个会把另一个的沉浸态一起撤掉。故新增 `hud.layer.hold { trigger, active }`：

- core 侧按**占用列表**裁决：有效档 = 有占用即 L3，否则回**手动档**；
- `hud.layer.set` 的语义收紧为「改手动档」（`WorldState.layerBase`），
  `WorldState.infoLayer` 变成**有效档**（呈现层与 world 侧只读它）；
- 占用词表 `LayerTrigger = 'milestone' | 'replay' | 'director'`（有界，广播数据不许无限增长）。

### 接线点

| 演出 | 占用来源 | 释放时机 |
|---|---|---|
| 里程碑大字 | 组件 `show()` 时发 `hud.layer.hold` | 大字收起（计时器）/ 元素离场（`disconnectedCallback`） |
| ▶60 秒重演 | 回放控制器 `play()`（注入口 `setImmersive`） | 播完 / `stop()` / `dispose()` |
| 导演取景框 | `store.setDirectorEnabled` 自动同步占用（两条入口同一落点） | 导演关闭 / world 侧手动介入回写 false |

### 验证输出

`npx tsc --noEmit` → 0 错（无输出）

`npx jest src/hud --silent --maxWorkers=2` → `Test Suites: 52 passed, 52 total / Tests: 1022 passed, 1022 total`

`npx jest --silent --maxWorkers=2`（全量）→ `Test Suites: 258 passed, 258 total / Tests: 6 skipped, 4807 passed, 4813 total`

新增用例：

- `src/core/__tests__/layer-hold.test.ts`（10 例）：占用纯函数 / 命令→状态→广播 / 非法占用源忽略 /
  多演出叠加裁决 / 手动档被记住 / 导演两条入口；
- `src/hud/__tests__/immersive-layer.test.ts`（8 例，真实链路：组件 → HudCommand → core/bus →
  runtime → store → state 广播 → HUD 层级控制器 → 根元素 CSS 变量）：
  演出期间 `--srf-layer-l1-opacity = 0.18`、`--srf-layer-l2-visibility = hidden`；结束恢复 1 / visible；
  大字被中途摘掉 / 回放被 dispose → 层级回 L1 **不卡死**；里程碑撞重演 → 仍是 L3；
- `src/world/__tests__/info-layer.test.ts`（+2 例）：导演期间取景框挂进 L3 状态 / 手动介入后退出。

工作文档：`docs/rubric/agent_task_094_immersive_layer.md`
