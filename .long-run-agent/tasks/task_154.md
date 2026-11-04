# task_154

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_154.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

添加agent可发现性：主界面一级入口+直达表单-模块

## requirements

1. **底部双框合一（破坏式授权，限 command-panel）**：删掉常驻的「任务标题」输入框 ——
   单 composer 打天下：短输入走命令模式（回车执行既有命令，行为零回归）；
   大段提示词（含换行 或 >80 字）→ composer 下方浮现**紧凑任务条**
   「将发起为任务 · 标题：[首行截断·行内可编辑] · [发起] [取消]」；
   标题自动取首行（≤30 字），行内 chip 编辑取代第二个框；draft-store 语义保持（两面板说同一句话）。
2. **新建角色一级入口**：顶栏加显式「+ 角色」按钮（图标 + 文字，走既有 icon 体系），
   点击直达既有建档表单 / 流程（与战场空态 CTA / ⌘K「新建角色」同一条路）；空态 CTA 同路径。
3. **上场确认**：新建保存 → ≤5s 单位走上战场（153 已通同步）→ 轻提示「已上场」（走 toast）。
4. **表单验证**：必填项缺失时禁用提交 + 给原因（148 的死按钮语言）。
5. 回归红线：不动 153 同步装配与 world-sync 词表；不动 145 渲染 / 146 堆叠 / 147 token；
   不动 gateway/；零新依赖；不动 HEARTBEAT.md / .long-run-agent（除本文件）/ reports/（截图除外）。

## acceptance

- [x] 底部仅一个输入框（前后对照截图）；长文本 → 任务条浮现 → 行内改标题 → 发起（playwright 全流断言）
- [x] 短命令零回归（既有命令测试绿：command-line / prompt-composer e2e 13 条 + jest 全量）
- [x] 顶栏「+ 角色」可见且直达创建表单；空态 / ⌘K 同路径
- [x] 全流程「点按钮 → 填表 → 保存 → 上场 → toast」playwright 断言 + 截图（测试角色「十一测-」前缀，测完删）
- [x] `npx tsc --noEmit` 零错 + `npx jest src/hud` 全绿
- [x] 截图 `-r11` 前缀加 `-ck154` 后缀

## 交付物

1. **底部双框合一（command-panel）** —— 删掉常驻的「任务标题」输入框，单 composer 打天下：
   - 输入被判定为**大段提示词**（含换行 或 >80 字）→ composer 下方浮现**紧凑任务条**：
     `将发起为任务 · 标题：[首行截断·行内可编辑] · [发起] [取消]`；
   - 标题自动取提示词首行（≤30 字），行内 chip 编辑取代第二个输入框；
   - 标题为空 → 「发起」禁用并给出原因（task_148 的死按钮语言）；
   - draft-store 语义保持：任务条上的标题就是那份共享草稿（⌘K 面板读的是同一句）。
2. **新建角色一级入口** —— 顶栏加显式「+ 角色」按钮（图标 + 文字，走既有 icon 体系），
   点击直达**既有建档向导**（与战场空态 CTA / ⌘K「新建角色」同一条路，一处口径）。
   为此 `onboarding-host.reopen()` 增加 `force` 档：用户**主动**建档时不再受「已有角色」
   这道首启门槛约束（否则只要建过一个角色，入口就成死路），但仍要求「探到可建档的 agent」。
3. **上场确认** —— 建档完成 → core 同一次广播里投影出战场单位（task_153 已通）→ toast「已上场」。
4. **表单验证** —— 向导起名 / 确认步必填项缺失时，页脚主按钮**禁用**并显示原因。

## 验证证据（完成前必填）

- [x] **实现证明**: 见上方交付物（改动文件：`src/hud/panels/command-panel.ts`、
  `src/hud/screens/main-screen.ts`、`src/hud/screens/onboarding-screen.ts`、
  `src/app/main/main-entry.ts`、`src/app/main/onboarding-host.ts`、
  `src/core/theme/visual-spec.ts`）
- [x] **测试验证**: tsc 零错 + jest 全量绿 + Playwright 6 条 e2e 绿（详见下方输出）
- [x] **影响范围**: 破坏式改动一处（常驻「任务标题」框删除）—— 连带更新了
  `tests/e2e/new-task-dialog.spec.ts` 与相关单测；其余既有命令行为零回归。

### 测试步骤
1. `npx tsc --noEmit`
2. `npx jest --silent --maxWorkers=2`（全量）
3. `npx playwright test --config=tests/e2e/playwright.task154.config.ts`（task_154 新增 6 条）
4. `npx playwright test --config=tests/e2e/playwright.prompt-composer.config.ts`（既有命令回归）
5. `npx playwright test --config=tests/e2e/playwright.new-task-dialog.config.ts`（既有对话框回归）

### 验证结果

```
npx tsc --noEmit
（无输出 = 零错）

npx jest --silent --maxWorkers=2
Test Suites: 294 passed, 294 total
Tests:       6 skipped, 5365 passed, 5371 total

npx playwright test --config=tests/e2e/playwright.task154.config.ts
  ✓ 底部双框合一（task_154） › 底部只有一个输入框：常驻标题框已删（前后对照截图）
  ✓ 底部双框合一（task_154） › 大段提示词 → 任务条浮现 → 行内改标题 → 「发起」带着改过的标题开对话框
  ✓ 底部双框合一（task_154） › 标题为空 → 「发起」禁用并给出原因
  ✓ 底部双框合一（task_154） › 短命令零回归：help / mission / theme 照旧能执行
  ✓ 新建角色一级入口（task_154） › 顶栏「+ 角色」可见 → 点它直达建档表单（向导，不是角色中心死路）
  ✓ 新建角色一级入口（task_154） › 全流程：点按钮 → 填表 → 保存 → 上场（≤5s）→ toast「已上场」，测完删掉
  6 passed

npx playwright test --config=tests/e2e/playwright.prompt-composer.config.ts
  13 passed（task_144 composer + task_113 命令行，既有零回归）

npx playwright test --config=tests/e2e/playwright.new-task-dialog.config.ts
  4 passed（既有对话框 spec 已改走新入口）
```

截图（reports/shots/）：
- `task154-r11-bottom-single-input-ck154.png` —— 底部只有一个输入框（对照）
- `task154-r11-bottom-taskbar-ck154.png` —— 大段提示词 → 任务条浮现（行内改标题）
- `task154-r11-topbar-create-character-ck154.png` —— 顶栏「+ 角色」→ 建档向导
- `task154-r11-character-onboarded-ck154.png` —— 建档完成 → toast「已上场」+ 角色卡
