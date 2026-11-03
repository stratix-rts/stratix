# agent_task_099 —— v3.5 交互减法 · 遮挡规则 R1/R2/R4 工作文档

> 任务：task_099 —— 全屏弹窗（设置屏等）打开时四角常驻件统一降对比 + 禁点（**复用 096 的 L1 降对比通道**，不另造变量）；
> chat-drawer 等侧滑抽屉只压暗对侧、不锁四角；所有全屏弹窗 ESC + 遮罩点击**双关闭途径**必齐。
> 方案依据：docs/interaction-reduction-v3.5.md §二（R1 / R2 / R4）。
> 前序：v3.4 task_096（信息三层级 L1/L2/L3 与 CSS 变量通道）、v3.5 task_098（小地图固定展开）。
> 分支：demo/v3.3（commit 前缀 v3.5）。日期：2026-11-03。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/hud/layers/occlusion.ts`（新） | **遮挡规则机制层**（R1/R2/R4 的唯一实现处）：遮挡控制器（全屏弹窗栈 + 抽屉位 + ESC 统一路由 + 根元素标记属性 + 注入样式表）、`mountModalShell`（全屏弹窗壳：遮罩 + 居中面板 + 双关闭途径） |
| `src/hud/layers/info-layer.ts` | L1 通道对外只开**一个口**：`L1DimSink.setDimSource(source, opacity)` —— 别的机制叠加降对比时登记自己的触发源，由本控制器合成（取最暗）后写进**同一个** `--srf-layer-l1-opacity` |
| `src/hud/screens/main-screen.ts` | 设置屏 / 角色屏改走**全屏弹窗壳**（`mountModalShell`）：遮罩 + 居中面板；`.hud-sub-screen` 底色改透明（四角要能在遮罩之下可见并降对比） |
| `src/hud/components/chat-drawer/chat-drawer.ts` | 抽屉开合报给遮挡控制器（`DrawerOcclusionPort.setDrawer`）；新增 `.rail-dim` 对侧压暗层（`pointer-events:none` —— 压暗不是挡住） |
| `src/hud/components/marquee/marquee.ts` | 事件轨的可点部件（条目 / 折叠按钮）读 `var(--srf-marquee-pe, auto)` —— 影子树内部只能靠自定义属性穿透边界传开关 |
| `src/hud/components/shortcuts/shortcut-help.ts` / `shortcut-manager.ts` | 帮助浮层（另一个全屏弹窗）登记进遮挡栈；开合经 `ShortcutOcclusionPort` |
| `src/app/main/main-entry.ts` / `src/hud/dev/hud-dev-entry.ts` | 组合根接线：层级控制器 + 遮挡控制器（先于 `createMainScreen` 建），并把遮挡控制器注入主屏 / 抽屉 / 快捷键三处 |
| `src/hud/layers/__tests__/occlusion.test.ts`（新，18 例） | 机制层单测：R1 通道复用 / 关闭全恢复 / 弹窗栈 / ESC 只关栈顶 / R2 抽屉不碰通道不禁点 / R4 弹窗壳双关闭 |
| `src/hud/__tests__/interaction-occlusion.test.ts`（新，8 例） | 接线层集成测：真主屏 + 真 store：弹窗开 → 四角降对比禁点；关 → 全恢复；ESC 与点遮罩**各自**断言；抽屉开 → 四角仍可点 |
| `docs/rubric/agent_task_099_occlusion_rules.md` | 本工作文档 |

## 2. 三条规则的口径（谁压着谁）

| 场景 | 四角常驻件（顶栏 / 控制岛 / 事件轨 / 小地图） | 全屏接管 | 关掉后 |
|---|---|---|---|
| **R1 全屏弹窗**（设置屏 / 角色屏 / 快捷键帮助浮层） | 统一降对比（L1 通道 → 0.18）+ `pointer-events:none` | 是（遮罩铺满视口） | 全恢复（通道回 1、标记回 false、角件可点） |
| **R2 侧滑抽屉**（chat-drawer） | **不动**（不降对比、不禁点） | 否（只压暗对侧） | — |
| **L3 演出**（096/094 既有） | 按层级口径降对比 / 收起 | — | 既有行为不变 |

**「通道只有一条」**：弹窗的降对比**不另造 CSS 变量**，而是往 096 的 `--srf-layer-l1-opacity` 上**叠加一个触发源**
（`setDimSource('modal', 0.18)`），由信息层级控制器取**最暗**的那个合成后写出。
⇒ 弹窗压着 L3 演出时仍是暗的；演出退、弹窗还在 → 仍是弹窗那档（096 的层级机制一行未改，回归用例钉住）。

**双关闭途径（R4）**：全屏弹窗 = 「全屏遮罩 + 居中面板」形态（没有遮罩就没有「点遮罩可关」这条路）。
ESC 由遮挡控制器**一个** document 监听器统一路由到**栈顶**（多弹窗各挂监听器会把它们一起关掉）；
点遮罩由弹窗壳自己接（遮罩与面板是兄弟节点 —— 点面板不冒泡到遮罩）。两条路都收口到「回主屏」这一条命令。

## 3. 关键设计决策

1. **通道复用而非新通道**：新增 `L1DimSink.setDimSource` 这一「口」，而不是第二个变量 ——
   通道主人（信息层级控制器）仍是唯一写者，多触发源在它那里合成（`composeL1Opacity` 取最暗）。
2. **样式表挂 `document.body` 末尾，且每次状态同步时挪到最后**
   —— 各屏的样式表（如主屏的 `.hud-topbar { pointer-events: auto }`）是在屏挂载时才插进来的，
   顺序级联下「最后」的那张才赢；挪位置而不是重建（重建会让浏览器重新解析样式表）。
3. **禁点带 `!important`**：小地图影子树里的 `:host { pointer-events: auto }` 是组件自开的交互口，
   不加 `!important` 时弹窗期间仍可能点到小地图（误触）。
4. **事件轨单独走自定义属性**：它的可点部件在**影子树内部**且自带 `pointer-events:auto`，
   外层样式表穿不进影子树 —— 只有自定义属性能穿透影子边界继承（组件读 `var(--srf-marquee-pe, auto)`）。
5. **抽屉不交 `requestClose`**：帮助浮层的 ESC 归快捷键管理器自己（解析表里 Escape = closeHelp，
   浮层开着时 ESC 只关浮层、不清选择）。若把 `requestClose` 也交出去，遮挡控制器的 ESC 路由会先把浮层
   从栈里摘掉（`helpOpen` 变 false），紧接着管理器会把同一次 ESC 解析成 `deselect` —— 多清一次选择。
6. **子屏改透明底**：`.hud-sub-screen` 原为不透明 `var(--srf-bg)` —— 铺一层不透明底色会把四角整个盖掉，
   降对比就白做了；底色改由弹窗壳的遮罩（`--srf-backdrop`）给。
7. **jsdom 口径**（探针实证）：jsdom 的 `getComputedStyle` 是**只按源码顺序**的层叠（不认特异度）、不解析 `var()`、
   不把影子树样式算进去 ⇒ 降对比断言看**通道变量值**、禁点断言看**computed pointer-events**、
   影子树内的样式断言看**样式表文本**。

## 4. 验证

### 4.1 静态与单测（输出原样）

- `npx tsc --noEmit` → **零输出（零错）**，`exit 0`。
- `npx jest src/hud --maxWorkers=1` → **56 suites / 1123 tests 全绿**（含本任务新增 2 个 suite / 26 例）。
- `npx jest src/app --maxWorkers=1` → **57 suites / 727 tests 全绿**（组合根改动的回归面）。

### 4.2 验收标准逐条对照（每条都有断言）

| 验收项 | 断言位置 | 断言内容 |
|---|---|---|
| 弹窗开 → 四角降对比 | `interaction-occlusion.test.ts` / `occlusion.test.ts` | `--srf-layer-l1-opacity === '0.18'`（**复用 096 通道**，样式表里无第二个变量） |
| 弹窗开 → 四角禁点 | 同上 | 四角 computed `pointer-events === 'none'`；事件轨另断言 `--srf-marquee-pe === 'none'`（影子树内可点部件的开关） |
| 弹窗关 → 全恢复 | 同上 | 通道回 `'1'`、`data-srf-modal-open === 'false'`、四角 `pointer-events !== 'none'`、事件轨开关复位 |
| ESC 可关 | `interaction-occlusion.test.ts` | ESC → 发 `{type:'ui.navigate', screen:'main'}`，弹窗退场后四角全恢复 |
| 点遮罩可关 | 同上 | 点 `.hud-modal-mask` → 同一条命令；**点面板不关**（另一条断言） |
| 抽屉开 → 四角仍可点 | 同上 | `state.drawer==='chat-drawer'`、`activeModal===null`、通道仍 `'1'`、四角 `pointer-events !== 'none'`、对侧压暗层 `data-active==='true'` 且不吃点击 |
| 096/094 L3 机制不回归 | `occlusion.test.ts` | 弹窗与 L3 叠加取最暗；演出退、弹窗还在 → 仍是弹窗那档；关弹窗 → 回层级口径 |

## 5. 未决与后续（不属本任务）

- **弹窗互斥队列 / 统一弹窗体验**：方案 §四 属 task_101（本任务只提供机制层与接线，不改各弹窗的内部布局）。
- **收口与状态文档**：task_102（含 §4 实施状态列）。
- **增长图全屏态**：当前代码里**不存在**增长图的全屏形态（`growth-chart` 只有内嵌面板）——
  方案 §二举的「增长图全屏态」属举例；将来它成为全屏弹窗时，走本任务这条 `mountModalShell` 通道即可。
- **小地图折叠逻辑**：task_098 并行在做，本任务**未触碰** `minimap.ts`（只在**外层样式表**里禁它的指针，
  与折叠机制无关）。
