# TencentDB-Agent-Memory 评估报告 —— Stratix 内置「大管家」记忆系统选型

> **任务**：task_174 调研评估（`TencentDB-Agent-Memory` 作为 Stratix 内置「大管家」agent 的记忆系统）
> **调研对象**：<https://github.com/TencentCloud/TencentDB-Agent-Memory>
> **所读 commit**：`2002196f2d7c22ea267cfcaf67c5a6fa861df681`（2026-11-04 19:33:39 +0800，`Update README_CN.md (#1949)`；仓库最新 tag `v2.0.3`）
> **子包版本**：`MemoryCore` = `@tencentdb-agent-memory/memory-tencentdb-v2@1.0.2-beta.1`；`MemoryProxy` = `context-proxy@0.1.0`；TS SDK = `@tencentdb-agent-memory/memory-sdk-ts-v2@1.0.1-beta.1`
> **拉取方式**：`git clone --depth 50` → `/tmp/tdb-agent-memory`（**不进本仓**）；`npm install` 副本 → `/tmp/mc-install`、`/tmp/mp-install`（同样在 /tmp）
> **报告日期**：2026-11-05
> **实测环境**：darwin 25.3.0 / Node v22.22.2 / npm 10.x / Docker CLI 24.0.5（Docker Desktop VM 磁盘已满，故镜像体积改用 registry API 流式实测，见 §2.2）
> **网络**：全程经 `https_proxy=http://127.0.0.1:7890`
>
> **纯调研声明**：本任务**零代码改动**。未改 `src/`、未改任何设计文档、未改 `HEARTBEAT.md` / `lra.md` / `.long-run-agent`，未向本仓引入任何依赖。本文件是本次唯一的产出物。
>
> **证据分级**（全文遵守）：源码/实测 > 官方 README/INSTALL/API 文档 > 官方 SDK 指南 > 第三方描述。凡未实测的数字均标注「推断」并给出推断依据。

---

## 0. TL;DR

**结论先行**：消费级电脑三档判定 = **🟡 黄**；用不用 = **👀 观望**。

1. **它不是一个「记忆库」，是一整个四件套产品**（MemoryCore 记忆引擎 / MemoryProxy LLM 拦截代理 / MemoryPanel 管理面板 / MemoryKnowledge 知识服务）。Stratix 真正需要的只是第一个（记忆引擎），而且**可以只拿它**。
2. **架构上有一半用不上**：产品的招牌是「Proxy 拦截 LLM 流量 → 把记忆塞进 system prompt」。而 Stratix 的内置 agent 走的是**拉起外部 CLI 子进程**（claude-code / codex / dsh / opencode / kimi / openclaw），没有一条自有的 LLM HTTP 出口 —— Proxy 路径与 Stratix 的进程模型正面冲突。
3. **但记忆引擎本体确实好用且贴合**：L0→L1→L2→L3 四层模型 + SQLite/sqlite-vec 本地存储 + BM25/向量/RRF 混合检索 + MIT 协议 + TS SDK（唯一依赖 `undici`）+ 「Standalone 模式，适合 Agent sidecar」的官方定位 —— 这是本次评估里最正面的一条。
4. **三档判定 🟡 黄的依据**：
   - 🟢 **绿**：只跑 MemoryCore standalone（`npm install` 源码进程）—— **450 MB node_modules / 122 包 / 单进程 / 零外部服务 / 数据全在本地 `~/.memory-tencentdb/`**（冷启动 2.47 s、稳态 RSS 753 MB；关掉本地 BM25 稀疏编码后 **227 MB / 1.09 s**）；
   - 🔴 **红**：跑官方三件套（`start-all.sh`）—— **3.2 GB 解压后磁盘**、4 容器 4 端口、2 组 LLM API key、每开新会话要弹表单选 team/agent/task、Panel 独占 1.5 GB；
   - 🟡 **黄**：整体。裁剪路径明确（见 §5.3），但裁剪后剩下的记忆引擎是 **beta 版 + 原生插件 ABI 摩擦**，不到「今天就接进生产」的成熟度。
5. **观望的理由（三条，缺一不可地成立）**：
   - ① **协议层是 beta**：v3 数据面 API、SDK 都在 `1.0.x-beta.1`，仓库 CHANGELOG 显示高频破坏性变更（尤其各 CLI 的 wire 协议适配，见 `agents/dsh/README.md` 里记录的 5 个 dsh v0.2 兼容坑）；
   - ② **原生插件与 Electron 的 ABI 摩擦**：`sqlite-vec` / `better-sqlite3` 都是 `.node` 原生插件，Stratix 跑在 Electron 40 里，本仓已有 `better-sqlite3` 在 Node/Electron 版本不匹配时 `ERR_DLOPEN_FAILED` 的前科（见 CLAUDE.md 与仓库记忆），接进来要付 electron-rebuild 的持续维护成本；
   - ③ **真正划算的部分（分层记忆模型 + RRF 混合检索 + 降级纪律）代码量不大**，自研一个 Stratix 原生的 memory port 成本可控，且没有 beta 依赖与 ABI 风险 —— 现在引入外部 beta 项目，换来的不是不可替代的能力。
6. **一个被低估的坑：`@tencentdb-agent-memory/tcvdb-text` 硬依赖 285 MB 中文 BM25 语料**。它随包分发两份 JSON（英文 200.6 MB + 中文 85.4 MB），启动时 `readFileSync` + `JSON.parse` **两份各解析一次**（`factory.ts:55` 与 `store-pool.ts:133` 各建一个 encoder）→ 实测单份解析后 RSS **663.6 MB**，两份是 MemoryCore 默认 753 MB 稳态内存的**主要来源**。**关掉它（`memory.bm25.enabled: false`）省 526 MB / 1.4 s，检索能力一点不打折**（SQLite FTS5 是另一套独立实现，`/health` 仍报 `ftsAvailable: true`）。
7. **一条正面结论**：如果 Stratix 未来真要记忆，**这个项目应该被当作「设计参考 + 可选的引擎实现」**，而不是「依赖」。它的 L0/L1/L2/L3 分层、RRF(K=60) 融合、`<relevant-memories>` / `<user-persona>` 注入分区、失败降级三原则，都是可以直接抄进 Stratix `core/` 契约的成熟设计。

---

## 1. 工具能力

### 1.1 这是什么（架构 / 定位）

仓库根下是 **4 个可独立部署的 TypeScript 组件 + 1 个 SDK + 1 组 CLI 适配文档**：

| 组件 | 目录 | 端口 | 职责 | 对 Stratix 的价值 |
|---|---|---|---|---|
| **MemoryCore** | `MemoryCore/` | 8420 | 记忆内核 gateway：L0–L3 数据面 + Skill 库 + 元数据面（team/agent/task/user/ACL） | ★★★ 唯一真正相关 |
| **MemoryProxy** | `MemoryProxy/` | 8096 | LLM 请求转发代理：拦截 → 注入记忆 → 转发上游 | ★☆☆ 与 Stratix 进程模型冲突 |
| **MemoryPanel** | `MemoryPanel/` | 8125 | Web 管理面板（建 team/agent/task、审核 skill） | ★☆☆ 可被 API 完全替代 |
| **MemoryKnowledge** | `MemoryKnowledge/` | 8424 | 知识服务：Wiki / CodeGraph 生成与检索 | ☆☆☆ 与大管家记忆无关 |
| **SDK** | `sdk/memory-core/{typescript,python}` | — | v3 严格隔离客户端 | ★★★ 真正的接入面 |

官方定位（`MemoryCore/README_CN.md:44`）：

> MemoryCore 以 Standalone Runtime 形式开源，**适合本地开发、单机部署和 Agent sidecar**。

**这一句直接命中 Stratix 的场景**（本地单机的 agent sidecar）。而 `deploy/global-images/README.md` 的三件套是「团队记忆管控平台」的形态 —— **产品重心在团队协作面板，不在单机 agent 侧车**。这个重心差异是后面所有判定的根源。

**仓库活跃度**（GitHub API 实测，2026-11-05）：30,520 star / 2,972 fork / **888 open issue**；创建于 2026-04-07，最后 push 2026-11-04。主力语言 TypeScript。**半年内从 0 到 3 万 star，迭代极快 —— 这是双刃剑：设计成熟，但接口不稳定。**

### 1.2 记忆模型（会话记忆 / 长期记忆 / 分层？）

**明确分层，四层**，这是该项目的核心设计（`MemoryCore/src/core/`）：

| 层 | 名字 | 载体 | 触发 | 产出上限 |
|---|---|---|---|---|
| **L0** | Conversation | SQLite `l0_conversations` + `l0_vec` + `l0_fts` | 每轮对话（由 proxy 或 SDK 写入） | — |
| **L1** | Atom（原子记忆） | SQLite `l1_records` + `l1_vec` + `l1_fts` | 轮次阈值（warm-up 1→2→4→8→5）或静默 600s | 每会话 **20** 条 |
| **L2** | Scenario（场景） | Markdown 文件 `scene_blocks/<name>.md` | L1 之后 ≥10s，定时器下探式 | **15** 个场景 |
| **L3** | Persona / Doctrine | Markdown `persona.md` | 冷启动 / 首个场景完成 / 累计 50 条记忆 | — |

