# task_088 cli-transport: dsh worker adapter——DeepSeek Harness 接入为第四种 CLI worker

## 描述

桥 A：dsh 作为第四种 CLI worker 接入 cli-transport，与 claude/kimi 平级。方案：docs/DSH-INTEGRATION-PLAN.md 第 1 节（先读它）。

## Requirements

1. **先实测契约再写码**：本机跑 `npx -y @deepseek-ai/dsh --help`（或 --profile headless 相关帮助）摸清 headless one-shot 的实际 CLI 契约——参数形状、stdin/stdout 帧格式、退出码。**契约以实测为准，不猜**；实测结果（帮助输出/试跑输出摘录）贴进任务 md。若 npx 拉取失败（网络/源不可达），降级：按 dsh 仓库 docs（headless/README）写契约并明确标注「未经实测」，adapter 照常交付。
2. 新 adapter `src/app/services/cli-transport/adapters/dsh.ts`：实现既有 CliAdapter 端口（拼参数 + 解析一行），模式对齐 adapters/claude.ts 与 kimi 系 adapter。
3. 注册：CLI_ADAPTER_FACTORIES 增补 + custom-agent roster 可用（照 kimi 先例；registry/detect 逻辑里加 which 检测）。
4. 降级语义：本机未安装/npx 失败 → spawn_failed 错误事件（对齐现有错误语义），绝不假成功。
5. cli-transport 既有模块分层纪律不破（transport.ts 端口 / runtime.ts 进程 / adapters 纯函数）。

## deliverables

- src/app/services/cli-transport/adapters/dsh.ts（新增：dsh adapter —— 拼参 + 解析一行）
- src/app/services/cli-transport/adapters/index.ts（出口/注册点：并入 dsh 工厂）
- src/app/services/cli-transport/index.ts（出口点：导出 createDshAdapter / parseDshLine）
- src/core/types.ts（词表即契约：BuiltinAgentKind / AGENT_KINDS / DETECTABLE_AGENT_KINDS 增 dsh）
- src/app/services/agent-detector.ts（检测名单：dsh 进 T1）
- src/hud/screens/onboarding-catalog.ts（AGENT_KIND_LABELS 增 dsh —— roster 可见）
- src/world/appearance/brand-presets.ts（dsh 品牌形象预设）
- src/app/__tests__/cli-transport-dsh.test.ts（新增：单测 25 条）
- docs/AGENT-MATRIX.md（T1 名册加 dsh 行）

---

## 契约实测记录（2026-11-02，真机）

> 环境：macOS · node v22.22.2 · npm/npx 10.9.7 · `@deepseek-ai/dsh` **0.2.1-rc.5**（npx 按需拉取）
> 契约来源优先级（按 07:42 补充）：**本地源码 `/Users/kingj/code/deepseek-harness` > npx 实测 > 远端 docs**
> ——本节所有条目都做了「npx 实测」与「本地源码」双向印证，两者一致。

### ① launcher 契约（`npx -y @deepseek-ai/dsh --help`，exit 0）

```
Usage: dsh [--profile] <name> [options] [app-args...]
       dsh plugin --profile <name> <pnpm-args...>

dsh: boot a DeepSeek Harness profile — an ordered stack of plugin-bundle patch
layers under your own overrides.

Arguments:
  args                           arguments for the booted profile's app (see:
                                 dsh --profile <name> --help)

Options:
  -V, --version                  output the version number
  --profile <name>               the profile under $DSH_HOME/profiles to boot
  --from-default-profile <name>  replace a custom profile with a fresh copy of a
                                 shipped profile template
  --patch <path>                 extra patch-list overlay applied after the
                                 profile layer (repeatable)
  --dump-config                  print the composed profile tree and exit
  --dump-config-schema           print JSON Schema for profile entries and
                                 patches without mounting
  --dump-default-config          print the profile tree without its user layer
                                 or --patch overlays and exit

Examples:
  dsh web                                   boot the web profile (same as: dsh --profile web)
  dsh rescue --from-default-profile web
                                            recreate rescue from the shipped web template, then boot it
  dsh headless "run the tests"              answer one task, print the result, and exit
  dsh tui --patch ./extra.yml               boot a custom profile with one extra overlay
  dsh tui --resume <session>                arguments after the launcher flags reach the app
  dsh web --help                            the web app's own flags and help
  dsh plugin --profile tui add <package>    install a plugin into the tui profile
```

