# task_006

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_006.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3骨架: HelloLoop联调验收-模块

## requirements

打通 Phase 1 收官的完整闭环：HUD 按钮 → HudCommand → core → WorldState 变更 → world 场景响应。

1. 联调入口：`src/app/dev/hello-loop.html` + `hello-loop-entry.ts`，同屏挂 hud 的 main-screen（含 strat-button）
   与 world 的 BattlefieldScene（各自容器）；入口是唯一允许同时 import hud/ 与 world/ 的组合根。
2. 闭环链路选定为 `unit.select`：HUD 按钮 → core 选择状态机 → WorldState.selection → world 桥接层 → 单位高亮；
   反向（战场点击 → unit.click → core → HUD 显示）一并打通。
3. Phase 1 三件套（types / bus / store+unit）之间原本没有接线，新增 `src/core/runtime.ts` 作为唯一的
   「command/world → 状态机 → store → state 广播」接线；core 仍零渲染依赖。
4. 总线铁律不变：hud ↔ world 互不引用，两侧只经 core/bus 通信；未落地的命令/事件转交 `onUnhandled`，不静默吞掉。
5. 集成测试用真实 store / bus / adapter / 组件（jsdom），只有 Phaser 场景本体是替身，断言打在
   `WorldScenePort` 这一层（任务允许：可对 adapter 层断言，无需真渲染像素）。
6. 每个新文件头部写契约注释；不引入新依赖；不 mock 数据。

## acceptance

- [x] hello loop 闭环跑通：真实 Chromium 实测，正反向都生效（截图见验证结果）
- [x] 集成测试 `src/app/__tests__/hello-loop.test.ts`（jsdom，真实 store/bus/adapter/组件）10 例全绿
- [x] `npx tsc --noEmit` / `tsc -p tsconfig.test.json --noEmit` / `npm run build` 全部 exit 0
- [x] core/world/hud/app 测试全绿：142 passed（基线 121 + 新增 21）
- [x] 架构扫描：`src/hud` 零 phaser/world 引用、`src/world` 零 hud/vue 引用、`src/core` 零渲染依赖
- [x] eslint 改动文件零 error；不引入新依赖（package.json 未改）
- [x] 不改动 core/world/hud 已有实现结构（唯一例外是 store 的一个 bug 修复，见"验证结果"）

## 交付物

新增：

- `src/core/runtime.ts` —— core 运行时（闭环接线：命令/事件 → 选择状态机 → store → state 广播）
- `src/core/__tests__/runtime.test.ts` —— runtime 单测（真实 bus + 真实 store，9 例）
- `src/app/README.md` —— 组合根模块说明（≤20 行）
- `src/app/dev/hello-loop.html` + `hello-loop-entry.ts` —— dev-only 联调入口（HUD 主屏 + Phaser 战场同屏）
- `src/app/dev/hello-loop-panel.ts` —— HUD 侧操作面板（真实 strat-button 发 unit.select + 状态回读，入口与测试共用）
- `src/app/dev/global.d.ts` —— `*.css?inline` 环境声明
- `src/app/__tests__/hello-loop.test.ts` —— 全闭环集成测试（jsdom）

修改（最小 bug 修复）：

- `src/core/store.ts` —— `setState` 的更新函数原样返回当前态时不再广播（见"验证结果"）
- `src/core/__tests__/store.test.ts` —— 补该行为的回归用例

## 验证证据（完成前必填）

### 实现证明

- `src/core/runtime.ts`：唯一的闭环接线。`start()` 三件事 —— `store.subscribe(emitState)`（core → 两层唯一出口）、
  `onCommand(handleCommand)`、`onWorldEvent(handleWorldEvent)`；返回 stop 闭包，重复 start 不叠加订阅。
- 命令侧：`unit.select` 的 `mode`（set/toggle）与选择状态机动作同名，直接映射；
  事件侧：`unit.click` 按 Shift/Ctrl/⌘ 判定 set 还是 toggle（RTS 惯例）。
- 「应用动作 + 与已知单位对账」合并在**同一次** `setState` 里 —— 一次用户操作只广播一次，且选择集里不留悬空 id。
- `src/app/dev/` 是唯一同时 import hud/ 与 world/ 的地方；入口里没有一处 hud ↔ world 的直接调用。
- dev 入口另做了镜头摆位（`frameDemoView`）：单位从战场左上角落位而开局机位在战场正中，
  不摆位则点亮的单位在画面外。已在代码里标注 TODO(v3.Phase2) 交回 world 侧收口。

### 测试验证

```
$ npx jest src/core src/world src/hud src/app --maxWorkers=2
Test Suites: 10 passed, 10 total
Tests:       142 passed, 142 total
```

集成测试（真实 store / 真实 bus / 真实 hud adapter / 真实 main-screen / 真实 strat-button 的 shadow DOM 点击 /
真实 world 桥接层 / 真实 UnitRegistry；只有 Phaser 场景本体是替身）：

