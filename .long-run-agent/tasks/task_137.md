# task_137

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_137.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

排版与信息层级系统：字号梯度/间距节奏/顶栏密度-模块

## 交付物

### 1. 字阶 / 间距 token 层（双皮肤各自生效）

- **新增** `src/hud/theme/type-scale.ts`：
  - `TYPE_SCALE_CSS`（现代皮）—— 三级语义字阶 `--srf-font-size-title: 18px` / `--srf-font-size-body: 14px`
    / `--srf-font-size-caption: 12px`，配套 `--srf-line-height-title/body/caption`；
    语义间距节奏 `--srf-space-tight/base/comfy/room/section/block`（4 / 8 / 12 / 16 / 24 / 32，全是 4 的倍数）。
  - `PIXEL_TYPE_SCALE_CSS`（像素皮）—— 同一套字阶**整体 +1px**（19 / 15 / 13），
    Fusion Pixel 落在 12px 网格上，+1px 才是像素网格对齐；间距节奏与皮肤表一致。
  - `typeScaleCssFor(skinId)` —— 皮肤 id → 字阶层（pixel 走像素那套，其余走现代那套）。
  - `TRUNCATE_CSS` —— 全 HUD 共用一份的截断规则（单行 ellipsis + `min-width: 0`）。
- **接线** `src/hud/theme/theme-controller.ts`：注入皮肤表时**追加**对应皮肤的��阶层
  （切皮 = 连字阶一起换；现代皮不受像素字阶影响）。
- **为什么不塞进 `tokens-*.css`**：皮肤表要求 8 套键集合严格一致（skin-tokens 单测的
  CANONICAL_TOKENS 白名单），在那一层加 token 要同时改 8 张表 —— 而 `tokens-pixel.css`
  正是 task_135 在途编辑的文件（任务书明令勿碰）。拆成独立层后，两件事在结构上就是显式的：
  「一套字阶、两套皮肤数值」。

### 2. 顶栏减密度（7 元素位 → 4，-43%，功能零丢失）

- 新的视觉权重：**当前任务一句话 > 战场态势 > 其余收纳**。
- 顶栏元素位（`data-topbar-item`）由 7 个收到 4 个：
  `brand`（降为辅助级字号）/ `task`（**新增**：`当前任务` + 任务标题，标题级字号）/
  `capsule`（态势胶囊，通知徽标收进胶囊内）/ `overflow`（⋯ 菜单）。
- 声音 / 导演 / 演示三个**低频开关收进 ⋯ 菜单**（功能一条不少，开关仍是「点亮即状态」，
  `variant` + `aria-pressed` 语义不变）；⋯ 菜单从 5 项变 8 项。
- 音量滑条从「顶栏浮层」改成「菜单内行内展开」（声音件已经在菜单里，再浮一层是套娃）。
- 口径写进 `src/core/theme/visual-spec.ts` 的 `TOPBAR_METRICS`：`maxVisibleItems` 7 → 4，
  `overflowItemCount` 5 → 8（唯一事实源，单测按它回归）。

### 3. 高频面字阶落地（≥4 个界面，三级可辨）

| 界面 | 标题级 | 正文级 | 辅助级 |
|------|--------|--------|--------|
| 主屏顶栏 | `.hud-task-title` 18px | `.hud-capsule-value` 14px | `.hud-capsule` 12px |
| 态势总览 | `.title` 18px | `.metric-value` 14px | `.metric-label` 12px |
| 会话面板 | `.title` 18px | `.body` 14px | `.chip` 12px |
| 设置页 | `.title` 18px | `.row-label` 14px | `.group-name` 12px |

（角色屏 / 向导屏 / 日志抽屉等留待后续任务扫，本次只做「先立 token 再扫高频面」的四个面。）

### 4. 长文本截断规则

- 顶栏任务标题：`.truncate`（单行 ellipsis）+ `title` 属性双写（被省略的内容仍可悬停读到）。
- 会话列表：沿用既有的 `.row-title` ellipsis + `title`（本次统一到同一份规则文案）。
- 规则文案只有一份：`src/hud/theme/type-scale.ts` 的 `TRUNCATE_CSS`（各表面共用）。

## 验证证据（完成前必填）

- [x] **实现证明**:
  - 字阶 token 落在**双 token 体系**：现代 18/14/12、像素 19/15/13，由主题控制器按皮肤注入
    （`theme-controller.ts` + `type-scale.ts`）。
  - 顶栏元素位 7 → 4（`TOPBAR_METRICS.maxVisibleItems` 同步收紧到 4），⋯ 菜单 5 → 8 项，
    声音 / 导演 / 演示**全部仍可达**（`data-role` 不变，测试逐项验证点击派发不变）。
  - 4 个高频面三级字阶落地（见上表，e2e computed style 实测 18/14/12）。
