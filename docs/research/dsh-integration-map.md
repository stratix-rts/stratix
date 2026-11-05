# dsh 集成面测绘 —— 外部驱动口 / 双向兼容结合点 / working-directory 映射

> **调研 B**（task_158）。纯只读调研，产出本文件。
> **dsh 仓库**：`/Users/kingj/code/deepseek-harness`，**HEAD `fcc0ad4621`**（提交标题即「Merge pull request #7873 … merge/release-dsh-0.2.2-rc.1-to-master」），版本 `@deepseek-ai/dsh-root@0.2.2-rc.1`（`package.json:3`）。本地 `master` 与本地跟踪引用 `origin/master` 同为 `fcc0ad4621`；`git ls-remote` 在本机**网络不可达**（`curl 28 Failed to connect to github.com port 443`），故**未执行 `git pull`**——既因任务禁止对该仓库的写操作，也因网络不通；工作树已是 rc.1 最新。调研期间**零写操作**（`git status --porcelain` 为空）。
> **路径约定**：本文所有 `packages/…` / `apps/…` / `docs/…` 路径均相对 **dsh 仓库根**；所有 `src/…` / `plugins/…` 路径相对 **Stratix 仓库根**（`/Users/kingj/code/Stratix-demo`）。
> **姊妹文档**：调研 A（dsh 插件架构深读）见 `docs/research/dsh-architecture.md`（task_157，其 HEAD 为 `ce7073d5`）。本文不依赖它，可独立阅读；两者在 Cordis 版本一节有**口径差异**，见 §0.2。
> **二试说明**：上一 worker 的草稿基于 `0.2.2-alpha.2` 写成。本文**保留其分析骨架与已核实结论**，按 rc.1 HEAD 逐条复核了全部引用行号与论断，并补入 rc.1 的增量（见 §0.1）。**行号已全面校正**（多处偏移 ±1~9），另有 5 处**实质性论断更正**（见 §0.1 表）。
> **已有落地资产**：Stratix 侧已存在桥 A（`src/app/services/cli-transport/adapters/dsh.ts`）与桥 B spike（`plugins/dsh-bridge/`）；本文给出的是**面**的完整盘点与下一轮可选项，非重复已有实现。

---

## 目录