证据：
- L1 表结构 `MemoryCore/src/core/store/sqlite/memory-store.ts:483-504`；向量表 `:541-547`（`vec0` 虚拟表，cosine）；FTS5 表 `:945-983`。
- 抽取链路 `MemoryCore/src/utils/pipeline-manager.ts:42-51`（三条触发路径）；L1 抽取 **1 次 LLM 调用**（`src/core/record/l1-extractor.ts:478`，场景切分 + 记忆抽取合并一次），**去重再 1 次 LLM 调用**（`src/core/record/l1-dedup.ts:133-134`）。
- L2 抽取是 **LLM Agent + 工具循环**（`src/core/scene/scene-extractor.ts:2-16`），沙箱限定在 `scene_blocks/`，超时 **300,000 ms**（`:143`）。
- L3 五级触发优先级 `src/core/persona/persona-trigger.ts:35-96`。

**「跨会话」的实现机制（对大管家最关键的一条）**：
TS SDK 的 v3 客户端在构造时强制 `(teamId, agentId, userId)` 三元组，`sessionId` **可选**（`sdk/memory-core/typescript/README_CN.md`）：

> 传入时，L0/L1 按单会话收敛；**不传或 `withIsolation({ sessionId: null })` 时，L0/L1 按 `(team, agent, user)` 跨 session 聚合**；L2/L3 是 team+agent 级 profile，不消费 `sessionId`。

→ **这正是「大管家要跨任务跨会话记忆」的现成开关**，不需要 hack。

### 1.3 API 形态（SDK / 服务 / MCP？）

- **HTTP 服务**：`MemoryCore` v3 API，19 个 L0–L3 数据面端点 + 17 个 Skill 端点 + 5 个 Knowledge 端点（`MemoryCore/v3-api-memorycore-doc.md:83` 起）。全部 `POST`，路径 `/v3/{conversation,atomic,scenario,core,skill,knowledge,meta,session}/…`。鉴权走 `x-tdai-user-key` + `x-tdai-service-id` 双头。
- **SDK**：TS（`@tencentdb-agent-memory/memory-sdk-ts-v2`，**唯一运行时依赖 `undici`**）与 Python 双份。TS SDK 是纯 HTTP 客户端（`package.json` 只有 `undici` 依赖），**不是可嵌入引擎**。
- **管理面**：`MetadataClient`（同包）覆盖 team/agent/task/user/asset 的 CRUD（`sdk/memory-core/typescript/AGENT_GUIDE.typescript.zh-CN.md` §7）→ **Panel 可以完全绕开**。
- **MCP**：**没有**。全 `MemoryProxy/` 目录 case-insensitive grep `mcp` 只命中客户端 system prompt 里的 tag 名（`mcp_protocol` / `mcp_configuration`）与提示词文案，**无 `@modelcontextprotocol/*` 依赖**。官方明示其机制是 **HTTP + `Bash + curl`**（`MemoryProxy/src/injection/injectors/skill-tools-injector.ts:3-9`：「the LLM does NOT see these as native tools … Instead the LLM uses its existing Bash tool to curl」），白名单只读端点见 `MemoryProxy/src/memory/memory-bridge.ts:46-53`。
  → **对 Stratix 意味着**：记忆检索不是 MCP tool，而是要 Stratix 自己把它包成 core 契约里的 tool，或者退化成「每轮自动召回 + 注入」（推荐，见 §6.3）。

### 1.4 检索机制（向量 / 关键词 / 混合）

**三套并存，且有完整的 RRF 融合**：

| 机制 | 实现 | 位置 |
|---|---|---|
| 向量 | sqlite-vec `vec0` 虚拟表，cosine，`WHERE embedding MATCH ? AND k = ?` | `memory-store.ts:591-598`（L1）、`:701-708`（L0） |
| 关键词 BM25 | SQLite FTS5，`bm25(l1_fts)` / `bm25(l0_fts)` | `memory-store.ts:995-1005`、`:1016-1024` |
| **混合 + RRF** | 客户端 FTS ∥ 向量 → **Reciprocal Rank Fusion，K = 60** | `src/core/tools/l1-candidate-recall.ts:20,154-173`；`src/core/hooks/auto-recall.ts:746,752-780`；`src/core/tools/conversation-search.ts:52,61-79` |

- **中文分词**：硬依赖 `@node-rs/jieba`（`package.json`），写侧 `cutForSearch` 预分词后空格连接存入 FTS 列（`src/core/store/tokenize.ts:145-150`），查侧生成 `"词1" OR "词2"` MATCH 串（`:73-99`）；jieba 缺失时降级为 Unicode 正则（`:88-94`）。
- **超采样**：hybrid 用 `candidateK = maxResults * 3`（`auto-recall.ts:668`）。
- **无 embedding 时自动降级为 keyword**（`auto-recall.ts:480-485`）。
- **Skill 检索只有 BM25**：`src/core/skill/skill-store.ts:532-549` 明确注释「pure embedding 路径暂未实现 → 仍回 BM25；hybrid 同样回 BM25（后续 RRF 融合）」。

**两个隐性坑（实测/源码均确认）**：
1. **FTS5 未必存在**。官方 README 自己警告（`MemoryCore/README_CN.md`）：「官方 Node 二进制不保证包含 FTS5（如 v22.13.1 缺失、v22.23.2 有）。FTS5 缺失时关键词搜索**静默返回空**，召回降级为仅 embedding」。可用 `GET /health` 的 `stores.ftsAvailable` 检查。**这一条对消费级电脑（往往用 Homebrew/官方的 Node 二进制）是真风险。**
2. **默认压根不开向量**：`embedding.provider: "none"`（`tdai-gateway.standalone.yaml:128` 注释「默认关闭向量搜索, 仅用 BM25」）。要开远程 embedding 得配 `baseUrl + apiKey + model + dimensions` 四项齐全（`src/core/store/embedding.ts:439-450`），**又是第四个外部服务**。
   - 顺带：**本地 embedding（node-llama-cpp + embeddinggemma-300m / 768 维 / Q8_0 ≈ 300MB）在当前版本被配置层禁用了** —— `MemoryCore/src/config.ts:517-524` 写得很直白：「Local embedding provider is not available in user config … Embedding has been disabled」。所以**没有「零外部服务 + 语义检索」的组合**，要么纯 BM25，要么加一个远程 embedding API。

### 1.5 与 agent 框架的集成面（能不能接 CLI agent，还是只接自家生态）

**能接通用 CLI agent，而且覆盖得相当全** —— 这是本项目相对同类产品的最大优势。

`MemoryProxy/src/supported-agents.ts:38-48` 权威清单（**7 类客户端**，各自的协议 / URL 前缀 / 凭据传递方式都不同）：

| 客户端 | 协议 | URL 前缀 | 凭据传递 |
|---|---|---|---|
| Claude Code | Anthropic Messages | `/claude-code/<spaceId>` | env `ANTHROPIC_AUTH_TOKEN` |
| CodeBuddy | OpenAI Chat | `/codebuddy/<spaceId>` | `~/.codebuddy/models.json` |
| Codex | OpenAI Responses | `/codex/<spaceId>` | `~/.codex/config.toml` |
| WorkBuddy | OpenAI Responses | `/workbuddy/<spaceId>` | TOML |
| **DeepSeek Harness (dsh)** | OpenAI Chat / Anthropic Messages | `/dsh/<spaceId>` | `~/.dsh/profiles/web/cordis.patch.yml` + `.credentials.yaml` |
| OpenCode | OpenAI Chat | `/opencode/<spaceId>` | — |
| Hermes / OpenClaw | Anthropic Messages | header-only | — |

**接入方式：零代码，只改 base URL**（`README_CN.md`「所有 Agent 共享同一个 Memory Server」）：

```bash
# Claude Code
export ANTHROPIC_BASE_URL=http://127.0.0.1:8096/claude-code/default
export ANTHROPIC_AUTH_TOKEN="<sk-mem-...>"
```

**但对 Stratix 而言这条路的代价被放大了**：
- Codex **没有环境变量入口**，必须改 `~/.codex/config.toml`；dsh 必须改 `~/.dsh/profiles/web/cordis.patch.yml`（**全局用户配置**）；
- 每次新会话要**弹表单选 team→agent→task**（`agents/claude-code/README.md:63-67`，用 Claude Code 原生 `AskUserQuestion` 工具）；
- Codex 首次必须**手动切 Plan 模式**，否则 session-init 永远完不成（`agents/codex/README.md:38`）；
- **协议耦合极深**：`agents/dsh/README.md` §0.2 用表格列出 dsh v0.2 换协议后踩的 **5 个坑**（表单解不出 / 循环弹表单 / 答复读不到 / mem 不生效 / `STREAM_CLOSED`），且修法要在 proxy 侧改 5 个文件。这是**上游 CLI 一升级就要跟着改**的维护债。

**SDK 直连路径**（`sdk/memory-core/typescript/AGENT_GUIDE.typescript.zh-CN.md`）与 CLI 无关，任何能发 HTTP 的 agent 都能用，官方把接入拆成四步：

```
用户输入 → ① 召回（注入 prompt） → LLM → ② 捕获（写 L0）
                             ↑
                 ③ 工具：让 LLM 自己再查
                             ↑
                 ④ 错误降级：失败不挂主流程
```

**没有「MCP / SDK / 插件」三选一的强制绑定** —— 这是它比多数「记忆插件」类项目高明的地方：它把「记忆」做成了**一个可插拔的 HTTP 后端**，而不是绑死在某个 agent 框架的插件 API 上。

---

## 2. 安装体量

### 2.1 clone 体量（实测）

