# agent_task_093 —— HUD v3.4 · Z3/Z5 边角件（小地图 hover + 回放角标迁移）工作文档

> 任务：task_093 —— (a) 小地图 hover 提升亮度（带过渡）+ 与控制岛「≥40px 间距」规则化；
> (b) 回放时间戳角标从「压在顶栏上的 24px」迁到「左上 inset top 56px」，仅回放激活时显示，
> 挂 L3 层级（task_096 的层级系统）。
> 方案依据：docs/hud-redesign-proposal.html §2.5（分区规格表 Z3 / Z5 行）+ §4 D6（修复表）。
> 前序：Z1 顶栏（task_089）/ Z2 事件轨（task_091）/ Z4 控制岛（task_090，commit 140949e）/ 层级系统（task_096）。
> 分支：demo/v3.3（commit 前缀 v3.4）。日期：2026-11-03。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/core/theme/visual-spec.ts` | **唯一事实源**：`MINIMAP_METRICS` 增 `cornerMarginPx / headHeightPx / frameBorderPx / hoverBrightness / hoverTransitionMs`；`CONTROL_ISLAND_METRICS.cornerStackHeightPx` 改为按小地图度量**派生**（154 → 158）；`REPLAY_METRICS` 增 `clockTopbarClearancePx`，并新增派生的 `REPLAY_CLOCK_TOP_INSET_PX`（40 + 16 = 56） |
| `src/hud/components/minimap/minimap.ts` | **hover 提亮**：`.frame` 加 `transition: filter 180ms ease`，`:host(:hover) .frame { filter: brightness(1.12) }`；贴边留边由 `var(--srf-spacing-md)`（12px）改为常量 16px（与事件轨同口径） |
| `src/hud/components/replay/replay-clock.ts` | **角标迁移**：垂直 inset 24px → 56px（左右拆成两个变量 `--replay-clock-inset-top / -left`）；host 挂 `data-srf-layer="L3"` 入层 |
| `src/hud/layers/info-layer.ts` | **层级表补 L3**：`HUD_LAYER_REGIONS` 增 `L3: ['strat-replay-clock']`；样式表增 L3 规则（L3 元素满对比 —— L3 期间 L1 降对比、L2 收起，沉浸的那几件必须最清楚） |
| `src/hud/layout/hud-layout.ts` | **版面纯计算（新增）**：把 Z3 / Z4 / Z5 的盒子与间距写成纯函数（岛宽公式 / 小地图盒 / 与岛的间距 / 角标顶边与顶栏的净距），让「≥40px」「不相交」在 jsdom 里也能断言 |
| `src/hud/__tests__/hud-layout.test.ts` | 回归测试（新增）：三档视口宽下小地图与岛零重叠且间距 ≥40px；角标顶边在顶栏下沿之下 → 包围盒不相交；岛宽公式与样式表同源 |
| `src/hud/__tests__/replay-clock.test.ts` | 回归测试（新增）：非回放态隐藏 / 回放态信息完整（时间 + 日期 + ⏩ 回放中）/ 顶部 inset 56px / 挂 L3 |
| `src/hud/__tests__/minimap.test.ts` | 回归测试（增 4 例）：hover 提亮、过渡存在、只动 filter（不触发布局重排）、留边口径统一 |
| `src/hud/layers/__tests__/info-layer.test.ts` | 回归测试（增 2 断言）：L3 分区选择器进样式表、`[data-srf-layer="L3"]` 通用口径在 |
| `scripts/check-hud-island-layout.mjs` | **浏览器碰撞断言**：新增 ⑦ 小地图 hover 提亮（computed filter 的 brightness + filter 过渡声明）与 ⑧ 角标与顶栏包围盒不相交（强制点亮角标后量真实盒子） |
| `src/hud/README.md` | 目录速查补 `layout/hud-layout.ts` 一行 |
| `docs/rubric/agent_task_093_corner_pieces.md` | 本工作文档 |

## 2. 关键设计决策

1. **「≥40px 间距」从「CSS 里的隐式结果」升级为「可断言的规则」**：task_090 已经用
   `--hud-island-inset = 角件留边 + 更宽的角件 + 40px` 把间距做出来了，但那条公式里
   写死的是**事件轨**的宽（260px），小地图只以「更窄」的身份被顺带覆盖 —— 也就是说
   「小地图与岛的间距」从来没被单独断言过。本任务把它显式化：
   `hud-layout.ts` 里 `minimapIslandClearancePx()` 用**与小地图同一份常量**算出真实间距，
   三档视口宽下断言 ≥40px（实测 98 / 98 / 204px）。公式与 main-screen 的样式表**逐字同源**
   （岛宽 `min(56%, 100% − 2×inset)`、留边 16px、画布 200 + 描边 2）。
2. **小地图的贴边留边从 12px 提到 16px**：原实现用的是 `var(--srf-spacing-md)`（= 12px），
   而 `CONTROL_ISLAND_METRICS.cornerMarginPx` 的注释里写的是「事件轨 left:16px /
   小地图 right:16px（两个组件 shadow CSS 的同一口径）」—— **注释与实现不符**（实际 12px）。
   本任务把实现对齐到注释（16px，与事件轨一致），并把数字提成常量
   `MINIMAP_METRICS.cornerMarginPx`，两个角件从此同一口径。
   连带影响：小地图总占高 154 → 158px，`cornerStackHeightPx` 改为**按小地图度量派生**
   （不再写死），右竖栏的下边界自动跟着让开。
3. **hover 提亮只动 `filter`**：`filter: brightness(1.12)` 是合成层属性，不触发布局重排
   （性能铁律）；过渡 `transition: filter 180ms ease` 只声明一次，落在 `.frame` 上。
   为什么不用 `opacity` / `background`：opacity 会把画布内容一起变淡（地图看不清），
   改 background 则是「换个底色」而不是「提亮」。亮度提升是唯一符合「提升亮度」字面意思的做法。
4. **角标的垂直 inset 与水平 inset 拆成两个变量**：原实现一个 `--replay-clock-inset`
   同时控制 top / left（都 24px）。规格只要求改**垂直**位置（D6：「仅改 inset 避让顶栏；
   字号 / 配色 / 显隐规则不变」），水平 24px 保持不动 —— 拆变量才做得到「只改一边」。
5. **角标顶部 inset 是派生的，不是写死的 56**：`REPLAY_CLOCK_TOP_INSET_PX =
   TOPBAR_METRICS.heightPx + REPLAY_METRICS.clockTopbarClearancePx`（40 + 16 = 56）。
   顶栏高度一改，角标落点自动跟着挪 —— 「角标不压顶栏」这条规则不会悄悄失效。
6. **角标挂 L3 的两条路都走**：机制层在 `HUD_LAYER_REGIONS.L3` 里登记
   `strat-replay-clock`（分区 → 层级的映射集中一处），组件自己再标 `data-srf-layer="L3"`
   （task_096 立的「通用属性口径」）。前者让层级语义一处可查，后者让组件自证归属。
   L3 元素满对比（L3 期间 L1 降到 18%、L2 收起），**L3 的接管触发逻辑属 task_094**，
   本任务只做「登记 + 呈现口径」，不越界改 task_094 的范围。
7. **显隐规则一字未改**：角标仍是「有回放时刻才显示」（`setTime(null)` → `display:none`），
   字号（44px）、配色（`--srf-visual-accent`）、内容（时间 + 日期 + 「⏩ 回放中」）全部原样。
   本任务只搬了位置、只挂了层级。
8. **零新依赖、零资产**：提亮与过渡全是 CSS；浏览器断言复用仓库已有的 Playwright。

## 3. 验证

| 项 | 命令 / 方式 | 结果 |
|---|---|---|
| 类型 | `npx tsc --noEmit` | 零错 |
| 类型（测试） | `npx tsc -p tsconfig.test.json --noEmit` | 零错 |
| HUD 全量 | `npx jest src/hud --maxWorkers=2 --silent` | 51 套件 / 1011 用例全绿（新增 `hud-layout.test.ts` 9 例 + `replay-clock.test.ts` 8 例 + minimap 4 例） |
| core 全量 | `npx jest src/core --maxWorkers=2 --silent` | 38 套件 / 807 用例全绿 |
| lint | `npx eslint --cache --max-warnings 200 <改动文件>` | 零错（测试目录按 eslint 配置忽略） |
| 碰撞断言 | `node scripts/check-hud-island-layout.mjs <url>`（Playwright + Chromium，1280×720 / 1920×1080 / 1024×768） | 三档全过：小地图与岛间距 98 / 204.4 / 98px ≥40px；**小地图 hover 提亮**（静止 filter 无 brightness，hover 后 brightness >1，声明了 filter 过渡）；**角标 top 56px > 顶栏底 40px → 零重叠** |

### 碰撞断言脚本输出（原样）

```
URL: http://127.0.0.1:7525/src/app/main/index.html
分辨率 | 控制岛 | 顶栏 | 左下事件轨 | 右下小地图 | 中轴可用高度 | 岛内分层 | 命令条
1280×720 (720p) | 岛 648×60 | 顶栏 40 | 事件轨 x[16,276] 间距 40.0 | 小地图 x[1062,1264] 间距 98.0 | 中轴 620px (86.1%) | 回放层 25 / 命令层 22 | 可见命令 6 条 | 角标 top 56 / 顶栏底 40
1920×1080 (1080p) | 岛 1075×60 | 顶栏 40 | 事件轨 x[16,276] 间距 146.4 | 小地图 x[1702,1904] 间距 204.4 | 中轴 980px (90.7%) | 回放层 25 / 命令层 22 | 可见命令 6 条 | 角标 top 56 / 顶栏底 40
1024×768 (窄屏) | 岛 392×60 | 顶栏 40 | 事件轨 x[16,276] 间距 40.0 | 小地图 x[806,1008] 间距 98.0 | 中轴 668px (87.0%) | 回放层 25 / 命令层 22 | 可见命令 2 条 | 角标 top 56 / 顶栏底 40

