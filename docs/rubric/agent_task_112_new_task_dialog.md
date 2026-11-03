# task_112 · 新建任务对话框接通（核心闭环 P1）—— 工作记录

> 日期：2026-11-03 ｜ 分支：`demo/v3.3` ｜ 任务：v3.6 task_112
> 类型：UI 组件 + 核心闭环接线（不是重构）

## 一、问题定位（先读代码，不猜）

死功能报告说「底栏填任务标题后点『新建任务』无任何对话框 / toast / 反馈，连拍 0–1200ms 零变化」。
实际读代码后的结论是**两处缺失，不是一处**：

| 缺失 | 现状 | 修法 |
|------|------|------|
| 没有对话框 | 命令条只有一枚「新建任务」按钮，而发起方式有四种（单任务 / 流水线 / 派发 / 取消） | 新增 `<strat-new-task-dialog>`，四按钮组 |
| 没有反馈 | core 的 `mission.create` 早就在工作（`src/core/mission/manager.ts` 会 push info 级 Notice），但 **core 的 notices 从未进 toast 宿主** —— 只有 agent.online / level.up / awaiting_approval 等少数事件接了 toast | 对话框订阅 WorldState，把新 Notice 转成 toast |

即：core 侧**不需要**新增派单逻辑（任务书也明令「勿重复实现派单逻辑」）。命令构造全部复用既有纯函数。

## 二、方案与改动清单

```
src/hud/components/new-task-dialog/new-task-dialog.ts   （新增，~530 行）
src/hud/panels/command-panel.ts                          （改：global 组「新建任务」改派 DOM 事件）
src/app/main/main-entry.ts                                （改：组合根挂对话框 + 收事件）
src/hud/__tests__/new-task-dialog.test.ts                 （新增，21 例）
src/hud/__tests__/click-health.test.ts                    （改：第 29 条按新行为重写）
src/hud/__tests__/command-panel.test.ts                   （改：global 组断言改为「派事件不派命令」）
tests/e2e/new-task-dialog.spec.ts                        （新增，4 例）
```

### 数据流

```
底栏输入框 ──输入──▶ 命令面板._draftTitle
      点「新建任务」(global 组)
            └─▶ 命令面板派 DOM 事件 NEW_TASK_OPEN_EVENT {title}
                  └─▶ 组合根 main-entry 收到 → newTaskDialog.open({title})
                        └─▶ 对话框渲染四动作按钮（读数：选中数 / 流水线预设 / 推荐承接人）
                              点「单任务」→ buildCommand(command-catalog) → mission.create
                              点「流水线」→ buildPipelineStartCommand  → pipeline.start
                              点「派发」  → buildTaskAssignCommand     → task.assign
                              点「取消」  → close()
            ┌─ core 广播新 Notice（8s 反馈窗口内）──▶ toast 宿主
            └─ 对话框派 NEW_TASK_SUBMITTED_EVENT → 命令面板清标题草稿
```

### 三个架构口径（与既有代码同源，非新发明）

1. **DOM 事件桥**：hud → 组合根用冒泡的 `CustomEvent`，先例是 `stratix:chat-open`（main-screen 派、main-entry 收）。
   开对话框是纯 UI 动作，**不往 core 加命令**。
2. **命令构造单一出口**：单任务走 `command-catalog.buildCommand`、流水线走 `pipeline-catalog.buildPipelineStartCommand`、
   派发走 `agent-catalog.buildTaskAssignCommand`；HUD 不裁决合法性，合法性归 core 状态机。
3. **遮挡 R1/R4**（task_099）：对话框登记进 `occlusionController` —— 开着时四角常驻件降对比 + 禁点，
   ESC（遮挡控制器的统一 ESC 路由）与点遮罩**双关闭途径**齐备。

## 三、踩过的坑（都写进代码注释了）

| 坑 | 现象 | 解法 |
|----|------|------|
| `#hud-root` 是 `pointer-events: none` | 浮层挂在它下面 → 按钮点不动 | 宿主 `:host` 显式 `pointer-events: auto`（toast 宿主同款手法） |
| 宿主零尺寸 | `all: initial` + 内容在 shadow 里 → 宿主没有盒子，「宿主可见吗」断言全败 | 宿主自身 `position: fixed; inset: 0` 全屏浮层容器，可见性由宿主自己回答 |
| `:host:not([open])` 复合写法 | Chromium ≥145 上不匹配 → 遮罩从启动起吞掉全屏点击（shortcut-help 已实证） | 用 `:host(:not([open]))` 参数形式 |
| `document` 监听器里的 `this` | 普通方法摘下来当监听时 `this` 指向 document | 箭头函数字段 |
| playwright globalSetup 会杀 7523/7524 | 任务明令禁止 kill 常驻服务 | 用临时配置（无 globalSetup / 无 webServer）跑 e2e，跑完即删 |

## 四、验证（输出原样见会话记录）

| 项 | 命令 | 结果 |
|----|------|------|
| 类型 | `npx tsc --noEmit` | 通过（exit 0） |
| 单测（hud） | `npx jest src/hud --maxWorkers=2` | 57 套 / 1144 例全绿 |
| 单测（全量） | `npx jest --maxWorkers=2` | 267 套 / 4900 例绿；唯一失败是 `brand-presets`（缺 `dist/` 构建产物，**改动前既有失败**） |
| e2e | `npx playwright test`（临时配置） | 4/4 通过：1s 内可见 + 四按钮 / 计数 +1 + toast + console 零报错 / 取消不建任务 / ESC+遮罩双关闭 |
| MCP | `curl POST http://127.0.0.1:7524/mcp tools/call stratix_world_snapshot` | 远程模式（`STRATIX_REMOTE=1`）下 missions 可见：`mission_1793718554243_1 / 远程模式任务 / draft` |

### 真链路说明（重要）

MCP `world_snapshot` 与浏览器 UI **共用一份真相**，只在 **远程模式**（`STRATIX_REMOTE=1`，
命令走 `command.forward` 到 service、状态由 service 推全量快照）下成立 ——
本地直连模式（缺省）浏览器自带 core runtime，本地就是第二份真相（迁移期双模式，见
`docs/SERVICE-SPLIT-PLAN.md` §8 与 main-entry 顶部注释）。验证远程模式时用的是**另起的一个临时 vite 实例**，
常驻的 7523 / 7524 全程未被 kill，临时实例跑完已清理。

## 五、未尽事项

- `src/hud/panels/agent-panel.ts` 里还有一组隐藏的四按钮（`form-mode-single` / `form-mode-pipeline` /
  `task-submit` / `task-cancel`，在 `.task-form[hidden]` 里）—— 属角色面板的另一套表单，本次未动
  （守「最小改动」）。若要清，需要单独一条任务确认它不是别的形态的入口。
- 本地直连模式下 UI 建的任务**不**出现在 MCP `world_snapshot` 里（第二份真相的固有问题，非本任务引入）。
- e2e 用的是临时 playwright 配置跑的；仓库默认配置的 globalSetup 会清端口，跑全量 e2e 前需确认可以重启服务。
