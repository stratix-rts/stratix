# task_155: 输入语义定稿：提示词默认 + / 前缀命令 + 任务标题 Agent 后置生成（154 收编迭代）

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_155.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

输入语义定稿：提示词默认 + / 前缀命令 + 任务标题 Agent 后置生成（154 收编迭代）

## requirements

1) 删除 composer 的输入模式启发式判定（>80字/含换行视为提示词那套）：非 `/` 开头的输入一律是用户提示词，回车直接发送发起任务，无任何前置标题输入/确认环节
2) `/` 开头进入命令模式（保留现有命令执行路径），非 `/` 开头永远不判为命令
3) 任务标题不再要求用户提供：发起时标题留空或占位（如「生成中…」），由 Agent 在第一轮工作回报时生成并回写（评估现有 task/mission 回报链与 checkpoint 机制，选最小改动路径让 worker 首轮产出标题回写任务记录）
4) 交互惯例参考主流 Agent 聊天框（Claude/ChatGPT/Cursor）：单框、默认发消息、`/` 触发命令
5) 154 建的「任务条内行内标题 chip 编辑」相应简化：发起流程中不再有标题编辑步骤

## acceptance

- [x] 非 `/` 开头普通文本回车直接发起任务且无标题确认步骤
- [x] `/` 开头才走命令路径，且既有已注册命令行为不受影响
- [x] 发起后任务列表/任务条标题初始为占位，并在 Agent 首轮回报后更新为生成值
- [x] typecheck 通过
- [x] hud 与 world 相关 jest 全绿
- [x] 浏览器默认打开路径（直开 7523，非 STRATIX_REMOTE 模式）全流程断言

## 交付物

1. **输入语义定稿（`src/hud/panels/command-panel.ts`）** —— 单框 · 默认发消息 · `/` 触发命令：
   - 删掉 task_154 的启发式判定（`PROMPT_TEXT_MIN_LENGTH` / `isPromptText`：>80 字或含换行才当提示词），
     唯一判据是 `isCommandInput(raw)` = `raw.trim().startsWith('/')`；
   - 非 `/` 开头 → 走 `launchTask(prompt)`：直接 `task.assign` + `createMission` 发起任务，
     **无标题输入、无确认弹窗、无「发起」按钮**；
   - `/` 开头 → 去掉 `/` 后走既有命令通路（词表与行为一字未改）；
   - 任务条改成**只读的在办任务条**（显示当前非终态任务单的标题 + 相位），
     154 建的行内标题 chip 与「发起」按钮整套删除（发起流程里没有标题编辑环节）；
   - 标题草稿（draft-store）改为 **composer 首行派生**（≤30 字，task_154 口径），
     且**只在提示词模式派生** —— 命令模式下派生会把输入原文塞进命令 hint，
     子序列匹配就永远自匹配（命令清单「怎么筛都剩一条」）。
2. **提示词直发的命令构造（`src/hud/panels/agent-catalog.ts`）** —— `buildLaunchTaskCommand(prompt, state)`：
   一条提示词 = 一条任务；承接人取 `recommendAssignees(state)[0]`（与新建任务对话框「派发」同一算法），
   顺带立一条任务单（`createMission: { unitId, brief.requirements }`），
   任务单标题留空 → core 侧填占位；无承接人 / 空提示词 / 无状态 → 返回 null（不发半截命令）。
3. **标题占位与回写（core）** ——
   - `src/core/types.ts`：`MISSION_TITLE_PENDING = '生成中…'`（发起时的占位标题）；
     `task.assign` 扩展可选 `createMission?: { title?, unitId?, brief? }`（标题可缺省）；
   - `src/core/mission/machine.ts`：`renameMission(current, title)`（纯函数；终态拒 / 空标题拒 / 同标题 changed=false）；
   - `src/core/mission/manager.ts`：`applyGeneratedTitle(missionId, title)` ——
     **只改占位标题**的独立写入面（别人给的标题不动；静默，不发 Notice）；
   - `src/core/runtime.ts`：`launchMissionId(command)` —— `task.assign` 带 `createMission` 时
     先立任务单（标题缺省 = 占位）→ `decideMission('accept')` → running，任务单 id 即回报链钥匙。
