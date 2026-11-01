# task_056 自定义 agent 注册
## 需求
非内置 CLI 手动注册：用户填命令模板（探测命令/对话命令/任务命令）成为战场单位。
## 要点
1. 检测器扩展 custom 词表：注册表存 SQLite（name/command 探测/执行模板/解析器选择=json|纯文本）
2. 向导扫描步显示「+ 添加自定义 agent」入口 → 表单（命令模板测试按钮）
3. custom kind 走通用 adapter（模板渲染命令），persona/形象/养成全链路同内置
4. 删除注册→单位移除（档案保留策略注明）
## 验收
- 注册一个 echo 型假 CLI（测试用）全链路可对话可派任务
- typecheck/jest 全绿

---

## 实施结果（task_056，v3.32）

### 改动文件

| 文件 | 内容 |
|------|------|
| src/core/custom-agent.ts（新增） | 注册草案纯校验层：命令白名单字符集（`[A-Za-z0-9 _\-./:=@%+,]`）、`{prompt}` 占位符恰好一个、名字→slug 派生、词表/上限常量（≤16 条、命令 ≤200 字符）；文件头注明四条安全边界 |
| src/core/types.ts | AgentKind 扩自定义段：`BuiltinAgentKind` + `custom:<id>` 模板字面量 + `isCustomAgentKind`/`customAgentIdOf`/`buildCustomAgentKind`/`isBindableAgentKind`；DetectedAgent.kind 收自定义段 + 可选 label |
| src/core/character/profile.ts | 建档校验 agentKind 走 isBindableAgentKind（内置 ∪ 形状合法自定义段） |
| src/app/services/persistence/custom-agent-dao.ts（新增） | custom_agents 表 DAO：ensure 幂等建表（CHECK 钉 output_parser 词表）+ insert/delete/load/find，参数绑定 |
| src/stratix-database/StratixDatabase.ts | schema v11：migrateCustomAgents（与 DAO DDL 同构，IF NOT EXISTS 自愈） |
| src/app/services/cli-transport/adapters/custom.ts（新增） | custom adapter：renderCustomRunArgv（argv 直拼不经 shell，注入构造上不存在）+ quoteSingle/预览串（单引号包裹用于展示/审计）+ json 解析器（.text/.content/.output 首个非空，取不到降级 plain）+ 渲染期重校验 fail closed |
| src/app/services/cli-transport/adapters/index.ts | 工厂表收窄为 BuiltinAgentKind；自定义段动态构造（createCustomAdapter） |
| src/app/services/cli-transport/index.ts | 出口加 createTransportForCustomAgent（与内置同一 runtime） |
| src/app/services/agent-detector.ts | detectCustomAgent/detectCustomAgents：probeCmd 直跑（exit 0=在装；127=未装；超时/脏命令=对应态），kind=`custom:<id>`、label=注册名、version/path 恒 null |
| src/app/services/health-monitor.ts | isHealthMonitoredKind：内置 T1 ∪ 形状合法自定义段（探测周期含 custom probe 的判定入口） |
| src/app/services/persistence/game-save-coordinator.ts | 恢复翻译 agentKind 走 isBindableAgentKind（注册删了档案照绑，不抹成未绑定） |
| src/electron/main.ts | chat:run 自定义分支（查注册行→createTransportForCustomAgent，sessionId 强制 null=每轮新会话）；customAgent:list/create/delete/probe 四条 IPC（core 校验 + id/名字查重 + 16 条上限 + 注册即探一轮 + 删除=断检测角色保留）；启动探测与 runHealthProbeRound 内置轮后追加自定义轮 |
| src/electron/preload.ts | customAgents IPC 面 + CustomAgentsIpcApi 形状 |
| src/hud/screens/custom-agents-port.ts（新增） | hud 侧注册端口类型（hud 不 import electron 的接缝件） |
| src/app/main/custom-agents-bridge.ts（新增） | electronAPI.customAgents → hud 端口的组合根接线（非 Electron → null 降级） |
| src/hud/screens/onboarding-catalog.ts | 扫描行 bindable/label 口径（自定义行可勾选、显示注册名/退 slug）；完成度分母随行数走（不出现 12/11 倒挂）；agentKindLabel 剥 custom: 前缀 |
| src/hud/screens/onboarding-screen.ts | 扫描步「+ 添加自定义 agent」表单（名称/探测命令/执行模板/解析器 + 测试/注册/取消），广播重画草稿回填不丢；自定义行带「移除注册」；起名默认值用注册名 |
| src/hud/screens/settings-screen.ts | 设置屏「自定义 agent 注册」组（查看/移除；新增入口注指向导） |
| src/app/main/onboarding-host.ts / main-entry.ts / src/hud/screens/main-screen.ts | 端口注入接线（缺省 null 降级） |

