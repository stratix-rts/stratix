# agent_task_110 —— 视觉基建：唯一事实源 + 双端同步 + 演示模式开关骨架

> 任务：v3.3-01（task_110）—— 视觉常量唯一事实源（palette 七色 / 尺寸 / 时长 / easing）+
>   world theme.ts 与 hud 双 token 同步 + demo-mode 开关骨架（顶栏开关 / localStorage 记忆 /
>   工程面板隐藏 / 字号 +30%）。
> 方案：docs/DEMO-PLAN.md §1（调色板与 Design Token）+ §8（演示模式）。
> 日期：2026-11-02 · 分支 `demo/v3.3`（worktree `/Users/kingj/code/Stratix-demo`）。

## 1. 交付物

| 文件 | 性质 | 职责 |
|---|---|---|
| `src/core/theme/visual-spec.ts` | 新增 | **视觉常量唯一事实源**：七色调色板 / 尺寸 / 时长 / easing / 演示模式参数 / `hexToNumber` / `hexToRgba`（零 import 叶子模块） |
| `src/world/visual-spec.ts` | 新增 | world 侧门面：把调色板换算成 Phaser 数字色（`WORLD_PALETTE`），并透出 `VISUAL_METRICS` |
| `src/world/theme.ts` | 改 | world 侧**取色入口**：透出 `WORLD_PALETTE` / `VISUAL_PALETTE` / `VISUAL_METRICS`（各文件只认这个门面） |
| `src/world/scenes/BattlefieldScene.ts` | 改 | 战场底色 / 网格 / 外框描边与底衬改从调色板取 |
| `src/world/objects/unit-layer.ts` | 改 | 业务态配色（idle/busy/error）+ 选中圈色改从调色板取（offline 中性灰保留本地） |
| `src/world/objects/task-fx.ts` | 改 | 进度环 / ✓ / ! / ? 浮标 / 移动涟漪色改从调色板取 |
| `src/world/objects/unit-presence.ts` | 改 | 名字标签描边色、说话气泡底衬色改从调色板取（文字色仍属文本层，不并入） |
| `src/hud/theme/visual-tokens.ts` | 新增 | HUD 侧调色板注入器：把七色注入成 `--srf-visual-*` CSS 变量（幂等，可卸载） |
| `src/hud/theme/demo-mode.ts` | 新增 | 演示模式骨架：状态源 + localStorage 记忆 + 字号放大（+30%）+ 工程件过滤机制 |
| `src/hud/screens/main-screen.ts` | 改 | 顶栏「演示」开关 + 状态标签；演示模式下不挂载日志抽屉（工程件）+ 订阅开关重渲 |
| `src/hud/bridge/bus-adapter.ts` | 改 | 换肤后重算演示模式字号覆盖（各皮肤基准字号不同） |
| `src/app/main/main-entry.ts` | 改 | 组合根挂载时注入 HUD 调色板 token |
| `src/core/theme/__tests__/visual-spec.test.ts` | 新增 | 事实源单测（7 色 / 换算 / 尺寸时长 / 演示参数）+ 「色值只此一份」纪律扫描 |
| `src/hud/theme/__tests__/demo-mode.test.ts` | 新增 | 演示模式单测（开关 / 记忆 / 字号放大 / 工程件过滤，jsdom） |
| `src/hud/theme/__tests__/visual-tokens.test.ts` | 新增 | 调色板注入单测（jsdom） |
| `src/world/__tests__/visual-spec.test.ts` | 新增 | world 门面与事实源同值的单测 |
| `src/hud/__tests__/main-screen.test.ts` | 改 | 顶栏演示开关的端到端用例（开关 / 记忆 / 工程件显隐） |

## 2. 关键设计决策

1. **唯一事实源落 core，而不是 world/visual-spec.ts**：
   方案 §1 写的是「常量集中在 `world/visual-spec.ts`」，但这份调色板有**两个消费者** ——
   战场侧（world，Phaser 数字色）与 HUD 侧（hud，CSS 变量）。按 §1 通信铁律「hud ↔ world 互不引用」，
   若事实源留在 world，hud 只能 import world（跨层违规）；若抄一份进 hud，则回到「两份真相」。
   **这正是 core/theme/skin-registry.ts 当年面对的同一处境、同一条解法**（皮肤徽标色 hud 与 world 都要用）——
   事实落两侧共用的 core，两侧各留一个门面：
   - 事实：`src/core/theme/visual-spec.ts`
   - world 门面：`src/world/visual-spec.ts`（方案点名的路径存在，world 各文件从 `../theme` 取色）
   - hud 门面：`src/hud/theme/visual-tokens.ts`（注入 CSS 变量）
   门面不同，事实只有一份；铁律零破例。

2. **调色板是「场景层」，与「皮肤层」正交**：
   `tokens-*.css`（8 套皮肤）是 chrome 配色（面板底色 / 边框 / 字色），换肤时整体换；
   调色板七色是场景语义色（背景 / 网格 / 单位 / 进度 / 完成 / 报错 / 装饰），只有一套。
   因此**不并进 8 份皮肤 CSS**（那等于把一份真相抄 8 遍），而是单列一层 `--srf-visual-*` 注入：
   单色皮肤（mono）也仍然需要场景语义色 —— 两层正交才说得通。