- [x] **测试验证**:
  - `npx tsc --noEmit` → 绿（无输出）。
  - `npx jest src/hud --maxWorkers=1` → **65 套 / 1266 例全绿**。
  - `npx jest --maxWorkers=2`（全量）→ **278 套 / 5101 例绿**，唯一失败套件
    `src/world/appearance/__tests__/brand-presets.test.ts` 是**已知既存失败**（缺 `dist/` 构建产物，
    与本次改动无关，记忆里有登记）。
  - e2e（playwright，不杀 7523/7524）：`npx playwright test --config=tests/e2e/playwright.type-scale.config.ts`
    → 1 passed。实测输出见下。
- [x] **影响范围**:
  - 只碰 HUD 层（theme / screens / panels / e2e）与 `core/theme/visual-spec.ts` 的两个常量。
  - 未动 gateway（7524）、未动 135 的在途文件（`tokens-pixel.css` / `icon-set.ts` /
    `skin-pixel-layer.css` / `skin-icons.ts`）、未动 136 的空态文件
    （`components/empty-state/`、`components/battlefield-empty/`、两处空态组件文件）；
    `status-screen.ts` / `session-panel.ts` 与 136 共用 → **用 partial-index 只提交自己的字阶 hunk**
    （`git hash-object -w` + `git update-index --cacheinfo`），136 的空态改动留在工作区未提交。

### 测试步骤

1. `source ~/.nvm/nvm.sh && nvm use 22 && npx tsc --noEmit`
2. `npx jest src/hud --silent --maxWorkers=1`
3. `npx jest --silent --maxWorkers=2`（全量）
4. `npx playwright test --config=tests/e2e/playwright.type-scale.config.ts`
   （需要 7523 的 vite 在跑；**不要**用仓库默认 playwright 配置 —— 它的 globalSetup 会杀 7523/7524）

### 验证结果

**e2e 实测（PHASE=after）**：

```
T137_METRICS {"phase":"after",
  "items":["brand","task","capsule","overflow"],
  "taskTitle":"暂无进行中的任务","taskTitleAttr":"暂无进行中的任务",
  "taskOverflow":{"textOverflow":"ellipsis","whiteSpace":"nowrap","overflow":"hidden"},
  "scales":{"main":{"title":"18px","body":"14px","caption":"12px"},
            "status":{"title":"18px","body":"14px","caption":"12px"},
            "session":{"title":"18px","body":"14px","caption":"12px"},
            "settings":{"title":"18px","body":"14px","caption":"12px"}},
  "rects":{"topbar":{"x":0,"y":0,"w":1280,"h":40},
           "railLeft":{"x":12,"y":52,"w":320,"h":556},
           "railRight":{"x":908,"y":52,"w":360,"h":498},
           "bottomBar":{"x":316,"y":660,"w":648,"h":60}}}
```

- 顶栏元素位：**4**（改前 7 → -43%，≥30% 达标）；功能零丢失（菜单 8 项逐项可达）。
- 4 个高频面 × 三级字阶 = **12 个 computed font-size 抽查全为 18/14/12**（三级可辨）。
- 骨架不变：顶栏 1280×40、左栏 320×556、右栏 360×498、底岛 648×60（面板结构未动，只调密度/层级）。

**截图**（reports/shots/）：

- 改后：`type-scale-r5-topbar-after.png`（顶栏特写）、`type-scale-r5-full-after.png`（整屏）、
  `type-scale-r5-settings-after.png`（设置页）。
- 改前对照：`modern-font-r4-full.png`（task_134 在 HEAD 状态下拍的整屏 —— 顶栏是
  `Stratix | 胶囊` + 右侧 4 个图标钮的 7 元素位）与 `pixel-font-r4-topbar-zoom.png`（顶栏特写）。

**未尽事项**：

- 顶栏「当前任务」目前取自 `WorldState.missions`（最近创建且未终结的一条），
  **不含** `MissionBrief` 里的结构化正文 —— 任务正文四段（需求 / 验收 / 交付物 / 约束）
  要不要在顶栏露一句，留给后续任务定。
- 角色屏 / 向导屏 / 日志抽屉 / 命令面板等剩余面板的字阶尚未扫（本次只做四个高频面）。
- 间距 token 目前只落在顶栏与三个面板的**部分**留白上，`--srf-space-*` 语义别名
  尚未在全套组件里铺开。
- 像素皮的 `+1px` 字阶只做了 token 层落地，**未做像素皮整屏截图验收**（像素皮的
  `tokens-pixel.css` 在 task_135 在途，本次未碰）。
