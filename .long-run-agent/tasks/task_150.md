# task_150

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_150.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 请在项目根目录或适当子目录创建交付物

**这是配置文件**，不是最终产出！

## 描述

惊喜：⌘K命令面板——全应用键盘可达-模块

## requirements

1. **命令注册表**（`hud/lib/command-registry.ts`）：命令 = {id, 标题, 别名[], 分组, 动作, 可用性判定,
   快捷提示}；**收编既有五条命令 + 中文别名**（composer 改读注册表 —— 零行为回归）
   + **全应用动作**（新建角色 / 切皮肤（现代·像素）/ 开设置 / 开日志抽屉 / 开态势屏 / 示例会话 /
   派发任务直达 / 清空草稿……逐个 grep 各面板公开入口登记），**目标 ≥15 条**。
2. **⌘K 面板**：⌘K / Ctrl+K 全局唤起（输入态也生效）；浮层居中偏上，层级走 146 的堆叠秩序（modal 档）
   + 138 的动效 token；模糊匹配（标题/别名子序列即可，不用拼音库）；↑↓ 选 + Enter 执行 + Esc 关闭
   （沿用 146 的 ESC 栈顶语义）；分组标题；不可用命令灰态 + 原因（沿用 148 的死按钮语言）；
   最近使用置顶（localStorage，5 条上限）。
3. **键盘优先细节**：打开即聚焦搜索框；执行后焦点回原位（原位可聚焦才回）；Tab 不逃逸（focus trap）。
4. 双皮肤 token 适配 + reduced-motion（无动效则直接出现）。

## acceptance

- [x] ⌘K 唤起 → 输两字 → 模糊命中 → Enter 执行，**全程无鼠标**（playwright 键位序列断言 + 截图）
- [x] **≥15 条命令注册**；底栏 composer 的五命令 + 中文别名零回归（既有测试全绿）
- [x] 不可用命令灰态 + 原因（如 0 角色时的「派发任务」）
- [x] ESC 栈语义不破坏 146（栈顶先关：面板开在对话框之上 → 先关面板，对话框后关）
- [x] 最近使用置顶生效（localStorage，5 条封顶）
- [x] `npx tsc --noEmit` + 相关 jest 绿
- [x] 截图 `-r9` 前缀 + `-ck` 后缀（双皮肤）

## 交付物

### 1. 共享命令注册表（一份事实源）

- `src/hud/lib/command-registry.ts`（新）：**19 条**全应用命令
  （id / 标题 / 别名 / 分组 / 动作 / 可用性判定 / 快捷提示）+ 模糊匹配 + 分组 + 最近使用排序。
  纯逻辑：零 DOM、零 IO、零总线依赖（node 环境可直测）。
  - 收编 task_113 的五条 CLI 词表（mission / theme / settings / replay / help + 中文别名）——
    `src/hud/panels/command-registry.ts` 的 `CLI_COMMANDS` 改为**从注册表派生**（零行为回归）。
  - 收编全应用动作：新建任务 / 确认 / 停止 / 派发 / 清草稿 / 打开角色 / 新建角色 / 打开聊天 /
    示例会话 / 打开设置 / 打开态势屏 / 打开日志抽屉 / 回放今天 / 取消选择 / 现代·像素·切换皮肤 /
    命令帮助 / 快捷键帮助。
- `src/hud/lib/app-actions.ts`（新）：不落总线契约的宿主动作登记口（抽屉 / 向导 / 回放 / 清草稿）
  —— 有登记才算「可用」，没人接就是一句人话（不假装成功）。
- `src/hud/lib/recent-commands.ts`（新）：最近使用（localStorage，**上限 5 条**）。
- `src/hud/lib/draft-store.ts`（新）：底栏 composer 与 ⌘K 面板共用的任务标题草稿。

### 2. ⌘K 命令面板