✓ 碰撞断言全过：岛高 ≤100px、事件轨 / 小地图零重叠且间距 ≥40px、中轴可用高度 ≥85%、小地图 hover 提亮有过滤渡、角标不压顶栏
```

### 目视证据（1280×720，强制点亮角标 + 悬停小地图）

角标从「压在顶栏品牌位上」迁到顶栏之下（top 56px），显示 14:32:07 / 2026-11-03 / ⏩ 回放中；
小地图悬停时整块提亮，与底部的控制岛之间留出清晰空当。

## 4. 未尽事项

- **角标会盖住左上竖栏的第一块面板**（`.hud-rail-left` 从 top 52px 起）：这是 L3 沉浸层的
  预期叠放 —— L3 期间 L1 降到 18% 对比，角标成为画面焦点。**L3 的接管触发逻辑属 task_094**
  （Z6 沉浸层：L3 接管 / ▶60 秒重演 / 导演取景），本任务只做「登记 + 呈现口径」，未越界。
  若 task_094 落地后仍觉得叠放突兀，再讨论把角标改为侧栏内定位。
- **窄屏（容器宽 ≤700px）下顶栏退化为文档流**（`position: static`），此时顶栏不再是
  视口顶部的 40px 固定条，「角标在顶栏之下」这条几何关系在该断点下不成立 ——
  本任务的断言覆盖的是标准（宽屏）布局，与 task_090 的碰撞断言口径一致。
- **`hoverBrightness` 的倍率是审美值**：1.12 是「看得见但不刺眼」的档位，
  常量已提到 `MINIMAP_METRICS`，调档不需要改组件。
- **浏览器断言脚本需要真浏览器 + dev server**：jsdom 无排版引擎，bounding box 全是 0；
  脚本复用仓库已有的 Playwright（未新增依赖），跑前需起 vite dev（端口以启动日志为准，
  本仓 vite.config 的 server.port = 7523）。
