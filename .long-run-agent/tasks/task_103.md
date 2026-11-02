# task_103 v3.2b-B4 MCP session_interrupt 写面工具

## 描述

`manager.interrupt`（core/session）已存在（v3.2a 落地，HUD `session.interrupt` 命令在用），本单只补 **MCP 面**：

1. 在现有 MCP server 工具注册中新增 `stratix_session_interrupt`（入参 `session_id`；description 四要素：
   何时用 / 何时不用 / 边界 / 错误码 —— 对齐 2a 的 `session_list` / `session_get` 风格，含 `unsupported_kind` 边界）；
2. MCP-SPEC.md 增补章节（对齐现有 session 工具章格式）。

最小改动，不动其他工具。

方案：docs/SESSION-PLAN.md §8 B4。

## Requirements

1. 新增 `stratix_session_interrupt`（域 `session`，排序位 12 —— 紧跟 `session_get`，既有工具相对次序不变），
   落点必须是**既有**的 `HudCommand.session.interrupt`（不新增状态通道 / 持久化表 / 状态机）。
2. description 四要素齐备（何时用 / 何时不用 / 边界 / 错误码），错误码取自 SPEC 附录 A；
   新增错误码 `unsupported_kind` 须先改附录 A。
3. kind 边界：只认**对话真在跑**的那类会话（`peer_chat`），其余 kind 一律 `unsupported_kind`。
4. 相位裁决归 core 状态机：工具只投命令 + 读回 `WorldState.sessions` 核对结果，不另写一套判定。
5. 写工具回执须含：标识 + 状态 + 查法 `poll`。
6. 零新依赖、零新表、零 core / app 改动；既有十一件工具的名字 / 参数 / 语义 / 缺省行为一律不动。

## Acceptance

- [x] `tools/list` 含 `stratix_session_interrupt`（注册顺序对齐 SPEC 编号序：位次 12，紧跟 `session_get`）
- [x] 单测：调用后目标会话 `status=interrupted` **且**事件落中断标记（真实 sql.js 库 + 真总线 + 真 runtime）
- [x] `npx tsc --noEmit` 通过（0 错）
- [x] MCP-SPEC.md 更新（§2.12 + 目录 + §2.0 映射表 + §3.1 / §3.4 + §4.2 域表与动词登记 + 附录 A + §5.5 v1.5 + §6 口径追记）

## deliverables

- `src/stratix-gateway/mcp/tools/session.ts`（新增 `sessionInterruptTool` + 文件头职责更新）
- `src/stratix-gateway/mcp/types.ts`（新增错误码 `unsupported_kind`）
- `src/stratix-gateway/mcp/envelope.ts`（`unsupported_kind` 元数据）
- `src/stratix-gateway/mcp/server.ts` / `index.ts`（注册 + 导出；工具面十一件 → 十二件）
- `src/stratix-gateway/mcp/__tests__/session-interrupt.test.ts`（新增单测 9 例）
- `src/stratix-gateway/mcp/__tests__/registry.test.ts` / `transport.test.ts`（tools/list 清单回归）
- `docs/MCP-SPEC.md`（规范增补）
- `docs/rubric/agent_task_103.md`（工作文档）

---

## 实现说明（落地后回填）

### 改动

| 文件 | 职责 |
|------|------|
| `src/stratix-gateway/mcp/tools/session.ts` | `sessionInterruptTool`：入参 `session_id`；投 `session.interrupt` 命令 → 读回 `WorldState.sessions` 核对 → 回执（id / kind / title / status / previous_status / event_count / last_event_at / poll） |
| `src/stratix-gateway/mcp/types.ts` | `McpErrorCode` 增 `unsupported_kind`（与 `session_not_found` 分开：不存在 → 重列；这一类不能这么操作 → 换一条） |
| `src/stratix-gateway/mcp/envelope.ts` | `unsupported_kind` 的 message / retryable=false / hint（附录 A 的代码侧镜像） |
| `src/stratix-gateway/mcp/server.ts` | `DEFAULT_MCP_TOOLS` 追加该工具（排序位 12）+ "十一件 → 十二件"注释 |
| `src/stratix-gateway/mcp/index.ts` | 出口导出 |
| `src/stratix-gateway/mcp/__tests__/session-interrupt.test.ts` | 单测 9 例（真链路：真总线 → 真 runtime → 真 manager → 真 store；落库走真 sql.js 适配器 + 真 DAO） |
| `src/stratix-gateway/mcp/__tests__/registry.test.ts` / `transport.test.ts` | tools/list 清单快照（十二件，既有次序逐字未动） |
| `docs/MCP-SPEC.md` | §2.12 新条目（description / inputSchema / 返回 / 映射 / 写面为何看 WorldState / kind 边界）+ 其余章节同步 |