```
git clone --depth 50 https://github.com/TencentCloud/TencentDB-Agent-Memory.git /tmp/tdb-agent-memory
→ 85 MB（含 32 MB assets/ 图片资源）
```

分目录（`du -sh`）：

| 目录 | 体积 | 性质 |
|---|---|---|
| `assets/` | **32 MB** | 文档配图 / logo（README 图片）—— **纯文档用** |
| `MemoryCore/` | 5.7 MB | 记忆引擎源码 |
| `MemoryProxy/` | 3.6 MB | 代理源码 |
| `MemoryPanel/` | 3.4 MB | 面板（前后端） |
| `MemoryKnowledge/` | 1.3 MB | 知识服务源码 |
| `agents/` + `sdk/` + `adapters/` + `deploy/` | 1.2 MB | 适配文档 / SDK / 部署脚本 |
| 代码文件总数 | 932 个（.py/.ts/.go/.js） | |

> **推断依据（代码量）**：`find` 统计 932 个源码文件。按 TS 项目均行数估，核心逻辑量级约 **5–8 万行 TS**（含测试）。其中测试与文档占比可观（每个组件都有 `__tests__/` 与 `vitest.config.ts`）。

### 2.2 三个 Docker 镜像（实测）

Docker Desktop VM 磁盘已满（60 GB 配额已用尽，`docker pull` 报 `no space left on device`），故改用 **registry API 流式实测**：拉取 arm64 manifest → 逐层 blob 流式解压统计字节数。

| 镜像 | 压缩下载量 | **解压后磁盘占用（实测）** | 层数 |
|---|---|---|---|
| `agentmemory/memory-core:latest` | 246.4 MB | **995 MB** | 10 |
| `agentmemory/memory-hub:latest` | 438.1 MB | **1,486 MB** | 21 |
| `agentmemory/memory-proxy:latest` | 182.7 MB | **727 MB** | 10 |
| **三件套合计** | **867 MB** | **≈ 3,208 MB（3.2 GB）** | 41 |

（amd64 压缩量：248.3 / 448.6 / 185.7 MB，合计 882.6 MB。最新 tag = `1.0.3`，镜像 last_updated 2026-10-26。）

**关键读数**：
- **Panel 独占 1.5 GB，是三件套里最重的** —— 而它的功能（建 team/agent/task）**完全可以被 SDK 的 `MetadataClient` 替代**。裁掉它 = 省 46% 磁盘。
- 两个 Dockerfile 的运行时都设了 `NODE_OPTIONS="--max-old-space-size=1536"`（`MemoryCore/Dockerfile`、`MemoryProxy/Dockerfile`），即**每个 Node 容器理论上可吃到 1.5 GB 堆**。
- `MemoryProxy` 镜像保留了 devDependencies（`tsx` 运行期需要），所以 727 MB 里含 typescript / vite / rollup。

### 2.3 源码安装（实测）

| 组件 | 命令 | 结果 |
|---|---|---|
| **MemoryProxy** | `npm ci`（有 `package-lock.json`，确定性安装） | **added 297 packages in 2m** / node_modules **263 MB** / 耗时 **1 分 34 秒** |
| **MemoryCore** | `npm install --omit=dev --omit=optional --ignore-scripts --legacy-peer-deps` | **added 155 packages in 12m** / node_modules **450 MB** / 耗时 **11 分 33 秒** |

> 注：MemoryCore 仓库只提供 `pnpm-lock.yaml`，`npm install` 需重新解析依赖树（无 lockfile ⇒ 11 分半；`mongodb` / `@opentelemetry` / `ai` 三大件都在拉）。**MemoryCore 的安装体量是 MemoryProxy 的 1.7 倍，时间是 7.6 倍** —— 这本身就与「消费级电脑随手装」的预期不符。

**MemoryProxy 的 263 MB 里，最大三块是「其实用不上」的**（实测 `du`）：

```
104 MB  @opentelemetry     ← 四路可观测（opentik/langfuse/clickhouse/otlp），默认全关
 62 MB  node-pty           ← 交互式终端，proxy 用不到
 23 MB  typescript        ← devDep，镜像里也要（tsx 运行期）
 12 MB  better-sqlite3    ← optionalDep，storage backend 用
 11 MB  @esbuild          ← tsx 的平台二进制
```

即：**去掉可观测与 node-pty 后，实际业务依赖不到 100 MB**。

### 2.4 MemoryCore 依赖树拆解（实测 `du`，450 MB / 122 个包）

| 包 | 体积 | 必需性 |
|---|---|---|
| **`@tencentdb-agent-memory/tcvdb-text`** | **285 MB** | **硬依赖（`dependencies`），但体量 100% 是数据文件** —— 见下方拆解 |
| `@opentelemetry/*` | 65 MB | 可选（四路可观测，默认全关） |
| `js-tiktoken` | 21 MB | 必需（token 计数） |
| `@node-rs/jieba` | 11 MB | **必需**（中文分词，原生插件） |
| `ai` + `@ai-sdk/openai` | 20 MB | 必需（LLM 调用） |
| `zod` | 8.1 MB | 必需 |
| `mongodb` + `bson` | 7.7 MB | 运行期可选（实验特性，默认关），但在 `dependencies` 里 |
| `sqlite-vec` | <1 MB | **必需**（原生插件） |

**`tcvdb-text` 的 285 MB 是什么（实测 `ls -la`）**：

```
bm25_en_default.json   200,624,809 B  (191 MiB)
bm25_zh_default.json    85,394,973 B  ( 81 MiB)
stopwords.txt                    1,151 B
```

即 **两个 BM25 预训练参数语料（英 + 中），占了 MemoryCore 安装体的 63%**。这个包名叫「tcvdb」（腾讯云向量库），而默认后端是 SQLite、腾讯云向量库是可选的 —— **但它被挂在 `dependencies` 而不是 `optionalDependencies` 上，装机必下**。

而且它**不是死数据**：`MemoryCore/src/core/store/bm25-local.ts:12-13` 引入它的 `BM25Encoder` 做**本地 BM25 稀疏向量编码**，`BM25Encoder.default("zh")`（`dist/encoder/bm25.js:29-42`）**同步 `readFileSync` + `JSON.parse`** 加载这 81 MiB 语料。**这份语料会被读进内存两次**（见 §4.2）。

### 2.5 数据体积（推断，依据：schema 与上限常量）

- **L0/L1**：SQLite `vectors.db`，每条 L1 记录含 content + 13 个索引列 + 一条 768 维向量（≈ 3 KB/条 float32）。按每会话 20 条 L1 上限，单个用户规模在 **几十 MB 量级**。
- **L2**：Markdown 文件 `scene_blocks/*.md`，最多 15 个场景。
- **L3**：`persona.md`，单文件。
- **Skill**：`SKILL.md` 正文入 FTS5，**单条 FTS content 上限 4000 字符**（`src/core/skill/skill-store-ddl.ts:104`），单资源文件上限 5 MB（`skill-config.ts:265-266`）。
- **结论（推断）**：单个重度用户全量数据 **< 100 MB**；真正的体积风险不在数据，在镜像与 node_modules。

### 2.6 小结

| 维度 | 三件套（Docker） | 只跑 MemoryCore（源码 standalone） |
|---|---|---|
| 磁盘 | **3.2 GB** | **450 MB**（node_modules，含 285 MB 不可省的 `tcvdb-text`）+ 数据 < 100 MB |
| 依赖管理 | 3 个镜像 tag | 1 次 npm install（**无 lockfile**，实测 11 分 33 秒） |
| 原生编译 | 镜像内已编译 | **需要本机编译 `sqlite-vec` / `@node-rs/jieba`**（要 python3/make/g++） |

---

## 3. 部署成本

### 3.1 官方推荐路径：三件套（`deploy/global-images/start-all.sh`）

实测脚本流程（`deploy/global-images/start-all.sh:1-70`、`README.md:1-120`）：

```
1. cp .env.example .env           # 填两组 LLM：memory 组 + proxy 组（各自 base_url/api_key/model）
2. ./start-all.sh                 # 交互式：填 LLM → 立即探测通路（GET {base}/models，不烧 token）
                                 #   → 端口预检 → 依次起 3 个容器，每个等 healthy
3. 打开 http://localhost:8125      # Panel，用 admin user_key 登录（打印在 .admin-key 文件）
4. admin 建 Team（顶栏 TeamSwitcher → +新建团队）
5. Team 成员管理 → 「新建用户并加入团队」→ 复制一次性展示的 sk-mem-... user_key
6. 建 Agent（要填 description + system prompt）；可选建 Task
7. 把 agent 的 API base 指向 proxy（env 或改配置文件）
8. 每次新会话弹表单选 Team → Agent → Task
```

**成本要点**：
- **4 个容器、4 个端口**（8420 / 8125 / 8424 / 8096），3 个容器是必需，MongoDB 仅在开实验特性时第 4 个；
- **2 组 LLM 凭据**（memory 组用于抽取/embed，proxy 组用于转发上游）；
- **至少 2 步 Web UI 操作 + 2 个一次性密钥的复制粘贴**（admin key + 业务 user_key，后者**面板只显示一次**）；
- **每次新会话都要交互选一次 team/agent/task** —— 对「后台跑的大管家」是致命的交互税。

### 3.2 官方备选路径：MemoryCore Standalone（本次评估认为这条才是 Stratix 的形态）

`MemoryCore/README_CN.md:60-80`：

