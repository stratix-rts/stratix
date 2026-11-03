# agent_task_098 —— v3.5 交互减法 · 小地图固定展开 工作文档

> 任务：task_098 —— 小地图 200×120 **常驻展开**，不折叠、不自动收起；
> 排查现有**一切**折叠 / 收起路径并全部解除；hover 提亮（093）与「MAP」角标保留；点击跳转不回归。
> 方案依据：docs/interaction-reduction-v3.5.md §三（小地图：固定展开，hover 提亮保留，MAP 角标保留）。
> 前序：v3.3 task_079（岛屿轮廓 / 状态光点 / 视野白框 / MAP 角标）、v3.4 task_093（hover 提亮 + 间距规则化）、
> v3.4 task_096（信息三层级 L1/L2/L3）。
> 分支：demo/v3.3（commit 前缀 v3.5）。日期：2026-11-03。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/hud/components/minimap/minimap.ts` | **解除折叠机制**：删折叠钮（`[data-role="toggle"]`）、删折叠态 DOM（`data-collapsed` 属性 + 隐藏画布的 CSS）、删折叠记忆（`localStorage stratix.minimap.collapsed` 的读与写）、删 `collapsed` getter / `toggleCollapsed()` 接口与实现；标题栏只留「小地图」标签；hover 提亮 / MAP 角标 / 点击跳转原样保留 |
| `src/core/theme/visual-spec.ts` | `MINIMAP_METRICS.headHeightPx` 注释同步（标题栏不再含折叠按钮，高度值不变 = 20） |
| `src/hud/__tests__/minimap.test.ts` | 「折叠与记忆」用例整段改为「固定展开」用例：无折叠钮 / 无隐藏画布的 CSS / **遗留 localStorage 旧值不再生效** / 标题栏标签仍在 / 拖拽残留复位 |
| `src/hud/__tests__/click-health.test.ts` | 体检第 19 项重写为「小地图固定展开」：无折叠钮、无折叠属性、画布在且尺寸为 200 |
| `src/hud/layers/__tests__/info-layer.test.ts` | 新增守卫：L3 期间小地图**只降对比、不收起**（L1 规则块里只有 opacity，没有 display / visibility） |
| `docs/rubric/agent_task_098_minimap_fixed.md` | 本工作文档 |

## 2. 折叠 / 收起路径排查（逐条核实，不靠猜）

方案 §一里点名的三类路径 + 组件自带的折叠机制，逐条查证：

| # | 路径 | 是否存在 | 证据 | 处置 |
|---|---|---|---|---|
| 1 | **折叠按钮**（shadow 内 `[data-role="toggle"]` ▾/▸） | ✅ 存在 | task_057（3805fa1）引入；`buildDom()` 建按钮 → `toggleCollapsed()` → `syncCollapsedDom()` 翻 `data-collapsed` | **删除**：按钮、监听器、`syncCollapsedDom()` 整体移除 |
| 2 | **折叠记忆**（localStorage `stratix.minimap.collapsed`） | ✅ 存在 | `connectedCallback` 读 `readCollapsed()`（`'1'` → 收起），`toggleCollapsed()` 写 `writeCollapsed()` | **删除**：读写函数与常量一并移除；旧值留在 localStorage 里也**不再被读**（新用例专门钉这条） |
| 3 | **折叠态 CSS**（`:host([data-collapsed]) canvas { display:none }`） | ✅ 存在 | `buildDom()` 的样式表 | **删除**（连同 `data-collapsed` 属性本身） |
| 4 | **hover 收起** | ❌ 不存在 | 全仓无「hover → 折叠」路径；`:host(:hover) .frame` 只做 `filter: brightness(1.12)`（093 的**提亮**，不是收起） | 无需处置；hover 提亮**保留** |
| 5 | **L3 演出收起** | ❌ 不存在 | `HUD_LAYER_REGIONS` 里小地图是 **L1**（`info-layer.ts:82`）；L3 期间 L1 走「降对比到 18%」，**收起（visibility:hidden）是 L2 专属**（事件轨 / toast） | 无需处置；新增守卫用例钉住「只降对比、不收起」 |
| 6 | **窄屏折叠** | ❌ 不存在 | 全仓无 `@media` / 容器查询作用于小地图（唯一的 `@container (max-width:700px)` 在 `main-screen.ts:315`，只作用于顶栏 / 左右竖栏 / 控制岛；小地图挂在 `hudRoot` 下的 `position:fixed` 独立元素，不在该作用域内） | 无需处置 |
| 7 | **全屏弹窗遮住 / 收起小地图** | ❌ 不存在 | 小地图 `position:fixed; z-index:45`，独立于任何弹窗层；R1 的「降对比 + pointer-events:none」属 task_099 范围，本任务不引入 | 无需处置（本任务不碰弹窗机制） |

**结论**：真正存在的收起路径只有 ①②③ 三条，全部落在同一个组件内，已整体解除；
④⑤⑥⑦ 四条**本来就不存在**（逐条给出证据，避免「以为解除了其实没查」）。

## 3. 关键设计决策

1. **彻底删掉折叠 API，而不是留一个永远返回 false 的 `collapsed`**
   ——留着会变成「看起来能收、其实收不了」的僵尸接口，下一个人还会照着它写文档。
   契约变更只波及本组件（`StratMinimapElement`）与其两处测试，全仓无第二个调用方
   （`grep toggleCollapsed` 只命中会话面板的同名方法，与小地图无关）。
2. **标题栏保留、只摘折叠钮**
   ——「小地图」标签是**识别信息**（观众知道右下那块是什么），折叠钮才是**收起入口**。
   标签高度 `MINIMAP_METRICS.headHeightPx = 20` 不变 ⇒ 版面计算
   （`hud-layout.ts` / `CONTROL_ISLAND_METRICS.cornerStackHeightPx`）**一行都不用改**。
3. **L3 期间小地图「降对比但可展开」的口径写进测试，不只写进注释**
   ——R1 允许全屏弹窗期降对比，但「展开状态本身不得被禁」；小地图是 L1 件，
   层级样式表对它**只有 opacity**。新增用例断言 L1 规则块里没有 `display` / `visibility`
   ——将来谁给小地图挂进 L2（收起）分组，这条用例会红。
4. **旧 localStorage 值「留着但不读」**
   ——已经写过 `'1'` 的本机用户不会残留一个永远收不起来的小地图，也不需要清理脚本
   （组件不读 ⇒ 那个键就是普通垃圾数据）。新用例专门断言这条。

## 4. 验证

### 4.1 静态与单测

- `npx tsc --noEmit` → 零输出（零错）。
- `npx jest src/hud --maxWorkers=2 --silent` → **54 suites / 1097 tests 全绿**。
- `npx jest --maxWorkers=2 --silent`（全量）→ 261 suites 通过、1 个 suite 失败：
  `src/world/appearance/__tests__/brand-presets.test.ts` —— **与本任务无关的既有环境缺口**：
  该用例读 `dist/frontend/spritesheets/item-metadata.json`（由 `scripts/generate-metadata.ts`
  从 LPC 素材生成，本 worktree 无该素材），报 `ENOENT`，与 hud / 小地图无任何关联。
- `npx eslint --cache <改动文件>` → 0 error（测试目录按 eslint 配置忽略）。
- 回归点：hover 提亮（093 用例原样保留）、点击跳转（`camera.center` / `unit.select`）、
  拖拽连续跳转、状态着色光点、MAP 角标 —— 全部原样通过。

### 4.2 真浏览器（vite dev + playwright）

`node scripts/check-hud-island-layout.mjs`（既有四角碰撞脚本）→ **碰撞断言全过**：
三档分辨率下小地图与控制岛 / 事件轨 / 顶栏 / 角标两两零重叠、间距 ≥40px、
hover 提亮有 filter 过渡 —— 说明摘掉折叠钮没有挪动小地图的占位。

另跑一次性浏览器断言（不入库），逐条核对「展开态」：

| 场景 | 实测 | 结论 |
|---|---|---|
| L1 常驻 | 无折叠钮 / 无 `data-collapsed` / 样式表无折叠规则 / 标签在 / 画布 200×120 / `display:block` / 占位 200×120 / opacity 1 / pointer-events auto | 展开 ✅ |
| L3 沉浸（演出中） | 画布仍 `display:block`、`visibility:visible`、占位仍 200×120、opacity 0.18（降对比）、pointer-events auto（不禁点） | 展开（只降对比）✅ |
| hover | `filter: brightness(1.12)` + `transition-property: filter` | 提亮保留 ✅ |