要点：
- profile 名是**第一个位置参数**（`dsh headless "task"`），`--profile <name>` 与位置参数等价 → adapter 选**显式 `--profile headless`**（不依赖位置顺序，profile 名不与任务文本抢位置）。
- launcher 自身的 `--help` 只管启动器；app 的 flag 要 `dsh --profile <name> --help` 才看得到。

### ② headless app 契约（`npx -y @deepseek-ai/dsh --profile headless --help`，exit 0）

```
Usage: dsh --profile headless [options] [task...]

Answer one task and exit; the answer goes to stdout and diagnostics to stderr.

Arguments:
  task               the task text; multiple words are joined by spaces, and `-`
                     reads stdin

Options:
  --json             write newline-delimited run events to stdout instead of the
                     final message
  --session-id <id>  adopt the persisted Session with this id; an unknown id is
                     an error
  -h, --help         show this help

Examples:
  dsh --profile headless "run the tests"          answer one task and exit
  echo "run the tests" | dsh --profile headless   read the task from stdin
  dsh --profile headless --json "run the tests"   emit machine-readable run events
  dsh --profile headless --session-id session-… "continue"   resume an existing Session
```

要点：
- **one-shot runner**：一次调用一个任务，答完就退出（无交互、无常驻进程）。
- 任务文本 = 位置参数（**多词会被 join 成空格**）→ adapter 把 prompt 作为**单个 argv 元素**传入，语义与 CLI 一致，且不经 shell 不会被拆词。
- `--json` = stdout 吐**换行分隔的运行事件**；不带 `--json` 时 stdout 只有最终答案。
- `--session-id <id>` = 认领已持久化 Session；**未知 id 是错误**（不是静默开新会话）。
- 凭据：headless profile **禁用**托管凭据库，API-key 路由按「启动环境 → `<cwd>/.env` → `$DSH_HOME/.env`」顺序取（本地源码 `packages/bundle/headless/README.md` 明文；实测报错文案亦指向 `DEEPSEEK_API_KEY`）。

### ③ 真机试跑（`npx -y @deepseek-ai/dsh --profile headless --json "回复 pong"`）

stdout：
```json
{"type":"session","sessionId":"session-bbf0b701-00b7-475c-afa2-f1c4db8c1d9d","cwd":"/private/tmp"}
{"type":"status","phase":"turn_start","turn":1}
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"status","phase":"step_end","turn":1,"step":1}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"error","error":{"message":"llm-deepseek: no API key for provider route \"deepseek-official\"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment","code":"MISSING_CREDENTIAL"}}}
{"type":"final","text":""}
```
stderr：
```
dsh: MISSING_CREDENTIAL: llm-deepseek: no API key for provider route "deepseek-official"; store DEEPSEEK_API_KEY through the credentials service (the web Models page writes it), or export DEEPSEEK_API_KEY in the launching environment
```
**退出码 = 1**（失败）。

要点：
- 本机没配 `DEEPSEEK_API_KEY` → CLI 自报失败，**stderr 一行 `dsh: <CODE>: <原因>`**，exit 1。
- `--json` 模式下 stdout 是事件流；**turn_end 的 `reason.kind='error'` 携带结构化失败原因**（`error.message` / `error.code`）。
- 失败时 `final.text` 是空串（`final` 事件仍出现）——**所以 `final` 不能当成功信号**，成功与否看 exit code + `reason.kind`。
- 「答出问题」的那条路径本机无法实测（缺 API key）：**已实测到的是成功路径的 `session` 事件 + 失败路径的完整错误帧**；`text`/`thinking`/`tool_call`/`tool_result` 四类事件的字段形状由本地源码 `projectJsonRun` 逐字段印证（见 ⑤），**标「源码印证，未带凭据实跑」**。