```bash
cd MemoryCore
npm install
npm run build
export TDAI_GATEWAY_CONFIG="$PWD/tdai-gateway.standalone.yaml"
export TDAI_LLM_API_KEY=... TDAI_LLM_BASE_URL=... TDAI_LLM_MODEL=...
node --import tsx src/gateway/server.ts        # 默认 127.0.0.1:8420
```

配置注释直说（`tdai-gateway.standalone.yaml:1-8`）：

> `deployMode: standalone` / `stateBackend: "local"` —— **零外部依赖（不需要 Redis/Shark），进程内状态管理**

**冷启动步骤数：3 步**（npm install → 配 3 个环境变量 → 起 node），**无 Docker、无表单、无密钥复制**。数据落 `~/.memory-tencentdb/memory-tdai`（`tdai-gateway.standalone.yaml:16`）。

### 3.3 外部依赖清单（逐项判定）

| 依赖 | Standalone 必需？ | 三件套必需？ | 证据 |
|---|---|---|---|
| **Node ≥ 22.16** | ✅ 必需 | ✅ | `MemoryCore/package.json` `engines.node`；`MemoryProxy/src/index.ts:3-10` 硬门禁（不匹配直接 `process.exit(1)`） |
| **OpenAI 兼容 LLM API** | ✅ 必需（抽取/归纳） | ✅ 必需（2 组） | `MemoryCore/README_CN.md`：「除 LLM API 外没有必需的外部服务」 |
| **SQLite FTS5** | ⚠️ **隐性必需** | ⚠️ 同 | 官方警告：Node 官方二进制不保证含 FTS5，缺失则关键词检索**静默返回空** |
| Redis | ❌ 可选 | ❌ 可选（默认 `enabled: false`，`deploy/global-images/start-proxy.sh:148`） | `MemoryProxy/src/config.ts:80-89`；`src/db/redis-client.ts:52-80` `lazyConnect` + 失败不阻塞启动；仓库降级到 SQLite/fs/memory |
| MongoDB | ❌ 可选（实验特性，默认关） | ❌ 同 | `deploy/global-images/README.md`「试验特性，默认关闭」 |
| 腾讯云 VectorDB (tcvdb) | ❌ 可选 | ❌ 同 | `src/core/store/factory.ts:58-98` |
| 远程 Embedding API | ❌ 可选（**默认关**） | ❌ 同 | `tdai-gateway.standalone.yaml:128` `provider: "none"` |
| 腾讯云 COS | ❌ 可选 | ❌ 同 | optionalDep |
| ClickHouse / Opik / Langfuse | ❌ 可选 | ❌ 同 | 四路可观测，挂了只 warn |
| **Redis（COS 多节点场景）** | — | 必配（`config.example.yaml:128`「多实例部署必须开启」） | 单实例可选 |
| **Panel Web UI** | ❌ 可用 API 替代 | ✅ 官方路径必用 | `MetadataClient` 覆盖 team/agent/task/user CRUD |

**结论：Standalone 模式下，除 LLM API 外没有任何必需的外部服务。** 这是一个非常重要的正面结论。

### 3.4 降级矩阵（记忆挂了会怎样）

| 故障 | 后果 | 证据 |
|---|---|---|
| LLM API 挂 | 记忆抽取失败（L1 记 0 条），但**只读召回照常** | `MemoryCore/README_CN.md`：「只读查询可以不触发 LLM」 |
| FTS5 缺失 | 关键词检索**静默返回空**，召回降级为仅 embedding（若也没配 embedding = 召回全空） | `README_CN.md` FTS5 段 |
| 无 embedding | 自动降级为 keyword（`auto-recall.ts:480-485`） | — |
| Redis 挂（proxy） | 限流 fail-open 放行；注入降级到 SQLite/fs；**不阻塞启动** | `MemoryProxy/src/rate-limit/guard.ts:40-51` |
| Core 挂（proxy, auth 关） | 注入块为空，请求照常转发 | `MemoryProxy/src/injection/pipeline.ts:229-250` |
| Core 挂（proxy, auth 开） | **全部 401**（唯一硬失败路径） | `MemoryProxy/src/auth.ts:110-116` |
| sqlite-vec 加载失败 | store 整体降级为 no-op（所有向量操作失效） | `memory-store.ts:380-385` |

**降级哲学与 Stratix 高度一致**。SDK 指南 §4 写得很明确：

> 记忆服务挂了**不能挂主对话**。① 召回用 `Promise.allSettled`；② 捕获包 try/catch，失败只记日志；③ 工具返回错误信息字符串而不是抛异常。

这与 Stratix `src/app/services/project-context.ts` 文件头的口径（「上下文是增强，不是依赖，坏了不能绑架任务回路」）**是同一条纪律**。

---

## 4. 运行开销

### 4.1 MemoryProxy —— 本次实测（本机跑源码，配置：注入关 / auth 关 / storage=memory）

| 指标 | 实测值 | 测法 |
|---|---|---|
| **冷启动（进程 exec → `/health` 返回 200）** | **0.43 秒**（T0=…082.967 → T1=…083.395） | 每轮 3 次，稳定 |
| **常驻 RSS（启动后 30s 空闲）** | **100,544 KB ≈ 98.2 MB** | `ps -o rss` |
| **空闲 CPU** | **0.0 %** | `ps -o %cpu` |
| **每请求代理开销（稳态）** | **≈ 5 ms**（首请求 84 ms，含 JIT/冷路径） | 见下方对照 |
| **代理自身计时** | `totalMs` 4–7 ms，`forwardMs` 1–2 ms | proxy 自己的 `pipeline.request.complete` 日志 |

**延迟对照实测**（本地 mock 上游，同一份请求体）：

```
直连 mock 上游：  1.1 / 0.85 / 0.95 / 0.78 / 0.60 ms
经 proxy 转发：  84.0 / 8.5 / 5.4 / 5.5 / 5.1 ms   ← 稳态 +5 ms
```

**权威超时预算**（`MemoryProxy/config.example.yaml`）：

| 项 | 值 |
|---|---|
| 上游转发 | 3,600,000 ms（1 小时，部署脚本实际写 600,000 ms） |
| 鉴权（→Core） | 5,000 ms |
| Core skill / knowledge 调用 | 1,500 ms |
| tdai memory 调用 | 5,000 ms |
| prewarm 总预算 | 20,000 ms（注释说明从 8s 放宽，因「imported agent 存在或 COS 慢时 8s 常常 timeout 导致整个 `<tdai_profile_memory>` 段落丢失」） |

> **注意**：鉴权是**每请求一次 HTTP 往返到 Core，且无缓存**（`MemoryProxy/src/auth.ts:79` 注释：「Every call goes directly to the auth service (no caching)」）。本地 loopback 下这是亚毫秒级，但**多机部署就是每请求 +1 RTT**。

### 4.2 MemoryCore Standalone —— **实测**（本机跑源码，SQLite 后端，embedding 关闭）

> 本次评估**实际把 MemoryCore standalone 跑起来了**（`TDAI_GATEWAY_CONFIG=… node --import tsx src/gateway/server.ts`），下面是真实数字，不是推断。

| 指标 | 默认配置 | 关闭本地 BM25 稀疏编码 | 备注 |
|---|---|---|---|
| **冷启动（exec → `/health` 200）** | **2.47 s**（另一次 3.02 s） | **1.09 s** | 差的 ~1.5 s 全在解析 BM25 语料 |
| **稳态 RSS（启动 40 s 后）** | **753 MB**（772,560 KB） | **227 MB**（232,528 KB） | **差 526 MB** |
| **启动峰值 RSS** | **1.15 – 1.19 GB**（1,209,504 / 1,243,072 KB） | 未单独测 | V8 GC 前 |
| **RSS 30 s 漂移** | 771,712 → 772,480 KB（**稳定，不涨**） | — | 无泄漏迹象 |
| **空闲 CPU** | **0.0 %**（`top` 采样）；进程生命周期累计 CPU 3.63 s / 43 s（≈8%，含启动） | 0.2 % | 定时器扫描是低频非忙轮询 |
| **子进程数** | **0** | 0 | 纯单进程 |
| **数据目录（全新）** | **916 KB** | 同 | `vectors.db` + `vectors.db-shm` + `.metadata/` + 4 个空目录（`conversations/` `records/` `scene_blocks/` `.backup/`） |
| **`/health`** | `status: ok`，`ftsAvailable: true`，`embeddingService: false`，`vectorStore: true` | 同 | FTS5 在官方 Node v22.22.2 上**可用** |

#### 526 MB 差额的归因（实测定位到具体代码）

**根因：本地 BM25 稀疏编码器被实例化了两次，各自独立 `JSON.parse` 一份 81.4 MiB 的中文 BM25 语料。**

两个创建点：

| # | 位置 | 产物 |
|---|---|---|
| 1 | `MemoryCore/src/core/store/factory.ts:55` — `const bm25Encoder = createBM25Encoder(config.bm25, logger)` | encoder #1 |
| 2 | `MemoryCore/src/core/store/store-pool.ts:133` — `this.sharedBm25Encoder = createBM25Encoder(this.memoryCfg.bm25, …)` | encoder #2 |

两者都走 `bm25-local.ts:90` → `BM25Encoder.default("zh")` → `dist/encoder/bm25.js:29-42` → `setParamsSync(path)` → `readFileSync` + `JSON.parse`（`:200-201`）。

