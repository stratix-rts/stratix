# task_147

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_147.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

交互时序对齐：motion token 全量收编 + 一个机械尾巴。

用户原话：「有交互时间没对齐？」—— 视觉 loop 各任务各自为政埋的时长不一致，现在统一节拍。

## requirements

1. **全量收编**：grep hud 全部 transition / animation-duration 硬编码时长，逐个替换为 motion token
   （缺中间档可补 token，如 `--srf-motion-instant` 60ms 用于微反馈）；收编清单进交付。
2. **节拍语义**：同一交互类别同一时长 —— hover/focus 一档、面板开合一档、横幅进出一档、toast 一档；
   发现明显违和（如按钮 400ms 比面板还慢）按语义纠正并记录。
3. **reduced-motion**：全部走既有禁用通道，抽查断言。
4. **机械尾巴**：前 worker 披露的 `src/hud/__tests__/` 约 10 个套件的假 `HudBusAdapter`
   缺 `themeId` / `subscribeTheme`（TS2345），逐个补齐，让含测试文件口径的 tsc 全绿。
5. 验收：hud 内 transition/animation 硬编码时长清零；交互类别-时长映射表写进交付；
   reduced-motion 抽查；双口径 tsc 全绿；`npx tsc --noEmit` + `npx jest src/hud` 绿；
   截图 `-r7` 前缀 + `-motion` 后缀。

## acceptance

- [x] 收编清单 + grep 证据：hud 内 transition/animation 硬编码时长清零（token 文件与注释除外）
- [x] 交互类别-时长映射表写进交付
- [x] reduced-motion 抽查断言（影子树 + 浅 DOM）
- [x] 10 个假 adapter TS2345 全修，双口径 tsc 全绿（命令与输出贴出）
- [x] `npx tsc --noEmit` + `npx jest src/hud` 绿
- [x] 截图 `-r7` 前缀加 `-motion` 后缀

## 交付物

### 1) 收编清单（hud 内 transition / animation 时长字面量 → motion token）

**核心改动**
- `src/core/theme/motion-spec.ts`：时长表从三档扩到**四档**（新增 `instant: 60ms` 微反馈档），
  新增 `MOTION_LOOP_DURATIONS`（环境循环分表）、`MOTION_BEAT_CSS_VARS`（五档复合节拍）、
  `MOTION_TOKEN_VALUES`（token 名 → 声明值唯一表，CSS 与取值函数同源，不可能漂移）。
- `src/hud/theme/motion-tokens.ts`：新增 `MOTION_REDUCED_CSS`（降级块拆出，供组件自挂）、
  `installReducedMotionChannel`（文档级降级通道）、`MOTION_REDUCED_STYLE_ID`。
- `src/app/main/main-entry.ts`：`installMotionTokens()` 在 HUD 挂载前装一次
  （token 表 + 文档级降级通道），保证组件里的 `var(--srf-motion-*)` 一定解析得到。

**硬编码时长收编（逐条）**

| 文件 | 收编前 | 收编后 | 类别 |
|---|---|---|---|
| hud/layers/occlusion.ts | `140ms ease-out` ×2 | `--srf-motion-panel` | 面板开合 |
| hud/layers/layer-switch.ts | `140ms ease-out` ×4 | `--srf-motion-hover` | hover / 按下 |
| hud/panels/session-panel.ts | `140ms ease-out` ×3 | `--srf-motion-panel` | 面板开合 |
| hud/panels/log-drawer.ts | `140ms ease-out` ×3 | `--srf-motion-panel` | 面板开合 |
| hud/screens/main-screen.ts | `140ms ease-out` ×3 | `--srf-motion-panel` | 面板开合 |
| hud/components/battlefield-empty | `srf-sweep 2.4s` / `srf-pulse 1.8s` | `--srf-motion-loop-sweep` / `--srf-motion-loop-pulse` | 环境循环 |
| hud/components/screen-fx/scan-band | `var(--scan-band-period, 12000ms)` | `…, var(--srf-motion-loop-scan))` | 环境循环 |
| hud/components/screen-fx/error-glow | `var(--glow-pulse-ms, 650ms)` | `…, var(--srf-motion-loop-glow))` | 环境循环 |
| hud/components/marquee/marquee | `250ms cubic-bezier(…)` / `300ms ease-in` / `120ms ease` | `--srf-motion-panel` / `--srf-motion-panel-exit` / `--srf-motion-hover` | 换位 / 退场 / hover |
| hud/components/marquee/milestone | `var(--milestone-duration, 1500ms) cubic-bezier(…)` | `var(--milestone-duration, var(--srf-motion-slow)) var(--srf-motion-ease-enter)` | 叙事（运行时值仍来自 core MARQUEE_METRICS） |
| hud/components/chat-drawer | `caret-blink 900ms` | `var(--srf-motion-loop-caret)` | 环境循环 |
| hud/lib/markdown.ts | `120ms ease` ×2 | `--srf-motion-hover` | hover |
| hud/components/minimap | `${MINIMAP_METRICS.hoverTransitionMs}ms`（180ms） | `--srf-motion-hover` | hover |
| hud/layers/info-layer | `${HUD_LAYER_METRICS.transitionMs}ms`（200ms） | `var(--srf-motion-base)` + `--srf-motion-ease-enter` | 层级切换 |

