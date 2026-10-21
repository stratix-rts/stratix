# task_015

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_015.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

V3屏: character-screen角色屏-模块

## requirements

角色屏 + 角色域数值逻辑，**core 持真相、HUD 只渲染**，不引入自建养成体系：

1. **数值层（src/core/character/growth.ts，纯函数、零渲染依赖）**：`level/experience/addExperience` 语义
   **提炼**自 `src/stratix-character-creator/core/SharedSkillStore.ts`（**只读参考，不搬运实现**）：
   - 每 `EXP_PER_LEVEL` 点经验升 1 级、等级封顶 `MAX_LEVEL`、经验只增不减且**封顶后仍继续累计**；
   - 等级是**派生量**：`level ≡ levelForExperience(experience)`，入参自相矛盾即在下次写入时对账
     （避免「level=5 / exp=10」这种档案长期留在状态里）；
   - 非法增量（0 / 负数 / NaN / Infinity）**不抛异常**（命令总线同步，抛异常会打断整轮广播），
     返回 `error` 机器码由上层转 Notice；
   - 入参 immutable，返回新对象。
2. **写入面（src/core/character/manager.ts）**：`grantExperience` 在**同一次 `setState`** 内查找→判定→投影进
   `WorldState.characters`（不先 `getState` 再 `setState`：两次读之间的并发写入会被陈旧快照整段覆盖）；
   被拒时 updater 原样返回当前引用，store「引用未变即不广播」约定自动生效；失败转 Notice（source = `core/character`）。
   manager **不自己订阅总线、不自己发 HudCommand**（铁律：只有 hud → core）。
3. **派生层（src/hud/screens/character-catalog.ts，纯逻辑、零 DOM）**：`WorldState → CharacterScreenModel`：
   - focus = **恰好单选 1 个单位**且该单位 `characterId` 命中 `characters` 时才有（未关联/悬空一律 null，
     不拿别的角色顶上）；刻意不用 `previewUnitIds`（框选拖拽中集合，松手即归零）；
   - links = 按当前选择集逐个解析，**未关联的单位照样在列**（「哪些人还没角色」正是这屏要回答的问题）；
   - cards = `WorldState.characters` 的养成总览，**渲染有上限**（`MAX_CHARACTER_CARDS`）+ 如实报溢出数
     （perf 硬约束：派生数据必须有界）。
4. **屏幕（src/hud/screens/character-screen.ts）**：`<strat-character-screen>` Web Component，Shadow DOM，
   视觉全走 `--srf-*` token；**唯一命令出口是 `ui.navigate`**（main / chat）—— 展示屏不该能改角色数值；
   用户数据（角色名 / persona）一律 `escapeHtml`。
5. **成长阈值不复制**：`character-catalog` 直接 import `core/character/growth` 的纯函数与常量渲染进度条，
   **不另抄一份** `EXP_PER_LEVEL` / `MAX_LEVEL`（两处必然漂移）。
6. **经验增长钩子（事件驱动占位）**：靠前后两帧快照的**经验差**观测到增长后 a) 给经验条加 `.pulse`
   （`EXP_PULSE_MS` 后自动摘）；b) 派发冒泡 DOM 事件 `character-exp-gained`，detail = `{characterId, gained, levelUps}`。
   why 是「钩子」不是动效本体：像素级动画要 canvas / 精灵上下文，那是 world 层的活。
   首次渲染不算增长（挂载瞬间全体「涨经验」是假的）；**定时器与订阅必须可清理**（disconnectedCallback 退订 + 清 timer）。
7. **挂载留空**：本屏只提供 `mountCharacterScreen` 工厂，**不做 main-screen 挂载**（由 task_019 统一接线，
   见文件末 `TODO(v3.task_016)`）—— 避免两个任务同时改同一处壳。
8. **硬约束**：不引入新依赖；不动既有 panels / screens 实现；不碰 `src/world`、`src/stratix-character-creator` 本体；
   不 mock 数据；core 零渲染依赖；每个新文件头部写契约注释（含**为什么**这么写，不是复述代码）。

## acceptance

- [x] **经验/升级数值逻辑单测全绿（边界覆盖）**：`src/core/__tests__/character.test.ts` 24 例 ——
      恰好升级（99 不升 / 100 立刻升）、连升（一次 +250 从 Lv.1 跨到 Lv.3，levelUps=2）、封顶后经验照常累计、
      脏数据（NaN / 负数 / Infinity）不产出 NaN 级且不传播、等级对账（levelUps 为负）、
      非法增量拒发且原样返回入参引用、immutable
- [x] **角色屏与 `WorldState.characters` 联动有测试**：`src/hud/__tests__/character-screen.test.ts` 29 例 ——
      **单选单位显示角色详情**（验收项）、单选未关联明说未关联、编组逐行列出单位↔角色（未关联的标注并计入 unboundUnits）、
      core 广播后重渲染（改名 / 升级 / 满级）、用户数据转义不产生 DOM 注入、渲染判重、
      经验增长钩子（事件 detail / 高亮定时器到期 / 首帧不算增长 / 卸载退订清 timer）
- [x] **typecheck/build 全绿**：`npm run typecheck` / `npm run typecheck:tests` / `npm run build` 全部 exit 0
- [x] **全量回归不劣化**：`npx jest --maxWorkers=1` → 142 套件 / 3408 用例全绿

## 交付物

