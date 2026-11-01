# agent 设计文档：MCP 工具面同步（方案B·3/3）

> 任务：`stratix_mission_create` 支持 `brief` / `depends_on`，新增 `stratix_mission_checkpoint`
> 关联：core 侧前序交付 `d9a9fce`（数据模型）/ `2e8301e`（依赖解锁调度），MCP 骨架 `3baf559` / `bf9a78b`
> 规范：`docs/MCP-SPEC.md`（v1.0 → v1.1）

---

## 1. 需求理解（D1）

**要做的事**：把 core 侧已经落地的三块能力（结构化正文 brief / 依赖链 dependsOn / 检查点 checkpoint）
暴露到 MCP 工具面上，让 CLI agent 能用协议直接立"带验收标准、带前置依赖"的编组任务，并在推进途中留痕。

**隐含约束**（从既有代码与规范里读出来的，不看就会踩）：

| 约束 | 出处 | 影响 |
|------|------|------|
| MCP 运行期**没有 schema 校验器** | `server.ts` 的 `tools/call` 只把裸参数交给 handler | 所有形状/范围校验必须手写（`args.ts` + 工具内校验），schema 只是给模型看的说明书 |
| 写工具必须返回**受理回执**（标识 + 状态 + 查法） | MCP-SPEC §1.3 | checkpoint 工具不能回裸 `ok` |
| 错误码必须先入附录 A | `envelope.ts` 铁律 + §5.4 | `mission_terminal` 要与实现同 PR 进规范 |
| core 是唯一裁决点 | §3.1 / §3.2 | 依赖是否满足**调用 core 的 `findMissingDependencies`**，不在 MCP 抄一份 |
| `tools/list` 顺序是客户端提示词缓存的一部分 | §2.0 | 排序位写死成工具自己的字段 |

**边界**：本单**不动** `src/core` 与 `src/hud`（它们是基线），**不改**既有 8 件工具的语义；
新增能力一律走"加可选参数 + 开新工具"（§5.1 只加不删）。

---

## 2. 方案（改动面 / 分层 / 数据流）（D2 / D4）

### 2.1 改动面

| 文件 | 改动 | 性质 |
|------|------|------|
| `src/stratix-gateway/mcp/types.ts` | `McpErrorCode` 增 `mission_terminal`；`order` 字段的语义注释改成"清单位次" | 契约 |
| `src/stratix-gateway/mcp/envelope.ts` | 错误码元数据表增 `mission_terminal` | 契约 |
| `src/stratix-gateway/mcp/tools/mission.ts` | create 增 `brief` / `depends_on`；新增 `missionCheckpointTool`；两个入参读取助手 | 实现 |
| `src/stratix-gateway/mcp/tools/chat.ts` / `registry.ts` | 排序位 7→8 / 8→9（新工具插进 mission 域后，既有工具**相对次序不变**） | 元数据 |
| `src/stratix-gateway/mcp/server.ts` / `index.ts` | 注册新工具 + 导出 | 装配 |
| `docs/MCP-SPEC.md` | §0.4 术语、§2.0 顺序口径、§2.5 schema、§2.9 新条目、§3.2 约束表、§4.1/§4.2、附录 A、§5.5 演进记录 | 规范同步 |

**为什么排序位要动 chat / registry**：`order` 原义是"§2 条目号"，而条目号按只加不删递增（§2.9 在末尾），
清单位次却要按域聚拢 —— 两套编号必然分家。分家之后 `order` 的含义必须重新钉死为**清单位次**，
既有工具的 `order` 值随之 +1（chat 7→8、registry 8→9）。**既有工具之间的相对次序不变**，
客户端提示词缓存的稳定性不受影响。

### 2.2 数据流

```
tools/call stratix_mission_create
  ├─ readBrief(args)      ── 形状/段名/长度校验（MCP 侧自设）
  ├─ readDependsOn(args)  ── 形状/条数上限校验
  └─ emitCommand(mission.create { title, unitIds, brief?, dependsOn? })
        └─ core: manager.createMission → machine.createMission（归一：trim / 丢空段 / 去重 / 丢自依赖 / 截断）
     emitCommand(mission.assign) → emitCommand(mission.confirm(accept))
        └─ core: confirm 守门 —— findMissingDependencies 非空 → 拒绝（相位停在 pending）
     回读状态 → 回执（含 blocked_by_dependencies）

tools/call stratix_mission_checkpoint
  ├─ 预检：任务存在？（否则 mission_not_found）／终态？（否则 mission_terminal）
  └─ emitCommand(mission.checkpoint { missionId, note })
        └─ core: checkpointMission → machine.appendMissionCheckpoint（append-only，终态拒绝、静默）
     回读状态核对这条记账真的落上了 → 回执（mission_id + checkpoint_count）
```

### 2.3 关键判断：依赖未满足时**回执**而不是报错

`confirm` 被 core 的依赖守门拒绝时，**任务已经建成**（只是还不能开工）。此时：

- 报错 `illegal_transition` → 模型以为"建任务失败了" → 重试 → 造出第二条重复任务（越报错越乱）；
- 回执 + `blocked_by_dependencies` → 模型知道"任务在，缺哪几个前置"。