**`var(--srf-transition)` 收编（67 处）**——皮肤表里那个 160ms 常量是「各任务各自为政」的产物，
它既不是 hover 档也不是面板档，收编后全 HUD 不再消费它的时长部分
（皮肤表的 `--srf-transition` 保留为**皮肤运动语言信号**：像素皮靠它带 `steps()`）。

- hover / focus 类（多数）：`var(--srf-transition)` → `var(--srf-motion-hover)`
- 面板 / 抽屉 / 引导环开合：`var(--srf-motion-panel)`
- 进度条换位：`var(--srf-motion-panel)`

### 2) 交互类别-时长映射表

| 交互类别 | token | 时长 | 缓动 |
|---|---|---|---|
| 微反馈（按下 / 勾选 / 即时回执） | `--srf-motion-tap` | 60ms | ease-out |
| hover / focus 反馈 | `--srf-motion-hover` | 120ms | ease-out |
| 面板 / 浮层开合、横幅进出、列表换位 | `--srf-motion-panel` | 200ms | ease-out |
| 退场 | `--srf-motion-panel-exit` | 200ms | ease-in |
| 签名瞬间（确认脉冲） | `--srf-motion-signature` | 360ms | spring |

**环境循环表**（装饰性 infinite 动画 —— 与交互节拍分表，不占交互档位）

| 用途 | token | 周期 |
|---|---|---|
| 战场空态扫描扫线 | `--srf-motion-loop-sweep` | 2400ms |
| 战场空态待命呼吸 | `--srf-motion-loop-pulse` | 1800ms |
| 全屏扫描光带 | `--srf-motion-loop-scan` | 12000ms |
| 报错红光晕呼吸 | `--srf-motion-loop-glow` | 650ms |
| 输入光标眨眼 | `--srf-motion-loop-caret` | 900ms |

**明显违和纠正记录**
- hover 此前有 **140 / 160 / 180 / 120ms 四种** → 统一 120ms（fast 档）。
- 面板开合此前 140ms、而横幅 / toast 入场 200ms → 统一 200ms（base 档）。
- 小地图 hover 180ms（自带第二份时长常量 `MINIMAP_METRICS.hoverTransitionMs`）→ 120ms，
  该常量已从 core 删除（时长只有一个事实源）。
- 事件轨退场 CSS 300ms 与 JS 移除计时 300ms 不一致（收编后 CSS 200ms）→ JS 改用
  `MOTION_DURATIONS.base`，两侧同拍。

### 3) reduced-motion

- 既有禁用通道（`animation: none !important; transition: none !important;`）拆成
  `MOTION_REDUCED_CSS`，**每个带动效的影子组件**都拼进自己的 `<style>`
  （session-panel / log-drawer / agent-panel / settings-screen / character-screen /
  chat-drawer / marquee / milestone / scan-band / error-glow / new-task-dialog /
  task-output / shortcut-help / strat-button / minimap / empty-state）。
- 浅 DOM 样式（弹窗壳 / 层级切换 / 主屏 / 信息层）由**文档级通道**
  `installReducedMotionChannel()` 兜底（装在 `installMotionTokens()` 里）。