**启动日志实测**（两次 init，同一 language=zh）：

```
[memory-tdai][bm25-local] Initialized BM25 local encoder (language=zh)   ← 22:30:07.974
[memory-tdai][factory] Store created: backend=sqlite, ..., bm25=enabled
[memory-tdai][bm25-local] Initialized BM25 local encoder (language=zh)   ← 22:30:08.804
[store-pool] Initialized: mode=sqlite, ..., bm25=shared
```

**单份语料的独立成本（隔离实测）**：

```
读 81.4 MiB 文件：  69 ms
JSON.parse：        916 ms
解析后 RSS：        663.6 MB
解析后 heapUsed：   306.3 MB
```

→ 一份 ≈ 664 MB / ~1 s，两份 ≈ **1.3 GB / ~2 s**，与实测的「关掉后省 526 MB 省 1.4 s」量级吻合（GC 后两份共享部分 V8 堆结构，故稳态差 526 MB 而非 1.3 GB）。

#### 关键结论：关掉它，检索能力不打折

```
memory:
  bm25: { enabled: false }
```

关掉后 `/health` 仍报 `ftsAvailable: true`，因为**默认召回走的是 SQLite FTS5 的 `bm25(l1_fts)`**（`memory-store.ts:995-1005`），与本地稀疏向量编码器是**两套独立实现**。本地 BM25 稀疏编码器只在腾讯云 VectorDB / MongoDB 这类需要稀疏向量上报的后端才真正需要（`bm25-local.ts:1-9` 的文件头说明它是为替换「Python sidecar BM25 客户端」而生）。

> ⚠️ **配置位置有坑**：gateway 读的是 **`memory:` 子段**（`src/gateway/config.ts:664` — `const memoryRaw = obj(fileConfig, "memory")`），不是顶层。把 `bm25:` 写在 yaml 顶层会被**静默忽略**（实测：顶层写 `bm25.enabled: false` → 日志仍打 `bm25=enabled`）。

#### 每次 LLM 抽取的 token 开销（源码实测依据，未实跑真实流量）

| 动作 | LLM 调用次数 | 形态 |
|---|---|---|
| L1 抽取（场景切分 + 原子记忆） | **1 次** | 单次 JSON 结构化输出（`l1-extractor.ts:478`） |
| L1 去重 | **1 次** | 批量判定全部新记忆（`l1-dedup.ts:133-134`） |
| L2 场景抽取 | **agent + 工具循环** | 超时 **300,000 ms**（`scene-extractor.ts:143`） |
| L3 persona 归纳 | agent + 工具 | `persona-generator.ts:80-140` |
| Skill 抽取 | **最多 16 轮迭代** | `skill-config.ts:240` |

→ **记忆的「运行开销」大头不在 CPU/内存，在 LLM token 与后台延迟**。对消费级电脑这不是「机器扛不扛得住」的问题，是**账单与响应延迟**的问题。

### 4.3 常驻进程数（实测）

| 部署形态 | 常驻进程 | 子进程 | 说明 |
|---|---|---|---|
| **MemoryCore standalone** | **1**（实测 `pgrep` 确认） | **0** | 单 Node 进程，进程内状态 |
| 三件套 | **3**（+1 MongoDB 可选） | — | 三个 Node 容器 + tini(PID 1) |
| 裁剪路径（只 core + SDK） | **1** | **0** | —— |

**MemoryCore standalone 实测**（启动后 43 秒采样）：

| 指标 | 实测值 | 口径 |
|---|---|---|
| 空闲 CPU | **0.0 %** | `top` 采样 |
| 进程生命周期累计 CPU 时间 | **3.63 s / 43 s**（≈ 8 %） | 含启动期解析 BM25 语料 |
| 子进程数 | **0** | 单进程，无 fork |
| RSS 30 s 漂移 | 771,712 → 772,480 KB（**+768 KB，稳定不涨**） | 无内存泄漏迹象 |

### 4.4 存储增长

- **全新启动的数据目录实测：916 KB**（`~/.memory-tencentdb/memory-tdai`）：`vectors.db` + `vectors.db-shm` + `.metadata/` + 4 个空目录（`conversations/` `records/` `scene_blocks/` `.backup/`）。→ **空载占用可忽略**，存储风险全部来自后续写入。
- **L0 会无限增长**？L0 是原始对话，**官方没有 TTL / 大小上限**（`src/core/skill/conversation-add/buffer-storage.ts:117` 注释：「当前不做 TTL / 大小限制（每 agent 一份文件，量大时用户自己处理）」）。L0 由 `/v3/conversation/add` 写入后进入 L1 抽取队列，但 L0 本身留在库里。
  → **对消费级电脑是真实风险**：一个每天用几小时的 agent，半年后 L0 可能是几百 MB 的 SQLite。**裁剪路径必须自己加保留策略**（比如只留 N 天 / 只留 L1 之后删除 L0）。
- **Skill 版本保留**：默认 **TTL 关闭 + 版本数上限关闭**（`skill-config.ts:270-279`，`versionTtlDays ?? 0` → 0）→ 版本会累积。清理函数 `cleanupExpiredVersionsForSkill` 存在但**默认不启用**。
- **Vector 表重建**：embedding 的 provider/model/dims 变更会**自动 drop 并重建**向量表（`memory-store.ts:423-444`）——换 embedding 模型 = 全量重算。

### 4.5 CPU / 延迟预算的官方建议（值得抄）

SDK 指南 §6：

> **召回总预算 < 200ms**：三路并行后取最快返回的可用结果，超时的丢掉。
> prompt 注入控制大小：L1 ≤ 5 条、Scene 列表只列 path 不列内容、Persona 一份就够。

召回超时硬上限 5,000 ms（`config.ts:696`），返回结构化错误而非挂死。

---

## 5. 消费级电脑可行性判定

### 5.1 三档判定：**🟡 黄**

**判定对象**：「把 TencentDB-Agent-Memory 用作 Stratix 大管家记忆系统，跑在消费级电脑（Mac Studio 级）上」。

### 5.2 依据拆解（分形态给档）

| 形态 | 档 | 依据 |
|---|---|---|
| **A. 只跑 MemoryCore standalone + SDK 直连** | 🟢 **绿** | 1 进程 / **450 MB node_modules** / 0 外部服务（除 LLM API）/ 数据 < 100 MB / 官方明确定位「Agent sidecar」/ 冷启动 3 步 / 部署全本地 / **实测冷启动 2.47 s、稳态 RSS 753 MB（关本地 BM25 后 227 MB）** |
| **B. 三件套全套（core + hub + proxy）** | 🔴 **红** | **3.2 GB 磁盘** / 4 容器 4 端口 / 2 组 LLM key / 每会话弹表单 / Panel 独占 1.5 GB 且功能可被 SDK 替代 / 无 MCP / 协议层随各 CLI 升级而碎 |
| **C. 整体作为「大管家记忆系统」接入** | 🟡 **黄** | B 太重所以不能整套上；A 够轻但**记忆引擎是 beta + 有原生 ABI 摩擦 + 与 Stratix 进程模型不是同一套**（见 §6） |

**为什么不是绿**（三个独立的红/黄信号）：
1. **成熟度**：核心包版本 `1.0.2-beta.1`、SDK `1.0.1-beta.1`；仓库 tag 到 `v2.0.3`，但组件版本号仍在 beta；**888 个 open issue**；CHANGELOG 显示高频破坏性变更。
2. **原生插件 ABI**：MemoryCore 依赖 `sqlite-vec`（必需，`.node` 原生插件）与 `@node-rs/jieba`（必需，原生插件）。Stratix 跑在 **Electron 40**（内置 Node 23），本仓已有 `better-sqlite3` 在 Node 版本不匹配时 `ERR_DLOPEN_FAILED` 的明确前科（CLAUDE.md 记载：「Node 22 与 Electron 不兼容，会导致 better-sqlite3 报错 ERR_DLOPEN_FAILED」）。接 `sqlite-vec` 意味着**要付 electron-rebuild 的持续维护成本**，且 SQLite 是**进程内独占**的 —— Electron 主进程与渲染进程各开一份会拿到两个独立库（SQLite 同进程多连接可以，但 native addon 在 renderer 还要单独走一套），架构上必须放主进程。
3. **FTS5 隐性依赖**：消费级电脑常用 Homebrew / 官方 Node 二进制，**不保证编译了 FTS5**；缺失时关键词召回**静默返回空**（不是报错），是「装完发现搜不到东西」型故障。

**为什么不是红**：
- MIT 协议，无授权成本；
- Standalone 模式零外部服务、除 LLM API 外无强制依赖；
- 数据 100% 本地，无外发（除 embedding API，可选且默认关）；
- 官方 SDK 已把「召回 / 捕获 / 工具 / 降级」四件事封装好，接入工作量小；
- 官方明确支持 agent sidecar 形态，且**不绑定任何 agent 框架**。

### 5.3 最接近可用的裁剪路径（🟡 → 🟢 的具体做法）

> **只取记忆引擎，不要产品外壳。**