3. **字号放大写绝对 px，不写 calc**：
   字号 token（`--srf-font-size-*`）被 canvas 消费者直接读成 px 串用（`components/growth-chart.ts`），
   写成 `calc(11px * 1.3)` 会让 canvas 拿到非法 font 串。故演示模式把**放大后的绝对 px** 写进覆盖样式表：
   CSS 与 canvas 两侧都拿到合法值。基准字号从**当前生效的皮肤样式表源码**读出
   （`<style id="srf-theme-*">`），换肤后由 bus-adapter 调 `refreshTypography()` 重算 —— 放大是相对的。

4. **演示模式是纯本地展示态，不进总线**：
   不发 HudCommand、不改 `core/types.ts` 契约（§12：core/types.ts 只加不改 —— 本单连加都没有）。
   状态源是 hud 侧单例 `demoMode`（跨面板共享一份，避免「面板以为开着、顶栏以为关着」）。

5. **工程面板隐藏做成「机制」而非「逐个点名」**：
   HUD 面板是 Shadow DOM 组件，外层 CSS 选择器进不去 —— 故机制是：面板给工程件标
   `data-engineering`，由 `demoMode.filterEngineering(root)` 按开关隐藏/恢复。
   本单先接一处（日志抽屉：时间戳 / 来源 / 级别四列，典型的工程件），
   json 视图 / 原始 id / 时间戳列由后续任务按同一机制接线（标属性即可，无需改主屏）。

6. **离线态色不进调色板**：调色板七色都是语义色，离线是「非语义中性灰」——
   硬塞一个语义色会让「离线 = 报错色」这类误读成立，故中性灰留在 world 本地常量（已在代码注释写明）。

## 3. 验证

- `npx tsc --noEmit` → 0 错（无输出）
- `npx tsc -p tsconfig.test.json --noEmit` → 0 错（无输出）
- `npx jest src/hud src/core src/world --maxWorkers=1` → `Test Suites: 87 passed, 88 total`（唯一失败项
  `src/world/appearance/__tests__/brand-presets.test.ts` 为**改动前既有失败**：它读 `dist/frontend/spritesheets/item-metadata.json`，
  本 worktree 未 build frontend、`dist/` 不存在 —— 与本单无关）；`Tests: 1810 passed, 1810 total`
- `npx jest --maxWorkers=2`（全量）→ `Test Suites: 1 failed, 223 passed, 224 total / Tests: 4287 passed`（同一既有失败）
- `npx eslint --cache <改动文件>` → 本单新增/改动文件 **0 新增 lint 错误**
  （main-entry / main-screen / unit-layer 残留的 `import/order` 报错为**改动前既有**，本单未新增）

### 本单新增用例（35 例：core 10 + demo-mode 12 + visual-tokens 5 + world 3 + main-screen 4）

| 套件 | 断言要点 |
|---|---|
| `core/theme/__tests__/visual-spec.test.ts` | 七色逐字对齐 DEMO-PLAN §1；恰好七色；CSS 变量名不重复；`hexToNumber` 对非法输入抛错；`hexToRgba`；尺寸/时长/easing；演示参数 1.3 与键名；**扫描 src/world · src/hud · src/app 无调色板色值字面量**（色值只此一份） |
| `hud/theme/__tests__/demo-mode.test.ts` | 默认关；开写入 localStorage；重开记忆恢复；toggle 翻转发；订阅通知（重复设同值不通知）/ 退订；开启注入覆盖样式表且四档字号 ×1.3（11→14.3 / 12→15.6 / 14→18.2 / 16→20.8）；关闭撤表撤标记；换皮肤后 `refreshTypography` 按新基准重算；读不到基准字号则不注入；工程件过滤显隐与未标记节点不受影响 |
| `hud/theme/__tests__/visual-tokens.test.ts` | 七色各出一个 CSS 变量且与事实源同值；注入到 head 且带稳定 id；重复注入幂等；卸载闭包 |
| `world/__tests__/visual-spec.test.ts` | world 数字色与事实源一一对应；`world/theme.ts` 是取色入口；尺寸规范透出 |
| `hud/__tests__/main-screen.test.ts`（新增 4 例） | 默认关：日志抽屉在位、标签 off；点开：抽屉消失、标签 on、`<html data-demo-mode="on">`；状态写进 localStorage；再点一次恢复 |

## 4. 未尽事项（留给后续任务）

- json 视图 / 原始 id / 时间戳列 / 日志 tab 的**逐个面板接线**：机制已就绪（标 `data-engineering` 即可），
  由 §8 对应任务接线。
- HUD 密度下调、跑马灯 / 里程碑大字强制开启：属 §8「各视觉任务实现时同步声明自己在演示模式下的表现」。
- 音效包（task_083）的「演示模式默认开」开关位：等声音包落地时接同一 `demoMode` 单例。
- 字号放大目前只作用于 HUD（CSS 侧）；战场 canvas 内的文字（名字标签 / 气泡）字号不随开关变化 ——
  战场文字是 Phaser 侧独立体系，放大口径留给动画八态任务（task_075）统一处理。
