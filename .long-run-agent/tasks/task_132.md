# task_132

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_132.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 见下方「交付物」

**这是配置文件**，不是最终产出！

## 描述

协议层错误文案修正（N3 P5）-模块

## requirements

- 通读 MCP 传输层与工具层的全部错误文案，逐条与**实际触发条件**比对，修掉「文案≠事实」的每一处（不止 content-type 一处）。
- content-type 被拒时，文案必须说清「Content-Type 应为 application/json」级别的真实原因，不得说成「帧不合法」。
- 文案风格对齐既有四段式人话风格：说什么错了 / 为什么 / 怎么改（message + data.reason + data.hint）。
- **不动错误码分型**（task_118 的 -32700 / -32600 / -32601 / -32602 / -32603 触发点逐条不变）；不引新依赖；最小改动。

## acceptance

- [x] content-type 错误时文案准确描述「Content-Type 应为 application/json」级别的真实原因。
- [x] 全部错误路径（畸形 JSON / 空 body / 未知方法 / 未知工具 / 参数缺失 / content-type / accept 头）逐个 curl 实测，文案与触发条件一一对应，对照表贴在交付里。
- [x] 错误码分型不变（118 层）。
- [x] `npx tsc --noEmit` + `npx jest src/stratix-gateway/mcp` 绿。
- [x] 结束时网关在跑（7524 LISTEN）。

## 交付物

**改动文件（4 个源/文档 + 1 个本任务文件）**

| 文件 | 改动 |
|------|------|
| `src/stratix-gateway/mcp/transport/http.ts` | 传输层改成**收原始字节**（`express.raw`）自己判 Content-Type / Accept / 空 body / 字符集 / strict；每条拒绝路径的文案与**真实触发条件**一一对应 |
| `src/stratix-gateway/mcp/server.ts` | `describeInvalidRequest()` —— 帧不合法时点名是 `jsonrpc` / `method` / `id` 哪个字段不对、`received` 精确到 `empty` / `array` / `object`；未知方法 / 未知工具 / 缺工具名 / 未捕获异常补 `data.hint`；stdio 与 HTTP 共用 `jsonRpcParseError()` |
| `src/stratix-gateway/mcp/__tests__/error-envelope.test.ts` | 新增 14 条用例锁住「文案 == 触发条件」（分型由既有用例锁） |
| `docs/MCP-SPEC.md` | §4.4 传输层错误表扩充 + 新增「文案必须与真实触发条件一一对应」纪律段；附录 A 协议层错误表同步；§5.5 追加 v1.13 行；抬头版本 v1.12 → v1.13 |
| `.long-run-agent/tasks/task_132.md` | 本文件（工作记录） |

**错误码分型：零改动**（task_118 的 `-32700` / `-32600` / `-32601` / `-32602` / `-32603` 触发点逐条未变；本任务只改文案与 `data` 细节）。

## 验证证据（完成前必填）

- [x] **实现证明**:
  - 传输层不再用 `express.json()`（它把「空 body」/「Content-Type 不对」/「JSON 数组」统统压成同一个空对象 → 文案只能撒谎），改用 `express.raw({type: () => true})` 收**原始字节**，由本文件自己按顺序判：① 空 body → ② Content-Type → ③ Accept → ④ 字符集 → ⑤ JSON 解析（strict）→ ⑥ 交协议层。
  - `server.ts` 新增 `describeInvalidRequest()`：把「帧不合法」拆成「缺 `jsonrpc`」/「`jsonrpc` 版本错」/「缺 `method`」/「`method` 类型错」/「`id` 类型错」/「顶层是数组」/「顶层是裸标量」七种，各自给出 message + `data.reason` + `data.hint`。
  - 工具层十九件工具的文案逐条比对过，**未发现文案≠事实**（args.ts 的「缺失 / 类型不对 / 不能为空」已分型，chat_send 的 not_available 已由 task_125 修正）→ 工具面零改动。

- [x] **测试验证**:
  - `npx tsc --noEmit` → exit 0
  - `npx jest src/stratix-gateway/mcp --maxWorkers=2` → **16 suites / 193 tests 全绿**
  - `npx jest src/stratix-gateway --maxWorkers=2` → **26 suites / 300 tests 全绿**（传输层改动不影响其它网关路由）
  - `npx eslint --cache` 改动文件 → 0 error
  - 网关重启后逐路径 curl 实测（见下表），请求/响应原文对照。

- [x] **影响范围**: 仅 MCP 协议层（HTTP 传输 + 协议分发）与规范文档。工具面零变更（十九件工具的名字 / 参数 / 语义 / 返回形状 / `tools/list` 顺序全部未动）；成功路径逐字未变；HTTP 状态码恒 200、通知类 202 的纪律未变。

### 测试步骤

1. `npx tsc --noEmit`
2. `npx jest src/stratix-gateway/mcp --maxWorkers=2`
3. `npx jest src/stratix-gateway --maxWorkers=2`
4. 重启网关：`kill $(lsof -nP -i :7524 | grep LISTEN | awk '{print $2}')` → `nohup sh -c 'PORT=7524 npm run start:dev' >/tmp/stratix-gw-7524.log 2>&1 &` → 等 4s
5. 按下表逐条 curl `http://127.0.0.1:7524/mcp`，对照「文案 vs 触发条件」