4. **标题回写走既有 worker 回报通道（app 层）** ——
   `src/app/services/task-service.ts`：`buildTaskPrompt(..., { askTitle })` + `TASK_TITLE_INSTRUCTION`，
   `extractGeneratedTaskTitle(output)`（首行口径，剥 markdown 前缀与「标题：」标记，≤30 字），
   deps 增 `missionTitle` / `onMissionTitle`；流式需含 `\n`，done 时 `final=true`，只写一次。
   - `src/app/main/main-entry.ts`：本地模式接线（`onMissionTitle` → `missionManager.applyGeneratedTitle`）；
   - `src/stratix-gateway/service/stratix-service.ts` + `task-execution.ts`：
     远程模式接线（**任务在 service 进程里跑 → 谁跑任务谁回写**，真相唯一）。
5. **面板重画口径（`src/hud/panels/command-catalog.ts`）** ——
   `renderSignature` 的任务单签名带上**标题**（`id:phase:title`），
   否则 Agent 首轮回报把占位换成生成值时任务条不会重画（只带相位看不见标题变化）；
   禁用原因改为「先在下方写一句任务指令」（发起本身已经不要标题了）。

## 验证证据（完成前必填）

- [x] **实现证明**: 见上方交付物（改动文件：`src/hud/panels/command-panel.ts`、
  `src/hud/panels/agent-catalog.ts`、`src/hud/panels/command-catalog.ts`、
  `src/core/types.ts`、`src/core/runtime.ts`、`src/core/mission/machine.ts`、
  `src/core/mission/manager.ts`、`src/app/services/task-service.ts`、
  `src/app/main/main-entry.ts`、`src/stratix-gateway/service/stratix-service.ts`、
  `src/stratix-gateway/service/task-execution.ts`）
- [x] **测试验证**: tsc 零错 + jest hud/world 1958 绿、core/app 1580 绿 + Playwright 32 条 e2e 绿（详见下方输出）
- [x] **影响范围**: 破坏式改动一处（输入面语义：非 `/` 开头一律是提示词）——
  连带更新了 `tests/e2e/command-line.spec.ts`、`command-palette.spec.ts`、
  `new-task-dialog.spec.ts`、`prompt-composer.spec.ts`、`task154-*.spec.ts` 的命令写法；
  既有命令**行为**零回归（help / mission / theme / settings / replay 照旧）。

### 测试步骤

1. `npx tsc --noEmit`
2. `npx jest src/hud src/world --maxWorkers=1`
3. `npx jest src/core src/app --maxWorkers=1`
4. `npx playwright test --config=tests/e2e/playwright.task155.config.ts`（task_155 新增 4 条，本地模式）
5. `npx playwright test --config=tests/e2e/playwright.task154.config.ts`（既有 154 回归）
6. `npx playwright test --config=tests/e2e/playwright.prompt-composer.config.ts`（task_144 + task_113 回归）
7. `npx playwright test --config=tests/e2e/playwright.command-palette.config.ts`（task_150 回归）
8. `npx playwright test --config=tests/e2e/playwright.new-task-dialog.config.ts`（task_112 回归）

### 验证结果

```
npx tsc --noEmit
（无输出 = 零错）

npx jest src/hud src/world --maxWorkers=1
Test Suites: 109 passed, 109 total
Tests:       1958 passed, 1958 total

npx jest src/core src/app --maxWorkers=1
Test Suites: 97 passed, 97 total
Tests:       1580 passed, 1580 total

npx playwright test --config=tests/e2e/playwright.task155.config.ts
  ✓ 底部只有一个输入面：标题框与行内 chip 都没了
  ✓ / 开头走命令路径：help / theme 照旧能执行
  ✓ 非 / 开头回车 → 直接发起任务，没有标题确认步骤
  ✓ 命令与提示词的分家是硬的：裸命令名（无 /）不再当命令
  4 passed

npx playwright test --config=tests/e2e/playwright.task154.config.ts
  5 passed（既有 154 回归）

npx playwright test --config=tests/e2e/playwright.prompt-composer.config.ts
  13 passed（task_144 composer + task_113 命令行，既有零回归）

npx playwright test --config=tests/e2e/playwright.command-palette.config.ts
  6 passed（task_150 回归）

npx playwright test --config=tests/e2e/playwright.new-task-dialog.config.ts
  4 passed（既有对话框 spec 已改走新入口）
```

截图（reports/shots/）：
- `task155-r11-bottom-single-input-ck155.png` —— 底部只有一个输入面（无标题框、无行内 chip）
- `task155-r11-taskbar-placeholder-ck155.png` —— 发起后任务条显示占位标题「生成中…」
