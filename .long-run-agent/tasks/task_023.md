# task_023

## ⚠️ 重要提示（Agent 必读）

**当前位置**: `.long-run-agent/tasks/task_023.md`（任务描述文件）

**工作目录**: 项目根目录（`.long-run-agent` 的同级目录）

**产出物**: 代码 + 测试

## 描述

agent-link: CliTransport 抽象 + Claude/Codex/OpenCode/Kimi/OpenClaw 五家 adapter-模块

## requirements

src/app/services/cli-transport/：CliTransport 抽象 spawn(prompt,{sessionId?})→AsyncIterable<TransportEvent{type:message|tool_use|done|error,...}> + AbortSignal 取消。adapter：claude（-p --output-format stream-json --resume）、codex（exec --json）、kimi（--yolo --prompt --session）、opencode（run，serve 探测失败降级）、openclaw（sessions API 或 CLI）。会话 id 原样透传存 AgentProfile.externalSessionId。

## design

参考 docs/AGENT-MATRIX.md「集成要点」。真机 claude 往返用 -p "回复 pong" 验证。spawn 一律注入 child_process 工厂保可测。

## acceptance

- tsc 零错误
- 每家 adapter 有假 stdout 流的单测（喂样例 JSONL 断言事件序列）
- AbortSignal 触发进程树终止的单测
- jest 新增套件全绿
- 真机与 claude adapter 跑通一轮 echo 往返

## 交付物

按 design 落地的新增/修改文件 + 对应测试

## 验证证据（完成前必填）

- [x] **实现证明**: 简要说明如何实现
- [x] **测试验证**: typecheck + 对应目录 jest 输出原样贴出
- [x] **影响范围**: 是否影响其他功能

### 实现说明

分层（自底向上，全在 `src/app/services/cli-transport/`）：

1. `transport.ts` —— **词汇表与端口**（纯类型 + 纯函数）：
   - 公共事件词汇表 `TransportEvent = message | tool_use | tool_result | session | done | error`
     （AGENT-MATRIX「集成要点」第 1 条）；`session` 事件承载各家的会话 id，**原样透传**
     给 `AgentProfile.externalSessionId`（第 4 条）。
   - `CliAdapter`（纯函数契约）：`buildArgs(prompt, {sessionId})` + `parseLine(line)` + `outputMode`；
     `ProcessFactory`（子进程注入点）→ `CliProcessHandle{stdout/stderr 逐行, exit, killTree}`。
2. `runtime.ts` —— **进程生命周期统一实现一次**（各家不重复）：
   拉进程 → 逐行喂 adapter → 出事件；`AbortSignal`/超时 → `killTree`（第 5 条）→
   `error{aborted|timeout}`；非 0 退出 → `error{nonzero_exit}`（带 stderr 尾巴）。
   子进程只经注入的 `ProcessFactory`，**runtime 不 import child_process**（可测）。
3. `node-process.ts` —— 生产用真实工厂：`spawn` 时 `detached:true`（POSIX 自成进程组），
   `killTree` 用 `process.kill(-pid)` **杀整组**（含孙进程）；Windows 走 `taskkill /T /F`。
   **不引第三方 tree-kill 包**（不新增依赖）。
4. `adapters/*.ts` —— 五家**纯** adapter（拼参数 + 解析一行），事件翻译到公共词汇表：
   - claude：`-p <prompt> --output-format stream-json --verbose --permission-mode bypassPermissions`，
     会话 id → `--resume`；认 `system/init`（session）、`assistant`（text→message、tool_use→tool_use）、
     `user`（tool_result）、`result`（is_error→error）。
   - codex：`exec --json`，会话 id → `exec resume <id>`；**新旧两代格式都认**
     （新 `type/item.*`、旧 `msg.*` 信封 —— 只认一代会在版本切换时整轮静默）。
   - opencode：`run --format json`；**先探测 serve 端口**（TCP connect，注入可替换）——
     探测到 → `--attach <url>`；探测失败 → 降级为不带 `--attach` 的 run（探测失败**不是错误**）。
   - kimi：`--yolo --prompt`，会话 id → `--session`；输出是**纯文本**（text 模式，整段一条 message，
     不逐行拆成几十条聊天记录）。
   - openclaw：`agent --message <p> --json`，会话 id → `--session-id`；输出是 **pretty-print 的
     一个 JSON 文档**（故是 json 模式而非 jsonl —— 逐行解必然失败）。