| 文件 | 职责 |
|------|------|
| `src/core/character/growth.ts` | 角色成长数值**纯函数**：`EXP_PER_LEVEL` / `MAX_LEVEL` / `levelForExperience` / `experienceIntoLevel` / `experienceToNextLevel` / `isMaxLevel` / `grantExperience`。语义提炼自 `src/stratix-character-creator/core/SharedSkillStore.ts`（只读，未搬运实现） |
| `src/core/character/manager.ts` | 角色域**唯一写入面**：`grantExperience` 在一次 `setState` 内查找→判定→投影进 `WorldState.characters`，失败转 Notice（source = `core/character`） |
| `src/core/character/index.ts` | 域出口（上层只认这一个文件） |
| `src/hud/screens/character-catalog.ts` | 角色屏视图模型派生（纯逻辑、零 DOM）：`resolveCharacterModel` / `resolveGrowth` / `characterSignature` / `MAX_CHARACTER_CARDS` / `MAX_CHARACTER_LINKS` |
| `src/hud/screens/character-screen.ts` | `<strat-character-screen>` Web Component：单选单位角色详情 + 编组单位↔角色关联 + 角色养成总览；经验增长钩子 `character-exp-gained` + `.pulse` 高亮 |
| `src/core/__tests__/character.test.ts` | 成长数值状态机 + store 投影 + 总线闭环单测 |
| `src/hud/__tests__/character-screen.test.ts` | 角色屏渲染 / 与 `WorldState.characters` 联动 / 增长钩子 / 转义 / 定时器清理 jsdom 集成测试 |

**未做（有意留空）**：`persona.ts`（`character.persona.update` 命令尚未在 `core/runtime.ts` 接线，落一个写入面只会得到"调了没反应"的函数）；
本屏**尚未挂载** main-screen（`TODO(v3.task_016)` / 任务书指派 task_019 统一接线，见文件末注释）。

## 验证证据（完成前必填）

- [x] **实现证明**:
  - 数值裁决**只在 core 一处**（`growth.ts` 纯函数）：等级恒等于 `levelForExperience(experience)`（派生量），
    一次加经验返回 `{ next, changed, gained, levelUps, error }`；HUD 的 `character-catalog` 直接 import 这些
    纯函数与常量渲染进度条阈值，**不另抄一份**（两处必然漂移）。
  - 写入面**只认 manager**：`grantExperience` 在同一次 `setState` 内读改写（不先 `getState` 再 `setState`，
    避免陈旧快照覆盖别的域的并发写入）；被拒时 updater 原样返回当前引用，store「引用未变即不广播」约定自动生效。
  - 角色屏**纯展示**：交互只发 `ui.navigate`（main / chat），改数值一律经 core 广播回来重渲染。
- [x] **测试验证**: 见下方命令输出（新增 53 个用例全绿；全量 142 套件 / 3408 用例全绿；typecheck / typecheck:tests / build 全绿）
- [x] **影响范围**: 无外溢。全部为新增文件，未修改任何既有 panels / screens / world / `stratix-character-creator`；
  未引入新依赖；`src/core/types.ts`、`src/core/store.ts` 本任务**无需改动**（`CharacterView` / `characters` 此前已有）。

### 测试步骤
1. `npx jest src/core/__tests__/character.test.ts src/hud/__tests__/character-screen.test.ts --maxWorkers=1` — 角色域与角色屏专项
2. `npm run typecheck && npm run typecheck:tests` — 类型检查
3. `npm run build` — backend(tsc+tsc-alias) + frontend(vite build)
4. `npx jest --maxWorkers=1` — 全量回归

### 验证结果

**专项测试（53 passed）** — 边界覆盖摘录：

```
✓ 恰好卡在阈值下方不升级：99 经验仍是 1 级
✓ 恰好卡在阈值上立刻升级：100 经验 = 2 级
✓ 一个阈值区间内等级恒定（199 经验还是 2 级）
✓ 恰好升级：加满到 100 的那一刻升 1 级
✓ 差 1 点不升级（边界另一侧）：99 → 99 仍是 1 级
✓ 连升：一次加 250 从 1 级跨到 3 级（levelUps = 2）
✓ 等级封顶：远超阈值也停在 MAX_LEVEL（经验继续累计是另一件事）
✓ 等级是派生量：入参 level 与 experience 自相矛盾时被对账（levelUps 为负）
✓ 满级：距下一级为 null（"已满级"，而不是"还差 0"）
✓ 单选单位 → 详情位显示它的角色（验收：单选显示角色详情）
✓ core 广播新状态 → 本屏重渲染（角色改名/升级都跟着变）
✓ 单选但未关联角色 → 明说未关联，不显示别人的角色
✓ 经验经 core 写入上涨 → 派发 character-exp-gained（detail 含涨幅与升了几级）
✓ 卸载即退订 + 清高亮定时器（不留在全局跑）
✓ 用户数据（角色名 / 提示词）按文本渲染，不产生 DOM 注入

Test Suites: 2 passed, 2 total
Tests:       53 passed, 53 total
```

**typecheck / typecheck:tests**：

```
> stratix@0.1.0 typecheck
> tsc --noEmit
（无输出 = 通过）

> stratix@0.1.0 typecheck:tests
> tsc -p tsconfig.test.json --noEmit
（无输出 = 通过）
```

**build**：

```
> stratix@0.1.0 build
> npm run build:backend && npm run build:frontend
...
✓ built in 2m 27s
（无 error）
```

**全量回归**：

```
Test Suites: 142 passed, 142 total
Tests:       7 skipped, 3408 passed, 3415 total
Snapshots:   0 total
Time:        42.957 s
Ran all test suites.
```

**lint（仅本任务文件）**：

```
✖ 2 problems (0 errors, 2 warnings)
  两个 warning 均为「测试文件命中 eslint ignore 规则」，是仓库既有约定，非本任务问题
```