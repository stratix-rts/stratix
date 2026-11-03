# agent_task_096 —— HUD v3.4 地基：信息三层级系统 工作文档

> 任务：task_096 —— HUD 全局层级状态机（L1 常驻 / L2 事件 / L3 沉浸）+ CSS 变量驱动的对比度切换；
> L3 激活时 L1 降到 18% 对比、L2 收起，退出全恢复；层级状态经 core 契约暴露给 world；
> 顶栏 / 底栏 / 事件轨本任务不动，只交付机制 + 一个演示用三档开关。
> 方案依据：docs/hud-redesign-proposal.html §2.3（信息三层级）+ §2.5（分区规格表的「层级」列）。
> 分支：demo/v3.3（commit 前缀 v3.4）。日期：2026-11-03。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/core/info-layer.ts` | **层级纯语义**（core 侧唯一口径）：词表 `INFO_LAYERS` / 缺省 `DEFAULT_INFO_LAYER` / 合法性判定 / 归一化 / 各档的对比与收起口径（`layerL1Opacity` / `layerL2Opacity` / `layerL2Collapsed`）—— 零 IO 零 DOM |
| `src/core/types.ts` | **契约增补**：`type InfoLayer = 'L1' \| 'L2' \| 'L3'` + `WorldState.infoLayer?` + `HudCommand` 的 `hud.layer.set` |
| `src/core/store.ts` | `applyInfoLayer`（纯函数，值没变即同一引用）+ `setInfoLayer`（写入口径） |
| `src/core/runtime.ts` | `hud.layer.set` 命令接线 → 写状态 → 广播（core 只记状态，零 DOM） |
| `src/core/theme/visual-spec.ts` | **唯一事实源**：`HUD_LAYER_METRICS`（l1Opacity / l1DimOpacity=0.18 / l2DimOpacity=0 / transitionMs）+ `blendOver`（前景按 alpha 叠底色）+ `contrastRatio`（WCAG 对比度） |
| `src/hud/layers/info-layer.ts` | **HUD 层级状态机（呈现层）**：根元素 CSS 变量（`--srf-layer-*`）+ 注入样式表 + 分区→层级映射表 `HUD_LAYER_REGIONS` + 控制器（`current/apply/subscribe/destroy`） |
| `src/hud/layers/layer-switch.ts` | **演示用三档开关**（浮层）：三枚按钮 + 两个样例区，点击发 `hud.layer.set`，`aria-pressed` 回显当前档 |
| `src/app/main/main-entry.ts` | 组合根接线：控制器 + 开关挂 `#hud-side`；core 广播 → 控制器写 CSS 变量；pagehide 时完整退订 |
| `src/hud/dev/hud-dev-entry.ts` | dev 页同一套接线；`window.__srfHud.layerController` 供调试脚本直接驱动 |
| `src/stratix-gateway/api/websocket/world-sync/protocol.ts` | `hud.layer.set` 入册命令类型白名单（远程模式渲染进程不起 core runtime，真相在 service 侧） |
| `src/core/__tests__/info-layer.test.ts` | core 侧单测 6 例（写入口径 / 命令→状态→广播 / 不重复广播 / 非法值归一化） |
| `src/hud/layers/__tests__/info-layer.test.ts` | HUD 侧集成测试（jsdom）9 例（含**实测对比度**：WCAG 公式算降不透明度前后的真实对比度） |
| `src/hud/layers/__tests__/layer-switch.test.ts` | 开关单测（jsdom）5 例（三枚按钮 / 发命令 / aria-pressed / 样例标记 / 卸载） |
| `src/world/__tests__/info-layer.test.ts` | **world 侧最小订阅用例** 3 例（命令 → core → 广播 → world 订阅者收到层级；退订干净） |

## 2. 关键设计决策

1. **真相在 core，HUD 只做呈现**：层级是「要被 world 订阅」的状态，故进 `WorldState`（可选增补字段，
   读取方缺省按 L1 处理）—— HUD ↔ world 零直接调用（总线铁律），唯一合法通道就是 core 的 state 广播。
   HUD 侧**不存第二份真相**：开关点一下发命令 → core 写状态 → 广播回来 → 控制器改呈现。
2. **切档 = 改四个 CSS 变量，不逐元素改样式**：根元素上写 `--srf-layer-l1-opacity` /
   `--srf-layer-l2-opacity` / `--srf-layer-l2-visibility` / `--srf-layer-transition-ms`，
   样式表把「哪些分区属于哪一层」映射到这些变量。改一个变量 → 一次重绘；`opacity` / `visibility`
   **不触发布局重排**（性能铁律）。变量写在 `document.documentElement` 上 → 能继承进 shadow DOM
   （`strat-marquee` / `strat-toast-host` 在 shadow 里）。
3. **分区 → 层级的映射收在机制层一处（`HUD_LAYER_REGIONS`），用 CSS 选择器而不是给组件打标记**：
   本任务「顶栏 / 底栏 / 事件轨不动」与「L3 时 L1 要降对比」是一对矛盾 —— 打标记要改各组件的代码，
   而选择器把「分区 → 层级」这张表收在机制层：**顶栏 / 事件轨的代码一行未改**，语义一处可查。
   L1 = 顶栏 / 左右侧栏 / 底栏 / 小地图；L2 = 跑马灯 / toast。