```
PASS src/app/__tests__/hello-loop.test.ts
  HUD → core → world：Phase 1 选定的闭环链路
    ✓ HUD 按钮 unit.select → core 状态机 → WorldState → world 场景高亮
    ✓ HUD 侧 main-screen 的单元计数来自真实广播
  world → core → HUD：反向那一半
    ✓ 战场点击单位 → WorldEvent → core 选择状态机 → HUD 显示选中
    ✓ 带 Shift 的战场点击是加选，与 HUD 的 toggle 语义一致
    ✓ 点不存在的单位不会在战场上留下悬空高亮
  往返与清理
    ✓ HUD 选中 → 战场点击 → HUD 再选中，三段交替仍保持单一真相
    ✓ 清空按钮把选择集与场景高亮一起清掉
    ✓ unmount 后命令与状态都不再流动（监听器全部退订）
  尚未落地的命令：走对上总线，不静默吞掉
    ✓ main-screen 的切皮肤按钮：本地落皮肤 + 命令进总线等 Phase 2 接手
```

### 影响范围

- 新增 `src/app/`（此前不存在，本次建组合根）、`src/core/runtime.ts`
- 修改 `src/core/store.ts`（1 处 bug 修复，全仓仅 world dev 入口与 v3 测试用到，无 legacy 依赖）
- 未改动 src/world、src/hud 任何已有文件；未改 package.json / vite.config.ts
- dev 入口不进生产 bundle（vite build 只构建根 index.html，grep `app/dev` 在 src 内 0 命中）

### 测试步骤

1. `npx tsc --noEmit` —— exit 0
2. `npx tsc -p tsconfig.test.json --noEmit` —— exit 0
3. `npx jest src/core src/world src/hud src/app --maxWorkers=2` —— 142 passed
4. `npm run build` —— exit 0（backend tsc + vite build）
5. `npx vite --port 5199` 后开 `/src/app/dev/hello-loop.html` —— 真实 Chromium 实测（正反向闭环 + 截图）

### 验证结果

```
$ npx tsc --noEmit
EXIT=0
$ npx tsc -p tsconfig.test.json --noEmit
EXIT=0
$ npm run build
✓ 1767 modules transformed.
✓ built in 2m 8s
EXIT=0
$ npx jest src/core src/world src/hud src/app --maxWorkers=2
Test Suites: 10 passed, 10 total
Tests:       142 passed, 142 total
$ npx eslint --cache src/core/runtime.ts src/core/store.ts src/app
EXIT=0
```

真实 Chromium 跑 hello-loop.html（一次性脚本，不入库）：

```
=== 正向（HUD 按钮 → core → 战场高亮）===
{ "hudPanelStateLine": "state: 单位 4 · 选择 [u-trinity] · revision 1",
  "hudMainUnitCount": "4",
  "coreState": { "unitIds": ["u-trinity"], "previewUnitIds": [], "revision": 1 },
  "sceneRegistryUnits": ["u-neo","u-trinity","u-morpheus","u-cipher"],
  "sceneSelected": ["u-trinity"] }          ← 场景 UnitLayer 的选中集合真的变了

=== 反向（战场点击 → core → HUD）===
{ "hudPanelStateLine": "state: 单位 4 · 选择 [u-morpheus] · revision 2",
  "coreState": { "unitIds": ["u-morpheus"], "previewUnitIds": [], "revision": 2 },
  "sceneSelected": ["u-morpheus"] }

=== 页面错误 ===
（无）
```

截图确认：战场 4 个单位可见，被选中的单位带白色选择环，HUD 状态行与闭环日志同步刷新。

铁律扫描：

```
$ grep -rnE "from ['\"][^'\"]*(phaser|/world/|src/world)" src/hud --include="*.ts"
0 行 ✅
$ grep -rnE "from ['\"][^'\"]*(/hud/|src/hud|vue|stratix-rts|stratix-project)" src/world --include="*.ts"
0 行 ✅
$ grep -rnE "document\.|window\.|canvas|Phaser" src/core --include="*.ts" | grep -v 注释
0 行 ✅（src/core 的 import 全集只有 mitt + 相对路径）
$ 同时 import hud/ 与 world/ 的文件
  src/app/__tests__/hello-loop.test.ts
  src/app/dev/hello-loop-entry.ts        ← 只有组合根及其测试，hud ↔ world 零直接调用
```

### 发现并修复的既有 bug

`src/core/store.ts` 的 `setState` 无论更新函数是否真的改变了状态都会广播。
状态机算"没变"时 updater 会原样返回当前引用（core/unit/selection.ts 的 `unchanged()`），
按原实现仍会通知订阅者 → 一次无效点击也会把新快照推给 world/hud 并触发两侧重渲染，
且与 `SelectionState.revision`（实质变化才递增）的语义矛盾。
最小修复：updater 原样返回当前态时直接返回、不进 `notify`，并补回归用例。

### 未尽事项（留给后续任务）

1. TODO(v3.Phase2)：首批单位自动入镜 —— 单位从战场左上角落位、开局机位在战场正中，
   dev 入口用 `frameDemoView` 摆位绕过；正解应由 world 侧收口（落位起点与开局机位对齐，或聚焦首批单位）。
2. TODO(v3.Phase2)：core runtime 的 `mission.*` / `chat.send` / `ui.navigate` / `theme.set` 记账形态；
   `selection.box` 需要补 "world 侧已算出 id 再回传" 的通道（core 不持有坐标，算不出命中）。
3. `src/world/dev/main.ts` 里还留着 `worldStore.subscribe(emitState)` 的临时接线，
   等应用根（src/app 正式入口，Phase 3）用 `createCoreRuntime` 统一接线后删掉那段即可。
4. src/core、src/world 缺 README（验收标准第 8 条），本次只补了新建的 src/app/README.md。