```
保留：  MemoryCore（standalone 源码跑，1 个 Node 进程，:8420）
        + @tencentdb-agent-memory/memory-sdk-ts-v2（唯一依赖 undici）
        + MetadataClient（建 team/agent/task，替代 Panel）
砍掉：  MemoryProxy（8096）—— 与 Stratix 进程模型冲突，且是 727 MB
        MemoryPanel（8125 / 438 MB 解压）—— 1.5 GB，功能被 SDK 完全覆盖
        MemoryKnowledge（8424）—— Wiki/CodeGraph 与大管家记忆无关
        Docker 三件套 —— 换成 standalone 源码进程
        Redis / MongoDB / COS / ClickHouse / Opik / Langfuse —— 全关
        远程 embedding —— 先用纯 BM25（provider: none），必要时再开
        本地 BM25 稀疏编码器 —— memory.bm25.enabled: false（见下）
```

#### 裁剪杠杆 ①（实测，最有效）：关掉本地 BM25 稀疏编码器

```yaml
memory:
  bm25: { enabled: false }   # ⚠️ 必须放在 memory: 子段下，写在顶层会被静默忽略
```

| | 默认 | `bm25.enabled: false` | 差 |
|---|---|---|---|
| 冷启动 | 2.47 s | **1.09 s** | **−1.38 s（−56 %）** |
| 稳态 RSS | 753 MB | **227 MB** | **−526 MB（−70 %）** |
| `/health` FTS5 | `ftsAvailable: true` | `ftsAvailable: true` | **不变** |

**为什么不打折**：默认召回走 SQLite **FTS5 的 `bm25(l1_fts)`**（`memory-store.ts:995-1005`），与本地稀疏向量编码器是**两套独立实现**。本地 BM25 编码器只在腾讯云 VectorDB / MongoDB 这类需要上报稀疏向量的后端才真正需要。

**额外收益**：`@tencentdb-agent-memory/tcvdb-text` 这个 285 MB 的包虽然仍在 node_modules 里（它是硬依赖，不能不装），但**运行时不再解析**，省掉 526 MB 常驻内存 + 1.4 s 启动。

#### 裁剪杠杆 ②：把 BM25 语料从「两份」变「零份」（上游可改）

现状是 `factory.ts:55` 与 `store-pool.ts:133` **各建一个 encoder**，等于把 81.4 MiB 中文语料 `JSON.parse` 了两遍。**上游只要让 store-pool 复用 factory 的实例，稳态 RSS 大概还能再省一半**（单份解析后 663.6 MB，两份共享 V8 堆结构后实测差 526 MB）。这是本次评估里最值得给上游提的一条 PR。

#### 裁剪后的账（实测口径）

| 项 | 裁剪后 |
|---|---|
| 磁盘 | **450 MB**（node_modules，含 285 MB 不可省的 `tcvdb-text`）+ 数据 < 100 MB（空载实测 916 KB） |
| 进程 | **1**（0 子进程） |
| 端口 | 1（8420，只监听 127.0.0.1） |
| 外部服务 | 1（LLM API，Stratix 本来就要用） |
| 常驻内存 | **227 MB**（关本地 BM25 后实测稳态 RSS） |
| 冷启动 | 3 步；**实测 1.09 s** |
| 空闲 CPU | **0.0 %** |
| 交互成本 | **0**（不需要表单、不需要复制密钥） |
| 剩余风险 | beta API / 原生 ABI / FTS5（Node 二进制可能缺）/ L0 无上限 |

---

## 6. 与 Stratix 的贴合度

### 6.1 Stratix 侧的需求（先把需求说准）

「大管家」= Stratix 内置的常驻 agent，需求三条（来自 task_174 描述 + Stratix 现状）：

1. **跨任务记忆**：上一个任务里学到的偏好/规则，下一个任务还记得。
2. **跨会话记忆**：重启 Stratix 后，记忆还在（不是内存态）。
3. **项目维度**：`.stratix` 契约已有项目维度（`docs/DESIGN-project-map.md`），记忆要能按项目隔离/归属。

**Stratix 的关键现状（决定了集成方式）**：
- **内置 agent 走「拉起外部 CLI 子进程」**：`src/app/services/cli-transport/` 下有 claude / codex / dsh / kimi / openclaw / opencode / custom 七个 adapter（`src/app/services/cli-transport/adapters/`），`runtime.ts:106` 组装 spawn options 后起子进程。**Stratix 自己没有一条 LLM HTTP 出口**。
- **spawn env 有白名单注入口**：`src/app/services/cli-transport/spawn-env.ts` —— `assembleSpawnEnv()` 支持「调用方逐次显式 env」+ `STRATIX_CLI_ENV` JSON，两级都是**显式注入**，不碰全局 CLI 配置（`:74-122`）。
- **已有的上下文注入范式**：`src/app/services/project-context.ts` 渲染 `<stratix-project>` 块，`STRATIX_PROJECT_CONTEXT_MAX_CHARS = 2000` 码点上限，逐字段截断 + 注入特征过滤，**provider 抛错 ⇒ 返回 '' 且不外泄**。
- **SQLite 已落地**：`src/app/services/persistence/`（tasks 落库；missions 纯内存）。

### 6.2 模型映射表

| Stratix 概念 | TencentDB-Agent-Memory 对应 | 契合度 | 说明 |
|---|---|---|---|
| 大管家 agent | **`agentId`** | ★★★ | 一一对应；L2/L3 是 team+agent 级 profile，天然是「这个 agent 的长期画像」 |
| 用户 | **`userId`** | ★★★ | L1/L3 都按 user 收敛 |
| 项目（`.stratix`） | **`teamId`** | ★★☆ | **需人工映射**：team 是「资产归属容器」，通过 admin/SDK 建；不绑定仓库路径，多项目共享一个大管家时只能一个 project = 一个 team（否则大管家就不是大管家了） |
| 任务 / mission | **`taskId`** 或 **`sessionId`** | ★★☆ | `sessionId` 可选：传 = 按会话收敛；**不传 = 跨会话聚合**（这正是「跨任务跨会话」要的） |
| Stratix 任务台账 | `taskId` 列（L1 表 `task_id`） | ★★☆ | 可填 Stratix 的 task id |
| `<stratix-project>` 上下文块 | `<tdai_profile_memory>` / `<user-persona>` / `<relevant-memories>` | ★★★ | 形态高度相似，都是「system 端稳定块 + user 端动态块」 |
| 记忆落库 | `~/.memory-tencentdb/memory-tdai/vectors.db` | ★★☆ | 与 Stratix 现有 SQLite 并存 → **两库**，一致性要自己管 |

**结论：模型层面契合度相当高**（★★★ / ★★★ / ★★★ 三项核心都对得上），**唯一需要人工设计的是「项目 → team」的映射**。

### 6.3 集成路径 A：SDK 直连（**推荐路径**）

```
Stratix app 层（Electron 主进程）
  ├─ 进程内起 MemoryCore standalone（:8420，127.0.0.1，或外部 sidecar）
  ├─ 用 @tencentdb-agent-memory/memory-sdk-ts-v2 的 MemoryClient 构造
  │    { endpoint, apiKey, serviceId:'default', teamId:<项目>, agentId:'butler', userId:<用户>, sessionId: <可选> }
  ├─ 每轮派单前：Promise.allSettled([ searchAtomic, readCore, listScenarios ]) → 拼 prompt
  ├─ 每轮结束后：addConversation() 写 L0
  └─ 失败：try/catch 吞掉，记日志（完全对齐 project-context.ts 的既有纪律）
```

**优点**：
- **不动 CLI 全局配置**（不像 proxy 路径要改 `~/.codex/config.toml` / `~/.dsh/profiles/...`）；
- **不接管用户的 LLM 凭据与流量**（proxy 路径要把用户自己的 API key 挪到 proxy 的 upstream 配置里 —— 这对 Stratix 是不可接受的产品变更）；
- **没有每会话弹表单**；
- **不随各 CLI 的 wire 协议变化而碎**（proxy 层最大的维护债被整层绕开）；
- 官方 SDK 指南的四步（召回 / 捕获 / 工具 / 降级）几乎可以逐条映射到 Stratix 现有范式。

**缺点 / 要付的代价**：
- 需要 Stratix 自己写「派单前召回 + 派单后捕获」的接线（Stratix 已有 `project-context.ts` 的注入点，M0-06 已把项目块塞进派单 prompt —— 记忆块可以挂在同一个位置）；
- 丢掉 proxy 的 **session-init 身份绑定**（谁在说话、属于哪个 team）—— 但 Stratix 自己有身份（`userId` / `agentId` / 项目），可以**直接用 Stratix 的身份，不走表单**；
- 丢掉 proxy 的 **Skill 自动选择/路由**（`skillRuntime`），需要自己实现或先不做。

### 6.4 集成路径 B：Proxy 拦截（**不推荐**）

把拉起的 CLI 的 base URL 指向 proxy：

| CLI | 可注入性 | 备注 |
|---|---|---|
| Claude Code | ✅ `ANTHROPIC_BASE_URL` + `ANTHROPIC_AUTH_TOKEN` | Stratix 的 `spawn-env.ts` **可以逐次注入**，不污染全局配置 |
| Codex | ❌ 只能改 `~/.codex/config.toml` | 全局文件，且要 `disable_response_storage = true` 才不绕过注入 |
| dsh | ❌ 只能改 `~/.dsh/profiles/web/cordis.patch.yml` | 且 dsh v0.2 的 profile/plugin id 都换过一轮 |

