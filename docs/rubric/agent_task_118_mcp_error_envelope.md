# agent_task_118 —— v3.6 MCP 错误信封收敛（P1）工作文档

> 任务：task_118 —— MCP 错误信封收敛（P1）。畸形 JSON 稳定返回裸 HTTP 500 `{"code":500,...}`（违反 JSON-RPC 2.0 的 -32700）；
> 合法请求（`task_assign` 缺 prompt）偶发过一次同样的裸 500，agent 无法建立可靠重试策略。
> 评估证据：§3-P1，curl A/B 原文见 `/Users/kingj/.openclaw/workspace/reports/2026-11-03-stratix-mcp-review.md`。
> 依据：docs/MCP-SPEC.md §4.4（传输层）+ 附录 A（错误码总表）。分支：demo/v3.3（commit 前缀 v3.6）。日期：2026-11-03。

## 1. 交付物

| 文件 | 职责 |
|---|---|
| `src/stratix-gateway/mcp/transport/http.ts` | **HTTP 传输的错误信封唯一实现处**：自带 body 解析器 + 解析错误映射（`-32700` / `-32600` / `-32603`）+ POST 兜底 try/catch + 路由级错误中间件（最后一道网） |
| `src/stratix-gateway/mcp/server.ts` | 协议层错误帧构造器 `jsonRpcError(...)` 导出（传输层与宿主装配点共用同一形状）；**未捕获异常改回 `-32603`**（不再冒充 `internal_error` 业务信封）；`handleLine` 的解析失败文案对齐规范 `Parse error` |
| `src/stratix-gateway/index.ts` | 组合根接线：`/mcp` 路由**上移**到全局 body 解析器**之前**（挂载位次硬约束）；app 级错误处理器对 `/mcp` 路径改回 JSON-RPC `-32603` 帧（不再漏裸 500） |
| `src/stratix-gateway/mcp/args.ts` | `requireString` 区分「参数缺失」与「类型不对」（报告 §3-P1 记的原话不准）；错误码不变（仍 `invalid_arguments`） |
| `src/stratix-gateway/mcp/__tests__/error-envelope.test.ts`（新，7 例） | 错误信封单测：畸形 JSON → `-32700`；非 JSON-RPC 帧 → `-32600`；缺参 → `invalid_arguments` 信封（三连稳定）；工具崩溃 → `-32603`；GET → 405 帧；**挂载位次反例**（锁住硬约束）；stdio 侧同款 `-32700` |
| `docs/MCP-SPEC.md` | §4.4 新增「传输层错误信封」小节（含三类硬约束）；附录 A 新增协议层错误表 + `internal_error` 语义澄清；§5.5 追加 v1.7 演进行 |
| `docs/rubric/agent_task_118_mcp_error_envelope.md` | 本工作文档 |

## 2. 根因（为什么原来会漏裸 500）

```
POST /mcp（畸形 JSON）
  → app.use(express.json({limit:'5mb'}))   ← 全局解析器**先**解析 → SyntaxError
  → next(err) → 跳过 /mcp 路由（连 MCP 自己的错误处理都到不了）
  → app 级错误处理器 → {"code":500,"message":"Internal server error","requestId":...}
```

两处根因，各自对应验收标准的一条：

1. **裸 500（A，稳定复现）**：全局 body 解析器排在 `/mcp` **之前**，畸形 JSON 的错误**绕过 MCP 路由**，
   落到宿主 app 级错误处理器 —— 那里只认 `{"code":500}`，JSON-RPC 的 `-32700` 根本没机会出现。
2. **偶发裸 500（B）**：任何漏到 app 级错误处理器的异常都会被压成裸 500（框架级 / 重启期 / 未预期异常），
   客户端拿到的东西**不可判别** —— 这正是"agent 无法建立可靠重试策略"的根因。

⇒ 修法不是"给 MCP 加个 try/catch"，而是**把失败收敛到一处**：MCP 端点上的任何失败都必须长成 JSON-RPC 帧。

## 3. 三条硬约束（实现与规范同 PR）

1. **HTTP 状态码恒 200**（通知类请求 202 空体）：判据是帧里的错误码；用 4xx/5xx 承载协议错误，
   会让部分 client 直接判"传输失败"，连帧都读不到。
2. **未捕获异常 ≠ 业务失败**：只有工具**主动**抛的 `McpToolError` 才走失败信封（`isError=true`）；
   崩溃一律 `-32603`。把崩溃包成 `internal_error` 会让 agent 以为"业务上拒绝"，从而去改参数重试，
   而不是查服务端日志 —— 这正是原实现（`fail('internal_error', message)`）的问题。
