# agent_task_089 —— HUD v3.4 · Z1 顶栏瘦身：19 元素降 7 工作文档

> 任务：task_089 —— 顶栏 19 个元素 → **7 个元素封顶**（品牌 + 态势胶囊 + 通知徽标 + 🔊 / 🎬 / ▶演示 + ⋯）；
> 删 3 个 on/off 文本标签（开关点亮即状态）；音量滑条收进 🔊 弹出层；⋯ 弹层收纳 5 项低频操作。
> 方案依据：docs/hud-redesign-proposal.html §2.5（分区规格表 Z1 行）+ §4（功能对照表 40/40，零删减）。
> 分支：demo/v3.3（commit 前缀 v3.4）。日期：2026-11-03。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/core/theme/visual-spec.ts` | **唯一事实源**新增 `TOPBAR_METRICS`（heightPx=40 / maxVisibleItems=7 / overflowItemCount=5）—— Z1 的三个验收数字 |
| `src/hud/screens/main-screen.ts` | **顶栏重构**：新模板（7 元素位）+ 态势胶囊 + 两个弹出层（🔊 音量层 / ⋯ 溢出菜单）+ 开关「点亮即状态」回显；导出 `TOPBAR_ITEM_ROLES` / `TOPBAR_OVERFLOW_ROLES`（计数口径与验收清单） |
| `src/hud/widgets/strat-button.ts` | 通用按钮增补 `aria-label` / `aria-pressed` 透传 —— 图标按钮（🔊 / 🎬 / ▶ / ⋯）可见文本只有一个字形，读屏需要真名与开关态 |
| `src/hud/__tests__/main-screen.test.ts` | 新增「Z1 顶栏瘦身」8 例（≤7 元素 / 5 项收纳 / 音量层 / 点亮即状态 / 无重复文本）；演示模式 4 例改断言为点亮态 |
| `src/hud/__tests__/director-toggle.test.ts` | 导演开关断言改口径：状态标签已删，改断 `variant` / `aria-pressed` |
| `src/app/__tests__/hello-loop.test.ts` | 切皮肤用例改按 `data-role` 定位（顶栏瘦身后按钮下标不再稳定），并断言「无 theme-tag 文本」 |

## 2. 关键设计决策

1. **「7 元素」必须先有计数口径，否则这个数字没法数**：顶栏内部本来就有子节点（胶囊里 3 个计数、
   弹出层里 5 个菜单项）。故显式定义 **元素位**（`TOPBAR_ITEM_ROLES` = brand / capsule / badge / sound /
   director / demo / overflow），渲染时逐位打 `data-topbar-item`，单测按这张清单逐位核对 ——
   清单是口径，测试是回归。
2. **三个 on/off 文本标签删除（§4 A13 修复项）**：`theme-tag` / `demo-tag` / `director-tag` 是
   「把开关状态用文字再写一遍」。删除后状态**不丢**：视觉用 `variant=primary`（点亮即状态），
   可访问用 `aria-pressed`（读屏听得出开/关）。皮肤（像素风）已降为低频操作，收进 ⋯ 菜单，
   它的状态由**菜单项自身的名字**承载（「像素风 · 像素」），不再另挂文本。
3. **🔊 一个元素位承载「开关 + 音量层入口」**：§4 A7 要求「点击开关 = 静音；点击旁边的音量区 =
   弹出音量层」，A8 要求音量滑条从顶栏常驻收进 🔊 弹出层。故声音件 = 🔊 开关 + **音量计**
   （一根 20×6 的小条，实时显示当前音量）+ 藏在里面的弹出层：
   - 点 🔊 → 只切静音（不牵动音量）；
   - 点音量计 → 展开音量层，滑条 0-100 即拖即写；
   - 音量层默认 `hidden` → 不占顶栏宽度（P7 痛点闭环）。
4. **⋯ 溢出菜单收纳 5 项，功能一项不减（§4 A4/A9/A10/A11/A12）**：聊天 / 会话 / 角色 / 设置 / 像素风。
   行为完全不变（`ui.navigate chat|character|settings` + `stratix:chat-open` + 会话面板 `toggleCollapsed`
   + `theme.set`），只是入口从顶栏常驻挪进菜单。
5. **「去设置」不再是 primary 按钮**：原顶栏唯一的 primary 按钮随 A12 收进菜单 —— 主屏不该有第二个
   「主行动」。三个开关的「点亮」用的是同一枚 `primary` 变体（= 选中态胶囊），不是「主行动」语义。
6. **两个弹出层的开合：点外面关 / Esc 关**：监听挂在 `document` 上（顶栏是浮层，点战场画布也得能收起它），
   但**只处理顶栏以外的点击**（顶栏内部的开合由顶栏自己管，否则 ⋯ 刚开就被自己点关）。
   监听随 `unmountMain` 一起摘 —— 留在 document 上就是泄漏（perf 铁律）。
7. **顶栏高度 40px（Z1 规格）**：`--hud-topbar-h` 从 48px 改读 `TOPBAR_METRICS.heightPx`。
   高度是 CSS 变量，左右侧栏的 `top` 锚点自动跟随（`calc(var(--hud-topbar-h) + var(--hud-gap))`），无副作用。
8. **不改 core 契约、不引新依赖、不碰底栏 / 事件轨 / 小地图**：本任务纯 HUD 呈现层改造，
   沿用 task_096 的层级地基（顶栏仍是 `.hud-topbar` 选择器 → L1 降对比照常生效，**代码零改动**）。
9. **顶栏模板仍在 main-screen.ts 内（不另起组件）**：顶栏的六个开关与五个收纳项共享同一套
   「事件委托 → adapter.dispatch」通道与同一份展示态（皮肤 / 演示 / 声音），拆成独立组件只会把
   这份共享状态切成两半。模块边界仍清晰：模板与样式在 main-screen，通用按钮能力在 widgets。

## 3. §4 功能对照表逐项保活（40/40 零删减，本任务涉及 13 项）

| # | 功能 | 新版位置 | 行为是否变化 |
|---|---|---|---|
| A1 | 品牌标识 | 顶栏左（元素位 1） | 否 |
| A2 | 单位 / 任务 / 会话计数 | 态势胶囊（三值合一，元素位 2） | 否（仍读 WorldState） |
| A3 | 通知徽标 | 态势胶囊右侧（元素位 3） | 否 |
| A4 | 切换像素风 | ⋯ 菜单第 5 项 | 否（`theme.set` 不变） |
| A5 | 演示模式开关 | ▶ 图标开关（元素位 6） | 否（仍是纯本地展示态） |
| A6 | 🎬 导演开关 | 🎬 图标开关（元素位 5） | 否（仍只发 `camera.director`） |
| A7 | 🔊 声音总开关 | 🔊 图标开关（元素位 4） | 否（仍直写 localStorage） |
| A8 | 音量 0–100 | 🔊 弹出层内的滑条 | 否（读写口径不变） |
| A9 | 打开聊天 | ⋯ 菜单第 1 项 | 否 |
| A10 | 会话面板（展开/收起） | ⋯ 菜单第 2 项 | 否（仍 `toggleCollapsed`） |
| A11 | 看角色 | ⋯ 菜单第 3 项 | 否 |
| A12 | 去设置 | ⋯ 菜单第 4 项 | 否（仍 `ui.navigate settings`） |
| A13 | theme/demo/director 状态文本 | **删除**（由三个开关的点亮态承担） | 状态不丢（§2.2） |

## 4. 验收对照

| 验收项 | 落点 |
|---|---|
| 顶栏可见元素 ≤7 | `TOPBAR_ITEM_ROLES` 7 位 + 单测逐位核对（`main-screen.test.ts`） |
| 音量在 🔊 弹层可调 | 音量计 → 弹出层 → 滑条即拖即写（单测：默认收起 → 展开 → 写 localStorage） |
| 收纳 5 项全部可达 | `TOPBAR_OVERFLOW_ROLES` 5 项 + 单测逐项核对 + 行为用例（聊天/角色/设置仍派发 ui.navigate） |
| 开关点亮即状态，无重复文本 | 三个 on/off 文本标签删除；`variant` + `aria-pressed` 表达状态（单测断言标签不存在） |
| `npx tsc --noEmit` 零错 | ✅ |
| hud 测试全绿不回归 | `npx jest src/hud src/app` 104 suites / 1685 tests 全绿 |

## 5. 未尽事项（留给后续任务）

- 顶栏**高度**已按 Z1 规格改 40px，但**回放时间戳角标**（Z5）仍在旧的 inset 24px —— 与新顶栏有重叠风险，
  属 Z5 任务范围（proposal §2.5 D6），本任务不动。
- L3 沉浸档下顶栏降到 18% 对比由 task_096 的层级机制承担；「L3 时顶栏**完全收起**」的更强形态属后续任务。
- ⋯ 菜单的「键盘方向键导航」未做（当前 Tab / Enter 可用，Esc 关闭可用）。
