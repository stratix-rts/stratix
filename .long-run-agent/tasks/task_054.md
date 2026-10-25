# task_054 agent 健康监测
## 需求
CLI 进程级健康：崩溃/掉线检测、单位状态真实化（在线/忙碌/离线徽标）、自动恢复。
## 要点
1. transport 执行期进程监控：exit 异常码/超时→标记 unhealthy 事件
2. 周期探测（心跳复用 agent-detector T1 异步探测）：离线单位头像灰显+徽标
3. 离线时派任务/对话：入口拦截提示（升级 035 的「未检出」为「已检出但离线」）
4. 恢复：探测恢复在线自动亮起；unhealthy 计数落库（统计用）
## 验收
- kill 一个 CLI 进程场景（打桩测试）：战场单位 30s 内灰显；恢复后自动亮
- typecheck/jest 全绿

---

## 验证结果（2026-10-25 执行）

### 验证命令
- `npm run typecheck` → ✅ 零错误
- `npx jest --silent` → ✅ **148 套件全过，3309 passed / 6 skipped**（基线 3268 passed，无回归，净增 41 例）

### 改动文件（17 改 + 5 新增测试）

**core（契约 + 接地）**
- `src/core/types.ts`：`UnitView.online?: boolean`（缺省即在线，向后兼容铁律写入契约注）；`WorldEvent` 增 `agent.online` / `agent.offline`（带 kind，事件不雪球 id 列表）
- `src/core/runtime.ts`：`applyAgentConnectivity` 接地——按 `characters.agentKind ↔ units.characterId` 对账批量置在线位；幂等（重发同事件零广播）；忙闲 status 不动（正交语义）

**app（判定服务 + 持久化 + 守门升级）**
- `src/app/services/health-monitor.ts`（新）：单一判定方。常量集中（`DEFAULT_HEALTH_PROBE_INTERVAL_MS=60_000`、`HEALTH_OFFLINE_FAILURE_THRESHOLD=2`）；数据源两路：周期探测（注入 probe 口→IPC 主进程真探测）防抖判定（1 次失败不判/连续 2 次判离线/1 次成功即回）；transport exit 异常记 unhealthy（aborted 不记），不改在线位
- `src/app/services/agent-detector.ts`：导出 `T1_AGENT_DETECTION_TARGETS`（从主名单过滤，不另抄）
- `src/app/services/persistence/agent-health-dao.ts`（新）：`agent_health_events` 表 DAO（建表/插入/unhealthy 计数，CHECK 词表约束）
- `src/app/services/persistence/agent-health-record.ts`（新）：渲染侧 IPC 端口 + fire-and-forget persister
- `src/stratix-database/StratixDatabase.ts`：schema v9→**v10**（`migrateAgentHealthEvents`）
- `src/app/services/task-service.ts`：守门第四条（离线拦截 `taskOfflineReason`，任务 failed 带原因）+ toast 去重（N 条排队只提示一次，守门通过重置）+ `onTransportError` 上报口（runTask/审批续段双路）
- `src/app/services/chat-service.ts` / `agent-chat-service.ts`：同构升级（错误气泡/拦截文案 + notify 去重 + onTransportError）

**HUD / world（灰显 + 徽标）**
- `src/hud/panels/agent-catalog.ts`：detail/row 模型增 `online`（归一 `unit.online !== false`）；签名含在线位（翻转必重画）
- `src/hud/panels/agent-panel.ts`：`data-online="false"` 灰显（`--srf-offline-filter: grayscale(1) opacity(0.55)` 皮肤 token，world 侧常量同档）+「离线」徽标（详情/编组行）
- `src/world/objects/unit-object.ts`：`online` getter（缺省 true）+ 对账谓词
- `src/world/objects/unit-layer.ts`：灰显常量（`OFFLINE_STYLE_ALPHA=0.55` + 灰 tint）；占位圆统一离线色（皮肤色不盖健康信号）；新精灵继承离线位
- `src/world/dev/main.ts`：事件面板描述新事件

**Electron（探测后端 + IPC）**
- `src/electron/main.ts`：`agent:detected:probe`（T1 按需探测，在飞单例串行化）+ `game:saveHealthEvent`（形状校验从严）
- `src/electron/preload.ts`：`agentDetection.probe` + `gameSave.saveHealthEvent`
- `src/app/main/main-entry.ts`：health-monitor 接线（probe/persist）；恢复 toast（成功 tone「XX 已恢复在线」）；chat/互聊/task 三路 onTransportError + notify；卸载纪律

**新增测试（5 文件 41 例）+ 夹具升级（4 文件）**
- health-monitor：防抖全口径（1 失败不判/2 判/夹成功清零/恢复即回/多 kind 不串味/非 T1 不判）、exit 异常记数（aborted 不记/审计可累计/落库抛错不炸）、周期回路（小间隔全链/IPC 断轮次跳过/无 probe 退化）
- runtime：事件接地（批量置位/幂等/未绑 kind 零变化不崩/status 正交）
- agent-health-schema-v10：新库建表/v9 老库迁移/DAO 幂等往返/重开库存活/CHECK 拒脏词
- task-service / chat-service：离线拦截（不进 transport + 原因带名）+ toast 去重 + 恢复放行 + onTransportError 透传
- agent-catalog / unit-registry：缺省归一 true、翻转改签名、掉线不重置位置
- 既有 schema 测试（v6/v7/v8/v9）版本断言随 v10 目标值更新（+1，语义不变）

### 监测链路（一句话版）
transport error（非 aborted）→ `onTransportError` → unhealthy 记数落库（审计）；周期 60s T1 探测 → 防抖（连续 2 败判离线/1 成即回）→ `agent.offline/online` 事件 → runtime 接地写 `units.online` → 战场灰显+徽标 / 角色卡灰显 / 派任务·对话·互聊守门拦截（toast「XX 当前离线」，去重）/ 恢复 toast（成功 tone）。

### 未尽事项（如实记录）
1. HUD `--srf-offline-filter` 目前只在 agent-panel 声明（未接正式换肤表）—— 换肤体系接入时把 token 挪进皮肤层即可，值常量已两处同源注记
2. unhealthy 计数有进程内观察口 + 落库审计，尚无设置页/面板读数 UI（`countUnhealthyEvents` 读口已就位，等 UI 任务）
3. 探测周期 60s 为全局常量，暂未暴露为用户设置项（规格只要求「可配」，服务构造参数已可配）
