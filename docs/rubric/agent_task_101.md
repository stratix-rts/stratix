# task_101 工作文档 —— v3.2b-B2 resume 全栈

> 关联任务：`.long-run-agent/tasks/task_101.md`
> 分支：`refactor/game-v3`　日期：2026-11-02

## 一句话

把 task_100 落地的 core 侧会话恢复能力（`manager.resume` + `context-replay`）接到三面：
**互聊引擎续跑**、**HUD 恢复按钮**、**MCP 写面工具**，全程只支持 `peer_chat`，不降级。

## 1. 改动地图

| 层 | 文件 | 职责 |
|----|------|------|
| app（互聊引擎） | `src/app/services/agent-chat-service.ts` | `resume(sessionId)`：回灌上文 + 重启轮转；不降级错误码 |
| app（事件源） | `src/app/services/session-event-log.ts`（新） | 进程内会话事件日志（写口 + 读口同源，双上限） |
| app（组合根） | `src/app/main/main-entry.ts` | 注入引擎级恢复端口 + 事件日志 |
| core（契约） | `src/core/types.ts` / `src/core/runtime.ts` | `session.resume` HudCommand + `sessionResume` 端口 |
| gateway | `src/stratix-gateway/api/websocket/world-sync/protocol.ts` | 命令协议对齐（与 `session.interrupt` 同模式） |
| gateway（组合根） | `src/stratix-gateway/service/stratix-service.ts` | 注入 **core 级**恢复端口 + 真事件读口 |
| hud | `src/hud/panels/session-panel.ts` / `session-catalog.ts` | interrupted 行「恢复」按钮 + `canResume` |
| mcp | `src/stratix-gateway/mcp/tools/session.ts` | `stratix_session_resume` 写面工具（§2.13） |
| mcp | `src/stratix-gateway/mcp/server.ts` / `index.ts` | 工具注册（第十三件，位次紧跟 `session_interrupt`） |
| 文档 | `docs/MCP-SPEC.md` | v1.6：§2.13 全文 + §3.1/§3.4/§4.2/§5.5/§6.0 同步 |

## 2. 关键设计取舍

### 2.1 恢复端口的「两副面孔」

进程拓扑决定了恢复有两个落点，本单如实区分并在 MCP-SPEC §2.13 写明：

- **渲染进程**（互聊引擎在这儿）→ **引擎级恢复**：回灌上文 + 重启轮转 + 追加「（续聊恢复）」。
- **service 进程**（MCP 在这儿，没有互聊引擎）→ **core 级恢复**：`manager.resume` 翻状态位
  （interrupted → active）+ 建回灌快照 + 记一条 `resumed` 事件。

MCP 走的是后者：**恢复后状态确实转 active、事件流确实留痕**，但**后续对话由渲染进程的引擎接手**
（引擎恢复时会自己再翻一次状态位，幂等）。这是当前进程拓扑下的实话，不假装 MCP 能自己续聊。

### 2.2 渲染侧没有落库通道 → 新增进程内事件日志

渲染进程不落库，事件写出来即丢 → resume 回灌无源 → core 拒绝恢复。
新增 `session-event-log.ts`：写口与读口**同一份内存表**（避免写读不同源），两条硬顶：

- 每会话事件条数上限 500（超限丢最旧）；
- 会话数上限 50（超限丢最旧会话整段）。

core 侧**零改动**（`SessionPersistPort` / `SessionEventReadPort` 两个契约早就留着）。

### 2.3 不降级：六条错误码

引擎级恢复：会话不存在 / kind 不符 / 状态不符 / 角色缺失 / 端口缺席 / 单飞占用 —— 一律
**如实报错**（code + 人话 reason），绝不另起一场讨论、绝不静默跳过。
MCP 工具沿用既有词表：`session_not_found` / `unsupported_kind` / `illegal_transition` /
`invalid_arguments` / `internal_error`。

### 2.4 事件读口口径统一

`readSessionEvents(sessionId, {beforeSeq?, limit})` 一律返回**命中集里最后 limit 条**（seq 正序）：
进程内日志、DAO（`ORDER BY seq DESC LIMIT` 后 reverse）、`manager.readAllEvents` 三处一致。

## 3. 验证

### 3.1 新增单测（4 个文件，26 例）