### 关键决策

1. **写面看 WorldState、读面看库**：会话**历史**在库（事件本体不进广播）；中断的**裁决与落点**在本进程
   状态里 —— 库里那条会话本进程未必还在跑（服务重启后不在内存、已收尾被 FIFO 淘汰）。
   故存在性判据 = `WorldState.sessions`，找不到即 `session_not_found`（不拿"历史"冒充"现在在跑"）。
2. **kind 边界只认 `peer_chat`**：中断 = "叫停一场正在进行的对话"，互聊是唯一一种**会话记录与"正在跑的
   那场对话"一一对应**的 kind（`agent-chat-service` 开场建会话、超时 / 取消时转 interrupted —— 正是
   "超时即丢"的解药）。其余四类背后没有可停的东西（长生命周期记录 / 任务与任务单的实体镜像 / 连接的投影），
   中断它们只会给出误导性的"已中断"。口径与 core 的 resume 策略一致（方案 §8 第一期只做 peer_chat）。
3. **相位裁决不写在工具侧**：投完命令读回状态 —— 转 `interrupted` = 成功；可中断却纹丝未动 =
   `internal_error`（命令没人接管）；状态未变且本就不可中断 = `illegal_transition`（状态机拒了）。
4. **不加 `reason` 参数**：既有 `HudCommand.session.interrupt` 只有 `sessionId`（core 契约冻结），
   加字段即改总线契约，超出本单范围；事件原因走 manager 缺省文案（`会话被中断`）。

### 验证（输出原样）

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npx jest src/stratix-gateway/mcp --maxWorkers=1
PASS src/stratix-gateway/mcp/__tests__/transport.test.ts
PASS src/stratix-gateway/mcp/__tests__/session.test.ts
PASS src/stratix-gateway/mcp/__tests__/session-interrupt.test.ts
PASS src/stratix-gateway/mcp/__tests__/mission.test.ts
PASS src/stratix-gateway/mcp/__tests__/task.test.ts
PASS src/stratix-gateway/mcp/__tests__/registry.test.ts
PASS src/stratix-gateway/mcp/__tests__/world.test.ts
PASS src/stratix-gateway/mcp/__tests__/chat.test.ts
PASS src/stratix-gateway/mcp/__tests__/registry-tool.test.ts
Test Suites: 9 passed, 9 total
Tests:       92 passed, 92 total
```

新增套件 9 例：

```
✓ 已注册在默认工具面里，且排在 session_get 之后（清单位次）
✓ 中断一条进行中的会话：状态转 interrupted，且落一条 interrupt 事件
✓ 空闲（idle）的会话也能中断（回执回显 previous_status=idle）
✓ 会话不在本进程的状态里 → session_not_found
✓ 会话种类不支持中断（character_chat / task_run / mission_run / shell_link）→ unsupported_kind，且不发命令
✓ 重复中断（已中断的会话）→ illegal_transition，历史不改写
✓ 已收尾的会话 → illegal_transition
✓ session_id 为空 → invalid_arguments
✓ 命令没人接管（本进程没有 core 运行时）→ internal_error（不假装成功）
```

Lint（改动文件）：`npx eslint --cache <改动文件>` → 0 error（测试目录被 eslint 配置忽略）。

### 未尽事项

- `stratix_session_resume`（恢复续聊）属 2b 的 B2 单，本单不做。
- kind 边界目前只认 `peer_chat`；将来别的 kind 真有"可停的东西"时再放宽（纯增量，只加不删）。
- e2e 验收剧本（中断 → resume 续聊等）属 B9（task_108）收口，本单只交付 MCP 面 + 单测。