不碰 `src/world` / `src/hud`；不新增依赖；core 侧只**读** `core/types.ts` 的 `AgentKind`/`AGENT_KINDS`
（不新增契约字段）。

### 验证结果

**1) typecheck（零错误）**

```
$ npm run typecheck
> stratix@0.1.0 typecheck
> tsc --noEmit
EXIT=0

$ npx tsc -p tsconfig.test.json --noEmit
TEST_TSC_EXIT=0
```

**2) jest（src/app 全量，5 套件 67 测试全绿）**

```
$ npx jest src/app --silent
PASS src/app/__tests__/agent-detector.test.ts
PASS src/app/__tests__/hello-loop.test.ts
PASS src/app/__tests__/main-layout.test.ts
PASS src/app/__tests__/cli-transport.test.ts
PASS src/app/__tests__/cli-transport-adapters.test.ts

Test Suites: 5 passed, 5 total
Tests:       67 passed, 67 total
Snapshots:   0 total
Time:        2.444 s
```

新增套件明细（`npx jest src/app/__tests__/cli-transport --maxWorkers=1`）：

```
PASS src/app/__tests__/cli-transport.test.ts
  CliTransport 抽象
    ✓ 五家 adapter 齐备，且与 core 的 AGENT_KINDS 一一对应
    ✓ 每家 adapter 都声明了自己的 kind / binary / 输出形态
  runtime：样例 stdout 流 → 事件序列
    ✓ claude：system/assistant/user/result 四类事件翻译正确
    ✓ codex：新格式（item.*）事件翻译正确
    ✓ codex：旧格式（msg.* 信封）也认（版本切换不能整轮静默）
    ✓ opencode：文本 part 与工具事件都认
    ✓ opencode：CLI 自报的错误转成 error 事件（不再补 done）
    ✓ kimi：纯文本输出整段作为一条 message（不逐行拆）
    ✓ openclaw：pretty-print 的 JSON 整段解（不是 JSONL）
    ✓ 非 0 退出：stderr 尾巴进 error 事件（不留空白错误信息）
  runtime：AbortSignal → 终止进程树
    ✓ 取消：killTree 被调用，且流以 error{aborted} 收尾
    ✓ 取消信号在 spawn 前就已 aborted：立刻终止，不产生任何输出事件
    ✓ 超时：走同一条终止路径，只是错误码是 timeout
  真机：杀进程树（孙进程必须一起死）
    ✓ 取消后孙进程被一并终止（只杀直接子进程会留下孤儿）

PASS src/app/__tests__/cli-transport-adapters.test.ts
  adapter.buildArgs：headless 命令形态（5 家各 1 条 + 会话 id 透传 3 条）
  adapter.parse：各家格式 → 公共事件词汇表（10 条）
  opencode：serve 探测 → --attach / 降级（3 条）

Test Suites: 2 passed, 2 total
Tests:       34 passed, 34 total
```

**3) 真机往返（claude，真跑不是 mock）**

```
$ npm run smoke:cli-transport
[cli-transport] claude-code · binary=claude · args=-p 回复 pong --output-format stream-json --verbose --permission-mode bypassPermissions
[cli-transport] event session  c1255565-afb5-45b5-978c-5b18f587d228
[cli-transport] event message  pong
[cli-transport] event done     exitCode=0 session=c1255565-afb5-45b5-978c-5b18f587d228
[cli-transport] 往返完成
```

会话 id 透传（第二轮带 `--resume` 接同一会话）：