### 测试（+106）

- src/core/__tests__/custom-agent.test.ts：白名单拒绝逐类穷举（19 探测 + 8 模板注入载体）、占位符语义、slug 派生、上限、角色保留裁决
- src/app/__tests__/cli-transport-custom.test.ts：argv 注入安全（`; rm -rf /` 单元素不逃逸）、quoteSingle 逃逸、plain/json 解析与降级、无 session 语义、真 runtime 回路
- src/app/__tests__/persistence/custom-agent-dao.test.ts：v11 全新库/v10 老库迁移、裸库 ensure 自愈、CRUD 往返、CHECK 约束、重开库持久
- src/app/__tests__/custom-agent-detection.test.ts：probeCmd 三态、脏命令 fail closed、整轮节奏/取消/空表零开销
- src/hud/__tests__/onboarding-custom-agent.test.ts：入口降级、表单流（填值回填/测试回显/白名单本地拦/注册成功出新行默认勾选）、移除注册、完成度文案
- src/hud/__tests__/settings-screen.test.ts：注册组渲染/移除/空态/降级
- 既有测试跟进：health-monitor（+3 自定义段监测）、game-save-coordinator（+1 恢复照绑）、schema v6-v10 版本断言 10→11（5 个文件 10 处，随目标 schema 走的既有惯例）

### 安全边界说明

1. **第一道门（注册面，core 纯校验）**：模板/探测命令白名单字符集——`;` `|` `&` `$` 反引号 `>` `<` `*` `?` 引号、反斜杠、换行、花括号全部拒绝；`{prompt}` 恰好一个且首段必须有可执行文件名。
2. **最终防线（执行面，adapter）**：执行走 **argv 直拼不经 shell**（spawn binary+args，与内置五家同一 ProcessFactory）——prompt 原样作为单个 argv 元素，注入在构造上不存在；**单引号包裹（quoteSingle）只用于预览串**（向导弹窗/日志展示），那里才是引号语义的用武之地（`'` → `'\''` 逃逸，测试钉死）。
3. **纵深**：渲染期对模板重校验（注册后库被手改 → fail closed 抛错转错误轮）；渲染期白名单同 core 一份常量；DAO CHECK 钉解析器词表；长度/条数上限封注册面（注册串随 kind 进 WorldState 广播，有界是 perf 硬约束）。
4. **语义边界**：无 session 语义（buildArgs 忽略 sessionId + chat:run 对自定义段强制置空——每轮新会话，task_055 前 kimi 同款口径）。

### 验证输出

```
npm run typecheck → tsc --noEmit（零输出，干净）
npx jest --silent  → Test Suites: 153 passed, 153 total
                    Tests: 6 skipped, 3427 passed, 3433 total
                    （基线 3321 → 3427，+106 新测试，零回归）
```

### 未尽事项

1. **自定义 kind 的形象预设**：BRAND_PRESETS 无自定义段条目，自定义角色走中性平民形象回退（形象编辑全链路可正常配）——按「不逐一新做」口径，未为注册动态生成品牌预设。
2. **设置屏新增注册**：新增入口只在向导扫描步（任务书指定入口位）；设置屏提供查看/移除（组文案已注明入口指向导）。
3. **执行模板的交互式 CLI**（需要 stdin 喂交互/密码的 CLI）不适用——与内置五家同一 spawn 模型，无 stdin 通道（文件头已注明执行模型）。
4. **win32 探测退出码**：node-exec 的 ENOENT 归 127 沿用 POSIX 惯例，Windows cmd 的 not-found 9009 未单列映射（归 failed 态，不误报「确定没装」）。
