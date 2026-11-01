# 评审报告 — Workbench 三份设计文档

> 阶段: Stage 1 Review · 日期: 2026-08-01 · 评审对象:
> - `docs/STRATIX_WORKBENCH_DESIGN.md` (v1.0)
> - `docs/protocol/ADP_v1.md` (v1.0)
> - `docs/STRATIX_REFACTOR_MAP.md` (v1.2)
> 评审标准: 内部一致性 / 实施可执行性 / 安全 / 性能

---

## 摘要

| 等级 | 数量 | 说明 |
|------|------|------|
| 🔴 HIGH | 4 | 实施时会卡或埋雷 |
| 🟡 MED | 6 | 文档需补充但不会卡实施 |
| 🟢 LOW | 9 | 细节打磨 |
| ✅ OK | — | 一致性、可追溯性、风险识别均合格 |

**总体**: 三份文档在内部一致性、范围划分、协议骨架上达标；但有 4 个 HIGH 项必须修正才能进 P0。

---

## 🔴 HIGH — 必须修

### H1. `stratix-mcp` 角色定义错位（REFACTOR_MAP §2.5）

**问题**：

文档说 "outbound 适配器：把 MCP 服务器的能力转换为 ADP capability"，但 `stratix-mcp/server.ts` (1,239 行) 是 **Stratix 自己暴露的 MCP 服务器**（让外部 MCP 客户端调用 Stratix 工具），不是消费外部 MCP。

**风险**：P2 实施时把"自建 MCP 服务"和"MCP 客户端适配器"混在一起，会产出错误的双向桥。

**修正**：

```
| 旧 `stratix-mcp/server.ts` | `stratix-gateway/api/mcp/server.ts` | Stratix 自有 MCP 服务（作为 Workbench 的可被外部调用接口）|
| 新增 | `stratix-adapters/builtin/mcp/client-adapter.ts` | 消费外部 MCP server，把 tool 转 ADP capability |
```

ADP v1 §12 落地映射也应增加 `MCPClientAdapter` 引用。

---

### H2. PathScanner 扫描策略未定义（DESIGN §2.2）

**问题**：

"PathScanner 并发探测 PATH 中的候选可执行"——但没有定义"候选"如何筛选。

**风险**：

- 全扫 PATH 几百个二进制：慢、误报、违反性能预算
- 只扫预定义名：错过用户装的 agent

**修正**（在 §2.2 添加）：

```typescript
// 两种策略并存：
// 1) known probe list (P1)：
//    PathScanner 维护 known agent signatures (claude, codex, openclaw, ...)
//    每个签名 = { names: string[], probe: ProbeFunc }
// 2) heuristic scan (P3)：
//    对 PATH 中所有可执行快速启发式匹配（--version 头 100KB + 正则）
// P1 仅用 (1)；(2) 走 feature flag
```

---

### H3. ADP 权限超时 UX 不安全（ADP §5.3）

**问题**：

"adapter 超时（默认 30s）未收 decision 视为 deny"——但没有事件回灌，UI 看不到失败。

**风险**：

用户打开 tool 弹窗被遮挡或最小化，30s 后 Agent 静默被拒，行为不可见。

**修正**：

```typescript
// ADP §5.3 增加：
// 超时必须发出：
//   event.session.permission_required -> 仍 pending
//   event.session.permission_required { reason: "timeout", decision: "deny" }
// 或：
//   event.session.failed { error: { code: "PERMISSION_TIMEOUT", ... } }
//   并写入 agent_audit_log
// UI 必须：超时后弹通知 + 标注最近一次决策为 deny
```

---

### H4. ADP 实施层 discover 列表缺失（DESIGN §2.2 + §7）

**问题**：

MVP 接入 Claude Code，但 PathScanner 的 known signatures 没列出。

**修正**（在 §2.2 数据流 1 之后增加小节）：

```typescript
// P1 PathScanner 内置 known signatures：
const KNOWN_AGENTS: ProbeSignature[] = [
  { id: 'claude-code', names: ['claude', 'claude-code'], probeCmd: ['--version'],
    detectVersion: /^(\d+\.\d+\.\d+)/, capabilities: { /* 静态预填 */ } },
];
// 探测成功 → 用静态 capabilities（无需沙箱询问）
// 探测失败 → 走 generic-cli PTY driver 兜底
```

---

## 🟡 MED — 建议修

### M1. SessionCheckpoint 缺 adapter 字段（ADP §9）

跨版本 resume 时 adapter 可能已升级。补 `adapter: AdapterId`。

### M2. 像素资源解析未定义（DESIGN §2.7 + §3.1）

`AgentManifest.avatarRef` → 实际资产。需要 `CharacterAssetRegistry.get(avatarRef): Texture` 接口。

### M3. 验证清单 grep 不覆盖 archive 模块（REFACTOR_MAP §4）

新增：

```bash
# archive 模块必须无 import
for m in stratix-designer stratix-nocodb stratix-blueprint; do
  grep -RE "from ['\"]@?/?$m" src --include='*.ts' --include='*.vue' && echo "STILL HAS $m"
done
# 预期：空
```

### M4. `wc -l` 验证有空目录误报（REFACTOR_MAP §4）

`find ... | wc -l` 取代 `ls | wc -l`。

### M5. ZoneCoordinatorEvents 在 §2.3 改造表中漏（REFACTOR_MAP §2.3）

ZoneCoordinator 提到但 ZoneCoordinatorEvents.ts 没标。补：

| `zone/ZoneCoordinatorEvents.ts` | 并入 `zone-coordinator.ts` 的 `emit` 方法 | 不再独立导出 |

### M6. 文档交叉引用陈旧（DESIGN §9）

ADP v1.md 现在已存在。把"（P0 产出）"去掉或改为"（✅）"。

---

## 🟢 LOW — 后续打磨

| # | 项 | 建议 |
|---|----|------|
| L1 | SQL schema agent_manifests.id 是 TEXT，缺 branded string 约定说明 | 在 REFACTOR_MAP §2.11 顶部加一句"id 列存储去掉 `<brand>` 后缀的字符串" |
| L2 | ADP 错误码缺 `UNKNOWN_ENVELOPE_TYPE` | 复用 `PROTOCOL_VERSION_MISMATCH` 或新增 |
| L3 | `displayName: 最多 64 字符` 约束在 TS 类型未强制 | 注明用 zod max(64) 校验 |
| L4 | task-executor "isAgentWorking 抛 Not implemented" 无外部调用核查步骤 | 加 grep 验证 |
| L5 | CLAUDE.md Workbench 章节未声明"P0 阶段不要进 P1" | 加一行 "Stop at P0 close. Re-evaluate before P1." |
| L6 | DESIGN §2.2 性能预算未量化 ADP 事件吞吐 | 加一行"ADP event ≥ 100/s，UI 帧 ≥ 30fps" |
| L7 | ADP §8 JSON-RPC framing 细节不够 | 加 LSP Content-Length 头示例 |
| L8 | ADP §10 codegen 路径缺 ADAPTER_AUTHOR_GUIDE.md 引用 | 标 P1 产出 |
| L9 | deprecated barrel 缺测试 | 在 STRATIX_REFACTOR_MAP §3.2 加测试要求 |

---

## 应用建议

P0 实施前必须把 H1–H4 写进对应文档。M1–M6 可在 P0 落地时同步修。L1–L9 留到 P1 review 阶段。

**评审通过**（带条件）：✅ — 修正 H1–H4 后可进 P0 实施。