- [0. 摘要](#0-摘要)
- [0.1 rc.1 增量与本文对草稿的更正](#01-rc1-增量与本文对草稿的更正)
- [0.2 与姊妹报告（157）的口径差异](#02-与姊妹报告157的口径差异)
- [1. 外部驱动口盘点](#1-外部驱动口盘点)
- [2. 方向 a：作为宿主装 dsh 插件](#2-方向-a作为宿主装-dsh-插件)
- [3. 方向 b：Stratix 作为 dsh 插件](#3-方向-bstratix-作为-dsh-插件)
- [4. workspace / working-directory / worktrees 映射](#4-workspace--working-directory--worktrees-映射)
- [5. 结合点清单](#5-结合点清单)
- [6. 最小可行试点建议](#6-最小可行试点建议)
- [7. 陷阱清单](#7-陷阱清单)
- [附录 A：dsh 关键 ctx 服务速查](#附录-adsh-关键-ctx-服务速查)
- [附录 B：Stratix 侧现存资产索引](#附录-bstratix-侧现存资产索引)
- [附录 C：本次复核的核对方法](#附录-c本次复核的核对方法)

---

## 0. 摘要

**一句话结论**：dsh 提供了**四个层级的驱动口**（一次性 CLI / stdio JSON-RPC / stdio ACP / HTTP+WS Gateway），全部**无协议层鉴权**、全部**单进程单 Node**；作为「插件宿主」它是一台 **Cordis IoC 容器 + YAML patch 配置树**，第三方插件的官方入口是 **Cordis 服务注册表**（`ctx.tools` / `ctx.slots`），而不是「npm 包装上就能用」。

| 层级 | 驱动口 | 传输 | 会话生命周期 | 鉴权 | Stratix 适用度 |
|---|---|---|---|---|---|
| L1 一次性 | `--profile headless` | stdout 文本 / NDJSON | 进程即会话，跑完退出 | 无（凭据走环境变量） | **高**（桥 A 已接） |
| L2 常驻 RPC | `--profile sdk` | stdio JSON-RPC 2.0（NDJSON 分帧） | 进程常驻，**无 cancel / 无 close** | 无 | **高** |
| L3 协议标准 | `--profile acp` | stdio JSON-RPC（ACP v1） | 进程常驻，有 cancel / resume / list | 无（`authMethods: []`） | **中**（标准但语义受限） |
| L4 远程 | `--profile web` | HTTP `POST /api/<ns>/<method>` + WS `/api/remote.mux` | 进程常驻 | **有**（HMAC 签名 Cookie + Origin 信任栅栏） | **中**（唯一带鉴权，也最重） |

**关键判断**（详见 §5 评级）：

1. **Stratix 不应做 dsh 的宿主**（方向 a 的「跑完整 dsh 复用其插件」），只应做 **dsh 的插件宿主**——即把 dsh 的能力通过**进程边界**接进来（桥 A），而不是把 dsh 的 Cordis 运行时嵌进 Stratix 进程。理由见 §2.3。
2. **Stratix 作为 dsh 插件**（方向 b）中最有价值的形态是 **tools provider**（`ctx.tools.register`）——已有 spike `plugins/dsh-bridge/` 跑通；**client-ui 插件**（浏览器侧 React 组件）技术上可行但与 Stratix 现有 Electron/Phaser 画面**重叠度低**，价值有限。
3. **「项目=文件夹」愿景与 dsh 的 `header.cwd` 天然对齐**：dsh 的 session 有一个**不可变**的 `header.cwd`，而 `ctx.workingDirectory` 是**可变**的有效目录 —— 这个「双目录」模型恰好对应 Stratix 想要的「项目身份 vs agent 当前落脚点」。

---

## 0.1 rc.1 增量与本文对草稿的更正

草稿基于 `0.2.2-alpha.2`；本节列出 rc.1 相对 alpha.2 的**影响结论的增量**，以及本文对草稿的实质性更正。

### 0.1.1 实质性更正（5 处，均已按 HEAD 复核）

| # | 草稿的说法 | HEAD 的事实 | 影响 |
|---|---|---|---|
| **E1** | 「dsh 侧只消费 MCP **tools**；MCP resources/prompts **无消费者**」——据 `packages/acp/acp/README.md:176` | **只对 prompts 成立，对 resources 不成立**。dsh 有宿主级 `packages/mcp/mcp-resources`（`@deepseek-ai/dsh-mcp-resources@0.2.2-rc.1`），注册三个共享工具 `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`（`docs/tool-catalog.md:20,176-228`；`packages/mcp/mcp-resources/src/tools.ts`），出厂 profile 自动挂载。ACP README 那句话说的是**ACP 这条协议面**的能力边界，不是 dsh 宿主的能力边界 | **S12 拆成两条**：MCP resources → 直接用；MCP prompts → 不可行（`packages/mcp/mcp-client/README.md:232,249`：「resource subscriptions 与 MCP prompt templates are unsupported」） |
| **E2** | 「dsh 的自动挂载 provider 适配器只支持 DeepSeek」——暗示非 DeepSeek provider 会**回退** | HEAD 是**抛错**：无预注册适配器时，`provider !== 'deepseek-official'` 直接 `throw new Error('no adapter registered for provider "…"')`（`packages/sdk/server/src/server.ts:233-236`）；只有 `deepseek-official` 才挂 DeepSeek 适配器 | S11 的「需上游配合」结论**加强**：接 Stratix 自己的 LLM 网关**必须**在 dsh 侧注册适配器，否则 initialize 直接失败 |
| **E3** | vendored Cordis 版本 `4.0.6-alpha.1` | **`4.1.0`**（`vendor/cordis/package.json:4`；升级提交 `60d811de43`） | 直接影响 Stratix 侧已有 spike 的依赖区间（见 §0.1.3） |
| **E4** | 插件市场**拒绝实验性包** | 拒绝**不是**插件市场做的 —— `packages/client/ui-plugin-market/src/` 里没有任何 experimental 逻辑。规则由构建期脚本执行：`scripts/verify-default-product-isolation.ts:139`、`scripts/bundle-input-isolation.ts:57-60`、`scripts/experimental-package-policy.ts:85` | S4 的评级依据需换出处，结论不变 |
| **E5** | 「`docs/architecture.md:23` 说 SDK 与 ACP 是同一核心服务之上的两个平行协议前端」 | **该句在 `docs/architecture.md` 里不存在**（全文无 "protocol" 字样）。ACP 与 SDK 无相互依赖这一结论本身**成立**（`packages/acp/acp/package.json` 依赖清单里没有 dsh-sdk），但出处要换成依赖表而不是那句杜撰的引文 | 仅影响引用可查证性 |

### 0.1.2 rc.1 的能力增量（草稿未覆盖）

| 增量 | 事实 | 对 Stratix 的意义 |
|---|---|---|
| **`session/query` 成为高层入口** | rc.1 新增 `session/query`（`packages/sdk/server/src/server.ts:505-513`；协议类型 `packages/sdk/protocol/src/types.ts:213`）。它是「普通输入 or 原生命令」的路由：命令名经 `resolveCommand` 解析（**中英别名**，第一方命令表见 `packages/interaction/commands/src/builtin.ts:17-20`），再按**定义 ID**筛出 `/compact`、`/permission <preset>`、`/plan [off\|message]`、`/goal [objective\|clear\|edit objective\|pause\|resume]` 四类走**原生命令注册表**，其余落回普通 prompt（识别函数 `packages/sdk/server/src/query-input.ts:14-27`；说明 `packages/sdk/server/README.md:40-52`）。新增 `session.query.completed` 通知（`types.ts:199-204`） | Stratix 自己的命令面板（`/` 命令语义见 commit 0672c84）可以**一一映射**到 dsh 原生命令面，不必自己造协议；**但只有 4 类命令被路由**（详见 §5.1 C14） |
| **`ctx.mcpManager` 成为插件贡献面** | 新服务（`packages/mcp/mcp-manager/src/index.ts:221` `super(ctx,'mcpManager')`，`register()` 在 `:288`）：插件可 `ctx.mcpManager.register()` 注册自己的 MCP server；Remote 侧新增 `mcpManager` namespace（`packages/api/remotes/src/client/index.ts:202`） | Stratix **不必**写 dsh 插件就能把自己的 MCP server 装进 dsh（见 S5 重评级） |
| **Python SDK 存在** | `python/sdk/`（`deepseek-harness-sdk` + `deepseek-harness-runtime-bin` wheel），API 与 TS 版同构：`DeepSeekHarness(dsh_home=, cwd=, provider=, model=, base_url=, api_key=)`，`run()` / `resume_session()`（`python/sdk/README.md:36-57`） | 多语言宿主可直连；也是「不必自建 SDK 客户端」的备选 |
| **Remote namespace 扩容** | `packages/api/remotes/src/client/index.ts:199-208` 从 26 个 contribution 增到 **30 个**（新增 `agentTeams` / `mcpManager` / `web`），解析出 **34 个 namespace**（alpha.2 为 27 个 contribution） | Gateway 面的覆盖面比草稿写的大 |
| **`ctx.sessionLogDeepSeek` / `ctx.fileActions` / `ctx.useContextMenu`** | rc.1 新增的三个 `ctx.*` 服务（`packages/session/session-log-deepseek/src/index.ts:194` `super(ctx,'sessionLogDeepSeek')`、`registerExclusion()` 在 `:273`；`packages/client/ui-file-actions`、`packages/client/ui-context-menu`） | 日志排除、文件动作、上下文菜单都是**新的插件贡献面**，Stratix 可挂 |
| **`SlotKind` 新增 `'hoc'`** | `packages/client/ui-slots/src/index.ts:101`：`'single' \| 'list' \| 'keyed' \| 'chain' \| 'hoc'`（alpha.2 只有前四个） | client-ui 插件多一种「嵌套包装层」槽位形态 |
| **`ToolDefinition` 新增两个钩子** | `packages/core/tools/src/contracts.ts:49,61`：`projectContent?()` / `finalizeContent?()` | Stratix 的 tools provider 插件可以参与内容投影，不必只靠 `output.render` |
| **`user-question/ask` 结果可表达「用户放弃」** | `packages/sdk/protocol/src/types.ts:49`：`SdkUserQuestionResult = SdkUserQuestionAnswer \| { cancelled: true }`（映射到原生 `ASK_CANCELLED`，`packages/sdk/server/README.md:50`） | 宿主可以「不回答」而不是被迫编一个答案 |

### 0.1.3 一个**新发现的硬阻塞**（草稿未提）

Stratix 侧已有的桥 B spike（`plugins/dsh-bridge/package.json`）钉的是：

```json
"@deepseek-ai/cordis": "~4.0.5",
"@deepseek-ai/dsh-tools": "0.2.1-rc.5",
```

而 rc.1 的 dsh 自带 **`@deepseek-ai/cordis@4.1.0`**、`@deepseek-ai/dsh-tools@0.2.2-rc.1`。

- semver 上 `~4.0.5` = `>=4.0.5 <4.1.0`，**不容纳 4.1.0** → spike 的 Cordis 区间与 dsh 自带的 Cordis 版本**已经互斥**。
- `dsh-tools` 钉 `0.2.1-rc.5`（精确版本），rc.1 是 `0.2.2-rc.1` → 同样对不上。

**结论**：桥 B spike 目前**只能在 alpha.2 时代的 dsh 上装载**。在 rc.1 上跑之前必须把两个依赖钉位改掉（`~4.1.0` + `0.2.2-rc.1`）。这是本次复核最具体、最可执行的一条发现。**注意：`packages/core/tools/src/` 在 alpha.2→rc.1 之间只有 `package.json` 版本号变化**（`git diff --stat dsh-v0.2.2-alpha.2 HEAD -- packages/core/tools` 只动了 `package.json` 与一个测试文件），所以 `defineTool` 的 DSL 形状没变 —— 改钉位应当是小改动。

### 0.1.4 rc.1 **没有**改变的东西（复核确认）

以下草稿的关键负面结论在 rc.1 上**依然成立**，这是本次复核最重要的「没变」：

- SDK wire **仍无** `session/cancel` / `session/close` / `session/list`（`packages/sdk/protocol/src/types.ts:210-219` 与 `packages/sdk/server/src/server.ts:500-541` 穷举确认；`packages/sdk/server/README.md:216`、`packages/sdk/protocol/README.md:141`）。
- ACP **仍不注册** `session/load` / `session/delete` / `session/fork` / `session/set_mode` / `fs/*` / `terminal/*` / `elicitation/*` / `mcp/connect`（`packages/acp/acp/src/index.ts:378-390` 只有 9 个方法）。
- headless **仍无** `--cwd`（`packages/bundle/headless/src/startup.ts:54-74`）。
- CLI **仍只有一个 bin**（`dsh`）、**无新 flag**（`apps/cli/src/args.ts:152-173`）。
- **无新 profile 模板**（`packages/util/official-bundles/src/bundles.ts:10-26` 仍是 acp / web / headless / sdk / sdk-minimal 五个；**没有 `desktop` 模板**，`desktop` 被 CLI 独占拒绝）。
- API 层 **无新增 `@Remote` 端点**（`git diff --stat dsh-v0.2.2-alpha.2 HEAD -- packages/api` 只在行为层变化 + 三个新 contribution）。
- `defineTool` 的 per-property 参数 DSL **完全未变**。

---

## 0.2 与姊妹报告（157）的口径差异

姊妹报告 `docs/research/dsh-architecture.md` §1.1 说 Cordis 是 **`4.0.0-rc.11`**，本文（草稿 + 本文）说 **`4.0.6-alpha.1` / `4.1.0`**。**两者都不算错，但指的是不同的东西**：

- `4.0.0-rc.11` 是 `vendor/README.md:19` 清单表里记录的**上游 cordis 版本**（配套记录上游 commit `0b96d9fd…`）。
- `4.0.6-alpha.1` → `4.1.0` 是 **`vendor/cordis/package.json` 自己 `version` 字段**的值，也就是 dsh 对这坨代码的**发布版本号**（含 dsh 自己的本地改造 V1–V25）。

**结论**：读源码行为看 `vendor/README.md` 的上游版本；写依赖钉位看 `package.json` 的 `version`。两篇报告在「如何写插件」上没有冲突。

---

## 1. 外部驱动口盘点

### 1.1 启动器：唯一入口是 `dsh` bin

dsh 全仓库**只有一个产品级 bin**：

```json
// apps/cli/package.json:14-16
"bin": { "dsh": "lib/bin.js" }
```

`apps/cli/README.md:5` 明确写着：「The `dsh` command is the sole supported Node application launcher: profiles are ordered stacks of plugin-bundle patch layers under the user's own overrides. **SDK and ACP are profiles, not separate public bins.**」

启动器自身的 flag 族（`apps/cli/src/args.ts:168-173`；`-V, --version` 在 `:154`）：

```
-V, --version                  输出版本号
--profile <name>               启动 $DSH_HOME/profiles/<name>
--from-default-profile <name>  用出厂模板重建某个自定义 profile
--patch <path>                 叠加一层 patch 覆盖（可重复）
--dump-config                  打印组装后的 profile 树并退出
--dump-config-schema           打印 profile 条目与 patch 的 JSON Schema
--dump-default-config          打印不含用户层与 --patch 的默认树
```

> ✅ **复核**：rc.1 **没有新增任何 flag**（`git diff dsh-v0.2.2-alpha.2 HEAD -- apps/cli/src/args.ts` 为空）。

第一个不认识的 token 之后，全部参数原样转交被启动的 app（`apps/cli/src/args.ts:8-11`：「the first token this parser does not recognize starts the inner arguments」）。简写 `dsh headless "任务"` ≡ `dsh --profile headless "任务"`（`apps/cli/src/args.ts:206-208`）。

`dsh plugin --profile <name> <pnpm args>` 是唯一的插件管理子命令（`apps/cli/src/args.ts:187-203`），转发给 pnpm。

### 1.2 L1 — headless（一次性 CLI）

**包**：`@deepseek-ai/dsh-headless`（`packages/bundle/headless/package.json:2`）。**没有独立 bin**，它是一个 bundle。

**它是什么**（`packages/bundle/headless/src/index.ts:1-11` 模块注释）：「one-shot direct Agent driver. The bundle patch rides over dsh-base without Host, HTTP, or browser plugins; this runner creates one Agent through the core registry (or adopts the exact Session a `--session-id` names), drives the task to quiescence, streams provider reasoning to stderr, flushes its Session, prints the final assistant text to stdout, and exits.」

**CLI 契约**（`packages/bundle/headless/src/startup.ts:53-75`）：

```
Usage: dsh --profile headless [options] [task...]

Options:
  --json                      stdout 吐换行分隔的运行事件（NDJSON），而不是最终消息
  --session-id <id>           认领已持久化的 Session；未知 id 是错误
  --permission-mode <preset>  选一个已配置的权限预设
  --approval-policy <policy>  审批策略，choices: "ask" | "never"
  --add-dir <path>            追加一个绝对可写目录（可重复）
  -h, --help
Arguments:
  task                        任务文本；多词以空格连接；`-` 表示从 stdin 读
```

**关键语义**：

- **没有 `--cwd`**。工作目录 = 调用进程的 cwd（`packages/bundle/headless/src/index.ts:386-387`：`const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))`）。
- **不开端口**（`packages/bundle/headless/README.md:12`：「it opens no ports and leaves nothing running behind」）。
- **必须在 `dsh` 启动器下运行**——它靠 `ctx.get('appExit')` 请求进程退出，绕过启动器会启动失败（`packages/bundle/headless/src/index.ts:456-462`：`'the launcher must provide ctx.appExit before the tree mounts'`；`packages/bundle/headless/README.md:187`：「Runs through the `dsh` launcher — starting the headless profile another way fails at startup, because only the launcher can request the process exit」）。
- **退出码**：`0` = completed，其余一律 `1`（`packages/bundle/headless/src/index.ts:443`：`io.exit(outcome.reason?.kind === 'completed' ? 0 : 1)`；另一处 `io.exit(1)` 在 `:312`）；失败时 stderr 一行 `dsh: <code>: <message>`。
- **stdout 必须纯净**：不能组合 stdout logger（`packages/sdk/server/README.md:70-72` 同理适用于 headless）。

**事件流形状**（`--json`）：`session` → `status`(turn_start/step_start/step_end/turn_end) / `text` / `thinking` / `tool_call` / `tool_result` → `final`。单行上限 32 KiB、字符串上限 8 KiB（`packages/bundle/headless/src/json-stream.ts:16,19`）。

> Stratix 侧已接：`src/app/services/cli-transport/adapters/dsh.ts`（桥 A）。**该 adapter 的契约与本文一致**，无需改动。

**鉴权**：协议层无。headless profile **禁用**托管凭据库与 DeepSeek 账号消费者，API key 依次取：启动环境 → `<invocation cwd>/.env` → `$DSH_HOME/.env`（`packages/bundle/headless/README.md:56`）。

### 1.3 L2 — SDK JSON-RPC stdio server

**三个包**：

| 目录 | 包名 | 定位 |
|---|---|---|
| `packages/sdk/server` | `@deepseek-ai/dsh-sdk-jsonrpc-server` | 服务端插件（Cordis plugin，非可执行文件） |
| `packages/sdk/client` | `@deepseek-ai/dsh-sdk-client` | TS 客户端 SDK |
| `packages/sdk/protocol` | `@deepseek-ai/dsh-sdk-protocol` | 共用线协议 + 分帧传输 |

**传输**：只有 stdio，无 WebSocket / HTTP / 端口（`packages/sdk/protocol/src/transport.ts:65` `JsonRpcLineTransport`，构造器 `(input: Readable, output: Writable)` 在 `:74-77`；每行一个 JSON-RPC 2.0 消息以 `\n` 结尾 —— 分帧逻辑在 `:186-195`，帧写出在 `:266-268`）。无 handler → `-32601`（`:235`）；handler 抛错 → `-32603`（`:242`）。

**插件契约**（`packages/sdk/server/src/index.ts:20-21`）：

```ts
export const name = 'sdk-jsonrpc-server'
export const inject = ['agents', 'workingDirectory']
```

**方法全集**（服务端 → 客户端请求，`packages/sdk/protocol/src/types.ts:210-218`，dispatch 在 `packages/sdk/server/src/server.ts:500-541`）：

| 方法 | Params | Result | dispatch |
|---|---|---|---|
| `initialize` | `InitializeParams` | `{ serverInfo }` | `server.ts:501` |
| `session/prompt` | `{ sessionId, contentBlocks }` | `{ messageId }` | `server.ts:503` |
| `session/query` | `{ sessionId, contentBlocks }` | `{ kind:'prompt' \| 'command', execution? }` | `server.ts:505` |
| `session/resume` | `{ sessionId }` | `{}` | `server.ts:514` |
| `session/wait` | `{ sessionId }` | `{}` | `server.ts:521` |
| `session/working-directory/get` | `{ sessionId }` | `{ cwd }` | `server.ts:526` |
| `session/working-directory/set` | `{ sessionId, path }` | `{ cwd }` | `server.ts:527` |
| `shutdown` | 无 | `{}` | `server.ts:537` |

未知方法 → `throw new Error('unknown DeepSeek Harness SDK runtime method: …')`（`server.ts:539-540`）。

> ⚠️ **rc.1 新增 `session/query`**（alpha.2 尚无）。它不是 `session/prompt` 的别名，而是**「普通输入 vs 原生命令」的路由器**（`server.ts:505-513` → `this.query(...)`）：
>
> - 文本以 `/` 开头 **且**命中 dsh 内建命令定义 ID → 走**原生命令注册表**，返回 `{ kind:'command', execution }`；命令生命周期由 `session.query.completed` 通知收尾（`packages/sdk/server/src/query-activity.ts:154`）。
> - 识别的内建命令只有四类：`/compact`、`/permission <preset>`、`/plan [off|message]`、`/goal [objective|clear|edit objective|pause|resume]`（`packages/sdk/server/README.md:40-52`）。命令名经 `resolveCommand` 解析，**中英别名可用**（第一方命令表：目标/计划/反馈/压缩/权限/导出，`packages/interaction/commands/src/builtin.ts:17-20`），但只有**定义 ID**属上述四类者才被路由；形态约束：`/compact` 必须裸、`/permission` 必须带 preset 参数、`/plan`/`/goal` 可带可选参数（`packages/sdk/server/src/query-input.ts:23-25`）。**`/model` 不是 SDK 命令**；裸 `/permission`、裸 `/权限`、`/compact extra`、`/反馈`、`/导出` 及一切未识别输入都当普通 prompt。
> - 命中的命令**不得回退**成 prompt：handler 失败即报错。
> - 命令行必须**独占唯一的 text block**，其余 block 只能是编码图片；否则在入队前以 JSON-RPC 错误拒绝（`packages/sdk/server/README.md:46`）。
> - `session/prompt` 保持为**低层排队入口**，不做斜杠路由。

**服务端 → 客户端的请求/通知**：

| 方向 | 方法 | 载荷 | 位置 |
|---|---|---|---|
| request | `approval/request` | `{ sessionId, toolName, callId?, reason? }` → `{ outcome: 'allowed-once' \| 'rejected' \| 'cancelled' }` | `types.ts:241` / `server.ts:134` |
| request | `user-question/ask` | `{ requestId, sessionId, questions }` → `{ answers:[…] }` **或** `{ cancelled: true }`（rc.1 新增，映射原生 `ASK_CANCELLED`） | `types.ts:61` / `types.ts:49` / `packages/sdk/server/src/user-questions.ts:48` |
| notify | `session.event` | `{ sessionId, event }` | `types.ts:196` |
| notify | `session.status` | `{ sessionId, status: 'idle' \| 'running' }` | `types.ts:197` |
| notify | `session.query.completed` | `{ sessionId, commandId, finalResponse, finishReason }` | `types.ts:199-204` |
| notify | `subagent.started` / `subagent.finished` | 血缘边 | `types.ts:205-206` |

**协议层完全无认证**：对 `packages/sdk/{protocol,server,client}/src` 全量 grep `auth|token|tenant|apiKey` 除 `maxTokens`/`reasoningEffort` 外零命中。凭据只在**模型供应商层**（子进程环境变量 `DEEPSEEK_API_KEY`，`packages/llm/llm-deepseek-api-key/src/config.ts:25`）。

**生命周期硬约束**（这是选型时最容易踩的）：

- **没有 `session/cancel`、没有 `session/close`、没有 `session/list`**（`packages/sdk/server/README.md:216`：「The wire has no per-session close or prompt-cancel method — SDK-created agents remain live until process shutdown.」；协议侧同一句话在 `packages/sdk/protocol/README.md:141`：「No cancel or session-close methods — a client abandons a turn by closing the runtime process」）。**rc.1 复核：仍然没有**（`packages/sdk/protocol/src/types.ts:210-218` 与 `packages/sdk/server/src/server.ts:500-541` 穷举确认）。
- **没有协议版本协商**（`packages/sdk/protocol/README.md:140`）；握手只带 `serverInfo: { name: 'deepseek-harness-sdk-runtime', version: '0.0.1' }`（`server.ts:254`）。
- **没有重连**：传输一旦 close，后续请求一律 reject（`packages/sdk/protocol/src/transport.ts:57-64,270-275`）。客户端 `start()` 失败后**仅当清理成功**才换新实例重试（`packages/sdk/client/src/api.ts:82-94`）。
- 超时不回滚服务端工作（`packages/sdk/client/src/client.ts:186-188`）。

**`initialize` 的必填参数**（`packages/sdk/protocol/src/types.ts:18-33`）：

```ts
{ cwd: string;                 // 必填 → 服务端 resolve()（server.ts:227）
  provider: string;            // 必填；无预注册适配器且非 deepseek-official → 直接抛错（server.ts:233-236）
  model: string;               // 必填，且此刻必须可解析（server.ts:238-244）
  approvalRequests?: boolean;
  reasoningEffort?: ReasoningEffortId;
  maxTokens?: number;
  capabilities?: { userQuestions?: boolean }; }
```

> ⚠️ **更正（E2）**：草稿说「provider 无适配器时回退 DeepSeek」。HEAD 是**抛错**：只有 `provider === 'deepseek-official'` 才挂 DeepSeek 适配器，其它 provider 一律 `throw new Error('no adapter registered for provider "…"')`（`packages/sdk/server/src/server.ts:233-236`，判定函数 `hasAdapterFor` 在 `:602`）。**Stratix 若要用自己的 LLM 网关，必须在 dsh 侧注册适配器，否则 `initialize` 直接失败。**

**会话懒创建**：不存在 `session/new`。`session/prompt` / `session/query` / `session/working-directory/*` / `session/resume` 任一首次调用即建会话（`packages/sdk/server/src/server.ts:544-552` → `createSession` 在 `:564-600`），落点是 `meta: { cwd: this.cwd }`（`server.ts:594`）。

**客户端 API**（`packages/sdk/client/src/index.ts`）：

```ts
const harness = new DeepSeekHarness({
  profile: 'sdk', dshHome: '/abs/path', patches: ['./auto.cordis.yml'],
  provider: 'deepseek-official', model: 'deepseek-v4-flash', cwd: '/abs/project',
})
await harness.start()
const s = harness.session('session-x')
await s.setWorkingDirectory('/abs/project/sub')
await harness.run('做这件事')
await harness.close()
```

- `DeepSeekHarness`（`client/src/api.ts:21`）：`start()`（`:70-97`）/ `session(id?)`（`:105-107`）/ `resumeSession(id)`（`:115-119`）/ `run(input, options?)`（`:127-129`）/ `close()`（`:136-139`）/ `[Symbol.asyncDispose]()`。
- `HarnessClient`（`client/src/client.ts:190`）：`initialize` / `prompt` / `resumeSession` / `getWorkingDirectory` / `setWorkingDirectory` / `request`（`session/wait` 只能靠它）/ `subscribe` / `subscribeSessionTree` / `close`。
- 连接方式 = **spawn 子进程 + stdio**（真正的 `spawn` 在 `client/src/client.ts:223-227`：`spawn(this.runtime.command, this.runtime.args, { cwd: this.runtime.cwd, … })`；`client/src/launch.ts:141-143` 只负责拼 argv：`args: [...dshLaunch.nodeArgs, '--profile', profile, ...patches.flatMap(path => ['--patch', path])]`），不是 URL。版本一致性校验：`dshManifest.version !== clientManifest.version` 即抛错（`launch.ts:58-60`）。
- **rc.1 语义变化**：`run()` 现在走 `session/query` 路由（普通输入 vs 原生命令），返回 `RunResult`（`client/src/types.ts:74-85`：`sessionId` / `finalResponse` / `finishReason` / `events` / `notifications`）。命令类输入要等 `session.query.completed` 通知才收尾（`packages/sdk/client/src/api.ts:180-215` 的 `RunActivity`）。
- **另有一套 Python SDK**：`python/sdk/`（`deepseek-harness-sdk` + `deepseek-harness-runtime-bin` wheel），API 同构 —— `DeepSeekHarness(dsh_home=, cwd=, provider=, model=, base_url=, api_key=)`、`run()` / `resume_session()` / `start_session()`（`python/sdk/README.md:36-57`）。它同样「没有独立入口，自己拉起 `dsh --profile sdk`」。

### 1.4 L3 — ACP（Agent Client Protocol）

**包**：`@deepseek-ai/dsh-acp`（`packages/acp/acp/package.json:2`），实现 **Zed Agent Client Protocol**（`packages/acp/acp/README.md:12` 指向 agentclientprotocol.com），上游 SDK `@agentclientprotocol/sdk@1.4.0`（**`packages/acp/acp/package.json:32`** —— 不在根 `package.json` 里；alpha.2→rc.1 **版本未变**）。

**传输**：stdio 上的 JSON-RPC，**NDJSON 分帧**，由 SDK 的 `ndJsonStream` 提供（`packages/acp/acp/src/index.ts:374`）。stdout 纯度是硬约束（`packages/bundle/acp-app/README.md:62`：「User plugins can violate stdout purity — profile and per-launch patches are trusted application composition」）。

**协议版本 = v1（单版本服务端）**：`PROTOCOL_VERSION = 1`（上游 SDK `@agentclientprotocol/sdk@1.4.0` 的 `schema/index.js:51`），dsh 直接回这个常量（`packages/acp/acp/src/index.ts:25,184`）。`packages/acp/acp/src/index.ts:180-182` 的注释原文：「Single-version agent: the spec's "same version if supported, else the latest supported" both resolve to this server's one version.」

> 上游 SDK 1.4.0 **内部认识 v1 与 v2**（`protocol-router.js:5-7`、`:161-167` 的 `highestCompatible`），并带 HTTP 传输的强制 `initialize` 前置校验（`:97-101`）；但**dsh 的 stdio 路径不经过该 router**（用 SDK 的 `agent()` 工厂），所以 dsh 是**纯 v1、无版本协商**。

**取消有两条独立通道**：

1. **显式 `session/cancel` 通知**（`packages/acp/acp/src/index.ts:390` → `src/session.ts:309-313`）；
2. **协议级 `$/cancel_request`**（SDK 的 `jsonrpc.js:1` 定义）—— 收到时中止对应 in-flight 请求的 `AbortSignal`，dsh 正是靠它把请求中断接到 `cancelPrompt`（`packages/acp/acp/src/session.ts:246-249`：`requestSignal?.addEventListener('abort', onRequestAbort, { once: true })`），并且在准入前检查 `requestSignal?.aborted`（`:249`）。

`packages/acp/acp/README.md:72` 的 `| session/cancel / $/cancel_request |` 正是把这两条并列。

**Agent 侧方法**（注册于 `packages/acp/acp/src/index.ts:378-390`，共 **8 个 request + 1 个 notification**；rc.1 **未新增任何方法**）：

| ACP 方法 | 种类 | 语义 |
|---|---|---|
| `initialize` | request | 返回 `protocolVersion` / `agentInfo` / 能力集 / `authMethods: []`（`src/index.ts:179-193`，`authMethods: []` 在 `:191`） |
| `authenticate` | request | **直接成功，服务端不做任何认证**（`:195-197`：`return Promise.resolve()`） |
| `session/new` | request | 校验绝对 `cwd`、拒绝 `additionalDirectories`、挂载 MCP、创建持久化 Agent（`:199-239`；校验函数 `validateWorkspaceParams` 在 `:509-518`，`additionalDirectories` 拒绝在 `:511-517`） |
| `session/list` | request | 分页列根会话，排除 `origin: 'subagent'`（`:293-331`） |
| `session/resume` | request | 校验 cwd **物理同一性**（realpath 比较，`:520-529` 的 `sameDirectory()`，realpath 在 `:524`；调用点 `:254-256` 与 `:272-275`），恢复且不重放历史 |
| `session/close` | request | 取消 → 排空 → flush → 处置（`:347-359`） |
| `session/set_config_option` | request | `model` / `reasoning_effort`（`:333-345`） |
| `session/prompt` | request | 每会话同时仅 1 个 in-flight prompt（`src/session.ts:225`：`'a prompt is already in flight for this session'`） |
| `session/cancel` | notification | 取消当前 prompt（`:390` → `src/session.ts:308-313`） |

**Client 侧方法**（服务端主动发起）：`session/update`（notification，推 `agent_thought_chunk` / `agent_message_chunk` / `tool_call` / `tool_call_update` / `usage_update` / `config_option_update`）与 `session/request_permission`（request，**一次性** `allow-once` / `reject-once` / `cancelled`，**永不转成持久授权**，`src/index.ts:155-176`；选项定义 `:167-168`，映射 `:172-175`；注释原文：「The bridge offers one-shot choices only and never infers a durable grant from an unknown client response.」）。

**能力边界**（`packages/acp/acp/README.md:82`）：

> Unsupported surfaces are omitted or rejected: `session/load`, deletion, fork, additional directories, SSE or ACP-transport MCP, modes, commands, plans, terminals, client filesystem operations, and elicitation.

**精确的「SDK 有、dsh 未注册」差集**（对照上游 SDK 1.4.0 的生成常量与 dsh 的注册表 `packages/acp/acp/src/index.ts:378-390`）：

| SDK 支持但 **dsh 未注册** 的方法 | 客户端调用结果 |
|---|---|
| `session/load`、`session/delete`、`session/fork`、`session/set_mode` | JSON-RPC **`-32601` Method not found** |
| `providers/list`、`providers/set`、`providers/disable`、`logout` | `-32601` |
| `nes/*`、`document/did*`、`mcp/message` | `-32601` |
| `fs/read_text_file`、`fs/write_text_file` | `-32601`（**dsh 不向编辑器暴露文件系统**） |
| `terminal/create`、`terminal/output`、`terminal/release`、`terminal/wait_for_exit`、`terminal/kill` | `-32601`（**dsh 不向编辑器暴露终端**） |
| `elicitation/create`、`elicitation/complete` | `-32601`（**dsh 不做人类征询**） |
| `mcp/connect`、`mcp/disconnect` | `-32601`（dsh 只**挂载 MCP server**，不做 MCP client 桥接） |

> **ACP v1 规范本身没有「列出工具」的方法** —— 上游 client 侧方法全集里只有 fs / terminal / permission / update / mcp / elicitation，**没有 tool-list**。所以「dsh 能否向外部编辑器暴露工具列表」的答案是**否**，且这不是 dsh 的裁剪，而是协议本身如此。

**结论**：在 ACP v1 内，编辑器**可以**向 Agent 声明 fs / terminal / elicitation 能力（SDK 侧方法齐全），但 dsh 一个都没实现，全部 `-32601`。工具执行、文件读写、终端全部留在 harness 进程内；dsh 只向客户端暴露**通用工具生命周期投影**与**一次性权限询问**。

**关键否定结论**：

- **不向客户端暴露工具 schema**。客户端只看到通用工具生命周期投影（`tool_call` / `tool_call_update`，`kind` 固定 `'other'`），没有工具名/参数清单。**工具执行始终留在 harness 内部**。
- **终端 / 文件操作不委派给编辑器**（`terminal/create`、`fs/read_text_file` 一类完全未实现）。
- **仅 1 个 in-flight prompt / 会话**。

**与 SDK JSON-RPC 的关系**：**两条独立路径，不是翻译层**。ACP 对 `dsh-sdk` **零依赖**（`packages/acp/acp/package.json:31-45` 全是 cordis/agent/llm/mcp/session 类依赖）；二者是同一核心服务（`agents`/`llm`/`sessions`/`sessionPersistence`）之上的**两个平行协议前端**。

> ⚠️ **更正（E5）**：草稿把「两个平行协议前端」这句挂在 `docs/architecture.md:23` 上，但**该句在 `docs/architecture.md` 里不存在**（全文无 "protocol" 字样；`:23` 讲的是 `dsh-base` 是四个 profile 的共享第一层）。结论本身**成立**（依据改为依赖表：`packages/acp/acp/package.json` 里没有 dsh-sdk 依赖），但引文出处要换成依赖清单。

> ⚠️ **`session/prompt` 在两边都存在，但语义与返回结构不同**（ACP 返回 `{stopReason}`，SDK 返回 `{messageId}`）——**不要把两者混用同一客户端**。

### 1.5 L4 — api gateway（HTTP + WS mux）

**包**：`@deepseek-ai/dsh-api-gateway`（`packages/api/gateway/package.json:2`），「Typert Remote Host dispatcher and Client API endpoint」。

**它不是 REST 路由表**。整个 API 层是 **Typert RPC（一元调用）+ Gateway 自有 WebSocket 多路复用（流式调用）**，路由形如 `POST /api/<namespace>/<method>`，namespace/method 由 `@Remote` 装饰器在**构建期**生成（`docs/api-gateway.md:110-118`）。

**HTTP 路由表**：

| Method | Path | 用途 | 位置 |
|---|---|---|---|
| POST | `/api/<namespace>/<method>` | 全部 Typert Remote 一元调用 | 路由注册在 `packages/client/connection/src/index.ts:146-160`；Gateway 侧的派发实现是 `packages/api/gateway/src/index.ts:491-522`（`dispatchRpc`） |
| POST | `/api/$events/result` | Client 回答 Host 转发来的 Agent-scoped waterfall | `packages/api/gateway/src/stream-protocol.ts:13` |
| GET (WS) | `/api/remote.mux` | Remote 流多路复用 WebSocket | `stream-protocol.ts:7`；`gateway/src/index.ts:273-309` |
| GET | `/connect?token=…&interactions=answer\|none` | API 客户端换取独立 Peer + 签名 Cookie，302 跳 `/api/remote.mux` | `packages/client/connection/src/connect-protocol.ts:7`；`browser-auth.ts:314-348` |
| GET | `/?token=…` | 浏览器换签名 Cookie（303 → `./`） | `browser-auth.ts:263-305` |

**RPC 信封**（严格，`packages/client/connection/src/rpc-schema.ts:35-40`）：

```json
{"type":"client-request","rpcId":"<uuid>","method":"<ns>/<method>","payload":{"args":{…}}}
→ {"type":"server-response","rpcId":"<uuid>","result":{"ok":true,"value":…}}
```

`method` 必须等于路径末两段（否则 `gateway/bad-request`）；`Content-Type` 必须 `application/json`（否则 415）；body 非 JSON → 400；端点未被认领 → 404。

**`session` namespace 关键方法**（`packages/api/session-controller/src/index.ts`）：

| Path | 用途 | 行号 |
|---|---|---|
| `POST /api/session/create` | 创建/复用 Session（**可带 cwd**，见 §4.2） | `:306-309` |
| `POST /api/session/list` / `search` | 列/检索 Session | `:281-285` / `:295-299` |
| `POST /api/session/prompt` | 提交 prompt（`mode: 'queue' \| 'steer'`） | `:467-492` |
| `POST /api/session/cancel` | 取消当前 turn | `:519-522` |
| `POST /api/session/wait` | 等待静止/待输入（`timeoutMs?` 省略 = 30s） | `:597-600` |
| `WS session/follow` | 跟随 Session 日志（快照 + 事件流） | `:609-612` |
| `WS session/observeEvent` / `observeState` / `observeProjections` | 订阅事件 / 状态 / 稀疏投影 | `:553-556` / `:586-589` / `:564-567` |
| `POST /api/session/fork` | 从事件前缀 fork 新 Session | `:448-459` |

另有 `workspace`（12 个方法）、`job`（3）、`terminal`（7）、`workspaceFiles`（5）、`account`（10）、`settings`（5）、`credentials`（3）、`remoteAccess`（1）namespace，以及 `packages/api/remotes` 装配的 **30 个** Remote contribution → **34 个 namespace**（`packages/api/remotes/src/client/index.ts:199-208`）。

> **rc.1 增量**：contribution 从 26 增到 30，新增 **`agentTeams`**、**`mcpManager`**、**`web`** 三个；解析出的 namespace 从 31 增到 34，新增 `credentials` / `fileReferences` / `skills` / `directoryPicker`。另有 rc.1 新出现的 **`goals`** namespace（`packages/goal/goal/src/index.ts:249`）与 **`skills`** namespace（`packages/api/session-controller/src/skill-catalog.ts:25`）。
>
> ⚠️ **仍然没有 `tools` namespace** —— `packages/core/tools/src/index.ts:112` 的 `ctx.tools` 是普通 Cordis Service，没有 `@Remote` 标记，不对外暴露工具清单。最接近的是独立的 `toolResults` namespace（`packages/client/ui-trajectory/src/index.ts:44`）。**「dsh 有没有对外的工具列表 API」—— 答案是否**（所以 §5.2 的 S1/S2 只能走进程内的 `ctx.tools` 注册面，或退到 MCP 的 `mcp__<server>__<tool>` 命名空间）。

**鉴权模型**（这是四个驱动口里唯一有鉴权的）：

- **没有** Bearer token / API-Key header / 签名 URL。唯一凭据是 **HMAC-SHA256 签名的 HttpOnly Cookie**。
  - Cookie 名：`'dsh-auth-' + base64url(sha256(authority))`（`packages/client/connection/src/browser-auth.ts:18,116-118`）
  - 载荷：`v<version>.<b64url(json)>.<b64url(hmac-sha256(secret, body))>`（`:146-149`）
  - 属性：`Path=/; HttpOnly; SameSite=Strict`，仅 HTTPS 时加 `Secure`；默认寿命 30 天
- **信任栅栏**（`packages/client/connection/src/api-request-trust.ts:121-151`）：`Host` 必须是 loopback 主机名、监听器自身的 bind IP 字面量，或命中 `trustedHosts`；`sec-fetch-site: cross-site` 一律拒绝；有 `Origin` 时必须同 authority。失败 → **403**。
- 未认证 → **401**。
- **方法级授权**由 `packages/api/remote-access` 提供（`ctx.remoteAccess`）：owner 与 `remoteAccess/follow` 恒 allow，其余按 policy 的 `bindings()` 逐资源判定（`packages/api/remote-access/src/index.ts:199-222`）。拒绝 → `RemoteError('remote-access/denied')`。
- 默认 **localhost-only**：bind `127.0.0.1:3080`（`packages/bundle/web-app/cordis.patch.yml:187-188`），`trustedHosts` 默认 `[]`（默认值在 `packages/bundle/web-app/src/startup.ts:120`，yml 行在 `:245`），**通配地址 `0.0.0.0` / `::` 被拒**（`packages/bundle/web-app/src/startup.ts:95-97`）。
- **`--public-url` 不授予任何信任**（`packages/bundle/web-app/cordis.patch.yml:236-237`：「an advertised public URL contributes nothing to it」；`startup.ts:67` 同义）。

**Gateway 不拥有 Session 生命周期**，它把调用派发到同进程同 Cordis 树里的目标 Service（`packages/api/gateway/src/index.ts:827-876` 的 `prepareInvocation` —— 解析接收方 context 后 `Reflect.apply` 调用，**不是**针对 SessionController 的特判；`sessionController` 字样在 gateway 里零命中）。层次：`remotes → gateway → connection → webserver`（`docs/api-gateway.md:166`）。

### 1.6 apps/ 进程边界

| 应用 | 形态 | 进程模型 |
|---|---|---|
| `apps/cli` | Node CLI，唯一 bin `dsh` | 单进程 |
| `apps/web` | **Vite 构建产物**，非独立 SPA | 被 Host 服务；`vite serve` 被显式拒绝（`apps/web/vite.config.ts:48-58`，`rejectStandaloneServe` 插件） |
| `apps/desktop` | Electron 壳（`apps/desktop/src/main.ts`，1590 行） | main + renderer + **Host 子进程** 三层 |
| `apps/desktop-host` | Node-mode Host（`apps/desktop-host/src/index.ts`，158 行） | agent runtime **真正运行的地方** |

**Desktop 三层拆解**：

```
Electron main (apps/desktop/src/main.ts)
  │  spawn(process.execPath, [entry, runtimeDir, projectDir, ...], { stdio: ['ignore','pipe','pipe','ipc'] })
  │  ← apps/desktop/src/host-process.ts:209-224（ELECTRON_RUN_AS_NODE=1）
  ▼
Host 子进程 (apps/desktop-host/src/index.ts)
  │  runProfile({ profile: 'desktop', args: ['--no-open','--host','127.0.0.1','--port','0'] })
  │  ← apps/desktop-host/src/index.ts:31-48
  ▼
HTTP+WS on 127.0.0.1:<OS 分配端口>
  ▲
  │ Electron 协议 dsh-app://app/ → forwardWebRequest 代理 → Host
  │ WebSocket 凭据只发给自有窗口，origin 必须 dsh-app://app（main.ts:846）
  ▼
Electron renderer（渲染 apps/web 产物）
```

- **main ↔ Host 走 Node IPC**（`stdio` 第四项 `'ipc'`），事件集合见 `apps/desktop/src/host-process.ts:28-47`（`'starting'`/`'ready'`/`'fatal'`/`'shutdown-complete'`/…）。
- **renderer → Host 走 HTTP 转发 + WS**，不是 Electron IPC；Electron IPC 通道名表（`apps/desktop/src/ipc.ts:11-48` 的 `DESKTOP_IPC`）只管桌面原生能力（文件保存、剪贴板图片、快捷键、设备信息、locale bootstrap、更新）。
- **renderer 安全基线**：`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`、`webSecurity: true`（`apps/desktop/src/main.ts:288-291`）。
- `desktop` profile 名被 CLI **独占**，npm 装的 `dsh` 不能 boot 也不能 dump 它（`apps/cli/src/args.ts:83-87`：`'profile "desktop" is managed exclusively by the Electron application'`）。**注意：rc.1 的出厂 profile 模板里没有 `desktop` 这一项**（`packages/util/official-bundles/src/bundles.ts:10-26` 只有 acp / web / headless / sdk / sdk-minimal）。
- `apps/desktop` 与 `apps/desktop-host` 都是 `private: true`，不发布到 npm。

**Web 前端如何连 Gateway**：**同源相对路径**，无独立环境变量。

```ts
// packages/client/connection/src/client/rpc.ts:48
const route = `${channel}/${endpoint}`.slice(1)   // → 'api/session/create'
// packages/client/connection/src/client/socket.ts:56,63-64
const url = new URL(path.slice(1), base)
url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'   // → ws://host/api/remote.mux
```

页面启动依赖 Host 注入的 `window.__DSH_BOOT__`（客户端插件清单图）。唯一的地址覆盖点是 `window.__DSH_TRANSPORT__.streamBaseUrl`（`packages/client/connection/src/client/index.ts:118-119`）。

> ⚠️ **更正**：草稿说该处注释写明「setting the origin alone grants no access」——**该文件里没有这句注释**。同义的表述在别处：`packages/client/connection/src/api-request-trust.ts:99`（「accepting it grants nothing further」）与 `packages/bundle/web-app/src/startup.ts:67`（「--public-url … grants no trust」）。结论（覆盖 origin 不等于获得信任）不变，出处要换。

**唯一近似「静态独立前端」的形态**是 Worker 版：把整个 Host 树跑进 Web Worker（`packages/experimental/webworker-runtime`）——那是**自带 Host**，不是对接远程 gateway。

### 1.7 四个驱动口横向对比（鉴权 × 生命周期）

| | headless | SDK stdio | ACP stdio | Gateway HTTP+WS |
|---|---|---|---|---|
| 启动 | `dsh --profile headless` | `dsh --profile sdk` | `dsh --profile acp` | `dsh --profile web` |
| 分帧 | NDJSON（`--json`）/ 纯文本 | NDJSON JSON-RPC 2.0 | NDJSON JSON-RPC | HTTP JSON + WS 自有帧 |
| 协议层鉴权 | 无 | 无 | 无（`authMethods: []`） | **签名 Cookie + Origin 栅栏 + 方法级 ACL** |
| 会话创建 | 隐式（一个进程一个会话） | 隐式懒创建 | `session/new` 显式 | `POST /api/session/create` |
| cwd 指定 | **只能靠进程 cwd** | `initialize.cwd`（全局） / `session/working-directory/set`（单会话） | `session/new.cwd`（绝对） | `session/create` 的 `cwd` 或 `workspaceId` |
| 取消 | 无 | **无 wire cancel** | `session/cancel` + `$/cancel_request` | `POST /api/session/cancel` |
| 列举/恢复 | `--session-id` 单个认领 | `session/resume` | `session/list` + `session/resume` | `session/list` + `session/fork` |
| 事件流 | stdout NDJSON | `session.event` 通知 | `session/update` 通知 | WS `session/follow` |
| 权限询问 | `--permission-mode` / `--approval-policy` | `approval/request`（需客户端 handler） | `session/request_permission`（一次性） | `remoteAccess` ACL + `session/prompt` 审批流 |
| 斜杠命令 | 无 | **`session/query` 原生命令路由**（`/compact` `/permission` `/plan` `/goal`） | 无（ACP v1 无 commands 面） | `commands` namespace |
| 端口 | 无 | 无 | 无 | 127.0.0.1:3080（web） |
| 常驻 | 否 | 是 | 是 | 是 |

---

## 2. 方向 a：作为宿主装 dsh 插件

> 方向 a 的准确含义有两种读法：(a1) Stratix **复用** dsh 生态的插件；(a2) Stratix **作为 dsh 插件宿主**运行 dsh 的插件。本节回答两者，结论不同。

### 2.1 dsh 插件的运行时依赖什么

**Cordis**。dsh 是 vendored 的 Cordis fork（`vendor/cordis/`，包名被 rescope 成 `@deepseek-ai/cordis`，**版本 `4.1.0`**，`vendor/cordis/package.json:4`；升级提交 `60d811de43 release(vendor): cordis 4.1.0, cosmokit 1.9.0, group 1.1.0, hmr 1.1.0, include 1.1.0, loader 1.1.0, logger-console 1.1.0, schemastery 3.19.0, timer 1.2.0`）。⚠️ **rc.1 把 Cordis 从 `4.0.6-alpha.1` 提到了 `4.1.0`** —— alpha.2→rc.1 之间的这条 minor 升级直接打断了 Stratix 现有 spike 的依赖区间（见 §0.1.3）。

- `README.md:8`：「built on an **everything-is-a-plugin** architecture and powered by Cordis」
- `docs/cordis-primer.md:5`：「Cordis is the vendored plugin framework underneath DeepSeek Harness.」

**核心概念**（`docs/cordis-primer.md:9-13`）：

> A plugin is a object that implements Service. / A context is a repository of services. / Declare service dependency via `inject`. / Typed Events for communication. / Registrations are reversible effects.

插件形状三种（`vendor/cordis/src/registry.ts`：联合类型 `Plugin` 在 `:91-95`，三个成员分别在 `:120` 函数 / `:125` 类 / `:130` 对象）：函数 `(ctx, config)` / 类 `new (ctx, config)` / 对象 `{ apply(ctx, config) }`。

**关键 API**：

| API | 位置 | 语义 |
|---|---|---|
| `ctx.get(name)` | `vendor/cordis/src/reflect.ts:19` | 取服务（严格模式抛错） |
| `ctx.provide(name, value)` | `vendor/cordis/src/reflect.ts:44` | 提供服务 → 投影成 `ctx.<key>` |
| `ctx.plugin(plugin, ...args)` | `vendor/cordis/src/registry.ts:185,316` | 装载插件 → 返回 `Fiber & PromiseLike<Fiber>` |
| `ctx.effect(fn, label?)` | `vendor/cordis/src/fiber.ts:421` | 注册**可回滚**副作用；fiber 卸载时自动撤销 |
| `ctx.inject(deps, cb)` | `vendor/cordis/src/registry.ts:176` | 等依赖服务就位后执行 |
| `ctx.extend()` / `ctx.isolate()` | `vendor/cordis/src/context.ts:99,121` | 子作用域 / 隔离 realm |

**`inject` 语义是「等不到就一直 pending」**：缺依赖时插件不装载，**不抛错**（`packages/experimental/tool-session-query/tests/tool-session-query.spec.ts:344` 断言 `expect(() => ToolSessionQuery.apply(new Context(), {})).toThrow()`——因为 `apply` 内部还会 `ctx.inject`）。

### 2.2 bundle / profile / patch —— 第三方插件怎么进 dsh

**三层概念必须分清**（`docs/architecture.md:17,19,21`）：

> A **profile** is a named composition stored in the Harness home. It lists the bundles it stacks, holds any out-of-tree plugins it installs, and keeps the user's own `cordis.patch.yml`. … A **bundle** is a distribution format for Cordis config rows and the code they mount, so whatever it inserts stays patchable by the layers above it.

| | profile | bundle |
|---|---|---|
| 本质 | `$DSH_HOME/profiles/<name>/` **目录** | 一个 **npm 包** |
| 内容 | `package.json`（`dsh.profile.bundles` + `dependencies`）+ 用户 `cordis.patch.yml` | `package.json` 的 `dsh.bundle.patch` + `cordis.patch.yml` |
| 装载 | `dsh --profile <name>` | profile 的 `dsh.profile.bundles` 列表 |

**bundle 本身没有运行时 API**（`packages/bundle/base/src/index.ts:9` 就是 `export {}`）——它只是一份 YAML patch 文档（一组「配置行」）。Loader 行形状（`vendor/loader/src/config/entry.ts:10-23`）：

```ts
interface EntryOptions {
  id: string
  name: string        // 模块 specifier
  config?: any
  group?: boolean | null
  disabled?: boolean | null
  inject?: Inject | null
}
```

**patch 叠加顺序**（`packages/boot/app-boot/src/profile-context.ts:74-87`，顺序在 `:76-81`）：

```
1. 各 bundle 的 patch（按 dsh.profile.bundles 顺序）
2. profile 自己的 cordis.patch.yml
3. $DSH_HOME/cordis.patch.yml
4. --patch 覆盖层
```

**patch 语义**：patch **替换目标行的整个 `config`，不合并**（`packages/bundle/base/README.md:88` 与 `:135`）。

**第三方插件的官方安装路径**：

```
dsh plugin --profile <name> add @scope/pkg
  → packages/boot/plugin-manager/src/operations.ts:565 runPluginCommand()
  → :296 runProfilePnpm()   （在 profile 目录跑 pnpm add）
  → packages/boot/app-boot/src/profile-plugins.ts:104 reconcileProfilePlugins()
       若该包声明了 dsh.bundle.patch → 写入 profile 的 dsh.profile.bundles
```

⚠️ **普通 npm 依赖不会自动变成插件行**：只有声明了 `dsh.bundle` 的包才会成为 profile 的一层（`packages/boot/plugin-manager/src/operations.ts:104` 会打印 warning：「dsh: warning: <name> declares no dsh.bundle — installed as a plain dependency, not a profile layer」）。**判定门槛更严的是 app-boot 侧**：`packages/boot/app-boot/src/profile-plugins.ts:73` 看的是 `dsh.bundle.patch !== undefined`，bundle 激活在 `:118-121`。

**裸包名运行时解析**：Loader 用动态 import（`vendor/loader/src/config/tree.ts:182-200`：`cordis:` 前缀走内置，其余经 `createResolve(baseUrl)` 解析后 `import()`），裸包名由 `PluginPackages` 服务的**运行时拦截层**解析到 profile 自己的 node_modules（`packages/boot/app-boot/src/profile-resolution/resolver.ts:829` `installRuntimeInterception`）。

**profile 自动初始化**：`$DSH_HOME/profiles/<name>` 不存在时自动从出厂模板铺出（`packages/boot/app-boot/src/profile.ts:728-745`；模板表 `packages/util/official-bundles/src/bundles.ts:10-26`）：

```ts
PROFILE_TEMPLATES = {
  acp:        { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-acp-app'] },
  web:        { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'] },
  headless:   { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-headless'] },
  sdk:        { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-sdk-app'] },
  'sdk-minimal': { bundles: ['@deepseek-ai/dsh-sdk-minimal'] },
}
```

### 2.3 「不跑完整 dsh 就复用其插件」——可行性与代价

**技术上可行**，因为 **Cordis 的 `Context` 本身就是可独立使用的最小容器**：`new Context()` 即得只有内置服务（`reflect`/`registry`/`events`/`logger`）的根容器（`vendor/cordis/src/context.ts:71-82`）。仓库内的独立容器用法遍布：

```ts
// packages/experimental/webhook/tests/runtime.spec.ts:16-20
const ctx = new Context()
// packages/experimental/speech-to-text/tests/service.spec.ts:25
const ctx = new Context(), base = ctx.plugin(SpeechToText, { … })
```

**但对 Stratix 而言这条路基本不成立**，理由：

| 障碍 | 事实 | 影响 |
|---|---|---|
| **依赖的是 dsh 的私有服务** | dsh 的插件普遍 `inject` 私有服务：`ctx.agents` / `ctx.llm` / `ctx.tools` / `ctx.sessions` / `ctx.systemPrompt` / `ctx.fs` / `ctx.shell` / `ctx.subprocess` / `ctx.sandbox` / `ctx.workingDirectory` / `ctx.sessionProjections` … | 单独 `new Context()` 里**一个都没有**，插件会永远 pending |
| **要复用的其实不是「插件」，是「会话 + 模型 + 沙箱 + 持久化」** | 例如 `packages/experimental/worktree` 的 `inject = ['workingDirectory','fs','subprocess','sandbox','sandboxPolicy']` | 复用一个插件 = 复现它的一整棵依赖树 |
| **Cordis 是 vendored fork** | `@deepseek-ai/cordis` 不在 npm 上公开的 `@cordisjs/*` 序列；rc.1 自带 **`4.1.0`**（alpha.2 是 `4.0.6-alpha.1`） | 引入即引入私有 fork，版本必须逐字对齐。**Stratix 现有 spike 钉的 `~4.0.5` 已经与 rc.1 互斥**（§0.1.3） |
| **dsh 是 dev preview** | 官方自我声明必有破坏性变更 | 私有依赖的破坏性变更不受你控制 |
| **Stratix 侧铁律** | `docs/SERVICE-SPLIT-PLAN.md` 七铁律；`docs/DSH-INTEGRATION-PLAN.md` §4 明确「**不引入 Cordis 运行时依赖进 gateway/core**」 | 方向冲突 |

**结论（a1）**：**不做**。复用 dsh 插件的正确姿势是**通过进程边界用 dsh 的驱动口**（桥 A / §6），不是把 dsh 的运行时嵌进 Stratix 进程。

### 2.4 嵌入式跑 dsh 的四种形态（若非要「跑」）

| 形态 | 描述 | 代价 | 评级 |
|---|---|---|---|
| **E1. 子进程 + stdio 协议** | Stratix spawn `dsh --profile sdk` / `acp`，用现成 SDK client 驱动 | 最轻；进程边界清晰；SDK client 已经封装好 spawn/握手/清理 | **适配后用**（推荐） |
| **E2. 子进程 + 一次性 headless** | Stratix spawn `dsh --profile headless --json "<task>"` | 最轻但**无 cwd 参数、无取消、无事件订阅**；已有实现：桥 A | **直接用** |
| **E3. 同进程嵌入 Cordis 树** | Stratix 进程内 `new Context()` + `ctx.plugin(dshPlugin)` | 需要把 dsh 的服务树整个搬进 Stratix 进程；违反铁律 | **不可行**（当前） |
| E4. 库形态（`import` dsh 包） | dsh 无库导出面（全是 bundle + CLI） | 无稳定入口 | **不可行** |

**启动流程（E1/E2 共用）**（`packages/boot/app-boot/src/index.ts:1201-1236`）：

```
new Context()                        // :1208
  → ctx.plugin(Loader)                // :1225
  → prepare?.(ctx)                    // :1226  提供 profileContext / cmdlineArgs / appExit / PluginPackages
  → mountRootInclude(ctx, configPath, patches, …)   // :1228
  → await ctx.get('loader')?.await()  // :1234
  → auditStartupEntries(ctx, binName) // :1236
```

**`ctx.appExit` 是启动器专属**：headless 插件在 `apply` 里直接检查 `ctx.get('appExit')`，缺了就抛错（`packages/bundle/headless/src/index.ts:456-462`）——**这坐实了「headless 必须走 `dsh` 启动器」**。

---

## 3. 方向 b：Stratix 作为 dsh 插件

### 3.1 插件元数据：manifest 里能声明什么

**没有 `client-ui` 这种「插件类型」字段**。全仓无该字面量。manifest schema（`packages/util/package-manifest/src/types.ts:32-41`；三个子接口分别在 `:71-78` / `:81-84` / `:87-100`）：

```ts
export interface DshManifest {
  manifestVersion?: 1
  bundle?:  DshBundleManifest   // { platforms?, patch: string | string[], listedByDefault? }
  profile?: DshProfileManifest   // { bundles?: string[] }
  client?: DshClientManifest     // { platform: string, inject?: string[], immediately?: boolean, external?: string[] }
}
```

> ⚠️ **`dsh.client.inject` 只是信息性的**——「they are **informational only** (preflight display, HMR diffing); they do not sequence entry activation or apply order. Activation order is Cordis fiber inject waiting on *services*, nothing else.」（`packages/client/AGENTS.md:151`）
> 真正决定激活顺序的是插件自己导出的 `inject` 常量（Cordis service 依赖）。

### 3.2 client-ui 插件形态（浏览器侧）

**判定「这是浏览器插件」的唯一机制**：`package.json` 的 `dsh.client.platform === 'web'` **且** `exports` 含 `"./client"`（`packages/client/modules/src/index.ts:905-909`：platform 非 `web` 跳过；无 `./client` 导出则 throw）。

> ✅ **rc.1 复核**：**没有新的 client 声明面**。全仓只读 `dsh.client.*` 的四个键：`platform` / `inject` / `external` / `immediately`（`packages/client/modules/src/client/manifest.ts:173-193` 的 `parseDshClient`）。`packages/util/package-manifest/src/types.ts` 在 alpha.2→rc.1 之间**只改了 `package.json` 版本号**，manifest 能力未变。

**参考实现**：`packages/experimental/client-ui-stats`（`@deepseek-ai/dsh-experimental-client-ui-stats@0.2.2-rc.1`，仍在 `packages/experimental/` 下）。

```
packages/experimental/client-ui-stats/
├── package.json     dsh.client.platform: 'web'，exports 含 './client'
├── src/index.ts     宿主半边：export function apply(): void {}   ← 空实现
└── src/client/      浏览器半边
    ├── index.ts     export const inject = ['slots','sessions','uiConversation','locale']   (:29)
    │                export function apply(ctx) { … }  (:63)
    │                  ctx.slots.inject('conversation.view', () => ctx.slots.register({…}))  (:75)
    ├── StatsView.tsx
    └── …
```

**贡献形态 = Slot 注册 + React 组件**（React 18.2）。核心 API（`packages/client/ui-slots/src/index.ts`）：

- `SlotKind`：`'single' | 'list' | 'keyed' | 'chain' | 'hoc'`（`:101`）—— ⚠️ **rc.1 新增第五个成员 `'hoc'`**（嵌套包装层），alpha.2 只有前四个
- `SlotScope`：`'root' | 'session-maybe' | 'session'`（`:104`）
- `ctx.slots.register({ name, children?, store?, inject? }, Component)`（`packages/client/ui-slots/src/index.ts:1194-1240` 两个重载：带 `inject` 业务面工厂的在 `:1222-1240`；实现体 `:1241`；形状说明 `:1184-1192`）——注册项的 `kind` 形状字段按种类追加（keyed 带 `key`；list 带 `id`/`order`/`label`）
- `ctx.slots.inject(slotKey, cb)` = 「等这个槽位被声明后再注册」（`packages/client/ui-renderer/src/client/registry.ts:209`，文档注释 `:194-208`）——**必需**，因为槽位是**声明即授权**（`packages/client/AGENTS.md:12`：「Rendering an undeclared slot, or declaring one someone else declared, fails at load」）
- `ctx.slots` 服务本体 = `SlotRegistry`（`packages/client/ui-renderer/src/client/registry.ts:120`，`super(ctx, 'slots')` 在 `:160`）

**Props 五份额模型**（`packages/client/AGENTS.md:13`）：`PropsRuntime`（owner 数据）+ `PropsRenderSlots`（children）+ `PropsRenderFactories` + `PropsStore` + **inject face**。

**inject face 的 `hooks` 隔间约定**（`packages/client/AGENTS.md:17`）：inject 只返回**纯数据与回调**；插件私有的响应式事实放 `hooks` 隔间（裸 observable），渲染器把它绑成 `use<Name>` hook，组件永远看不到 observable 源本身。

**能否嵌 WebGL / Canvas？——能，无机制性限制。** 插件就是普通 React 组件树：`useRef` 拿 DOM 节点、可挂 `<canvas>` 自行 `getContext('webgl')`、可 `createPortal`。约束是**约定式**的：

- 样式必须 CSS Modules + `clsx`，禁字面色值 / Tailwind / 组件库（`packages/client/AGENTS.md:120`）
- 业务组件不得自行订阅（禁 `useSyncExternalStore` / 手工 subscribe，`packages/client/AGENTS.md:26`）
- 构建期 purity gate：非实验性 client 产物拒绝实验性 module 与样式表输入（`packages/client/tsdown.client.ts:16-17`；gate 实现在 `:946-990` 的 `clientInputIsolation()`，隔离器来自 `scripts/bundle-input-isolation.ts`）

**新增 client-ui 插件的三个必需登记面**（`packages/client/AGENTS.md:150`，缺任一个会在**不同的、更晚**的时间点失败）：

1. `tsconfig.client.json` 聚合 `references` 条目
2. `packages/bundle/web-app/cordis.patch.yml` 里一行 `dsh.client` 行
3. `packages/bundle/web-app/package.json` 的 dependency

### 3.3 tools provider 插件形态（宿主侧）

**这是 Stratix 最该走的形态**（已有 spike：`plugins/dsh-bridge/`）。

**核心契约**（`packages/core/tools/src/contracts.ts:26-102`，接口 `ToolDefinition`）：

```ts
export interface ToolDefinition extends ToolSchema {
  readonly output: ToolOutputDefinition    // { schema: JsonSchemaNode, render(args, value): ContentBlock[], presentationMeta? }
  execute(args: unknown, exec: ToolRunContext): Promise<unknown>
  projectContent?(exec, result): ContentBlock[] | undefined    // :49  rc.1 新增
  finalizeContent?(exec, result): ContentBlock[] | undefined    // :61  rc.1 新增
  presentCall?(args): ToolCallView | undefined
  presentResult?(args, result): ToolResultView | undefined
  timeoutMs?: number
  isConcurrencySafe?(args): boolean
}
```

> ⚠️ **rc.1 增量**：alpha.2 的 `ToolDefinition` 只有 `execute` / `presentCall` / `presentResult` / `timeoutMs` / `isConcurrencySafe` 五个可选钩子；**rc.1 新增 `projectContent?` 与 `finalizeContent?`**（`packages/core/tools/src/contracts.ts:49` 与 `:61`）。语义差别是**位置**：`projectContent` 在 `tools/post-execute` 策略**之前**替换内容（策略替换仍具权威），`finalizeContent` 在**物化给模型的最后一米**同步变换（必须 total、不得抛）。二者都只影响**模型可见内容**，不改 `execute` 返回的 canonical 值——这给「工具输出给模型看的是浓缩版、给 UI 看的是全量版」提供了原生手段，Stratix 的 `stratix_world_snapshot` 正好适用。

**`defineTool` 的参数 DSL 不是自由 JSON Schema**：`ParameterSchemaSpec` 定义在 `packages/core/tools/src/schema.ts:104-107`（配套 `ValueSchemaSpec` 与 `DefineToolOptions` 在 `:484`），`defineTool` 实现在 `:555`；`parameters` 是**隐式开放 object 根的 per-property DSL**，编译后才变 raw JSON Schema（`parameterSchemaSpecToJsonSchema`，`:450-459`）。若直接 `ctx.tools.register` 传 raw JSON Schema，则**注册方自负输入校验**（`docs/cookbook/adding-a-tool.md`）。

**参考实现**（`packages/experimental/tool-worktree/src/index.ts`，全文 43 行）：

```ts
export const name = 'tool-worktree'
export const inject = ['tools', 'worktrees']

export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'create_worktree',
    description: '…',
    parameters: {
      name: { type: 'string', description: '…' },
      from: { type: 'string', description: '…' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false,
                properties: { path: { type:'string', required:true }, … } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      if (exec.agent === undefined) throw new Error('create_worktree requires a calling agent')
      return ctx.worktrees.create(exec.agent, args, exec.signal)
    },
    presentCall: args => ({ card: 'generic', title: 'create_worktree', rawInput: args }),
  }))
}
```

**注册时的强制校验**（`packages/core/tools/src/index.ts:128-152`，`ToolsService.register`）：

- `output` 缺 `render` → `TypeError`
- output schema 不受支持 → throw
- 工具名 `run_code` 保留 → throw（**无条件保留**，任何 agent 都能自选 code 模式）
- `timeoutMs` 非正有限数 → `TypeError`
- 参数校验失败 → `ToolArgsError`（`packages/core/tools/src/schema.ts:461-471`）
- `presentCall` / `presentResult` / `isConcurrencySafe` 违规 → **软失败**（返回 undefined / false，不抛）——「presentation must never crash a replay」（`schema.ts:609-625`）

**工具如何进入模型视野**：`ctx.tools.register` → layer effect → `ctx.tools.resolve({agent, modelSelection, signal})` 逐个评估 `registration.when` → `ResolvedToolSet` → `projectToolSchema` 只保留 `name/description/parameters/deferLoading`（`packages/core/tools/src/schema.ts:641-646`，由 `index.ts:317` 的 `schemas()` 调用）→ 注入 system prompt（`index.ts:113-117` 的 `ctx.systemPrompt.tools(...)`）。

> ✅ **rc.1 复核**：`ctx.tools` 服务本身**没有变**——`ToolsService` 类在 `packages/core/tools/src/index.ts:98`，`super(ctx, 'tools')` 在 `:112`；`resolve()` 在 `:264`；`defineTool` 产出的工具对象在 `schema.ts:555-633` 组装。变的是**契约多了两个钩子**（见上）。

**额外贡献面**：插件还可注册 system prompt section（`ctx.systemPrompt.section({ name, order, text })`，实现见 `packages/core/system-prompt/src/index.ts:484-493`；用法见 `packages/experimental/tool-ralph/src/index.ts:405-409`）。

### 3.4 「可视化指挥台」作为 dsh 面板——可行形态与限制

**结论：技术可行，但价值有限，且与 dsh 的既定路线重叠。**

| 形态 | 描述 | 限制 |
|---|---|---|
| **B1. client-ui 插件（浏览器侧 React）** | 把 Stratix 战场做成一个 `conversation.view` 槽位条目（`kind:'list'`, `scope:'session'`），或一个 `sidebar.right.pane.tab` 槽位 | ① dsh 的 client-ui 插件**跑在浏览器里**，跑的是 dsh 自己的 Web 前端；Stratix 的战场是 Phaser/Electron 应用，不是浏览器里的 React 组件树 —— 要嵌就得把 Phaser 画面搬进 dsh 的 Web 页面；② 三个登记面（§3.2）必须改 dsh 仓库（`packages/bundle/web-app/cordis.patch.yml` + `tsconfig.client.json` + `package.json`）；③ **默认产品不挂实验性包**——`packages/experimental/client-ui-stats/README.md:101` 自述「The Web bundle refuses experimental packages by rule」，但**强制点在构建脚本而非插件市场**：`scripts/bundle-input-isolation.ts:57-60`（bundle 输入若属于实验性包直接 throw）、`scripts/verify-default-product-isolation.ts:139`（默认产品依赖图不得含实验性包）、判定函数 `scripts/experimental-package-policy.ts:85` `isExperimentalPackageName`。即：**要挂进默认 Web 产品，第三方包不能带 `dsh-experimental-` 前缀** |
| **B2. tools provider（宿主侧）** | Stratix 的 8 个 MCP 工具改写成 dsh 工具，`output.render` 输出真数据 | 已经跑通（`plugins/dsh-bridge/`）。**模型看到的是 `output.render()` 的产物**——只 render 汇总结论模型会以为数据是编的（spike 实测教训） |
| **B3. 外部 Web 面板 + dsh 插件做「转发器」** | dsh 侧插件只提供工具（读 world-sync），Stratix 侧自己的 Electron/Pixi 画面独立存在 | **这就是现状**（桥 B）。最低风险 |
| **B4. client-ui 插件 + 外部 iframe/canvas** | 插件内挂 `<iframe>` 或 `<canvas>` 指向 Stratix 的本地服务 | 需放开 CSP / 同源策略；dsh 的 webserver 未见 iframe 放行配置 → **需上游配合** |

**关键限制**：dsh 的 client-ui 插件**不是「从宿主进程推 UI 给前端」**，而是**它本身就是前端**（`src/index.ts` 是空宿主半边）。所以「把 Stratix 指挥台塞进 dsh」实际含义是「把 Stratix 画面重写为 dsh Web 应用里的一个 React 组件」——与「Stratix 自己是 Electron 应用」的定位直接冲突。

### 3.5 bundle/profile 装载第三方插件（完整链路）

```
1. npm 发布（或本地路径 / tarball / git URL）
   spec 解析：packages/boot/plugin-manager/src/install-spec.ts:69 parseInstallSpec()
     绝对路径 → path（相对路径直接拒绝）
     .tgz/.tar.gz → tarball
     github:/gitlab:/bitbucket:/gist: 简写、git://、git@host:、http(s) 仓库 URL → git
     http(s) + tarball → tarball
     其余 → registry（npm 包名 + @range）

2. 安装：dsh plugin --profile <name> add <spec>
   → packages/boot/plugin-manager/src/operations.ts:296 runProfilePnpm()（pnpm add）
   → :104 若无 dsh.bundle → warning「installed as a plain dependency, not a profile layer」

3. 对账：packages/boot/app-boot/src/profile-plugins.ts:104 reconcileProfilePlugins()
   → 有 dsh.bundle → 写 profile 的 dsh.profile.bundles

4. 下次启动：packages/boot/app-boot/src/profile.ts:678 loadProfileDirectory()
   → 逐个 resolveBundleDir()（:651）→ 读 dsh.bundle → 平台检查 → bundlePatchPaths()（:69）→ loadOverlayPatches()（:702）

5. 运行时解析裸包名：packages/boot/app-boot/src/profile-resolution/resolver.ts:829 installRuntimeInterception
   （Worker 内用 worker_threads.getEnvironmentData/setEnvironmentData 传解析表，:1069-1071）
```

**不发布 npm 的两条捷径**（Stratix 现状用的正是第一条）：

- **`--patch` 覆盖层**：`dsh --profile headless --patch ./plugins/dsh-bridge/bridge.patch.yml "任务"`。相对路径按 **patch 文件所在目录** 锚定成绝对 file URL（`anchorInsertedPluginNames`），所以 patch 可以原地跟着仓库走（`plugins/dsh-bridge/README.md`「装载 · 方式 A」）。
- **手写一行 `insert`**：`name: './plugins/dsh-bridge/dist/index.js'`（同上「方式 C」）。

**插件市场**（`packages/boot/plugin-market`）：读用户配置的 http(s) 索引 URL，提供 `search` / `entry` / `readEntryDetail`；真正安装仍走 `pluginManager.installBundle`（`packages/boot/plugin-market/README.md:12`）。**Stratix 目前不做市场分发**（`docs/DSH-INTEGRATION-PLAN.md` §4）。

---

## 4. workspace / working-directory / worktrees 映射

### 4.1 dsh 里有**三个**不同的「根」

| 概念 | 载体 | 语义 | 可变性 |
|---|---|---|---|
| **Session header cwd** | `SessionHeader.cwd`（`packages/core/session/src/types.ts:106`） | Session 创建时写入的**原始项目目录** | **不可变** |
| **有效工作目录** | `ctx.workingDirectory`（`packages/session/working-directory/src/index.ts:57`） | Session 当前的落脚目录 | **可变**（记为 `working-directory/change` 事件） |
| **Workspace** | `ctx.workspaceRegistry`（`packages/workspace/workspace/src/index.ts:195` `super(ctx, 'workspaceRegistry')`；类型在 `:115`） | Host 侧持久注册表：稳定 id + 规范路径 + 会话清单 | 路径**永不重写** |

外加第四个：**沙箱可写边界** `ctx.sandboxPolicy.workspaceRoot`。

> 🔑 **关键不变量**：有效工作目录 `cd` **不改变沙箱边界**。
> `packages/sandbox/sandbox-policy/src/index.ts:201`：`workspaceRoot: resolveWorkspaceRoot(session?.header.cwd ?? this.workspaceRoot)` —— 沙箱根永远锚定在**不可变的 header cwd** 上。

### 4.2 外部进程如何指定一个 session 的 cwd（**六条路径**）

#### 路径 A — Typert Remote `session.create`（Web/桌面，最常用）

请求体（`packages/api/session-controller/src/types.ts:268-277`）：

```ts
export interface SessionCreateRequest {
  readonly workspaceId?: WorkspaceId   // 与 cwd 互斥
  readonly cwd?: string                // 与 workspaceId 互斥
  readonly sessionId?: SessionId
  readonly agentPreset?: string
}
```

**解析顺序**（权威实现，`packages/api/session-controller/src/commands.ts:121-151`）：

```
1. workspaceId 与 cwd 同时给出 → RemoteError('gateway/bad-request', 'session.create accepts workspaceId or cwd, not both')   (:121-123)
2. workspaceId 给出但 registry 里不存在 → RemoteError('workspace/not-found')                                            (:125-132)
3. cwd = workspace?.path ?? request.cwd ?? defaultCwd     // defaultCwd = process.cwd()                                   (:133)
4. 创建后若指定了 workspace → workspace.attachSession(sessionId)，失败 → 'session/workspace-attach-failed'                 (:147-151)
```

**副作用**：目录会被**递归创建**（`packages/api/session-controller/src/agent.ts:438`：`await mkdir(cwd, { recursive: true })`）→ 相对路径会被按**进程 cwd** 解释。**建议一律传绝对路径。**

**硬约束**：`cwd` 必须是绝对路径，在 session 边界强制（`packages/core/session/src/index.ts:114-119`：`session header cwd must be an absolute path`）。

#### 路径 B — SDK JSON-RPC `initialize` + `session/working-directory/set`

- `initialize.cwd` 决定该 server 后续**所有**新会话的 cwd（`packages/sdk/server/src/server.ts:227` 解析 → `:245` 赋值 → `:594` `meta: { cwd: this.cwd }`）。
- `session/working-directory/set` 改单个会话（`server.ts:428-431` → `ctx.workingDirectory.set(agent, params.path)`）；相对路径按会话当前目录解析；**不改变 origin 与权限**（`packages/sdk/protocol/src/types.ts:136-140`）。

#### 路径 C — ACP `session/new`

`params.cwd` 必须**绝对**（`packages/acp/acp/src/index.ts:199-239`，校验在 `:509-518`）；`additionalDirectories` 非空直接 `invalidParams`（`:511-517`）。`session/resume` 校验 cwd **物理同一性**（realpath 比较，`src/index.ts:521-529` 的 `sameDirectory`，调用点 `:254-255` 与 `:272-274`）。

#### 路径 D — Headless（**只能靠进程 cwd**）

**headless 没有 `--cwd`**。工作目录 = 调用进程的 cwd（`packages/bundle/headless/src/index.ts:386-387`）。恢复会话时严格核对 cwd，不匹配则拒绝（`:236-241`）：

```ts
if (header.cwd !== cwd) {
  throw new Error(`session "${sessionId}" was recorded in "${header.cwd}", not "${cwd}"`)
}
```

→ **Stratix 想用 headless 指定项目目录，唯一办法是 `spawn` 时设 `cwd` 选项**（即让子进程 cwd = 项目文件夹）。

#### 路径 E — 声明式 agent-loop 配置

```yaml
- id: my-agent
  cwd: /abs/path/to/project    # packages/core/agent-loop/src/index.ts:265（声明）、:303（schema）、:340（写入 session meta）
```

#### 路径 F — 模型侧（间接）

模型用 `working_directory({ cd })` 工具或 `create_worktree({ name, from })` 工具改目录。

### 4.3 `ctx.workingDirectory` 的完整语义

**服务**：`WorkingDirectoryService extends Service`，`static inject = ['fs','sessionProjections','systemPrompt']`（`packages/session/working-directory/src/index.ts:57-60`），服务名注册于 `:73`。

**作用域 = per-session**（不是 per-agent、不是 per-bundle）。证据链：

1. 状态按 Session 存储（session projection，`:82-89`）
2. 读 API 以 Session 为参数：`get(session): string`（`:122-124`）
3. 写 API 以 Agent 为参数，但落到该 Agent 拥有的 Session：`set(agent, path, signal)` → `agent.session.append('working-directory/change', { cwd })`（`:191`）

**五条写入通道**（全部落到 `session.append('working-directory/change')`）：

| # | 入口 | 位置 |
|---|---|---|
| A | Session 创建时的 `header.cwd` | `packages/core/session/src/index.ts:1196` |
| B | `working_directory` 工具的 `cd` | `packages/session/tool-working-directory/src/index.ts:38` |
| C | `create_worktree` 工具 | `packages/experimental/worktree/src/index.ts:198` |
| D | SDK `session/working-directory/set` | `packages/sdk/server/src/server.ts:428-431` |
| E | `ensure()` 的自动恢复（当前目录消失 → 回落到 `header.cwd ?? defaultDirectory`） | `packages/session/working-directory/src/index.ts:147-149` |

**校验**：路径必须存在且是目录；相对路径按**当前有效目录**解析（`:176-184`）。

**影响面**：

| 流向 | 具体 |
|---|---|
| 文件工具（read/write/edit/apply_patch） | `packages/fs/tool-fs/src/session-cwd.ts:23`（`ctx.workingDirectory.ensure(exec.agent, exec.signal)`） |
| Shell（bash/pwsh） | `packages/shell/tool-bash/src/index.ts:488-489`（`workdir` 相对会话 cwd 解析，`:145-152` 的 `resolveWorkdir`） |
| 搜索（glob/grep） | `packages/fs/tool-fs-search/src/search-core.ts:236`（**不受沙箱约束**，`:194` 注释） |
| 持久终端（PTY） | `packages/terminal/terminal-bash/src/index.ts:207` |
| 子 Agent（in-process） | `packages/subagent/subagent/src/manager.ts:489-495`（继承或解析目录），写入子 Agent 自身 session 在 `:834` |
| 子 Agent（out-of-process） | `packages/subagent/subagent/src/out-of-process.ts:104-111`（`assertUsableCwd` 要求绝对路径） |
| **模型上下文** | 作为**必需的用户上下文**注入（不进 system prompt），`packages/session/working-directory/src/index.ts:90-110`，文本 `Current working directory: "<path>".`（`:172-174`） |
| **会话日志路径** | **由不可变的 `header.cwd` 决定**（`packages/session/session-persistence-jsonl/src/index.ts:345-347`）——`cd` 只追加事件，**不移动日志文件** |

### 4.4 Workspace 注册表

`ctx.workspaceRegistry`（`packages/workspace/workspace/src/index.ts:170`）是 **Host 侧可选能力**，对模型不可见（无工具、无提示词、无会话事件，`docs/subsystems/workspace.md:5`）。

**它就是一个多根管理器**：注册表可同时持有多份 Workspace，每份对应一个规范化的目录根 + 全局显示顺序（创建时经 `fs.realpath` 规范化，`packages/workspace/workspace/src/index.ts:224-243`；持久化 schema 在 `packages/workspace/workspace/src/spec.ts:76-84`）。唯一性判据是**规范路径字符串相等**（`:503-506` 的 `resolveByPath` 与 `:510-513` 的 `createCanonical`）。

**关键 API**（`packages/workspace/workspace/src/index.ts`）：

| 方法 | 行号 |
|---|---|
| `create(path, title?)` | `:238` |
| `initializeDefault(resolveDirectory)` | `:258` |
| `get(id)` / `list()` / `delete(id)` | `:282` / `:292` / `:310` |
| `insertBefore(id, beforeId?)` | `:321` |
| `resolveByPath(path)` | `:502` |
| `archiveSession` / `unarchiveSession` / `pinSession` / `unpinSession` | `:365` / `:399` / `:428` / `:455` |

**会话与 Workspace 的绑定校验**（`packages/workspace/workspace/src/entity.ts:110-141`）：会话的 `header.cwd` 规范化后必须**等于** `Workspace.path`，否则 `cannot attach session '…' to workspace '…': its cwd resolves to '…'`。

**Workspace 根无静态配置文件**——三条运行时途径：

1. RPC `workspace.create`（`packages/api/workspace-controller/src/commands.ts:45-60`）
2. 首次使用自动创建默认 Workspace（`packages/api/workspace-controller/src/default-directory.ts:60-77`）→ 默认路径 = `<系统 Documents>/deepseek-harness/default-workspace`（目录名常量在 `default-workspace.ts:16`）
3. 覆盖 config `documentsDirectory` / `documentsLookupTimeoutMs`（`packages/api/workspace-controller/src/index.ts:39-41`）

**持久化**：storage-domain JSON 后端，落 `$DSH_HOME/storages`（`packages/workspace/workspace/src/spec.ts:76-84`；root 来自 `packages/bundle/base/cordis.patch.yml:182-190`）。

### 4.5 worktree

**包**：`@deepseek-ai/dsh-experimental-worktree`（`packages/experimental/worktree/src/index.ts:61` `WorktreeService`），实验性。

**一句话**（`packages/experimental/worktree/src/index.ts:1`）：「Creates a new Git branch and checkout, then changes the calling Session's working directory; restores a removed checkout.」

**默认是 opt-in**（无运行时功能开关，靠显式组合启用；GUI 里是 Official 分组下的「**Change requests & worktrees**」开关（`packages/experimental/forge-bundle/locale/en.json:3`），**shipped profiles 默认关闭**——`packages/experimental/forge-bundle/README.md:12`：「Enable Change requests & worktrees on the Web or Desktop Plugins page; shipped profiles leave it disabled.」；见 `packages/experimental/tool-worktree/README.md:28`）。

**流程**（`packages/experimental/worktree/src/index.ts:169-203`）：

| 步骤 | 命令/动作 | 行号 |
|---|---|---|
| 源仓库根 | `git rev-parse --show-toplevel`（取自**调用方当前会话目录**） | `:180-182` |
| 分支名 | `request.name` 或 `generatedWorktreeName('dsh-', sessionId)`（`src/name.ts:16-21`） | `:162` |
| 基点 ref | `request.from` 或 `'HEAD'`，**本地**解析，**不 fetch** | `:164,183` |
| 检出目录 | `<repositoryRoot>/<config.directory>/<branch>`，默认 `<repoRoot>/.agents/worktrees/<branch>` | `:187-190` + `:65` |
| 分支名校验 | 相对路径；不能含 `\`、`:`、`.`、`..`；不能以 `-` 开头 | `:55-58,163` |
| 实际创建 | `git --work-tree <root> worktree add --no-checkout -b <branch> -- <path> <baseCommit>` | `:194` |
| 检出 | `git --work-tree <path> reset --hard --no-recurse-submodules <baseCommit>` | `:197` |
| **切目录** | `ctx.workingDirectory.set(agent, path)` | `:198` |

**模型可见工具**：`create_worktree`（`packages/experimental/tool-worktree/src/index.ts:18`），参数 `{ name?, from? }`，输出 `{ path, branch, baseCommit, repositoryRoot }`（`:24-36`）。描述明确：「Use working_directory with cd to leave; the checkout and branch remain.」

**与 Agent Team 的关系**：Agent Team **明确不做** worktree——「**One process** — members can observe shared filesystem edits; this package provides no worktree, remote member, merge, or filesystem lock.」（`packages/team/agent-team/README.md:196`；同文件 `:12` 另有一句「Members share one checkout.」）。

### 4.6 与「项目=文件夹、.stratix 契约目录」的对齐

| Stratix 愿景要素 | dsh 对应物 | 对齐判断 |
|---|---|---|
| **项目 = 一个文件夹** | `SessionHeader.cwd`（不可变绝对路径）+ `Workspace.path`（规范化单路径） | ✅ **直接对齐**。dsh 的 Workspace 就是「多根管理器」，语义与「一个项目一个文件夹」一致 |
| **workspace 目录含 `.stratix` 契约目录** | dsh **没有**项目级元数据目录约定；只有 `<projectRoot>/.dsh/skills`（只读技能根，`packages/skill/skill-filesystem/src/index.ts:256`）与 `<repoRoot>/.agents/worktrees/`（harness 写入） | ⚠️ **dsh 不留项目级配置/状态**。`.stratix/` 属于 Stratix 私有，**dsh 侧不应写它**（对应 dsh 的铁律：配置与状态全在 `$DSH_HOME`） |
| **agent 进入项目获得干净上下文当「手脚」** | dsh 的 `header.cwd` = 项目目录；模型上下文里注入 `Current working directory: "…"`（`packages/session/working-directory/src/index.ts:172-174`）；`AGENTS.md`/`CLAUDE.md` 按项目根自动加载（`packages/context/agent-instructions/src/config.ts:11-13`） | ✅ **高度对齐**。dsh 的「cwd 即项目」+「项目根向上找 marker」正是 Stratix 想要的 |
| **多项目并存** | `ctx.workspaceRegistry` 支持多根 + 顺序 + 归档/置顶 | ✅ 直接用 |
| **每个副本独立的 agent 上下文** | dsh 一个 Session = 一个 Agent = 一个 cwd；不同 Session 可同 cwd（团队共享 checkout）或不同 cwd（worktree 隔离） | ✅ dsh 已经提供了「共享」与「隔离」两种玩法 |
| **副本隔离（worktree）** | `create_worktree` 工具 | ✅ **直接可用**（实验性，默认关） |

**要点**：**`.stratix/` 与 dsh 的 `cordis.patch.yml` 是正交的**——前者是项目契约（给 agent 读），后者是部署配置（给 harness 读）。**不要把 `.stratix` 映射到 profile/bundle**：profile 是 `$DSH_HOME` 下的**部署**概念，不是项目概念。

---

## 5. 结合点清单

**评级口径**：

- **直接用**——dsh 现有 API 即满足，Stratix 无需改造语义（≤1 天适配）
- **适配后用**——需要写适配层/换调用形态，但不改变 dsh 语义或需上游小改（≤1 周）
- **需上游配合**——需要改 dsh 仓库或等待其 API 演进（不可控）
- **不可行**——与 dsh 既定路线或 Stratix 铁律冲突

### 5.1 「Stratix 复用 dsh」栏（dsh → Stratix）

| # | 结合点 | 具体包名 / API | 评级 | 依据 |
|---|---|---|---|---|
| C1 | **dsh 作为第四种 CLI worker** | `npx -y @deepseek-ai/dsh --profile headless --json "<task>"`；事件面 `session`/`status`/`text`/`thinking`/`tool_call`/`tool_result`/`final` | **直接用** | 已实现：`src/app/services/cli-transport/adapters/dsh.ts`；契约与 `packages/bundle/headless/src/json-stream.ts` 一致 |
| C2 | **dsh 作为常驻 agent 服务（stdlib）** | `@deepseek-ai/dsh-sdk-client` 的 `DeepSeekHarness`（`packages/sdk/client/src/api.ts:21`）：`start()` / `session(id)` / `run()` / `close()` | **适配后用** | 协议成熟、事件通知齐全；**但无 wire cancel / 无 session/close**，需靠关进程取消（`packages/sdk/server/README.md:216`） |
| C3 | **dsh 作为标准协议 agent（ACP）** | `dsh --profile acp`；`initialize` / `session/new` / `session/prompt` / `session/cancel` / `session/list` / `session/resume` | **适配后用** | 标准协议，Zed 等编辑器可直接接；**但无工具列表、无终端委派、权限一次性、每会话单 in-flight prompt**（`packages/acp/acp/README.md:82`） |
| C4 | **dsh Web/Gateway 作为远程 agent 面** | `POST /api/session/create` / `session/prompt` / `session/wait`；WS `/api/remote.mux` | **需上游配合** | 唯一带鉴权的面，但需拿到 launch token（`GET /connect?token=…`）、处理 Cookie HMAC；**Stratix gateway 侧要新增「dsh peer」概念**；启动参数 `--trusted-host` 等由部署侧掌握 |
| C5 | **复用 dsh 的 tool 目录/schema 规范** | `packages/core/tools/src/schema.ts:555` `defineTool` 的 per-property 参数 DSL + `output.render` 契约 | **直接用** | 与 Stratix 现有 MCP 工具契约同构；`docs/cookbook/adding-a-tool.md` 有完整规则 |
| C6 | **复用 dsh 的 Cordis「可逆注册」范式** | `ctx.effect(() => disposer, label)`（`vendor/cordis/src/fiber.ts:421`）；插件卸载即撤销注册 | **直接用**（作为**规范**而非依赖） | 零依赖引用其**语义**，正好是 `docs/MCP-SPEC.md` v2 第四模式的落地口径 |
| C7 | **复用 dsh 的 session 事件流 + 投影模型** | `SessionEvent`（append-only）+ session projection（`packages/session/working-directory/src/index.ts:82-89` 的 `register({ key, stateVersion, stateSchema, init, apply, wire })`） | **适配后用** | 与 Stratix world-sync 的「事件日志 + 投影」语义同构（`docs/WORLD-SYNC.md` §3 seq 规则）；但 dsh 的投影是**按 session**的，Stratix 是**按 world**的 |
| C8 | **复用 dsh 的权限预设 / 审批策略** | `--permission-mode <preset>` / `--approval-policy ask\|never`（`packages/bundle/headless/src/startup.ts:60-62`）；`ctx.sandboxPolicy.resolve({session})` | **适配后用** | dsh 的 `workspaceRoot` 锚定不可变 `header.cwd`（`packages/sandbox/sandbox-policy/src/index.ts:201`），与 Stratix「项目文件夹边界」天然同构 |
| C9 | **复用 dsh 的技能/指令文件发现** | `<projectRoot>/.dsh/skills`、`<projectRoot>/.agents/skills`（`packages/skill/skill-filesystem/src/index.ts:256-268`）；`AGENTS.md` / `CLAUDE.md`（`packages/context/agent-instructions/src/config.ts:11-13`） | **直接用** | Stratix 的 `.stratix/` 契约目录可照此模式加一条 `.stratix/skills` 根 |
| C10 | **把 dsh 的 plugin manager / market 接到 Stratix 插件面板** | `ctx.pluginManager.installBundle(spec)`（`packages/boot/plugin-manager/src/index.ts:872`）；market 索引 URL（`packages/boot/plugin-market/src/index.ts:111-113`） | **需上游配合** | dsh 的 GUI 插件面板是 client-ui 插件（`packages/client/ui-plugin-manager/`）；Stratix 侧要么做自己的市场客户端，要么复用其 HTTP 面（受 §C4 的鉴权约束） |
| C11 | **把 dsh 的 plugin 目录（inventory）读给 Stratix** | `pluginInventoryRemote`（`packages/api/remotes/src/client/index.ts:202`，装配的 **30** 个 Remote contribution 之一） | **需上游配合** | 依赖 Gateway 面（同 C4） |
| C12 | **复用 dsh 的 model provider 抽象（多 provider 路由）** | `ctx.llm.resolveCallConfig({ provider, model, reasoningEffort?, maxTokens? })`（`packages/sdk/server/src/server.ts:239-244`）；`provider: 'deepseek-official'` | **适配后用** | dsh 自带多 provider 抽象，Stratix 的 provider roster 可映射过去；但 dsh 自动挂载的适配器**只支持 DeepSeek**（`packages/sdk/server/README.md:219`） |
| C13 | **把 dsh 的 MCP 服务器舰队状态读给 Stratix** | `ctx.remote.mcpManager`（`packages/mcp/mcp-manager/README.md:114`：`list()` / `restart(name)` / `probe(name)` / `watch(signal)`） | **需上游配合** | 唯一带 `watch` 推送的 MCP 状态面，但只在 Gateway/Remote 侧暴露，Stratix 需先解决 C4 的鉴权 |
| C14 | **复用 dsh 的斜杠命令语义做 Stratix 的 `/` 命令** | `session/query` 路由（`packages/sdk/server/src/server.ts:289-332`，识别函数 `packages/sdk/server/src/query-input.ts:14-27`）：命令名经 `resolveCommand` 解析（**含中英别名**，目标/计划/反馈/压缩/权限/导出，`packages/interaction/commands/src/builtin.ts:17-20`），再按**定义 ID**筛选出 `/compact` / `/permission <preset>` / `/plan [off\|message]` / `/goal [...]` 四类（`packages/sdk/server/README.md:40`） | **适配后用** | 路由规则可精确复述：**①** 文本以 `/` 开头；**②** token 能解析成已注册命令（精确名优先，别名次之）；**③** 其 definitionId 属上述四类之一；**④** 形态约束——`/compact` 必须**裸**、`/permission` 必须**带 preset 参数**、`/plan`/`/goal` 可带可选参数（`query-input.ts:23-25`）。**不满足即落回普通 prompt**（`/model`、`/反馈`、`/导出`、裸 `/permission` 与裸 `/权限` 全部落回）；**被识别的命令执行失败时不回落**（`server.ts:287,320-322`）。与 Stratix 现有 `/` 命令语义同构，但**只覆盖 4 类**、且**别名集合由 dsh 的第一方命令表决定** |

### 5.2 「dsh 复用 Stratix」栏（Stratix → dsh）

| # | 结合点 | 具体包名 / API | 评级 | 依据 |
|---|---|---|---|---|
| S1 | **Stratix 世界态作为 dsh 工具** | `ctx.tools.register(defineTool({ name: 'stratix_world_snapshot', … }))`；数据源 = world-sync WS（`docs/WORLD-SYNC.md`） | **直接用** | **已跑通**：`plugins/dsh-bridge/`（`src/index.ts:64-83`）；`inject: ['tools']` + `ctx.effect` 挂 disposer |
| S2 | **Stratix 写命令面作为 dsh 工具** | 同上，但 `execute` 里发 `command.forward`（`docs/WORLD-SYNC.md` §2.2）+ 等 `command.ack` | **适配后用** | world-sync 的写只有一条路：`command.forward`（铁律 2：裁决在 core）。工具的 `execute` 需**阻塞到 ack** 才返回，才能让模型看到落点 |
| S3 | **Stratix 世界事件面作为 dsh 工具** | `event.forward`（fire-and-forget，无 ack，`docs/WORLD-SYNC.md` §2.2） | **适配后用** | 语义上不适合做「工具」——无回执，模型无法确认；更适合做**后台事件源**（agent 上下文注入） |
| S4 | **Stratix 指挥台作为 dsh client-ui 面板** | `ctx.slots.register({ name:'conversation.view', id:'stratix', order, inject }, Component)`；需 `dsh.client.platform:'web'` + `./client` 导出 | **需上游配合** | ① 三个登记面要改 dsh 仓库（`packages/client/AGENTS.md:150`）；② Stratix 的 Phaser/Electron 画面不是 React 组件；③ **默认产品不挂实验性包**（构建脚本 `scripts/bundle-input-isolation.ts:57-60` 强制，非插件市场） |
| S5 | **Stratix 作为 dsh 的外部工具提供方（反注册）** | dsh 侧挂 MCP 客户端 `@deepseek-ai/dsh-mcp-client`（`packages/mcp/mcp-client/README.md:12`），工具名 `mcp__<server>__<tool>`（`:74,78`）；server 条目写在 profile 的 `config.servers`（`:38-48`，`serverName` 必填、transport 选 stdio / Streamable HTTP） | **直接用** | **这条路比把 Stratix 编成 dsh 插件更轻**：Stratix 已有 MCP server（`docs/MCP-SPEC.md`），只需在 dsh profile 里加一条 server entry（stdio 起子进程或 Streamable HTTP 指向本地端口）；dsh 侧的命名空间隔离天然避免与原生工具撞名 |
| S6 | **Stratix 项目目录作为 dsh session cwd** | `session.create { cwd }` / `initialize { cwd }` / ACP `session/new { cwd }` / headless `spawn({ cwd })` | **直接用** | 见 §4.2 路径 A/B/C/D；`.stratix/` 就在该目录下，agent 进去即得干净上下文 |
| S7 | **Stratix mission/task 作为 dsh 的 skill / 指令注入** | `ctx.systemPrompt.section({ name, order, text })`（实现 `packages/core/system-prompt/src/index.ts:484-493`）；`<projectRoot>/.dsh/skills` 约定 | **适配后用** | `.stratix/` 里的角色定义/任务史可渲染成 skill 或 system prompt section；dsh 已有完整的 skill 优先级（**rank 越小越优先**，`packages/skill/skill/src/index.ts:78`；project-dsh = 100 最高、project-agents = 200、runtime = 250、user-dsh = 400、bundled = 600，`packages/skill/skill-filesystem/src/index.ts:35-39`） |
| S8 | **Stratix 提供 git worktree 隔离（agent 副本隔离）** | dsh 的 `create_worktree` 工具（`packages/experimental/tool-worktree/src/index.ts:18`）+ `ctx.workingDirectory.set` | **直接用** | dsh 已实现；Stratix 只需把「副本」映射成「worktree 目录」，并在快照里带上 `branch` / `baseCommit` |
| S9 | **Stratix 作为 dsh 的 workspace 注册表后端** | `ctx.workspaceRegistry.create(path, title?)`（`packages/workspace/workspace/src/index.ts:238`）+ `POST /api/workspace/create` | **需上游配合** | dsh 的 Workspace 持久化在 `$DSH_HOME/storages` 的 storage-domain JSON；换后端要改 dsh 的 `workspaceDomainSpec`（`packages/workspace/workspace/src/spec.ts:76-84`） |
| S10 | **Stratix 派活 → dsh 执行的「队列/调度」面** | `ctx.sessions` / `session/wait` / `job` namespace（`packages/api/job-controller/src/index.ts:75-96`，`job/list` + `job/follow` + `job/kill`） | **适配后用** | dsh 的 job 面可映射「后台长任务」；Stratix 的 mission 队列语义（mission/task 状态机）留在 Stratix 侧（铁律 1） |
| S11 | **Stratix 的模型 provider 路由表供给 dsh** | `initialize { provider, model }`（`packages/sdk/protocol/src/types.ts:24-26`）；`ctx.llm.resolveCallConfig` | **需上游配合** | dsh 的 `provider` 必须在服务端有 adapter，否则 `initialize` 直接失败（`packages/sdk/server/src/server.ts:233-244`：先查 adapter、再 resolveCallConfig，失败即抛）；**接入 Stratix 自己的 LLM 网关要改 dsh 侧 adapter**（或走 `llm-example.patch.yml` 那样的 patch 行改 provider 配置） |
| S12 | **Stratix 世界态作为 dsh 的 MCP resource** | `dsh-mcp-resources` 的三个共享工具 `list_mcp_resources` / `list_mcp_resource_templates` / `read_mcp_resource`（`packages/mcp/mcp-resources/README.md:12,38,86-90`） | **直接用** | ⚠️ **草稿此处判断错误**：草稿据 ACP 面「resources/prompts 无消费者」推出「宿主侧也无人消费」，实际 dsh 宿主**有**资源消费者。resource 文本进对话历史；binary 载荷不投影给模型（`:104`）。Stratix 侧只需在 MCP server 实现 `resources/list` + `resources/read` |
| S13 | **Stratix 世界态作为 dsh 的 MCP prompt** | — | **不可行** | dsh 的 MCP 客户端**明确不支持 prompt 模板**：「MCP prompt templates are unsupported」（`packages/mcp/mcp-client/README.md:12`），宿主侧也没有任何 MCP prompt 消费面。要把「世界态提示词」送进模型，只能走 S7（system prompt section）或 S12（resource） |
| S14 | **Stratix 作为 dsh 的 MCP 服务器（舰队注册面）** | `ctx.mcpManager.register(name, …)`（`packages/mcp/mcp-manager/README.md:93-108`）；对外 `ctx.remote.mcpManager`（`:114`） | **适配后用** | **rc.1 新增**：manager 为每个启用 entry 挂一个 `dsh-mcp-client` 实例，支持 live 增删改；凭据用 `${credential:REF}` 模板留在 dsh 侧，轮换由 mcp-client 处理 |
| S15 | **Stratix 私密数据不进入 dsh 会话日志** | `ctx.sessionLogDeepSeek.registerExclusion(predicate)`（`packages/session/session-log-deepseek/README.md:48,55-56`） | **直接用** | **rc.1 新增**：谓词收到 `sessionId` 与可选 `purpose`，返回 `true` 即跳过该请求的日志字段与上传；**抛异常的谓词只跳过该项，模型请求照常继续** |
| S16 | **dsh 工具输出的「模型可见文本」二次加工** | `ToolDefinition.projectContent?` / `finalizeContent?`（`packages/core/tools/src/contracts.ts:49,61`） | **直接用** | **rc.1 新增**：`projectContent` 在 `tools/post-execute` 策略之前替换内容，`finalizeContent` 在物化给模型的最后一米变换。Stratix 的 `stratix_world_snapshot` 可让**模型看到浓缩结论、UI 看到全量快照**——正对 spike 的「只 render 汇总结论模型会以为数据是编的」教训 |
| S17 | **用 Python SDK 驱动 dsh** | `python/sdk/`（rc.1 新增，`pyproject.toml` + `src/` + `examples/`） | **适配后用** | 同一条 JSON-RPC 协议的第二语言实现；适合 Stratix 侧不需要 Node SDK 的场合（运维脚本、CI 探针）；代价是多一套运行时依赖，且能力面要与 Node SDK 对齐需各自跟进 |

### 5.3 汇总统计

| 评级 | Stratix 复用 dsh（14 项） | dsh 复用 Stratix（17 项） |
|---|---|---|
| 直接用 | C1, C5, C6, C9（4） | S1, S5, S6, S8, S12, S15, S16（7） |
| 适配后用 | C2, C3, C7, C8, C12, C14（6） | S2, S3, S7, S10, S14, S17（6） |
| 需上游配合 | C4, C10, C11, C13（4） | S4, S9, S11（3） |
| 不可行 | —（0） | S13（1） |

**合计 31 条**（≥8 的验收要求满足 3 倍以上）。评级变化相对草稿：**S5 由「适配后用」升为「直接用」**（rc.1 的 `dsh-mcp-client` 是现成的配置面，不必走 ACP 的 `mcpServers`）；**S12 拆成 S12/S13**（resource 可用 → 直接用；prompt 不可行）；**S14/S15/S16/S17 与 C13/C14 为 rc.1 新增**。

---

## 6. 最小可行试点建议

**目标**：两周内跑通一条**完整闭环**——Stratix 派活 → dsh 在指定项目目录里干活 → 结果回到 Stratix。

**选定路径**：`C2`（SDK stdio 常驻）+ `S1`（Stratix 世界态工具）+ `S6`（项目目录 = cwd）。

**为什么不选 headless（桥 A）**：headless **无 cwd 参数、无取消、无事件订阅**，只能靠 spawn 的 `cwd` 传目录，且一次一任务。对于「派活 → 收结果 → 可能追问」的循环，SDK 协议多出 `session/resume`、`session/wait`、`session.event` 三个关键能力，代价只是多写一个客户端适配。

### 6.1 试点范围（明确收窄）

| 做 | 不做 |
|---|---|
| Stratix 侧起一个 dsh 常驻会话，cwd = 项目文件夹 | 不做 dsh 插件市场 / GUI 面板 |
| 挂 `stratix_world_snapshot`（只读） | 不做写命令工具（`command.forward`） |
| 收 `session.event` 通知 → 映射成 Stratix 的 agent 事件 | 不做多会话 / 子 agent |
| 跑通「派活 → 收结果」一次 | 不做 worktree 隔离（下一个迭代） |

### 6.2 关键调用序列（可直接执行）

**第 0 步：起 dsh（子进程）**

由 Stratix 用 `@deepseek-ai/dsh-sdk-client` 发起：

```ts
import { DeepSeekHarness } from '@deepseek-ai/dsh-sdk-client'

const harness = new DeepSeekHarness({
  profile: 'sdk',                    // 默认；packages/sdk/client/src/launch.ts:132
  dshHome: '/abs/path/to/stratix-dsh-home',
  patches: ['/abs/path/to/stratix/bridge.patch.yml'],   // 装 S1 工具
  cwd: '/abs/path/to/project',        // ← 项目文件夹！packages/sdk/client/src/types.ts:59
  provider: 'deepseek-official',
  model: 'deepseek-v4-flash',
  env: { ...process.env, DEEPSEEK_API_KEY: '...' },   // 凭据只走环境变量
})
await harness.start()
```

`DeepSeekHarness.start()` 内部会 spawn `dsh --profile sdk --patch …`（`packages/sdk/client/src/launch.ts:143`），并发出 `initialize` 握手（`packages/sdk/client/src/api.ts:74-81`）。

> ⚠️ `cwd` 与 `processCwd` 是两件事：`cwd` 走 wire 落进每个 session 的 `header.cwd`；`processCwd` 是**子进程自身**的工作目录（`packages/sdk/client/src/types.ts:36,59-60`）。

**第 1 步：挂 Stratix 世界态工具（S1）**

复用现成的 `plugins/dsh-bridge/`，把 patch 行改成绝对路径：

```yaml
# /abs/path/to/stratix/bridge.patch.yml
- insert:
    - id: stratix-dsh-bridge
      name: '/abs/path/to/stratix/plugins/dsh-bridge/dist/index.js'
      config:
        url: 'ws://127.0.0.1:7797/ws/world-sync'
        clientId: 'stratix-dsh-bridge'
```

> 相对路径会按 **patch 文件所在目录** 锚定成绝对 file URL（`anchorInsertedPluginNames`），所以 `name` 也可以写 `'./plugins/dsh-bridge/dist/index.js'` 并把 patch 放在仓库里。

**第 2 步：订阅事件**

```ts
const sub = harness.client.subscribe((n) => {
  // n.method === 'session.event' | 'session.status' | 'subagent.finished' | …
  // session.event 的 payload.event 是 dsh 的 SessionEvent
})
```

事件类型见 `packages/sdk/protocol/src/types.ts:194-207`。

**第 3 步：派活**

```ts
const session = harness.session(`stratix-${taskId}`)
const result = await session.run('读一次战场状态，然后告诉我你的计划')
// result: { sessionId, finalResponse, finishReason, events, notifications }
//   packages/sdk/client/src/types.ts:74-85
```

> ⚠️ **rc.1 变化**：高层 `run()` 的线缆入口**已从 `session/prompt` 换成 `session/query`**——「`session/query` is the wire entry used by high-level SDK `run()` for strings and content-block arrays」（`packages/sdk/server/README.md:40`；服务端分派在 `packages/sdk/server/src/server.ts:505-508`，协议声明在 `packages/sdk/protocol/src/types.ts:213`）。`session/query` **自带斜杠命令路由**：只认 `/compact`、`/permission <preset>`、`/plan [off|message]`、`/goal [...]`；裸 `/permission`、`/权限`、`/compact extra` 及其它一切输入都**落回普通 prompt**（`:40`）。`session/prompt` 仍是「低层排队输入」入口，**没有**斜杠命令路由（`:40` 末句）。
> **对 Stratix 的含义**：Stratix 自己也有 `/` 命令语义（task_155 定稿），若派活文案以 `/` 开头会**意外触发 dsh 的命令**，需在派活前做前缀转义或改走 `session/prompt`。

底层线缆：`session/query`（`packages/sdk/server/src/server.ts:505`）→ Agent 跑 → `session/wait`（`:521`）排空；`session/prompt`（`:503`）仍是低层排队入口。

**第 4 步：收结果并映射到 Stratix**

- `result.finalResponse` → Stratix 的 agent 消息
- `result.events` → 逐条映射成 Stratix 的 `TransportEvent`（`src/app/services/cli-transport/transport.ts` 的公共事件类型）——**注意 dsh 的 `SessionEvent` 是内部类型，不要直接漏进公共契约**（桥 A 的 adapter 有同样的纪律：`src/app/services/cli-transport/adapters/dsh.ts` 头注释「禁止把 dsh 私有字段名漏进公共事件类型」）
- 工具调用轨迹：dsh 的工具事件在 `session.event` 里，工具名与参数**结构与 Stratix 的 MCP 工具不同**，需要一层映射（dsh 的 `tool_call`/`tool_call_update` 在 ACP 侧是 `kind:'other'` 的通用投影）

**第 5 步：收尾**

```ts
await harness.close()
// → 'shutdown' 请求 → 服务端 flush → rootFiber.dispose() → exit(0)
//   packages/sdk/server/src/index.ts:90-93
// → disposeRuntimeProcess: stdin EOF → SIGTERM → SIGKILL
//   packages/sdk/client/src/dispose.ts:82-99
```

### 6.3 试点必须处理的四个坑

| 坑 | 现象 | 处置 |
|---|---|---|
| **🔴 版本钉位互斥（rc.1 新增，最高优先级）** | `plugins/dsh-bridge/package.json` 钉 `@deepseek-ai/cordis: ~4.0.5` + `@deepseek-ai/dsh-tools: 0.2.1-rc.5`；rc.1 的 dsh 自带 `cordis@4.1.0` + `dsh-tools@0.2.2-rc.1`。`~4.0.5` = `>=4.0.5 <4.1.0`，**不容纳 4.1.0** → spike 在 rc.1 上**装不上** | **试点开工第一件事**：把两个钉位改成 `~4.1.0` 与 `0.2.2-rc.1`。安全性已核：`packages/core/tools/src/` 在 alpha.2→rc.1 之间**只动了 `package.json` 版本号**（`git diff --stat dsh-v0.2.2-alpha.2 HEAD -- packages/core/tools`），`defineTool` 的 DSL 形状未变 |
| **SDK wire 无 cancel** | Stratix 取消任务时，`session/query` 仍在服务端跑（`packages/sdk/server/README.md:216`） | 短期：取消 = **关掉整个 harness 进程**（`harness.close()`），重建新实例。长期：改用 ACP（有 `session/cancel`）或等待上游加 cancel |
| **`cwd` 目录不存在会被自动创建** | `session.create` 里 `mkdir(cwd, { recursive: true })`（`packages/api/session-controller/src/agent.ts:438`）；SDK 侧 `initialize.cwd` 不创建但会 resolve | 一律传**绝对路径**；项目目录由 Stratix 自己保证存在 |
| **stdout 纯度 / provider 凭据** | dsh 官方默认路由钉在 DeepSeek，无凭据直接 `MISSING_CREDENTIAL` 退出 | 用现成的 `plugins/dsh-bridge/llm-example.patch.yml`（把 LLM 路由指到任意 OpenAI 兼容网关）；凭据只走环境变量名，不落盘 |
| **派活文案以 `/` 开头会命中 dsh 的命令路由** | rc.1 的 `session/query` 会把 `/compact` / `/permission <preset>` / `/plan` / `/goal` 当原生命令执行，**不回落到普通 prompt**（`packages/sdk/server/README.md:40`） | 派活前检查首字符：`/` 开头则改走 `session/prompt`（低层入口无命令路由），或加前缀转义 |

### 6.3b 另一条更轻的试点路径（可与上条并行评估）

**S5（MCP 反注册）**：Stratix 侧已有 MCP server（`docs/MCP-SPEC.md`），dsh 侧只需在 profile 里加一条 MCP server entry（`packages/mcp/mcp-client/README.md:38-48`），工具名自动带 `mcp__<server>__` 前缀（`:74`）。**代价**：Stratix 不掌控 dsh 的会话生命周期（cwd、取消、事件），只能拿到工具调用与最终文本——适合「要结果不要过程」的活；**不适合**需要事件流/取消的活。选型判据：**要事件流与取消 → SDK（C2）；只要工具与结果 → MCP（S5）**。

### 6.4 试点验收清单

- [ ] **依赖钉位已改**：`plugins/dsh-bridge/package.json` 的 `@deepseek-ai/cordis` = `~4.1.0`、`@deepseek-ai/dsh-tools` = `0.2.2-rc.1`（否则 rc.1 上根本装不上）
- [ ] Stratix 能起一个 `dsh --profile sdk` 常驻会话，`initialize.cwd` = 项目文件夹
- [ ] dsh agent 调用 `stratix_world_snapshot` 拿到**真** units（不是 mock）—— 注意必须 `JSON.stringify(value)` 进 `output.render`，否则模型会判定数据是编的
- [ ] 派活文案以 `/` 开头时**没有**被 dsh 当成斜杠命令执行
- [ ] Stratix 侧收到 agent 文本 + 工具轨迹，且**没有 dsh 私有类型漏进公共事件契约**
- [ ] 取消路径可用（当前实现 = 关进程）
- [ ] dsh 进程退出后无孤儿（`ctx.effect` 的 disposer 关掉 WS 连接与重连定时器）
- [ ] 零反向依赖：`grep -r "dsh-bridge" src/` 为空

### 6.5 下一迭代的三个候选（按性价比排序）

1. **S2 写命令工具**：`execute` 里发 `command.forward` 并等 `command.ack` 返回 —— 让 dsh agent 能真的派活给 Stratix 角色，而不只读状态。**这是「双向兼容」的真正兑现点。**（rc.1 提示：用 `projectContent` 把「命令已下发」与「世界态新事实」分两层给模型，别让模型靠猜。）
2. **S8 worktree 隔离**：Stratix 的「游戏副本」= dsh 的 worktree 目录；副本创建 = `create_worktree`，并在 Stratix 快照里带上 `branch` / `baseCommit`。
3. **S5 反注册（Stratix 做 MCP server，dsh 用 MCP 客户端）**：比把 Stratix 编成 dsh 插件更轻，**只需在 dsh profile 里加一条 MCP server entry**（`packages/mcp/mcp-client/README.md:38-48`），工具名自动带 `mcp__<server>__` 前缀；也兼容 ACP 路径（`session/new` 的 `mcpServers` 支持 stdio 与 streamable-http）。**代价**：拿不到事件流与取消。

---

## 7. 陷阱清单

**驱动口相关**

1. **ACP 与 SDK 的 `session/prompt` 不是同一个东西** —— ACP 返回 `{stopReason}`，SDK 返回 `{messageId}`；方法名空间独立，**不要混用同一客户端**。
2. **SDK wire 没有 cancel / close / list** —— 取消任务 = 杀进程。
3. **ACP 不暴露工具列表**（ACP v1 规范本身就没有 tool-list 方法），也不委派终端/文件操作给编辑器；未注册的方法一律 `-32601`；权限只有一次性三选项。dsh 是 **ACP v1 单版本服务端**，不做 v1/v2 协商。
4. **ACP 有两条取消通道**：`session/cancel` 通知 与 协议级 `$/cancel_request`（后者经 SDK 的 `requestSignal` abort 传导）。客户端只发前者也有效。
5. **headless 必须走 `dsh` 启动器**（靠 `ctx.appExit` 请求退出，绕过即启动失败）。
6. **headless 没有 `--cwd`** —— 只能靠 spawn 时的进程 cwd；`--add-dir` 是「追加可写根」，不是「切换 cwd」。
7. **Gateway 是唯一带鉴权的驱动口**，且鉴权**不认 `Authorization` 头** —— 只有 HMAC 签名 Cookie + Origin 栅栏。
8. **`apps/web` 不能独立 serve** —— `vite serve` 被显式拒绝；页面依赖 Host 注入的 `window.__DSH_BOOT__`。
9. **`desktop` profile 被 CLI 独占** —— npm 装的 `dsh` 不能 boot 也不能 dump 它。

**插件相关**

10. **`dsh.client.inject` 不是激活顺序** —— 它只用于预检展示与 HMR diff；真正顺序由 Cordis `inject`（服务依赖）决定。
11. **`client-ui` 不是 manifest 字段** —— 判定靠 `dsh.client.platform === 'web'` + `./client` 导出。
12. **`defineTool` 的 `parameters` 不是自由 JSON Schema** —— 是 per-property DSL，编译后才是 raw JSON Schema；直接 `ctx.tools.register` 传 raw schema 则注册方自负校验。
13. **`ctx.tools.register` 必须声明 `output.render`** —— 缺则 `TypeError`；且模型看到的是 `render()` 的产物，不是规范值本身。
14. **普通 npm 依赖不会自动变成插件行** —— 只有声明 `dsh.bundle` 的包才成为 profile 的一层。
15. **patch 替换整个 `config`，不合并** —— 覆盖一行配置要写全字段。
16. **🔴 版本钉位互斥** —— rc.1 的 dsh 自带 `cordis@4.1.0` + `dsh-tools@0.2.2-rc.1`；`plugins/dsh-bridge/package.json` 钉的 `~4.0.5` + `0.2.1-rc.5` **装不上**（`~4.0.5` = `>=4.0.5 <4.1.0`）。详见 §0.1.3 与 §6.3。
17. **默认产品不挂实验性包** —— 强制点在**构建脚本**（`scripts/bundle-input-isolation.ts:57-60`、`scripts/verify-default-product-isolation.ts:139`），**不是插件市场**。第三方包若带 `dsh-experimental-` 前缀，进不了默认 Web 产物。
18. **`SlotKind` 在 rc.1 多了 `'hoc'`** —— 写死四个成员的 switch 会漏分支（`packages/client/ui-slots/src/index.ts:101`）。
19. **`ToolDefinition` 在 rc.1 多了 `projectContent?` / `finalizeContent?`** —— 位置语义不同（前者 pre-post-execute，后者物化前最后一米），不是同一个钩子（`packages/core/tools/src/contracts.ts:49,61`）。

**目录语义相关**

20. **`cd` 不改变沙箱边界** —— 沙箱根锚定不可变 `header.cwd`（`packages/sandbox/sandbox-policy/src/index.ts:201`）。
21. **`cd` 不移动会话日志** —— 日志路径由 `header.cwd` 决定（`packages/session/session-persistence-jsonl/src/index.ts:345-347`）。
22. **会话归属 Workspace 按 `header.cwd` 判定** —— `cd` 之后会话**仍留在**原 Workspace 清单里（`packages/workspace/workspace/src/entity.ts:110-141`）。
23. **ACP `session/resume` 的 cwd 校验是 realpath 物理同一性**，不是字符串比较（`packages/acp/acp/src/index.ts:521-529`）。
24. **headless 恢复会话时 cwd 必须完全一致**，否则报错拒绝（`packages/bundle/headless/src/index.ts:236-241`）。

**协议语义相关（rc.1 新增）**

25. **SDK 高层 `run()` 的线缆入口是 `session/query`，不是 `session/prompt`** —— 前者自带斜杠命令路由，后者没有（`packages/sdk/server/README.md:40`）。
26. **`session/query` 的斜杠命令只认 4 类且有形态约束** —— 路由见 `packages/sdk/server/src/query-input.ts:14-27`：`/compact` 必须裸、`/permission` 必须带 preset 参数、`/plan`/`/goal` 可带可选参数；**中英别名可用**（`packages/interaction/commands/src/builtin.ts:17-20`），但不满足形态约束的（如裸 `/permission`、裸 `/权限`、`/compact extra`）**落回普通 prompt**；**被识别的命令失败时不回落**（`packages/sdk/server/src/server.ts:320-322`）。
27. **MCP prompt 模板不被支持** —— dsh 的 MCP 客户端只消费 tools 与 resources（`packages/mcp/mcp-client/README.md:12`）；要送提示词只能走 system prompt section 或 resource。

---

## 附录 A：dsh 关键 ctx 服务速查

| ctx key | 提供方 | 位置 |
|---|---|---|
| `ctx.tools` | ToolsService | `packages/core/tools/src/index.ts:112`（类在 `:98`） |
| `ctx.llm` | LlmRuntime | `packages/llm/llm/src/index.ts:363`（类在 `:354`） |
| `ctx.agents` | Agent 注册表 | `packages/core/agent` |
| `ctx.sessions` | SessionStore | `packages/core/session/src/index.ts:1092` |
| `ctx.workingDirectory` | WorkingDirectoryService | `packages/session/working-directory/src/index.ts:73`（类在 `:57`） |
| `ctx.workspaceRegistry` | WorkspaceRegistry | `packages/workspace/workspace/src/index.ts:195` |
| `ctx.fs` / `ctx.shell` / `ctx.subprocess` | 文件/命令 | `packages/fs` / `packages/shell` / `packages/subprocess` |
| `ctx.sandbox` / `ctx.sandboxPolicy` | 沙箱 | `packages/sandbox/sandbox` / `sandbox-policy` |
| `ctx.systemPrompt` | 提示词 | `packages/core/system-prompt/src/index.ts:452`（`section()` 在 `:484`） |
| `ctx.pluginManager` / `ctx.pluginMarket` | 插件管理/市场 | `packages/boot/plugin-manager/src/index.ts:358`（`installBundle` 在 `:872`）/ `packages/boot/plugin-market/src/index.ts:135` |
| `ctx.typertGateway` / `ctx.remote` | Gateway 两侧 | `packages/api/gateway/src/index.ts:243` / `packages/api/remotes/src/client/index.ts:189-215`（装配 30 个 Remote contribution） |
| `ctx.remoteAccess` | 方法级授权 | `packages/api/remote-access/src/index.ts:135` |
| `ctx.slots` | SlotRegistry（浏览器侧） | `packages/client/ui-renderer/src/client/registry.ts:160`（类在 `:120`） |
| `ctx.uiConversation` | 会话视图注册表 | `packages/client/ui-conversation` |
| `ctx.appExit` / `ctx.cmdlineArgs` | 启动器注入 | `packages/boot/cmdline/src/index.ts:86-87` |
| **`ctx.mcpManager`**（rc.1 新增） | MCP 服务器舰队 | `packages/mcp/mcp-manager/README.md:93-114` |
| **`ctx.sessionLogDeepSeek`**（rc.1 新增） | 会话日志 DeepSeek 上报 | `packages/session/session-log-deepseek/README.md:48-56` |
| **`ctx.worktrees`**（实验性） | git worktree 运行时 | `packages/experimental/worktree/src/index.ts:61` |

**注意**：**没有** `ctx.workspace`（零命中）、**没有** `ctx.session`（单数，正确是 `ctx.sessions`）。

## 附录 B：Stratix 侧现存资产索引

| 资产 | 位置 | 状态 |
|---|---|---|
| 桥 A：dsh CLI adapter | `src/app/services/cli-transport/adapters/dsh.ts`（同目录另有 claude/codex/custom/kimi/openclaw/opencode 六个） | 已实现（task_088） |
| 桥 B：Stratix-as-dsh-plugin spike | `plugins/dsh-bridge/src/`（`index.ts` / `world-sync-client.ts` / `world-snapshot-tool.ts` / `protocol.ts`） | 已实现（task_089），只读单工具 |
| 桥 B 装载 patch | `plugins/dsh-bridge/bridge.patch.yml` + `llm-example.patch.yml` | 已实现 |
| **🔴 桥 B 依赖钉位（阻塞项）** | `plugins/dsh-bridge/package.json:21-25`（`cordis ~4.0.5` / `dsh-tools 0.2.1-rc.5`） | **必须改成 `~4.1.0` / `0.2.2-rc.1` 才能在 rc.1 上装载**（§0.1.3） |
| 三桥总纲（冻结） | `docs/DSH-INTEGRATION-PLAN.md` | 已冻结 |
| world-sync 线协议 | `docs/WORLD-SYNC.md` | 权威 |
| MCP 工具契约 v2 设计章 | `docs/MCP-SPEC.md` | 已设计（task_087）；**是 S5（MCP 反注册）路径的现成资产** |

---

## 附录 C：本次复核的核对方法

- **HEAD 读取方式**：只读仓库 `/Users/kingj/code/deepseek-harness`。本地 `HEAD` = `master` = `origin/master` = `fcc0ad4621`（`git rev-parse`），该提交标题为「Merge pull request #7873 from deepseek-harness/merge/release-dsh-0.2.2-rc.1-to-master」。`git ls-remote` 因本机**无法连通 github.com:443** 而失败，故**未执行 `git pull`**（本就不允许对该仓库写）；`git status --porcelain` 为空，**全程零写**。
- **行号漂移**：本文所有 `path:line` 引用均在 rc.1（`package.json:3` = `0.2.2-rc.1`）上用 `sed -n` / `awk` / `grep -n` 逐条复核过；与草稿（基于 alpha.2）有偏差的一律已改。
- **差异比对**：rc.1 相对 alpha.2 的改动面用 `git diff --stat dsh-v0.2.2-alpha.2 HEAD -- <path>` 定位（只读命令）。
- **未复核项**：Stratix 侧 `src/` 未做任何改动（任务禁止）；`plugins/dsh-bridge/` 的**代码**未改，只在本文标注了必须改的依赖钉位。
