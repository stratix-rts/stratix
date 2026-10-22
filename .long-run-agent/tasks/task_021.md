# task_021

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_021.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: src/core/character 代码 + 测试

## 描述

core: AgentProfile 模型 + character.create 命令（名字/皮肤/persona/agent绑定/初始数值）+ WorldState.characters 扩展

## requirements

core 层新增 AgentProfile（agentKind 如 claude-code/codex/opencode/kimi/openclaw、displayName、skinId、persona、level=1、exp=0、externalSessionId?）。扩展 HudCommand 增加 character.create{name, agentKind, skinId, persona}，manager 校验（名字 trim 非空≤24 字、persona 走 persona.ts 既有校验）后落库。WorldState.characters 全量广播。仅 core，零渲染。

## design

放 src/core/character/（manager.ts 扩展或新 profile.ts）；类型进 types.ts（契约注释）。随机皮肤分配不在此任务（skinId 由调用方传入）。空 persona 时套默认模板。

## acceptance

- tsc 零错误
- character.test.ts 新增 create 用例（合法/非法名/空 persona 默认模板）全过
- 重复 create 同名返回错误 Notice
- jest src/core 全绿

## 交付物

- src/core/character 新增/修改文件
- src/core/types.ts 契约扩展
- src/core/__tests__/character.test.ts 新用例

## 验证证据（完成前必填）

- [x] **实现证明**: 简要说明如何实现
- [x] **测试验证**: 如何验证功能正常（测试步骤/截图/命令输出）
- [x] **影响范围**: 是否影响其他功能

### 实现说明

1. **契约（src/core/types.ts）**
   - 新增 `AgentKind` 词表（claude-code / codex / opencode / kimi / openclaw，来源 docs/AGENT-MATRIX.md）+ `AGENT_KINDS` 可枚举一份；
   - 新增 `AgentProfile` 模型（id / agentKind / displayName / skinId / persona / level / exp / externalSessionId?）；
   - `CharacterView` 扩展三个可选字段：`agentKind?` / `skinId?` / `externalSessionId?`（可选增补，不破既有构造点）；
   - 新增契约上限常量：`MAX_CHARACTER_NAME_LEN=24`（按 Unicode 码点）、`MAX_SKIN_ID_LEN=64`、
     `MAX_EXTERNAL_SESSION_ID_LEN=200`、`MAX_CHARACTERS=64`（characters 全量广播，必须有界）；
   - `HudCommand` 新增 `character.create{name, agentKind, skinId, persona?}`。

2. **纯函数面（src/core/character/profile.ts，新增）**
   - `createAgentProfile()`：名字 trim 非空且 ≤24 码点、agentKind 在词表内、skinId 非空、
     persona 走 persona.ts 既有校验（**空 → 套 `DEFAULT_PERSONA_TEMPLATE`**，非空 → trim 后写入）；
     被拒一律返回错误码，**不抛异常**；
   - `toAgentProfile()`：CharacterView → AgentProfile 的**投影**（状态里只有一份 persona/等级，不存第二份真相）；
   - `hasDuplicateCharacterName()`：同名判定（大小写不敏感）。
   - persona.ts 导出 `normalizePersonaPrompt()` 供建档复用 —— 建档与改写用**同一份**提示词合法性口径。

3. **写入面（src/core/character/manager.ts）**
   - 新增 `createCharacter()`：合法性 → profile.ts；**同名冲突**与**条数上限** → manager（要看状态）；
     判与写都发生在**同一次 setState** 内（与 grantExperience / updatePersona 同一口径）；
   - 失败一律转 Notice（source = 'core/character'）：同名冲突 = `error` 级，输入不合法 = `warn` 级；
     成功**不推** Notice（状态广播本身就是反馈）。

4. **接线（src/core/runtime.ts）**：`character.create` → `character.createCharacter(...)`；
   落库后由 runtime 的 store 订阅把整份 WorldState（含 characters）**全量广播**给 world/hud 两侧。
   零渲染依赖：未 import 任何 world / hud / phaser / vue。

### 测试验证

- `src/core/__tests__/character.test.ts` 新增三段用例（合法建档 / 非法名 / 空 persona 默认模板 / 重复同名 error Notice /
  未知 agent 种类 / 皮肤非法 / persona 超长 / 条数上限 / 投影 / 经总线闭环）。
- 命令输出见下。

### 影响范围

- 仅 core 层：`types.ts`（契约）、`character/`（profile / manager / persona / index）、`runtime.ts`（接线）、单测。
- 未触碰 `src/world` / `src/hud` / `src/app`；未引入新依赖。
- `CharacterView` 只做**可选字段**增补，既有构造点（hud 单测夹具 / world 适配器）编译不受影响。
- 契约新增常量与命令位不影响既有命令；`jest src/hud src/world` 全绿（343 passed）。

### 测试步骤
1. npm run typecheck
2. npx jest src/core --silent
3. 贴出输出

### 验证结果

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
（零输出 = 零错误）

$ npm run typecheck:tests
> tsc -p tsconfig.test.json --noEmit
（零输出 = 零错误）

$ npx jest src/core --silent
Test Suites: 12 passed, 12 total
Tests:       278 passed, 278 total
Snapshots:   0 total
Time:        3.995 s

$ npx jest src/core/__tests__/character.test.ts --silent
  createAgentProfile：建档合法性（纯函数）
  toAgentProfile：agent 视角投影（同一份真相，不另存一份）
  CharacterManager.createCharacter：建档落库
    ✓ character.create 走 manager 落库并广播新角色（@since v3.7 接线）
    ✓ character.create：空 persona 经总线也套默认模板
    ✓ character.create：重复同名经总线走 error Notice，characters 只有一份
    ✓ character.create：非法名经总线走 warn Notice，不落库
Test Suites: 1 passed, 1 total
Tests:       70 passed, 70 total

$ npx jest src/hud src/world --silent
Test Suites: 17 passed, 17 total
Tests:       343 passed, 343 total
```