```
$ npm run smoke:cli-transport -- claude-code "回复 pong2" c1255565-afb5-45b5-978c-5b18f587d228
[cli-transport] claude-code · binary=claude · args=-p 回复 pong2 --output-format stream-json --verbose --permission-mode bypassPermissions --resume c1255565-afb5-45b5-978c-5b18f587d228
[cli-transport] event message  pong2
[cli-transport] event done     exitCode=0 session=c1255565-afb5-45b5-978c-5b18f587d228
[cli-transport] 往返完成
```

claude 原始输出片段（`claude -p "回复 pong" --output-format stream-json --verbose --permission-mode bypassPermissions`）：

```
{"type":"system","subtype":"init","cwd":"/private/tmp","session_id":"7dffe5db-28e9-4bc6-b9d9-89ce93654a4a", ... "permissionMode":"bypassPermissions", ...}
{"type":"assistant","message":{"id":"0728f80f...","type":"message","role":"assistant","content":[{"type":"text","text":"pong"}],"model":"MiniMax-M3.1-Flash",...},"session_id":"7dffe5db-28e9-4bc6-b9d9-89ce93654a4a",...}
{"duration_api_ms":1147,"stop_reason":"end_turn","session_id":"7dffe5db-...","total_cost_usd":0.08906500000000002,"usage":{...},"is_error":false,"num_turns":1,"subtype":"success","result":"pong","type":"result","duration_ms":1235,...}
```

（对照：adapter 把 `system/init` 译成 session 事件、`assistant.content[text]` 译成 message、
`result` 不再重复上送文本 —— 由 done 事件带 `text`（= 最后一条 message）。）

**4) 附带真机（kimi，装了但鉴权过期）**

```
$ npm run smoke:cli-transport -- kimi "回复 pong"
[cli-transport] kimi · binary=kimi · args=--yolo --prompt 回复 pong
[cli-transport] event message  Authorization failed. Your session may have expired. ...
[cli-transport] event error    [nonzero_exit] To resume this session: kimi -r 897873ea-c53d-4574-991b-bf0411585284
```

→ 传输层链路（拉起 → text 模式整段收 → 非 0 退出带 stderr）**通**；失败原因是 kimi 自己的
API Key 过期（401），与本任务无关。

### 影响范围

- **新增**（无既有文件行为改变）：`src/app/services/cli-transport/**`（8 个源文件）、
  `src/app/__tests__/cli-transport*.test.ts`、`src/app/__tests__/helpers/fake-process.ts`、
  `scripts/smoke-cli-transport.ts`。
- **修改**：`package.json` 加一条 `smoke:cli-transport` 脚本；`.long-run-agent/tasks/task_023.md`
  本文件填验证证据。
- 未碰 `src/world`、`src/hud`、`src/core`、`src/electron`；core 只**读** `AgentKind`。
- 未新增任何依赖（杀树用 Node 内置 `process.kill(-pid)` / `taskkill`）。

### 未尽事项

- codex 本机**未安装**（`which codex` 无结果）→ codex adapter 只有假流单测，**未做真机往返**；
  其命令形态 `codex exec --json` / `codex exec resume <id>` 与两代事件格式依据 AGENT-MATRIX 与
  codex 公开格式实现，待装上后需真机核对一次。
- opencode 本机装了但**模型不可用**（默认 `zai/glm-5` 不存在；`alibaba/qwen-flash` 401）→
  事件解析按「扁平信封（本机实测到的 error 形状）」+「SDK 事件总线形状」两族都认写的，
  **文本 part 的真机形状未验证**。
- openclaw 本机 gateway 未跑（`openclaw agent` 需 `--to/--session-id/--agent` 三选一）→
  只有假流单测；输出信封形状依据本机 openclaw 2026.4.2 源码 `buildOutboundResultEnvelope` 推导。
- 传输层目前**只到事件流**为止：接 core bus → ChatMessage → gateway SQLite 落库
  （AGENT-MATRIX「集成要点」第 6 条）不在本任务范围，未接。

