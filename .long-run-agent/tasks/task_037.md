# task_037: 任务派发命令与队列

## 描述
core 任务派发命令 + app 层队列：单位状态机 idle→working→done/failed，每单位并发 1 排队，任务经 transport 执行。

## 需求
1. core：`task.assign` 命令 + UnitTask 状态（CharacterTask：prompt/状态/时间戳），unit 状态进 WorldState（idle/working 派生自任务）
2. app 层 `task-service`：每角色 FIFO 队列，并发 1；出队 → transport 执行（长超时；与 chat-service 会话隔离——任务走独立会话或 resume 主会话，选一注明理由）
3. 状态事件：总线广播 task.started/task.progress（若 adapter 有）/task.completed/task.failed
4. 入口：本任务交付 core 命令+service+单测；UI 派发表单归 038 后续（如 038 范围不含表单则 039 补，文件头注明分工）
5. 单测：队列 FIFO/并发 1/状态机流转/失败重试策略（不自动重试，手动）

## 依赖
- 035（transport 服务）、033（任务记录可选落库）

## 验收标准
- [ ] tsc 零错误；npx jest --silent 全绿
- [ ] 状态机+队列单测全覆盖
- [ ] core 无 IO（transport 调用全在 app 层）

## 验证方式
npm run typecheck && npx jest --silent

---

## 验证结果（task_037 执行完成后补记）

- 验证命令：`npm run typecheck && npx jest --silent`
- typecheck：**零错误**（tsc --noEmit 通过）
- jest：**120 套件 / 2700 通过 / 6 跳过 / 0 失败**（基线 117 套件 / 2650 通过 → 新增 3 套件 50 测试，无回归）

### 交付清单

**core（零 IO）**
- `src/core/types.ts`：TaskStatus / CharacterTask 契约；WorldState.tasks（可选增补）；HudCommand 增 `task.assign`；WorldEvent 增 task.queued/started/completed/failed；MAX_TASKS=100、MAX_TASK_PROMPT_LEN=20000、MAX_TASK_SUMMARY_LEN=2000
- `src/core/task/`（新模块，machine→manager 分层与 mission 同构）：machine.ts 纯状态机（queued→running→completed/failed；fail 可从 queued 直达；终态不可再动；输出摘要裁决；dropSettledTasks 腾位）；manager.ts 写 store + 单位忙闲派生（running→unit busy，收尾仅当无其他 running 时回收 idle，error/offline 不碰）+ task.* 事件 + Notice
- `src/core/runtime.ts`：task.assign 落 task manager（与 mission 同口径直接调用）；task.* 事件显式接地不进 onUnhandled（同 unit.position 惯例）
- `src/core/store.ts`：初始态增 tasks: []

**app 层**
- `src/app/services/task-service.ts`：每角色 FIFO、并发 1；出队守门（在档/已绑/已检出 → 不满足直接 failTask，**不进 transport**）；经 transport 执行（**复用 035 的 chat:run/chat:abort IPC 通道**，理由见文件头：通道本就是通用单轮执行管道，runId 路由不串台）；会话隔离（spawn 恒 sessionId=null，session 事件忽略不回写，persona 每次内嵌——任务无续发）；超时 10min 同 035 档；失败不自动重试；completed 全文落库（状态里只有摘要）
- `src/app/services/persistence/task-record-dao.ts`：character_tasks 表 DAO（建表/upsert/按角色读最近 N 条）
- `src/app/services/persistence/task-record.ts`：渲染侧 IPC 端口 + 落库回调工厂
- `src/stratix-database/StratixDatabase.ts`：schema_version 3→4，migrateTasks + createTables DDL
- `src/electron/main.ts` / `preload.ts`：game:saveTask / game:loadTasks 两条 IPC（校验从严）
- `src/app/main/main-entry.ts`：组合根接线（taskManager 单实例注入 runtime 与 task-service）
- `src/world/dev/main.ts`：dev 面板 describe 补 task.* 展示

### 表结构（character_tasks，schema v4）

```sql
CREATE TABLE character_tasks (
  id TEXT PRIMARY KEY,           -- core 侧任务 id
  character_id TEXT NOT NULL,
  prompt TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('queued','running','completed','failed')),
  output TEXT NOT NULL DEFAULT '',  -- completed=全文；failed=原因
  created_at INTEGER NOT NULL,
  started_at INTEGER,               -- queued 直达 failed 时为 NULL
  ended_at INTEGER
);
CREATE INDEX idx_character_tasks_character ON character_tasks(character_id, created_at);
```

**why 表名 character_tasks 而非规格原文的 tasks**：v1 起已有一张 agent 平台的 tasks 表（task_id 主键/zone 形状），同名必撞；character_ 前缀对齐 character_chat_messages 的游戏存档域命名先例。独立表 vs 落 character_chat_messages 的选择理由（任务与聊天审计分离）已在 DAO 文件头注明。

### 单测覆盖（50 个新测试）

- `src/core/__tests__/task.test.ts`（28）：machine 全路径穷举（含非法迁移/摘要截断/腾位）、manager 投影（守门/上限纪律/多任务 busy 保持/Notice）、runtime 命令闭环、task.* 事件接地、与 character.create 串联
- `src/app/__tests__/task-service.test.ts`（17）：纯函数（守门/prompt 拼装/错误文案）、单任务执行（persona 内嵌/sessionId=null/全文落库/超时透传/空输出占位）、守门拦截零 transport、FIFO+并发 1（gated 挂起脚本验时序）、跨角色并行、失败不重试、transport 抛异常防御、忙闲派生全链路、start/stop
- `src/app/__tests__/persistence/task-record-dao.test.ts`（5，真实 sql.js 适配器）：三段相位 upsert 往返、failed 直达行、窗口排序、落盘重开、与 v1 tasks 表共存

### 遗留事项（明确归 038 及以后）

- 派发表单 + 战场 working 动画 + 队列可见性 UI（038 范围，本任务未碰 hud/world 渲染层——dev 面板 describe 仅补事件展示）
- task.progress 事件：transport 事件词表无 progress 语义（各家 adapter 只有 message/tool_use/tool_result/session/done/error），规格「若 adapter 有」条件不成立，未设——后续若需要进度上报，先扩 adapter 事件面再加总线事件
- 手动重派入口（failed 任务一键重发新任务）随 038 表单
- 任务历史回填 UI（loadTasks IPC 已就绪，读侧消费归 038 队列可见性/历史面板）
- stop() 窗口内派发的任务会错过 task.queued 事件而停留 queued（启动时序文档化行为；若需要「启动时清扫孤儿 queued」，归 039+ 运维面）