选后者。既有路径（`auto_confirm` 成功 / `auto_confirm=false` / 名单为空）**逐字节不变**，
差异只出现在"有依赖且未满足"这条新分支上。

判定用 core 的 `findMissingDependencies`（纯函数，不碰 store/时钟），与 core 守门、HUD 依赖行**同一份口径** ——
三处各写一份必然漂移。

---

## 3. 接口契约（D3）

### 3.1 `stratix_mission_create`（新增两个**可选**参数，缺省行为不变）

| 参数 | 类型 | 约束 | 缺省 |
|------|------|------|------|
| `brief` | object | 四段：`requirements` / `acceptance` / `deliverables` / `constraints`；未知段名 → `invalid_arguments`；每段 ≤ 500 码点 | 缺省 = 无正文（"裸任务"，与 v1.0 状态形状逐字节一致） |
| `depends_on` | string[] | 前置任务 id；> 32 条 → `invalid_arguments`（**不静默截断**） | 缺省 = 无依赖 |

回执新增（均为**可选**字段，仅在用到时出现）：`brief_fields`（只报段名，不回灌正文）、
`depends_on`（core 实际记下的那一份）、`blocked_by_dependencies`（还差哪几个前置）。
`auto_confirm_applied` 的口径 = "auto_confirm 真的生效了吗"（落到 `running` 才算）——
依赖未满足时为 `false`，不糊报"已自动开工"。

### 3.2 `stratix_mission_checkpoint`（新工具，order = 7）

| 参数 | 类型 | 约束 |
|------|------|------|
| `mission_id` | string | 必填 |
| `note` | string | 必填，≤ 500 码点（MCP 侧自设，防超长文本进状态广播） |

回执：`mission_id` / `title` / `phase` / `note` / `at` / `checkpoint_count` / `checkpoint_limit` / `next` / `poll`。

### 3.3 错误码（附录 A 增一行）

| code | 含义 | 可重试 | 触发 |
|------|------|--------|------|
| `mission_terminal` | 编组任务已收尾（done / cancelled），不再接受该操作 | ❌ | 终态拒绝（`appendMissionCheckpoint` 的终态分支） |

---

## 4. 风险与应对（D5）

| 风险 | 概率 | 后果 | 应对 |
|------|------|------|------|
| 依赖未满足时报错 → 模型重试造重复任务 | 中 | 战场多一条孤儿任务 | 回执而非报错；`blocked_by_dependencies` 说清还差哪几个 |
| brief / note 无界 → 撑爆状态广播（WorldState 全量广播，mission ≤ 100 条） | 中 | 每次广播变重 | MCP 侧自设上限（brief 段 500、note 500 码点）+ 显式报错（不静默截断） |
| 新增 `order` 位次 → 客户端提示词缓存抖动 | 低 | 缓存失效一次 | 既有工具**相对次序不变**；新工具插在 mission 域内；清单顺序由单测钉死 |
| 运行期无 schema 校验器 → 未知 brief 段名静默进状态 | 中 | 状态里多出没人认的字段 | 工具内手写校验（段名/类型/长度），与 schema `additionalProperties: false` 一致 |
| 只读面读不到 checkpoints 全量（§2.9 已登记为已知缺口） | 高 | 模型只能拿到计数 | 已在规范里**显式登记**缺口与补齐路径（改 `stratix_mission_status` 返回形状 = 既有工具契约变更，留待评审）—— 不在本单偷偷改既有工具 |

---

## 5. 验证（D6）

| 项 | 命令 / 步骤 | 预期 |
|----|------------|------|
| 类型 | `npx tsc --noEmit` | 零错误 |
| MCP 域单测 | `npx jest src/stratix-gateway/mcp --silent` | 全绿（新增 22 条 mission 用例） |
| 全量单测 | `npx jest --silent` | 零回归 |
| stdio 冒烟 | `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list"}\n' \| npx tsx src/stratix-gateway/mcp/bin/stratix-mcp.ts` | 9 个工具名，顺序固定（`mission_checkpoint` 紧跟 `mission_status`） |
| 规范同步 | `docs/MCP-SPEC.md` | §2.5 / §2.9 / 附录 A / §5.5 与实现一致（§5.4：实现与规范同 PR） |

新增单测覆盖：brief / depends_on 透传到命令载荷、brief 落进 `MissionView.brief`、
依赖未满足 → confirm 被拒 → 回执报出缺口、依赖已满足 → 直接 running、
brief 段名/类型/长度非法、depends_on 超 32 条、checkpoint 成功 append 与计数递增、
终态 → `mission_terminal`、任务不存在 → `mission_not_found`、note 空/超长 → `invalid_arguments`、
命令无人接管 → `internal_error`、`tools/list` 九件顺序 + 新工具位置。

---

## 6. 未做（留给下一单，并已登记在规范里）

1. **只读面暴露 `checkpoints` / `brief` / `dependsOn`**：`stratix_mission_status` 的返回形状要改 ——
   属既有工具的契约变更（§5.1 允许加字段，但要评审），本单按"不改既有 8 工具"的要求**不动**，
   已在 §2.9 写成"已知缺口"。
2. **`stratix_mission_confirm`**：确认权仍在 UI 面板（§4.2 预留位），本单不动。