### ④ 未知 session id（`--session-id session-x`）

stdout：
```json
{"type":"error","message":"session \"session-x\" does not exist; omit --session-id to start a new Session"}
```
stderr：`dsh: session "session-x" does not exist; omit --session-id to start a new Session`
**退出码 = 1**。

要点：致命错误走**顶层 `error` 事件**（不是 status/turn_end）→ adapter 必须单独认这一类事件，否则错误只会落进 stderr 尾巴（错误码更粗）。

### ⑤ 事件形状 × 本地源码逐字段印证（`/Users/kingj/code/deepseek-harness/packages/bundle/headless/src/json-stream.ts`）

`projectJsonRun` 写出的事件（源码行号 ↔ 字段）：

| 源码位置 | 事件 | 字段 |
|---------|------|------|
| L262 | `status` | `{phase:'turn_start', turn}` |
| L265 | `status` | `{phase:'step_start', turn, step}` |
| L283 | `status` | `{phase:'step_end', turn, step, usage?}` |
| L291 | `status` | `{phase:'turn_end', turn, reason}` ← reason = `turn/end` 的 reason |
| L275 | `thinking` | `{text}`（reasoning 块） |
| L276 | `text` | `{text}`（回答文本） |
| L294-298 | `tool_call` | `{callId, tool: event.data.name, input}` ← input 是**已解析的 JSON**（空串→`{}`） |
| L307-311 | `tool_result` | `{callId, status:'completed'|'error', result, error?}` ← result = 文本块拼接 |
| L320 | `session` | `{sessionId: agent.id, cwd}` ← 流的开头 |
| L327 | `final` | `{sessionId, reason, text}` ← 流的结尾（text 不截断） |

`reason` 的取值域（本地源码 `packages/core/session/src/types.ts` L206 `TurnEndReasonMap`）：
`completed / aborted / blocked / error / max-tokens / interrupted / forked`；
其中 `error` 的形状是 `{kind:'error', error:{message, code}}`（`LlmFailure`）。

> 结论：**实测与本地源码完全一致**，无冲突项。adapter 的解析口径即按此表实现。

### ⑥ 退出码与 profile 自动铺设

- 退出码：**0 = 任务完成；1 = 中止或出错**（本地源码 `packages/bundle/headless/README.md` + 实测 exit=1 互证）。
- profile 自动铺设：实测**全新 `DSH_HOME` 也能跑**——

```
DSH_HOME=/tmp/dsh-fresh-home npx -y @deepseek-ai/dsh --profile headless --json "回复 pong"
→ exit 1（同样只因缺 API key），stdout 照常吐事件流
$ find /tmp/dsh-fresh-home -maxdepth 2
/tmp/dsh-fresh-home/profiles/headless      ← dsh 自动从内置模板铺出来的 headless profile
/tmp/dsh-fresh-home/sessions/--private-tmp--
/tmp/dsh-fresh-home/storages/session_projcache
```
即：**用户不需要先手动建 profile**。

### ⑦ 版本探测

```
$ which npx            → /Users/kingj/.nvm/versions/node/v22.22.2/bin/npx
$ npx --version        → 10.9.7
$ npx -y @deepseek-ai/dsh --version → 0.2.1-rc.5
```

---

## 实现摘要