3. **挂载位次是硬约束**：`/mcp` 必须排在宿主全局 body 解析器**之前**（MCP 自带 1mb 解析器），
   否则畸形 JSON 在到达 MCP 路由之前就被抛掉。反例已写进单测（`挂载位次是硬约束` describe 块）。

## 4. 验证

### 4.1 报告 §3-P1 两条 curl 原样复跑（dev 网关 127.0.0.1:7524）

复现 A（畸形 JSON）：

```
$ curl -s -X POST http://127.0.0.1:7524/mcp -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":40,"method":"tools/call","params":'
{"jsonrpc":"2.0","id":null,"error":{"code":-32700,"message":"Parse error","data":{"detail":"Unexpected end of JSON input"}}}
```

复现 B（`task_assign` 缺 prompt）：

```
$ curl -s -X POST http://127.0.0.1:7524/mcp -H "Content-Type: application/json" \
    -H "Accept: application/json, text/event-stream" \
    -d '{"jsonrpc":"2.0","id":20,"method":"tools/call","params":{"name":"stratix_task_assign","arguments":{"character":"x"}}}'
{"jsonrpc":"2.0","id":20,"result":{"content":[{"type":"text","text":"{\"ok\":false,\"error\":{\"code\":\"invalid_arguments\",\"message\":\"参数 prompt 缺失\",\"retryable\":false,\"hint\":\"补齐必填参数 prompt 后重试\"}}"}],"isError":true,"structuredContent":{"ok":false,"error":{"code":"invalid_arguments","message":"参数 prompt 缺失","retryable":false,"hint":"补齐必填参数 prompt 后重试"}}}}
```

（改前 A 是 `{"code":500,"message":"Internal server error","data":null,"requestId":"stratix-req-…"}`。）

### 4.2 静态与测试（输出原样）

- `npx tsc --noEmit` → 零输出（零错）。
- `npx jest src/stratix-gateway/mcp` → **12 suites / 122 tests 全绿**（含新增 1 suite / 7 例）。
- `npx jest src/stratix-gateway` → **22 suites / 229 tests 全绿**。
- `npx jest --maxWorkers=2 --silent` → 264 suites 全绿、1 例失败 = `brand-presets.test.ts`
  （缺 `dist/frontend/spritesheets/item-metadata.json` 构建产物，与本任务无关的既知失败）。
- `npx eslint --cache <改动文件>` → 0 error（余下 4 条 warning 是 index.ts 既有的 express/dotenv 命名告警）。

### 4.3 验收标准逐条对照

| 验收项 | 断言位置 | 断言内容 |
|---|---|---|
| A：畸形 JSON → `-32700` 帧 | `error-envelope.test.ts` + 实跑 curl | `error.code === -32700`；`id === null`；响应体**无** `code:500` / `requestId` 字段 |
| B：缺参 → 规范 `invalid_arguments` 业务错误 | 同上 + 实跑 curl | `result.isError === true`；`structuredContent.error.code === 'invalid_arguments'`；`retryable === false`；**连打三次结果一致**；无裸 500 |
| 未捕获异常 → `-32603` | 同上（`stratix_test_crash` 工具抛 `TypeError`） | `error.code === -32603`；**无** `result`（不冒充业务信封） |
| 任何路径不漏裸 500 | 同上 + `index.ts` app 级处理器分支 | 畸形 JSON / 非 JSON-RPC 帧 / body 超限 / GET / 工具崩溃 —— 逐条断言"无 `code:500`" |
| 现有 mcp `__tests__` 全绿 | `npx jest src/stratix-gateway/mcp` | 12 suites / 122 tests 全绿 |

## 5. 未决与后续（不属本任务）

- **报告 §3-P2（checkpoint / brief 只写不读）**：不在本任务范围（要动 mission 工具的返回面）。
- **报告 §3-P5（`additionalProperties` 未强制）**、§3-P3（`stratix_chat_history` 悬空引用）、
  §3-P4（协议版本停在 2024-11-05）、§4（名册供给 / mission 收尾缺工具）：均不在本任务范围。
- **`timeout_ms` 恒 600000 / 无幂等键**：属工具面语义，按 §5.1「只加不删」需另开任务。
- **app 级裸 500 仍在**：非 `/mcp` 路径的裸 500（`{"code":500,...}`）**保持原样** ——
  那是业务 API 的既有契约，本任务只收敛 MCP 端点（改它属范围外改动）。