- 守卫测试 `src/hud/__tests__/motion-token-guard.test.ts` ②条：
  凡有 transition / animation 的文件**必须**挂上既有通道，否则测试红。

### 4) 机械尾巴（假 adapter 类型债）

前 worker 披露的「10 个套件的假 HudBusAdapter 缺 themeId / subscribeTheme」——
**改动已在工作树里**（上一 worker 未提交），本次核实并纳入本 commit：

- agent-panel / bus-adapter / click-health / control-island / director-toggle /
  hud-layout / interaction-occlusion / log-drawer / mission-confirm / mission-detail
  共 10 个套件已补齐（`themeId` / `subscribeTheme` / `subscribe`）。
- 双口径 `tsc` 全绿（主口径 `npx tsc --noEmit`；含测试口径 `npx tsc -p tsconfig.test.json --noEmit`，
  该口径 `include: src/**/*` 且 **不排除** `*.test.ts`，故测试文件确实在类型检查范围内）。

## 验证证据（完成前必填）

- [x] **实现证明**: core 事实源扩表 → HUD token 表 → 组件 `var(--srf-motion-*)`；
      收编守卫测试把「零字面量 + 降级通道全覆盖」写成会失败的断言。
- [x] **测试验证**: `npx tsc --noEmit`（绿）、`npx tsc -p tsconfig.test.json --noEmit`（绿）、
      `npx jest src/hud`（72 套件 / 1344 用例全绿）、`npx jest src/core`（38 套件 / 817 全绿）、
      `npx playwright test --config=tests/e2e/playwright.motion.config.ts`（5 passed）。
- [x] **影响范围**: 仅 HUD 动效层 + core 动效规格 + 组合根一行安装；
      未动 gateway / 未动 144 输入区 / 145 渲染逻辑 / 146 堆叠结构 / 布局骨架 / 零新依赖。

### 测试步骤
1. `npx tsc --noEmit` && `npx tsc -p tsconfig.test.json --noEmit`
2. `npx jest src/hud --silent` && `npx jest src/core --silent`
3. `npx playwright test --config=tests/e2e/playwright.motion.config.ts`
4. grep 自查：`grep -rnE "(transition|animation)[^;{}\"']*[0-9]+(\.[0-9]+)?m?s\b" src/hud`
   → 只剩皮肤 token 表与 token 文件注释。

### 验证结果
- 截图：`reports/shots/toast-r7-motion-0000ms.png` / `-0100ms.png` / `-0200ms.png`
  （toast 入场序列 = 横幅进出档 200ms）、`toast-r7-motion.png`、`motion-r7-full.png`。
- e2e 断言（实跑输出）：
  `T147_TOKENS {"--srf-motion-tap":"60ms ease-out","--srf-motion-hover":"120ms ease-out",
  "--srf-motion-panel":"200ms ease-out","--srf-motion-panel-exit":"200ms ease-in",
  "--srf-motion-signature":"360ms cubic-bezier(0.34, 1.56, 0.64, 1)"}`
  `T147_HOVER {"duration":"0.12s, 0.12s, 0.12s, 0.12s"}`
  `T147_PANEL {"duration":"0.2s"}`
  `T147_REDUCED {"panelAnimation":"none","panelTransition":"0s","miniTransition":"0s","layerTransition":"0s"}`

## 未尽事项
- 皮肤 token 表里的 `--srf-transition`（现代皮 160ms ease-out）**保留**为皮肤运动语言信号
  （像素皮的 `steps()` 探测靠它），但 HUD 已不再消费它的时长部分 ——
  若将来要彻底删，需要先给 `detectMotionSkin` 换一个探测信号（本轮不动，避免动皮肤层）。
- 事件轨「里程碑大字」的停留时长仍来自 core `MARQUEE_METRICS.milestoneDurationMs`（1500ms，
  运行时写进 `--milestone-duration`）—— 它是叙事节奏不是交互节拍，CSS 兜底已改为
  `var(--srf-motion-slow)`，不再有第二份字面量。
- 未跑全量 `npx jest`（仓库已知 brand-presets 套件因缺 dist/ 构建产物必失败，与本轮无关）。