| 文件 | 改动 | 性质 |
|------|------|------|
| `src/app/services/cli-transport/adapters/dsh.ts` | **新增**：拼参 + 解析一行（纯函数） | 本任务主体 |
| `src/app/services/cli-transport/adapters/index.ts` | 注册 `dsh` 工厂 + 出口类型 | 注册点（小改） |
| `src/app/services/cli-transport/index.ts` | 导出 `createDshAdapter` / `parseDshLine` / 常量 | 出口点（小改） |
| `src/core/types.ts` | `BuiltinAgentKind` / `AGENT_KINDS` / `DETECTABLE_AGENT_KINDS` 增 `dsh` | 词表即契约（必改：`CliAdapter.kind` 的类型就是 `AgentKind`） |
| `src/app/services/agent-detector.ts` | T1 检测目标加 `dsh` | 检测名单（见下方偏差说明） |
| `src/hud/screens/onboarding-catalog.ts` | `AGENT_KIND_LABELS.dsh = 'DeepSeek Harness'` | 显示名（roster 可见） |
| `src/world/appearance/brand-presets.ts` | `DSH_PRESET` 品牌形象 | 战场形象（`Record<DetectableAgentKind,…>` 强制补齐） |
| `src/app/__tests__/cli-transport-dsh.test.ts` | **新增** 25 条单测 | 拼参/解析/三路径/注册可见性 |
| `docs/AGENT-MATRIX.md` | T1 矩阵加 dsh 行 | 名册文档（权威 roster 文档） |
| `src/app/__tests__/{cli-transport,agent-detector,health-monitor}.test.ts`、`src/world/appearance/__tests__/brand-presets.test.ts`、`src/hud/__tests__/onboarding-custom-agent.test.ts` | 只改**计数/名单断言**（12 项、T1 六家），不动既有逻辑 | 跟随词表扩容的必要断言同步 |

**既有 adapters 文件零改动**（git diff 验证）：`adapters/claude.ts`、`adapters/kimi.ts`、`adapters/codex.ts`、`adapters/opencode.ts`、`adapters/openclaw.ts`、`adapters/custom.ts` 均无 diff；`adapters/` 下唯一 diff 是 `index.ts`（注册点）。

## adapter 契约（公共事件映射）

| dsh 事件 | → 公共 TransportEvent | 说明 |
|-----------|---------------------|------|
| `session` | `session{sessionId}` | 会话 id **原样透传**（不解释不改写） |
| `text` | `message{text}` | 回答文本 |
| `thinking` | —（丢弃） | 推理块不是「agent 说的话」 |
| `tool_call` | `tool_use{tool,input,id=callId}` | |
| `tool_result` | `tool_result{id=callId,text=result}` | 工具自身报错**不**升格成整轮失败 |
| `status/turn_end` + `reason.kind='error'` | `error{code:'cli_error', message}` | 取 `reason.error.message` |
| `status/turn_end` + `reason.kind='blocked'` | `error{code:'cli_error'}` | 「这一轮没成」 |
| `status/turn_start|step_start|step_end`、`turn_end` 其余 kind | —（丢弃） | 进度心跳 / 有插件兜住的情形 |
| 顶层 `error` | `error{code:'cli_error', message}` | 致命错误直述（未知 session id 等） |
| `final` | —（丢弃） | 与 `text` 事件是同一段回答，重复上送会双写聊天记录 |
| 非 JSON 行 / 未知事件类型 | —（丢弃） | 协议演进留口，不因新事件类型崩掉 |

拼参：`npx -y @deepseek-ai/dsh --profile headless --json [--session-id <id>] "<task>"`（包名/profile 可覆盖；prompt 单个 argv 元素）。

## 降级语义（需求④）

| 场景 | 表现 | 绝不做的事 |
|------|------|-----------|
| 本机无 npx（spawn 抛错） | `error{code:'spawn_failed'}` | 不补 done |
| npx 在但拉不到包（断网 / 源不可达） | npx 非 0 退出 → `error{code:'nonzero_exit'}` | 不假装成功 |
| 缺 API key | dsh 自报 → `error{code:'cli_error'}`（turn_end reason.error）+ exit 1 → 再一条 `nonzero_exit` | 不补 done |
| 未知 `--session-id` | 顶层 `error{code:'cli_error'}` + exit 1 → `nonzero_exit` | 不补 done |