**四个硬伤**：
1. **凭据搬家**：用户的 API key 必须从 CLI 挪到 proxy 的 `upstream.apiKey`（服务端托管），等于 Stratix 接管了用户的 LLM 计费路径；
2. **协议耦合**：proxy 对每个 CLI 的 wire 格式硬编码（thinking block 占位、SSE 尾换行、tool_result 载体差异…）。`agents/dsh/README.md` §0.2 记录的 5 个坑就是这份耦合的账单 —— **dsh 一升级，Stratix 的 proxy 侧就得跟着改**；
3. **交互税**：每个新会话弹表单选 team/agent/task，对后台常驻的大管家不可接受；
4. **体量**：+727 MB（proxy 镜像）+ 1.5 GB（panel）+ 代理自己的每请求 +1 RTT 鉴权（无缓存）。

### 6.5 License 与商用兼容性

| 项 | 结论 |
|---|---|
| **根 LICENSE** | **MIT**（Copyright (C) 2026 Tencent），完整 MIT 条款，允许商业使用、修改、分发、私有化。**商用无阻碍。** |
| **GitHub 识别** | `NOASSERTION` / "Other" —— 因为 MIT 条款前加了一段腾讯的定制开场白（"Tencent is pleased to support the open source community…"）。**不影响法律效力**，但部分扫描器/合规流程会把它当非标准协议，需要人工确认。 |
| **子包 license 字段** | `MemoryCore` / `MemoryKnowledge` / TS SDK 的 `package.json` 写了 `"license": "MIT"`；**`MemoryProxy` 与 `MemoryPanel` 的 `package.json` 没有 license 字段**（实测）→ 若以 npm 包形式分发会有元数据缺失的警告。**Stratix 只用 SDK（MIT，字段齐全）的话无此问题。** |
| **第三方依赖的商用风险** | 主要依赖均为宽松协议（`undici` MIT、`ai` Apache-2.0、`@ai-sdk/openai` Apache-2.0、`sqlite-vec` MIT/Apache-2.0、`@node-rs/jieba` MIT、`zod` MIT、`js-tiktoken` MIT）。**`@tencentdb-agent-memory/tcvdb-text`** 需单独确认（腾讯自有包，随仓库 MIT 分发）。**无 copyleft，无传染性。** |
| **商标** | 「TencentDB」是腾讯云产品名。OSS 仓库 MIT 授权的是**代码**，不含商标授权。自用/内部产品集成无碍；若做对外商用品牌，需回避 TencentDB 命名。 |
| **托管服务的绑定** | **无强制绑定**。Standalone + SQLite 不依赖任何腾讯云服务。`tcvdb` / `COS` / `MongoDB Atlas` 全是可选。**唯一实质绑定是「必须有一个 OpenAI 兼容 LLM 端点」** —— 而这可以是任意厂商（含本地 llama.cpp server）。 |

**结论：license 完全不是障碍。**

### 6.6 与 Stratix 架构的冲突点汇总

| 冲突 | 严重度 | 说明 |
|---|---|---|
| **进程模型**（spawn CLI vs LLM 代理） | 🔴 高 | Proxy 路径要求「客户端发 HTTP 给 LLM」；Stratix 内置 agent 是 spawn 子进程 |
| **凭据托管** | 🔴 高 | Proxy 要求把用户 API key 挪到 proxy 服务端配置 |
| **原生 addon ABI** | 🟡 中 | `sqlite-vec` / `better-sqlite3` 在 Electron 40 需 electron-rebuild；本仓已有 better-sqlite3 前科 |
| **双 SQLite** | 🟡 中 | Stratix `src/app/services/persistence/` 已有库；记忆引擎是第二个库 → 事务边界、备份、迁移要自己管 |
| **数据保留策略缺位** | 🟡 中 | L0 无 TTL/上限；Skill 版本默认不清理（`skill-config.ts:270-279`）→ 消费级电脑需自己补 |
| **注入体量上限** | 🟢 低 | Stratix 已有 `STRATIX_PROJECT_CONTEXT_MAX_CHARS = 2000` 的截断范式；记忆块可复用同一纪律（官方建议 L1 ≤ 5 条） |
| **beta API churn** | 🟡 中 | v3 数据面在 `1.0.x-beta.1`；CHANGELOG 显示破坏性变更频繁 |
| **中文优先** | 🟢 低 | jieba + `bm25_zh_default.json` 对中文场景是**优势** |

---

## 7. 结论

### 7.1 三档判定

> **🟡 黄 —— 记忆引擎本体可行（🟢），产品三件套不可行（🔴），整体黄。**

### 7.2 用不用：**👀 观望**

**一句话理由**：
> **它的记忆模型与降级纪律值得直接抄，但它的「beta + 原生 ABI + 与 Stratix 进程模型不同轴」这三项成本，在大管家记忆真正排期之前不值得先付；而等到排期时，更该做的是在 Stratix `core/` 里长出一个自己的 memory port（照抄它的 L0/L1/L2/L3 分层 + RRF(K=60) 混合检索 + 三条降级原则），而不是把一个高速迭代的 beta 外部项目接成硬依赖。**

**分解为三个具体判断**：

| 判断 | 内容 |
|---|---|
| **不引入（现在）** | 不把 `agentmemory/*` 三个镜像或 `@tencentdb-agent-memory/*` SDK 作为 Stratix 的**生产依赖**。理由：① SDK 是 beta（`1.0.1-beta.1`），仓库 888 open issue，CHANGELOG 破坏性变更频繁；② `sqlite-vec` 原生插件与 Electron 40 的 ABI 摩擦需持续维护，本仓已有 better-sqlite3 前科；③ 大管家的记忆需求尚未排期，现在接 = 提前背债。 |
| **要吸收（立刻）** | 把它的**设计**直接落进 Stratix 的设计文档：① L0 Conversation / L1 Atom / L2 Scenario / L3 Persona 四层分离；② 关键词 BM25 + 向量的 **RRF(K=60)** 融合 + 超采样 ×3；③ **稳定块进 system / 动态块进 user** 的注入分区（保住 prompt cache）；④ **召回 `Promise.allSettled` / 捕获 try-catch / 工具返字符串** 三条降级原则；⑤ **召回预算 < 200ms、L1 ≤ 5 条、场景只列 path** 的体量纪律。这些都不依赖外部项目，且与 Stratix `project-context.ts` 的既有纪律同构。 |
| **可重访（触发条件）** | 当以下任一成立时重新评估：① 大管家记忆正式排期且需要「跨会话 + 项目维度 + LLM 自动抽取」三合一；② 上游出 **1.0 稳定版**且 v3 API 冻结；③ 上游提供**稳定的嵌入式模式**（把引擎做成可 in-process 加载的库，消除 `sqlite-vec` 的 Electron ABI 问题）；④ Stratix 决定用「shell-out 到 CLI」的形态承载大管家（那样 proxy 路径反而自然）。 |

### 7.3 若不用，备选方向（不展开）

> **备选方向**：在 Stratix `core/` 里自建一个 **memory port**（纯契约、零 IO），app 层用**已有的 SQLite + FTS5** 实现一个「L1 原子记忆 + L3 画像」的**轻量子集**，只做「稳定画像块 + 按需检索」两件事，不做 LLM 自动抽取。
>
> 依据与取舍（各一两句，不展开）：
> - **为什么够用**：大管家当前最痛的是「上次说的偏好/约束这次又要重讲」，这属于**少量高频**的记忆（L3 画像 + 十几条 L1），完全不需要 L2 场景抽象与 L3 归纳 agent 那套重机器。
> - **为什么不用 SQLite FTS5 之外的东西**：Stratix 已有 SQLite 落地路径，FTS5 方案零新增依赖；向量检索推迟到确有需要时（中文短文本 BM25 召回质量已可用）。
> - **什么时候必须上外置引擎**：当记忆条目跨到**千级**且需要语义（而非关键词）召回，或需要**自动从对话里抽事实**时，再评估 TencentDB-Agent-Memory 的 MemoryCore（此时它正好是最小可用的那部分）。
> - **一条纪律**：自建 port 的接口按 Stratix 既有范式设计为「纯数据进 / 纯数据出 + 吞错降级」，**与具体实现解耦** —— 这样未来无论换成 TencentDB、mem0、Zep 还是自研，core 契约不动。

---

## 附录 A · 实测原始数据

### A.1 环境

```
darwin 25.3.0 (macOS) / Node v22.22.2 / npm 10.x
Docker CLI 24.0.5，Docker Desktop VM 磁盘 60 GB 已满（pull 报 no space left on device）
代理：https_proxy=http://127.0.0.1:7890
```

### A.2 镜像体积（registry API 流式实测，arm64）

```
memory-core  UNCOMPRESSED: 995 MB   （压缩下载 246.4 MB / 10 层）
memory-hub   UNCOMPRESSED: 1486 MB  （压缩下载 438.1 MB / 21 层）
memory-proxy UNCOMPRESSED: 727 MB   （压缩下载 182.7 MB / 10 层）
合计         解压 ≈ 3208 MB / 压缩下载 ≈ 867 MB
```

测法：`registry-1.docker.io` 取 arm64 manifest → 对每层 blob `curl | gzip -dc | wc -c` 累加（流式，无落盘）。

### A.3 源码安装

```
MemoryProxy: npm ci → added 297 packages in 2m（1 分 34 秒）
             node_modules 263 MB / 192 个顶层目录
             最大项：@opentelemetry 104 MB、node-pty 62 MB、typescript 23 MB、better-sqlite3 12 MB、@esbuild 11 MB

MemoryCore:  npm install --omit=dev --omit=optional --ignore-scripts --legacy-peer-deps
             → added 155 packages in 12m（11 分 33 秒）
             node_modules 450 MB / 122 个 package.json / 95 个顶层目录
             最大项（du 实测）：
               @tencentdb-agent-memory/tcvdb-text  285 MB  ← BM25 语料（硬依赖，不可省）
               @opentelemetry/*                     65 MB
               js-tiktoken                           21 MB
               @node-rs/jieba                        11 MB
               ai + @ai-sdk/*                        20 MB
               zod                                  8.1 MB
               mongodb + bson                      7.7 MB
               sqlite-vec                           <1 MB
```