### 错误路径对照表（curl 实测，请求 → 响应）

| # | 请求 | 错误码 | 响应 message（改后） | 与触发条件是否一致 |
|---|------|--------|---------------------|------------------|
| 1 | 畸形 JSON `{"jsonrpc":"2.0","id":1,"method":` | -32700 | 请求体不是合法 JSON（解析失败） | ✅ |
| 2 | 空 body | -32600 | 请求体为空：没有可解析的 JSON-RPC 帧（`received:"empty"`） | ✅ 改前：`received:"object"`（说是对象 —— 假的） |
| 3 | 缺 Content-Type 头 | -32600 | 请求缺少 Content-Type 头（本端点只收 application/json） | ✅ 改前：「帧不是合法 JSON-RPC」 |
| 4 | `Content-Type: text/plain` + **合法帧** | -32600 | 请求的 Content-Type 应为 application/json（本次收到 text/plain） | ✅ **本任务主诉（N3）**：帧是合法的，被拒的是 Content-Type |
| 5 | `Content-Type: application/x-www-form-urlencoded`（curl `-d` 默认） | -32600 | 同上（本次收到 application/x-www-form-urlencoded） | ✅ |
| 6 | `Content-Type: application/json; charset=utf-8` | — | 正常回 `{"result":{}}` | ✅ 不误伤 |
| 7 | JSON 数组 body | -32600 | 请求体是一个 JSON 数组，不是 JSON-RPC 2.0 请求帧（`received:"array"`） | ✅ 改前：`received:"object"` |
| 8 | 裸标量 body `123` | -32700 | 严格解析失败：请求体顶层必须是 JSON 对象或数组（本次是裸标量） | ✅ `123` **是**合法 JSON，不能说「不是合法 JSON」 |
| 9 | 缺 `jsonrpc` 字段 | -32600 | 请求帧缺 jsonrpc 字段（JSON-RPC 2.0 要求 "jsonrpc": "2.0"） | ✅ 点名字段 |
| 10 | `jsonrpc:"1.0"` | -32600 | 请求帧的 jsonrpc 字段必须是 "2.0"（本次收到 "1.0"） | ✅ |
| 11 | 缺 `method` 字段 | -32600 | 请求帧缺 method 字段（JSON-RPC 2.0 要求 method 是方法名字符串） | ✅ |
| 12 | `id:true` | -32600 | 请求帧的 id 字段类型非法（只允许 string / number / null，本次收到 boolean） | ✅ |
| 13 | 未知方法 `tools/frobnicate` | -32601 | 未知方法「tools/frobnicate」+ hint 列可用方法 | ✅ |
| 14 | 未知工具 `stratix_not_exist` | -32602 | 未知工具「stratix_not_exist」+ hint 指向 tools/list | ✅ |
| 15 | `tools/call` 缺工具名 | -32602 | tools/call 缺少工具名 + hint 指向 tools/list | ✅ |
| 16 | `task_assign` 缺 `prompt` | invalid_arguments（信封） | 参数 prompt 缺失 / hint 补齐必填参数 prompt 后重试 | ✅ |
| 17 | `task_assign` 的 `character:123` | invalid_arguments（信封） | 参数 character 必须是字符串 | ✅ |
| 18 | `Accept: text/plain` | -32600 | 请求的 Accept 头未包含 application/json（本端点只回 JSON 帧） | ✅ 新增路径（改前：静默放行） |
| 19 | `Accept: application/json, text/event-stream` | — | 正常放行 | ✅ |
| 20 | Accept 缺省 | — | 正常放行（简单客户端常省这个头，不误伤） | ✅ |
| 21 | `GET /mcp` | -32600 | MCP 端点只接受 POST（JSON-RPC 帧）；第一期不提供 SSE 推送端点 + hint | ✅ |
| 22 | 通知（无 id） | — | HTTP 202 空体 | ✅ |
| 23 | body > 1mb | -32600 | 请求体超过 1mb 上限 + hint「把请求体拆小后重发」 | ✅ 改前：'Invalid Request'（没说超了什么） |
| 24 | 回归 `initialize` | — | protocolVersion 2024-11-05 / serverInfo stratix | ✅ |
| 25 | 回归 `tools/list` | — | 19 件工具，首 `stratix_world_snapshot`、末 `stratix_character_edit` | ✅ |

### 验证结果（命令输出原样）

```
$ npx tsc --noEmit
TSC_EXIT=0

$ npx jest src/stratix-gateway/mcp --silent --maxWorkers=2
Test Suites: 16 passed, 16 total
Tests:       193 passed, 193 total

$ npx jest src/stratix-gateway --silent --maxWorkers=2
Test Suites: 26 passed, 26 total
Tests:       300 passed, 300 total

$ npx eslint --cache src/stratix-gateway/mcp/transport/http.ts src/stratix-gateway/mcp/server.ts
✖ 1 problem (0 errors, 1 warning)   # warning = 测试文件被 eslint ignore 覆盖

$ lsof -nP -i :7524 | grep LISTEN
node    29103 kingj   29u  IPv4 0xf158c48688088064      0t0  TCP 127.0.0.1:7524 (LISTEN)
```

（逐路径 curl 的请求/响应原文见上表；实测时网关为改后代码，PID 29103。）