| 文件 | 例数 | 覆盖 |
|------|------|------|
| `src/app/__tests__/agent-chat-resume.test.ts` | 10 | 回灌块三例 + 合法恢复一例（真 store + 真 manager + 真事件日志）+ 不降级六例 |
| `src/app/__tests__/session-event-log.test.ts` | 5 | 写读往返 / 会话隔离 / 读口窗口与游标 / 两条封顶 |
| `src/core/__tests__/session-resume-runtime.test.ts` | 3 | 命令经总线转到恢复端口 / 端口缺席 → onUnhandled / core 不自己恢复 |
| `src/stratix-gateway/mcp/__tests__/session-resume.test.ts` | 8 | 注册位次 / 恢复成功 / 五条错误码 / 无事件源 |

HUD 侧另加 3 例（`src/hud/__tests__/session-panel.test.ts`）：互聊 interrupted 行有恢复钮
（别的 kind 与 active 没有）、点恢复发 `{type:'session.resume', sessionId}`、点恢复不展开历史。

### 3.2 实跑输出

```
$ npx jest src/stratix-gateway/mcp/__tests__ --silent --maxWorkers=2
Test Suites: 10 passed, 10 total
Tests:       100 passed, 100 total
Snapshots:   0 total
Time:        2.778 s

$ npx jest src/app/__tests__ src/core/__tests__ src/hud/__tests__/session-panel.test.ts --silent --maxWorkers=2
Test Suites: 73 passed, 73 total
Tests:       1308 passed, 1308 total
Snapshots:   0 total
Time:        6.677 s, estimated 9 s

$ npx tsc --noEmit
TSC_EXIT=0

$ npm run build
> stratix@0.1.0 build
> npm run build:backend && npm run build:frontend

> stratix@0.1.0 build:backend
> tsc && tsc-alias

> stratix@0.1.0 build:frontend
> vite build

vite v7.3.1 building client environment for production...
✓ 134 modules transformed.
✓ built in 2m 3s
```

### 3.3 验收标准逐条对照

| 验收标准 | 结论 | 证据 |
|---------|------|------|
| 单测：resume 路由（合法恢复 / 非法 kind / 角色缺失报错不降级）全过 | ✅ | `agent-chat-resume.test.ts` 10 例 + MCP 8 例 + runtime 3 例 |
| typecheck + build 通过 | ✅ | `TSC_EXIT=0`；`npm run build` 成功 |
| service 层验证：interrupted 会话 resume 后可继续追加新消息且状态变 active | ✅ | `agent-chat-resume.test.ts`「合法恢复」一例：真 store/真 manager/真事件日志，恢复后新发言仍记同一条会话，spawn 时 `session.status === 'active'` |
| HUD 面板按钮与命令接线有测试或可查证实现 | ✅ | `session-panel.test.ts` 三例 + `session-catalog.ts` 的 `canResume` |

## 4. 未尽事项（如实记录，不粉饰）

1. **MCP 走的是 core 级恢复** —— service 进程内没有互聊引擎，`stratix_session_resume` 只把状态翻回
   active 并留痕，**后续对话由渲染进程的引擎接手**（已在 MCP-SPEC §2.13「恢复端口的两副面孔」写明）。
2. **渲染侧事件日志是进程内的** —— 页面重载即失，重载后渲染侧恢复无上文可回灌（core 会如实拒绝）。
3. **恢复后的轮数用缺省 3** —— 原场次轮数没留痕，续聊轮数无法还原。
4. **未跑 e2e** —— 本单只动会话域的恢复路径与命令面，未触碰 service 进程拓扑；
   `e2e-tests/service-resident.e2e.mjs` 与 `session-domain.e2e.mjs` 未在本单复跑（避免动用户 dev 实例）。
5. **只有 `peer_chat` 可恢复** —— `character_chat` / `task_run` / `mission_run` / `shell_link`
   一律 `unsupported_kind`（方案 §8 定的第一期边界）。

## 5. 边界遵守

- 不重构任务范围外的代码；不引入新依赖（只用仓库已有的 sql.js / node 内置）。
- 没碰 `HEARTBEAT.md` / `lra.md` / `.long-run-agent` 配置；没碰用户 dev 实例（7523/7524/9222）。
- 工作区历史脏文件（`.long-run-agent/tasks/task_07*.md` 等、`docs/rubric/agent_task_105.md`）
  未动、未纳入提交。