`@tencentdb-agent-memory/tcvdb-text` 包内文件（npm registry 文件清单实测）：

```
dist/encoder/bm25_en_default.json   200,624,809 B (191.3 MiB)
dist/encoder/bm25_zh_default.json    85,394,973 B (81.4 MiB)
dist/encoder/stopwords.txt                1,151 B
```

### A.4 MemoryProxy 运行实测

```
配置：server{127.0.0.1:18096} / upstream{mock} / auth=off / sessionInit=off / injection=off
      redis=off / storage={enabled:true, backend:memory}

冷启动  T0=1793888082.967714  →  T1=1793888083.395713   = 0.428 s（exec → /health 200）
RSS      PID 1570  RSS 100544 KB = 98.2 MB（启动后 30 s 空闲）
CPU      0.0 %（空闲 30 s）
子进程   0
健康检查  {"status":"ok","version":"0.2.0","storage":{"requested":"memory","effective":"memory","degraded":false}}
日志      server.starting → server.listening（间隔 3 ms）

延迟对照（mock 上游，同请求体，5 次）
  直连 mock： 1.1 / 0.85 / 0.95 / 0.78 / 0.60 ms
  经 proxy： 84.0 / 8.5 / 5.4 / 5.5 / 5.1 ms
  proxy 自报：totalMs 4–7、forwardMs 1–2
```

### A.5 MemoryCore 运行实测

```
启动方式：TDAI_GATEWAY_CONFIG=<yaml> node --import tsx src/gateway/server.ts
后端：sqlite（默认）/ embedding 关闭 / 数据目录 ~/.memory-tencentdb/memory-tdai

── 形态 1：默认配置（本地 BM25 稀疏编码器开启）────────────────
冷启动        2.47 s（另一次 3.02 s）        exec → /health 200
稳态 RSS      772,560 KB = 753 MB           启动 40 s 后
启动峰值 RSS  1,209,504 / 1,243,072 KB ≈ 1.15–1.19 GB
RSS 漂移      771,712 → 772,480 KB / 30 s   稳定不涨
空闲 CPU      0.0 %；生命周期累计 CPU 3.63 s / 43 s
子进程        0
数据目录      916 KB（全新）
/health       status:ok, vectorStore:true, embeddingService:false, ftsAvailable:true

── 形态 2：memory.bm25.enabled: false ─────────────────────────
冷启动        1.09 s                       （省 1.38 s）
稳态 RSS      232,528 KB = 227 MB          （省 526 MB）
/health       ftsAvailable:true            ← 关键词召回能力不变

── BM25 语料单份成本（隔离实测）─────────────────────────────
读 81.4 MiB 文件      69 ms
JSON.parse            916 ms
解析后 RSS            663.6 MB
解析后 heapUsed       306.3 MB

── 启动日志（同一进程内两次 init）─────────────────────────────
[bm25-local] Initialized BM25 local encoder (language=zh)   22:30:07.974
[factory] Store created: backend=sqlite, ..., bm25=enabled
[bm25-local] Initialized BM25 local encoder (language=zh)   22:30:08.804
[store-pool] Initialized: mode=sqlite, ..., bm25=shared
```

### A.6 未实测项（明确标注）

| 项 | 状态 | 原因 |
|---|---|---|
| 三件套端到端冷启动耗时 | 未实测 | Docker VM 磁盘满（`no space left on device`），无法 pull；镜像体积已用 registry API 流式实测替代（见 A.2） |
| L0→L1→L2→L3 的实际抽取延迟与 token 消耗 | 未实测 | 需真实 LLM API key + 真实对话流量，超出纯调研范围；抽取调用次数与超时上限已从源码给到（见 §4.2 末表） |
| 真实 embedding 下的召回延迟 / 召回质量 | 未实测 | 本地 embedding 在当前版本被配置禁用（`src/config.ts:517-524`），远程 embedding 需云端 key |

---

## 附录 B · 关键代码位置索引

（路径相对 `/tmp/tdb-agent-memory`，commit `2002196`）

| 主题 | 位置 |
|---|---|
| 记忆分层 | `MemoryCore/src/core/{conversation,record,scene,persona}/` |
| L1 表结构 / 向量表 / FTS5 表 | `MemoryCore/src/core/store/sqlite/memory-store.ts:483-504 / 541-547 / 945-983` |
| RRF 融合（K=60） | `MemoryCore/src/core/tools/l1-candidate-recall.ts:20,154-173`；`src/core/hooks/auto-recall.ts:746,752-780` |
| jieba 分词 | `MemoryCore/src/core/store/tokenize.ts:73-99,145-150` |
| 抽取触发（warm-up / idle / flush） | `MemoryCore/src/utils/pipeline-manager.ts:42-51,53-64,362-386,491` |
| 本地 embedding 被禁用 | `MemoryCore/src/config.ts:517-524` |
| **本地 BM25 编码器创建点 #1** | `MemoryCore/src/core/store/factory.ts:55` — `createBM25Encoder(config.bm25, logger)` |
| **本地 BM25 编码器创建点 #2（重复实例化）** | `MemoryCore/src/core/store/store-pool.ts:133` — `this.sharedBm25Encoder = createBM25Encoder(…)` |
| 本地 BM25 编码器实现（读文件 + JSON.parse） | `MemoryCore/src/core/store/bm25-local.ts:85-90`；`dist/encoder/bm25.js:29-42,200-201` |
| gateway 读的是 `memory:` 子段（顶层 bm25 会被忽略） | `MemoryCore/src/gateway/config.ts:664-670` — `obj(fileConfig, "memory")` |
| FTS5 BM25 召回（与本地稀疏编码器独立） | `MemoryCore/src/core/store/sqlite/memory-store.ts:995-1005` — `bm25(l1_fts)` |
| `/health` 暴露的组件状态 | `MemoryCore/src/gateway/server.ts:1535-1556` |
| 默认后端 sqlite | `MemoryCore/src/core/store/factory.ts:57-167`；`src/config.ts:582-586` |
| FTS5 缺失的官方警告 | `MemoryCore/README_CN.md`（环境要求段） |
| skill 检索只有 BM25 | `MemoryCore/src/core/skill/skill-store.ts:532-549` |
| skill 版本保留默认关闭 | `MemoryCore/src/core/skill/skill-config.ts:270-279` |
| L0 无 TTL/上限 | `MemoryCore/src/core/skill/conversation-add/buffer-storage.ts:117` |
| Proxy 支持的客户端清单 | `MemoryProxy/src/supported-agents.ts:38-48` |
| Proxy 硬编码 v22 | `MemoryProxy/src/index.ts:3-10` |
| Redis 可选 + 降级 | `MemoryProxy/src/config.ts:80-89`；`src/db/redis-client.ts:20,52-80`；`src/injection/index.ts:196-235` |
| 注入块清单 | `MemoryProxy/src/injection/injectors/{skill-injector,skill-tools-injector,knowledge-tools-injector,tdai-tools-injector,tdai-profile-memory-injector}.ts` |
| 无 MCP（只有 Bash+curl） | `MemoryProxy/src/injection/injectors/skill-tools-injector.ts:3-9`；`src/memory/memory-bridge.ts:46-53` |
| 鉴权每请求一次 Core、无缓存 | `MemoryProxy/src/auth.ts:79` |
| 核心挂 → 全部 401 | `MemoryProxy/src/auth.ts:110-116` |
| 注入失败不致命 | `MemoryProxy/src/injection/pipeline.ts:229-250` |
| dsh v0.2 的 5 个协议坑 | `agents/dsh/README.md` §0.2 |
| dsh 接入配置 | `agents/dsh/README.md` §1.1–1.4 |
| TS SDK v3 用法（sessionId 可选） | `sdk/memory-core/typescript/README_CN.md` |
| Agent 接入四步 + 降级三原则 | `sdk/memory-core/typescript/AGENT_GUIDE.typescript.zh-CN.md` §1–§6 |
| 部署脚本（三件套） | `deploy/global-images/start-all.sh`、`start-proxy.sh:80-160`、`README.md` |
| Standalone 配置 | `MemoryCore/tdai-gateway.standalone.yaml` |
| v3 API 目录 | `MemoryCore/v3-api-memorycore-doc.md:83-101` |

### B.1 Stratix 侧相关位置

| 主题 | 位置 |
|---|---|
| CLI 进程拉起（内置 agent 的实际形态） | `src/app/services/cli-transport/runtime.ts:106`、`node-process.ts:66-71` |
| spawn env 白名单注入口（可注入 base URL） | `src/app/services/cli-transport/spawn-env.ts:48,74-122` |
| 已有的上下文注入范式（截断 / 吞错降级） | `src/app/services/project-context.ts`（文件头「为什么这块必须带数据边界」「体积预算与截断策略」） |
| 项目维度契约 | `docs/DESIGN-project-map.md` §3.3.3、`docs/DESIGN-workspace.md` §8 |
| 现有 SQLite 落地 | `src/app/services/persistence/` |