4. **通用属性口径 `[data-srf-layer="L1"|"L2"]`**：后续任务新增 L3 元素或新的 L2 件时，
   标一个属性即可入层，不必改映射表 —— 机制对后续任务开放。
5. **L2 用 `visibility: hidden` 收起（不是 `display: none`）**：`display` 会与各元素自身的 display 规则
   打架（`display: none` 覆盖 flex 布局、`display: var(...)` 会回退成 block）；`visibility` 是独立属性、
   不吃布局、且连带禁掉子元素的指针事件 —— 正是「收起」要的。
6. **「降到 18% 对比」是可复算的数字，不是口号**：`HUD_LAYER_METRICS.l1DimOpacity = 0.18` 是唯一口径；
   实测对比度用 `blendOver`（前景按 0.18 叠到背景上）+ `contrastRatio`（WCAG 2.1 相对亮度）算 ——
   实测 15.53:1 → 1.61:1，退出后回到 15.53:1。单测直接断言这两个数。
7. **对比度公式落唯一事实源（visual-spec）**：本仓此后任何「降对比 / 提对比 / 无障碍校验」都用同一个
   `contrastRatio`，免得各处各算一套。
8. **状态机与命令分离**：`applyInfoLayer` 是纯函数（值没变 → 原样返回同一引用 → store 的
   「引用未变即不广播」约定自动生效）；非法档位归一化为 L1（显示密度不该让命令失败）。
9. **挂 `#hud-side` 而不是 `#hud-root`**：主屏每次重绘都重写 `#hud-root` 的 innerHTML（task_084/086 同一口径），
   `#hud-side` 是覆盖层容器，JS 永不重写它。开关按 `bottom: calc(min(34vh, 300px) + 8px)` 让开底栏。
10. **资源必须可清理**：控制器 `destroy()` 撤样式表 / 撤变量 / 撤标记 / 清订阅者；开关 `unmount()` 退订 + 摘 DOM；
    组合根在 `pagehide` 里三件套收干净。
11. **远程模式也要能切档**：`hud.layer.set` 入册 gateway 的 `HUD_COMMAND_TYPE_FLAGS`（远程模式下渲染进程
    不起 core runtime，真相在 service 侧的 core —— 不入册则远程切档发不出去）。
12. **零新依赖、零范围外改动**：只碰 core 契约 / hud 新目录 / 两个组合根 / 一个协议白名单；
    `src/world` 侧只新增一个测试文件（不改任何 world 代码）。

## 3. 验证

- `npx tsc --noEmit` → **0 错**（无输出）
- `npx jest src/hud src/world --silent --maxWorkers=2` → `Test Suites: 1 failed, 74 passed, 75 total / Tests: 1345 passed, 1345 total`
  —— 唯一失败的 `src/world/appearance/__tests__/brand-presets.test.ts` 是**既有的环境问题**（缺构建产物
  `dist/frontend/spritesheets/item-metadata.json`，本仓未内置 LPC 素材，与本任务无关）
- `npx jest src/core src/app --silent --maxWorkers=2` → `Test Suites: 93 passed, 93 total / Tests: 1527 passed, 1527 total`
- `npx jest --silent --maxWorkers=2`（全量）→ `Test Suites: 1 failed, 248 passed, 249 total / Tests: 6 skipped, 4638 passed, 4644 total`
- **真实浏览器验证**（Chromium + vite dev server，1280×720）：L1 时顶栏 / 左右侧栏 / 底栏 opacity = 1，
  跑马灯 / toast visible；切 L3 → 四个 L1 分区 opacity = **0.18**、跑马灯 / toast `visibility: hidden` + opacity 0；
  切回 L1 → 全部恢复为 1 / visible；控制台无报错。
- 截图确认：L3 下整屏 HUD 让位、世界层（战场空态提示）保持明亮 —— 正是「L3 沉浸」应有的观感。

## 4. 未尽事项

- **真实触发源未接**：本任务只交付机制 + 演示开关。回放播放中自动进 L2/L3、里程碑触发 L3 大字、
  导演取景框等真实触发源由后续任务接（同一条 `hud.layer.set` 命令口径，触发方换人即可）。
- **顶栏 / 底栏 / 事件轨的组件结构未动**（按任务要求）：它们的层级语义目前靠机制层的选择器映射表，
  顶栏 7 元素化等结构改造属后续任务。
- **L3 元素本体未做**：导演取景框 / 里程碑大字 / 回放重演等 L3 内容是后续任务；
  机制已给好入口（`[data-srf-layer="L3"]` 与 `WorldState.infoLayer` 订阅）。
- **`brand-presets.test.ts` 的失败未修**：缺 `dist/frontend/spritesheets/item-metadata.json`（需 LPC 素材生成），
  属既有环境问题，不在本任务范围。
- **左右侧栏归入 L1 是一处判断**：v3.3 主屏的左右侧栏（agent 面板 / 态势总览 / 会话 / 日志）在
  §2.3 的 L1 成员表里没有逐条列出；按「常驻基准信息」的语义归 L1，使 L3 的「整体让位」成立。
  若后续顶栏 7 元素化后侧栏结构变化，只需改 `HUD_LAYER_REGIONS` 这一张表。