- `src/hud/components/command-palette/command-palette.ts`（新）：
  - ⌘K / Ctrl+K 全局唤起（**输入态也生效** —— ⌘K 是逃逸键），焦点直接进搜索框；
  - ↑↓ 选择（跳过灰态项）+ Enter 执行 + Esc 关闭（**stopPropagation**，不与遮挡栈双关）；
  - Tab 不逃逸（focus trap）；执行后焦点回原位；
  - 分组标题渲染；不可用项灰态 + **原因**（task_148 的死按钮语言）；
  - 最近使用单独成组置顶（渲染序 = 选择序 = 执行序，三者同源）；
  - 层级走 146 的 `zVar('modal')` 刻度表 + `OVERLAY_REGISTRY` 登记（modal 档）；
  - 动效走 138 的 `MOTION_COMPONENT_CSS`（含 reduced-motion 降级）；双皮肤只用 `--srf-*` token。

### 3. 接线

- `src/app/main/main-entry.ts`：把面板挂进 `#hud-side`（兄弟于 `#hud-root`）；
  `NEW_TASK_OPEN_EVENT` 监听移到 `#hud-side`（面板才够得着）；登记向导 / 回放 / 快捷键帮助动作；
  pagehide 时卸载（不泄漏监听器）。
- `src/hud/screens/main-screen.ts`：登记示例会话 / 日志抽屉 / 态势屏三个本屏私有动作（随屏卸载注销）。
- `src/hud/panels/command-panel.ts`：草稿写入 draft-store（两块面说同一句话）；
  登记「清空草稿」动作（随面板卸载注销）。
- `src/hud/components/shortcuts/shortcut-manager.ts`：暴露 `toggleHelp()`。
- `src/hud/theme/layer-tokens.ts`：`command-palette` 登记进浮层登记表（modal 档）。

### 4. 测试

- `src/hud/__tests__/command-palette.test.ts`（新，18 例）：注册表口径 + 全键盘流 + 灰态原因 +
  ESC 栈语义 + 最近使用。
- `tests/e2e/command-palette.spec.ts` + `tests/e2e/playwright.command-palette.config.ts`（新，6 例）：
  真实应用里的全键盘流（⌘K → 两字 → Enter）、注册清单、灰态截图、ESC 栈、composer 零回归、置顶。

### 截图（`-r9` 前缀 + `-ck` 后缀，双皮肤）

- `reports/shots/-r9-cmdk-list-default-ck.png`
- `reports/shots/-r9-cmdk-search-default-ck.png`
- `reports/shots/-r9-cmdk-disabled-default-ck.png`
- `reports/shots/-r9-cmdk-search-pixel-ck.png`

## 验证证据（完成前必填）

- [x] **实现证明**: 见上「交付物」；核心是「命令定义收编进 `hud/lib/command-registry.ts`，
      composer 与 ⌘K 面板共用一份事实源」，面板只负责画列表 / 转键击 / 管焦点与层级。
- [x] **测试验证**: `npx tsc --noEmit` 绿；`npx jest src/hud` 1393 passed / 2 failed（**2 条失败是
      开工前既有的 agent-panel 改动所致**，见「未尽事项」）；`npx playwright test
      --config=tests/e2e/playwright.command-palette.config.ts` 6 passed（截图 4 张）。
- [x] **影响范围**: 底栏 composer 词表改为派生（`CLI_COMMANDS` 内容与顺序不变）——
      `command-line.test.ts` 绿；`#hud-side` 多挂一个浮层元素（不重写容器拓扑）；
      浮层登记表多一行（`command-palette`）；gateway / 144-149 成果结构未动。

### 测试步骤

1. `npx tsc --noEmit`
2. `npx jest src/hud --maxWorkers=2`
3. `npx playwright test --config=tests/e2e/playwright.command-palette.config.ts`（vite 7523 在跑）

### 验证结果

```
Test Suites: 1 failed, 73 passed, 74 total
Tests:       2 failed, 1393 passed, 1395 total
（失败的 2 条在 src/hud/__tests__/agent-panel-pipeline.test.ts —— 开工前既有）

e2e：6 passed
```

## 未尽事项

- `src/hud/__tests__/agent-panel-pipeline.test.ts` 2 条失败：**不是本任务引入**。
  证据：`git worktree` 到 HEAD(4c3ddbb) 单跑该文件 → 8 passed；差异来自工作区里**未提交**的
  `src/hud/panels/agent-panel.ts`（task_148 死按钮治理：把「派发」按钮按表单态禁用）——
  该改动让测试里「直接改 value 再点提交」的路径点不动禁用按钮。属他人在途改动，本任务未碰。
