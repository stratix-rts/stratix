# agent_task_103 —— MCP 会话写面第一件（session_interrupt）工作文档

> 任务：v3.2b-B4（task_103）—— MCP `stratix_session_interrupt` 写面工具 + MCP-SPEC.md 增补。
> 方案：docs/SESSION-PLAN.md §8 B4（`manager.interrupt` 已存在，只补 MCP 面）。
> 前置：2a S1–S6（域模型 / 存储 / service 接线 / 互聊接入 / HUD 面板 / MCP 读面）。
> 日期：2026-11-02。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/stratix-gateway/mcp/tools/session.ts` | 新增 `stratix_session_interrupt`（排序位 12；四要素 description；落点 = 既有 `HudCommand.session.interrupt`；kind 边界；回执含 id / 状态 / poll） |
| `src/stratix-gateway/mcp/types.ts` | 新增错误码 `unsupported_kind`（附录 A 的代码侧契约） |
| `src/stratix-gateway/mcp/envelope.ts` | `unsupported_kind` 的错误码元数据（message / retryable / hint） |
| `src/stratix-gateway/mcp/server.ts` / `index.ts` | 注册并导出该工具（工具面十一件 → 十二件） |
| `src/stratix-gateway/mcp/__tests__/session-interrupt.test.ts` | 工具单测 9 例（真总线 + 真 runtime + 真 manager + 真 sql.js 库） |
| `src/stratix-gateway/mcp/__tests__/registry.test.ts` / `transport.test.ts` | tools/list 清单回归（十一件 → 十二件；既有次序逐字未动） |
| `docs/MCP-SPEC.md` | §2.12 工具条目 + 目录 + §2.0 错误码映射 + §3.1 落点表 + §3.4 写面清单 + §4.2 域表 / 动词登记 + 附录 A 错误码 + §5.5 v1.5 演进行 + §6 口径追记 |
| `docs/rubric/agent_task_103.md` | 本工作文档 |

## 2. 关键设计决策

1. **写面落既有命令，不新开通道**：工具只 `host.dispatchCommand({ type: 'session.interrupt', sessionId })`
   → core runtime → `core/session/manager.ts` 的 `interruptSession`（原子地「记一条 interrupt 事件 +
   迁移到 interrupted」）。§3.1「MCP 是投影不是新功能层」—— 不新增状态字段 / 持久化表 / 状态机。
2. **相位裁决不写在工具侧**：工具投完命令**读回** `WorldState.sessions` 核对结果（与 `stratix_task_cancel`
   同一纪律）：状态转 `interrupted` = 成功；可中断却纹丝未动 = `internal_error`（没人接管命令）；
   状态未变且本来就不可中断 = `illegal_transition`（状态机拒了，如实回当前相位）。
3. **写面看 WorldState、读面看库**：会话**历史**在库（事件本体不进广播）；而中断的**裁决与落点**在
   本进程的状态里 —— 库里那条会话本进程未必还在跑（服务重启后不在内存、已收尾被 FIFO 淘汰），
   对一条不在跑的会话发命令没有意义。故存在性判据 = `WorldState.sessions`，找不到即 `session_not_found`
   （不拿"历史"冒充"现在在跑"）。
4. **kind 边界只认 `peer_chat`**（新增错误码 `unsupported_kind`）：中断 = "叫停一场正在进行的对话"，
   而互聊是唯一一种**会话记录与"正在跑的那场对话"一一对应**的 kind（`agent-chat-service` 开场建会话、
   超时 / 取消时转 interrupted —— 正是"超时即丢"的解药）。其余四类背后没有可停的东西：
   `character_chat` 是每角色一条长生命周期记录；`task_run` / `mission_run` 是任务 / 任务单的实体镜像
   （中断它停不住任务，停任务用 `stratix_task_cancel`）；`shell_link` 是 agent-link 连接的投影
   （中断它不断开连接）。口径与 core 的 resume 策略一致（方案 §8 第一期只做 peer_chat）；
   放宽是纯增量（只加不删）。
5. **不引入 reason 参数**：既有 `HudCommand.session.interrupt` 只有 `sessionId`（core 契约冻结）——
   加字段即改总线契约，超出本单范围；事件原因走 manager 的缺省文案（`会话被中断`）。
6. **`session_not_found` 与 `unsupported_kind` 分开**：会话**不存在** → 重列（换 id）；会话**存在但这一类
   不能这么操作** → 换一条可操作的会话。合并成一个码，模型分不清该重试还是该换一条。
7. **只加不改**：既有十一件工具的名字 / 参数 / 语义 / 缺省行为一律未动；`tools/list` 既有次序逐字未动；
   新工具插在 `session_get` 之后（位次 12，session 域聚拢）。
8. **零新依赖、零新表、零新状态通道、零 core 改动**：`src/core/**` 与 `src/app/**` 本单一行未改。

## 3. 验证

- `npx tsc --noEmit` → 0 错（无输出）
- `npx jest src/stratix-gateway/mcp --maxWorkers=1` → `Test Suites: 9 passed, 9 total / Tests: 92 passed, 92 total`
- 本单新增套件：`npx jest src/stratix-gateway/mcp/__tests__/session-interrupt.test.ts --maxWorkers=1` → 9 passed
- Lint（改动文件）：`npx eslint --cache <改动文件>` → 0 error（测试目录被 eslint 配置忽略）

### 本单新增用例（9 例）

| 用例 | 断言 |
|---|---|
| 已注册在默认工具面里 | 工具名在 `DEFAULT_MCP_TOOLS` 中，且排在 `session_get` 之后 |
| 中断一条进行中的会话 | 回执 `status=interrupted` / `previous_status=active` / 带 poll；store 状态转 interrupted、eventCount=2；**库里有 `interrupt` 事件**（seq=2、payload 带 reason）；摘要快照落库 status=interrupted |
| 空闲会话也能中断 | `previous_status=idle` |
| 会话不在本进程状态里 | `session_not_found` |
| 四类 kind 一律不支持 | `unsupported_kind`；且**状态与事件计数未被改动**（没发命令出去） |
| 重复中断 | `illegal_transition`；事件流仍是 created + interrupt 两条（历史不改写） |
| 已收尾的会话 | `illegal_transition` |
| session_id 为空 | `invalid_arguments` |
| 命令没人接管（无 runtime） | `internal_error`；状态未变（不假装成功） |
