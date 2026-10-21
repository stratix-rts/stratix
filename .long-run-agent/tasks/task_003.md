# task_003

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_003.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3骨架: core/ 总线契约与状态机-模块

## 交付物

新增 `src/core/`（纯 TS、零渲染依赖、jest 可测），无任何旧文件改动：

| 文件 | 职责 |
|------|------|
| `src/core/types.ts` | 总线契约唯一事实源（§5 草案）：`WorldState` / `HudCommand` / `WorldEvent` + 支撑类型（Point/Bounds/ClickMods/UnitView/MissionView/SelectionState/CharacterView/Notice/ConfirmDecision/ScreenId）+ 冻结常量（NOTICE_TTL_MS、MAX_NOTICES、MAX_SELECTION_SIZE）。零 import、零 any |
| `src/core/store.ts` | 极简响应式 store，67 行（<100 行红线）：`getState` / `setState` / `patch` / `subscribe`（返回退订函数）/ `pushNotice`（过期剔除 + 上限截断）；导出单例 `worldStore` |
| `src/core/bus.ts` | 项目已有 `mitt` 的封装：三条带类型通道 `command`(hud→core) / `world`(world→core) / `state`(core→两侧)，`on*` 一律返回退订函数，`resetBus()` 供测试隔离 |
| `src/core/unit/selection.ts` | 从 `stratix-rts/managers/SelectionManager` 抽取的**纯选择状态机**（去 Zone 分支，D5）：set/add/remove/toggle/clear/all/invert/reconcile/preview，返回新态 + added/removed 增量 + changed 标记，revision 仅在实质变化时 +1 |
| `src/core/unit/group.ts` | 编组语义：**编组 = 当前多选集合**（无持久化编队）：`toGroup` / `isSameGroup` / `isEmptyGroup` |
| `src/core/unit/index.ts` | 单元格出口 |
| `src/core/__tests__/{selection,group,store}.test.ts` | 51 条单测，覆盖选择状态机全路径 + 编组 + store/总线 |

## 验证证据（完成前必填）

- [x] **实现证明**: 契约文件零 import/零 any；store 自建不引状态库（67 行）；bus 只封装既有 mitt；选择逻辑为纯函数，从旧 SelectionManager 抽取时剔除 Zone 分支与 rxjs/Phaser 依赖，形状类型在 core 内自定义（Point/Bounds）
- [x] **测试验证**: typecheck / build / jest 三项全绿（见下方命令输出）
- [x] **影响范围**: 纯新增目录 `src/core/`，无任何旧代码引用它 → 对现有功能零影响；旧 stratix-rts 选择代码保持可运行（legacy 清理属后续任务）

### 测试步骤
1. `npm run typecheck`（tsc --noEmit）
2. `npm run build`（tsc + tsc-alias + vite build）
3. `npx jest src/core --passWithNoTests`
4. 附加：`npx eslint --cache src/core`（只 lint 改动文件）

### 验收自检
| 项 | 结果 |
|----|------|
| typecheck 通过 | ✅ 无输出 |
| build 通过 | ✅ `✓ built in 2m 39s` |
| core 单测全绿 | ✅ 3 suites / 51 tests passed |
| types.ts 零 any | ✅（唯一命中是契约注释里"禁止 any"那一行） |
| core/ 零渲染依赖 | ✅ 仅 import `mitt` + 本地 types |

### 验证结果

```
> stratix@0.1.0 typecheck
> tsc --noEmit
（无错误输出）

> jest src/core
Test Suites: 3 passed, 3 total
Tests:       51 passed, 51 total
Snapshots:   0 total

> vite build（npm run build）
✓ built in 2m 39s

> npx eslint --cache src/core
（0 problems）
```