runtime 侧既有语义保证：**报过错就不补 done**（`runtime.ts` 的 `failed` 标记）。

## Acceptance

- [x] 契约实测记录（或降级标注）贴进任务 md —— 见上「契约实测记录」①-⑦（npx 拉取成功，**非降级**；`text`/`thinking`/`tool_call`/`tool_result` 四类标「源码印证，未带凭据实跑」）
- [x] fake process factory 单测：拼参/解析行/spawn_failed 三路径全绿 —— `cli-transport-dsh.test.ts` 25 条全绿
- [x] 注册后 custom-agent 面可见 dsh 选项（代码级验证即可） —— 同文件「dsh 注册」describe：词表 / `CLI_ADAPTER_FACTORIES.dsh` / `createAdapter('dsh')` / 检测目标 / `AGENT_KIND_LABELS.dsh` 全断言；另改 `onboarding-custom-agent.test.ts` 的完成度文案断言
- [x] npx tsc --noEmit 0 错 + npx jest 全绿 —— 见下「验证输出」
- [x] adapters 既有文件（claude/kimi/custom）零改动（git diff 验证） —— `git diff -- src/app/services/cli-transport/adapters/` 只有 `index.ts`

## 与需求的偏差说明

**检测命令用 `which npx` / `npx --version`，而不是 `which dsh`。**
理由（写在 `agent-detector.ts` 注释里）：
- dsh **无本地安装**（按需 `npx -y` 拉取）。探 `which dsh` 恒为「未安装」→ 健康监控两轮后判离线 → 派单/对话被直接挡掉，dsh 永远用不了；
- 探 `npx -y @deepseek-ai/dsh --version` 又要拉包（冷缓存数十秒），会撞穿检测器 10s 超时 → 恒超时 → 同样判离线；
- 故探**运行器 npx 本身**（离线、免网络、秒回），版本列显示 npx 版本；dsh 自己的版本由 dsh 在运行时自报（`dsh --version` → 0.2.1-rc.5），不依赖检测器。

代价：检测器无法区分「npx 在但 dsh 拉不动」——那种情况在**调用时**才暴露为 `nonzero_exit`（真失败，非假成功）。这是刻意的取舍：宁可运行时失败一次，也不要在检测期把 dsh 永久判死。

## 未尽事项

1. **「成功出答案」那条路径没带凭据实跑**：本机无 `DEEPSEEK_API_KEY`，`text`/`tool_call`/`tool_result` 三类事件的**真实字节**未拿到（字段形状由本地源码 `projectJsonRun` 逐字段印证）。配好 key 后建议再跑一次真机回归，把 `text` 帧的原文补进本节。
2. **凭据注入未做**：headless 只认「启动环境 → `<cwd>/.env` → `$DSH_HOME/.env`」。adapter 预留了 `env` 选项（可注入 `https_proxy` / `DEEPSEEK_API_KEY`），但**谁在什么时机注入**属于上层调度（gateway / worker 派单）的事，本任务未动（超出「最小改动」与桥 A 边界）。
3. **`--session-id` 的续接语义只验到失败侧**：未知 id 报错已实测；「认领已持久化 Session 并续接」需要先跑成功一轮攒出 session id，未实测。
4. **dsh 是 dev preview**：事件协议会有破坏性变更（上游自述）。adapter 已对未知事件类型留口（跳过不崩），但字段级破坏仍需按上游更新同步。

---

> **2026-11-02 07:42 补充**：dsh 源码在 `/Users/kingj/code/deepseek-harness`（本地克隆，npx 之外的第二契约来源；headless 契约看 `packages/bundle/headless/`）。契约冲突时优先级：本地源码 > npx 实测 > 远端 docs。
