# DESIGN-workspace —— Workspace / `.stratix` 目录契约与项目发现（设计 A）

> 状态：**草案，待冻结**（设计冻结需用户过目；本任务只交文档，不含实现）
> 任务：task_159。依赖：task_157（`docs/research/dsh-architecture.md`）、task_158（`docs/research/dsh-integration-map.md`）
> dsh 参照版本：只读仓库 `/Users/kingj/code/deepseek-harness`，**HEAD `fcc0ad4621`**（`@deepseek-ai/dsh-root@0.2.2-rc.1`）。开工前置已执行 `git pull`，结果「已经是最新的」，HEAD 与 task_158 报告所注 HEAD **完全一致**（task_157 报告所注 HEAD 为更早的 `ce7073d5`，两者差异面见本文 §3.0）
> 原则出处：`docs/SERVICE-SPLIT-PLAN.md` 七铁律（尤其铁律 1：WorldState 真相源在 Stratix core）；`docs/DSH-INTEGRATION-PLAN.md`（已冻结的三桥总纲）；`docs/PERFORMANCE_GUIDELINES.md`
> 本任务**未修改任何 `src/` 代码**（纯设计文档）

---

## 0. 决策摘要（TL;DR）

**一句话**：把「项目 = 文件夹」从一句愿景变成一份**可被 dsh 生态读懂的目录契约**——`.stratix/` 是项目的**契约面**（随文件夹走、可入 git），项目运行态仍留全局库但**按项目维度分区**，两者用**单向 reconcile** 相连。

十二条关键决策：

| # | 决策 | 依据 |
|---|---|---|
| D1 | **`.stratix/` 是项目契约面，不是 dsh 的部署面**：它只声明「这个项目是什么、有什么角色、要什么配置、怎么接 dsh」，不含凭据、不含运行中状态 | 集成报告 §4.6 要点：「不要把 `.stratix` 映射到 profile/bundle——profile 是 `$DSH_HOME` 下的**部署**概念，不是项目概念」 |
| D2 | **两层身份**：逻辑 **project**（`.stratix/project.json` 的 `id`，随 git 传播）＋ 物理 **instance**（一个具体目录，注册表里一条稳定记录）。主仓与 worktree = **同一 project、不同 instance** | 集成报告 §4.4（dsh 的 Workspace 同时有稳定 id 与规范路径，唯一性按路径判等） |
| D3 | **契约层 vs 运行层单向 reconcile**：契约（`roster/`、`config/`）是**期望状态**，运行层（DB 行）是**物化结果**，reconcile **只从契约到运行层**，永不反向 | 借 dsh「patch 整段替换 config、不做深合并」的语义（`packages/bundle/base/cordis.patch.yml:6-8`） |
| D4 | **运行态留在单一全局 SQLite**，但每行带项目维度；不改成「一个项目一个库」 | 铁律 1 + 现状单库 + `docs/PERFORMANCE_GUIDELINES.md`（索引优于 N 库） |
| D5 | **格式版本用单调整数**，学 dsh 的 session format：方向性读规则、相邻链无缺口、`ignorable` 标记覆盖词汇增长 | `docs/session-format-status.md` + `.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md` |
| D6 | **`.stratix/skills/` 经 dsh 的 `customSkillDirs` 挂载**，不复制进 `.dsh/skills`（复制即写用户项目目录） | `packages/skill/skill-filesystem/src/index.ts:58` |
| D7 | **不写用户项目目录**的对等原则：dsh 不写 `.stratix/`，Stratix 也不写 `.dsh/` | 集成报告 §4.6：「dsh 不留项目级配置/状态」 |
| D8 | **发现 = marker walk-up**（`.stratix` > `.git` > 回落 cwd），照 dsh `findProjectRoot` 的形状，但 marker 语义换成 Stratix 的 | `packages/context/agent-instructions/src/files.ts:232-246` |
| D9 | **不做全盘扫描**：扫描根是「显式配置的根 + 最近使用 + 当前 cwd」三条有限来源 | `docs/PERFORMANCE_GUIDELINES.md` 性能预算制 |
| D10 | **`.stratix` 目录内的配置分层是「顶层键整段替换、最近者胜」**，与 dsh patch 层叠同构 | 集成报告 §2.2 的四层 patch 顺序（bundle → profile → home → `--patch`） |
| **D11** | **一个 Stratix 进程同时只激活一个项目实例**；多项目**并存**发生在注册表层，切换项目 = 换活跃实例（重载世界态），而不是让 world store 多开 | `src/core/store.ts:311` 的 `worldStore` 是**进程级单例**、`src/core/runtime.ts:803` 的 `coreRuntime` 同理、`src/core/bus.ts:32` 的总线同理——三者都**无项目维度**；改造成多实例 = 改 core 契约（撞铁律 1/2/3） |
| **D12** | **`cwd = 项目根` 的接入点已存在但无人使用**：`SpawnOptions.cwd?`（`src/app/services/cli-transport/transport.ts:85`）已定义并已透传到进程工厂（`:120`），但全仓**没有任何调用方赋值** → CLI 子进程当前继承宿主进程 cwd | `src/app/services/cli-transport/transport.ts:85`、`:120`；`adapters/dsh.ts` 的 `prepare` 只合并 env、不碰 cwd |

**明确不做的**（详见 §5）：不做 IDE、不做包管理器/插件市场、不做云同步、不做全盘索引、不把 `.stratix` 变成 dsh profile、**不在本任务实现任何代码**。

---

## 1. `.stratix` 目录契约

### 1.1 三条边界（谁写、谁读、谁不碰）

`.stratix` 的全部设计压力来自一个事实：**它同时被三方读**。

| 读者 | 读什么 | 写什么 |
|---|---|---|
| **Stratix 宿主**（app/gateway/core） | 全部 | 契约初始化、运行态物化、`state/` |
| **agent**（通过 dsh / CLI / 文件系统） | **只读**：`project.json`、`roster/`、`config/`、`skills/`、`history/` | **零**（agent 不得改契约；需要改就提 PR/派单给角色） |
| **dsh** | 通过 `--patch` 读 `.stratix/dsh/*.patch.yml`；通过 `customSkillDirs` 读 `.stratix/skills/`；通过 `cwd` 感知项目根 | **零**（对等 D7） |

> **为什么 agent 只读**：dsh 的设计哲学里，模型看到的是**注册面**（`ctx.tools`）与**按需加载的文档**（skill），不是可写的项目配置（架构报告 §5.3 的两级注入模型）。让 agent 能改 `.stratix/`，等于在项目里开第二套可写真相源，与「契约层单向 reconcile」（D3）冲突。

### 1.2 目录结构规范（示例树）

```
<project-root>/                       ← 项目根 = 含 .stratix 的目录（= dsh 的 session header.cwd）
├── .stratix/                         ← 【契约面】本设计的全部内容
│   ├── project.json                  ← 【契约】项目身份与元数据（含 formatVersion）
│   ├── .gitignore                    ← 【契约】自管理：声明哪些子目录不随 git 走
│   │
│   ├── roster/                       ← 【契约】角色定义（声明式，一角色一文件）
│   │   ├── <role-id>.json            ←   名字 / persona / 能力组合 / agent 绑定
│   │   └── _index.json               ←   角色名册索引（顺序、别名、默认角色）
│   │
│   ├── config/                       ← 【契约】项目级配置
│   │   ├── stratix.json              ←   Stratix 侧项目配置（覆盖全局默认）
│   │   └── permissions.json          ←   本项目的权限预设（对齐 dsh --permission-mode 语义）
│   │
│   ├── skills/                       ← 【契约】项目级技能（Markdown + frontmatter）
│   │   └── <skill-name>/SKILL.md     ←   照 dsh skill 形状（kebab-case 名 + YAML frontmatter）
│   │
│   ├── history/                      ← 【本地态·默认不提交】已归档任务史（append-only JSONL）
│   │   ├── missions-YYYYMM.jsonl     ←   已终结 mission 的归档摘要
│   │   └── tasks-YYYYMM.jsonl        ←   已终结角色任务的归档摘要
│   │
│   ├── dsh/                          ← 【契约】dsh 桥接件（声明式，不含凭据）
│   │   ├── profile.json              ←   接入参数（profile 名 / provider / model / patch 列表）
│   │   ├── bridge.patch.yml          │   供 `dsh --patch` 叠加的 patch（YAML，声明式）
│   │   └── README.md                 ←   人类可读说明（给不熟 dsh 的人）
│   │
│   └── state/                        ← 【本地态·绝不提交】运行期临时物
│       ├── lock                      ←   项目级独占锁（防两个实例同时写同一项目）
│       └── cache/                    ←   可重建缓存（如 discovery 结果指纹）
│
├── AGENTS.md                         ← dsh 自动加载的项目指令（dsh 约定位置，非 .stratix 独有）
├── CLAUDE.md                         ← 同上（dsh 的候选清单：AGENTS.md / CLAUDE.md）
├── .env                              ← dsh 的凭据读取位置（`<invocation cwd>/.env`），**必须 gitignore**
└── ...（项目自身源码）
```

**两类内容的分界**（`.stratix/.gitignore` 自己声明）：

```
# .stratix/.gitignore
history/          # 任务史：默认本地积累（避免 worktree 合并冲突）
state/            # 运行期临时物
```

- **契约（可提交）**：`project.json` / `roster/` / `config/` / `skills/` / `dsh/`
- **本地态（默认不提交）**：`history/` / `state/`

> **为什么 `history/` 默认不提交**：`.stratix/` 随 git 传播时，worktree 会 checkout 出**同一份** `history/*.jsonl`；两个副本各自追加 → git 对 JSONL 的合并极差。副本语义本就是「各玩各的存档」（产品愿景：项目 = 文件夹 = 游戏副本），故任务史**默认本地**；团队协作需要时用**显式开关**开启提交（见 §5.3 开放问题 Q3）。

### 1.3 各文件职责与格式

#### `project.json` —— 项目身份

```jsonc
{
  "$schema": "https://stratix.dev/schemas/project/v1.json",
  "formatVersion": 1,                       // 单调整数；见 §1.4
  "id": "spx_9f3c2a1b7d4e5f60",              // 逻辑项目 id，随契约传播（同仓库各副本相同）
  "name": "雨林哨站",
  "description": "一句话说明这个项目要做成什么",
  "createdAt": "2026-11-05T12:00:00.000Z",
  "instance": {                             // 本副本的物理身份（写入时按实际目录生成）
    "path": ".",                            // 恒为 "."：项目根 = 含 .stratix 的目录
    "vcs": { "kind": "git", "branch": "demo/v3.3", "commonDirFingerprint": "sha256:3b7a…" }
  },
  "agents": {
    "defaultRoleId": "scout",               // 默认派单角色
    "defaultProfile": "stratix-default"     // dsh 侧 profile 名（部署面，见 §3.2）
  },
  "engines": { "stratix": ">=3.3.0" },       // 版本兼容声明（借 dsh 的 engines.dsh）
  "links": { "dsh": "dsh/profile.json" }
}
```

- `id` 用**本地生成的稳定 id**（`spx_` + 22 位 base62），**不用目录路径派生**——路径会变，id 不该变（对齐 dsh：Workspace 有稳定 id + 规范路径两件事）。
- `vcs.commonDirFingerprint` = `git rev-parse --git-common-dir` 路径的哈希 → 用来识别「这些副本来自同一个仓库」（见 §2.5）。

#### `roster/<role-id>.json` —— 角色定义

**角色在契约里是「能力组合」，在运行层是「数据行」**——这是本设计最重要的一处概念归位（详见 §4.3）。

```jsonc
{
  "id": "scout",
  "name": "斥候",
  "persona": "你负责在项目里到处看，先摸清地形再动手。",
  "bindings": {
    "agentKind": "claude",                  // 绑定的本地 agent 种类（对齐 CharacterView.agentKind）
    "model": null                           // null = 用项目/全局默认
  },
  "capabilities": {                         // 能力组合（借 dsh preset 的形状）
    "tools": ["stratix_world_snapshot", "read", "edit"],   // 白名单；缺省 = 全集
    "commands": ["/status", "/map"],       // 可用斜杠命令
    "skills": ["scout-recon"],              // 引用 .stratix/skills 下的技能
    "systemPrompt": null                    // 追加 system prompt 段（覆盖而非拼接）
  },
  "state": {                                // 运行态字段的**默认值**（运行层可被覆盖）
    "level": 1, "experience": 0,
    "contextEnabled": true
  }
}
```

> **「角色 = 能力组合」的出处**：架构报告 §5.2 指出 dsh 的 preset 是「一组具名的、声明式的子 Cordis 插件行」，决定「这个 session 的工具集和 prompt」，并**被写进 session header**——理由原文是 *"a resume that restored a different composition would replay history the model can no longer act on"*。Stratix 现在的角色只是「一个名字 + 一段 prompt 串」，**换角色再 resume，同一段历史里的工具语义就变了**（架构报告 §5.2 原文指出的真实存在的洞）。本设计把角色升级为能力组合，并要求**能力组合快照进 session header**（§4.3）。

#### `config/stratix.json` —— 项目级配置

```jsonc
{
  "agent": {
    "defaultRoleId": "scout",
    "maxConcurrentWorkers": 2,              // 并发上限（性能预算，见 §5.2）
    "permissionPreset": "project-safe"      // 引用 config/permissions.json
  },
  "dsh": {
    "profile": "sdk",
    "cwdStrategy": "project-root",          // 见 §3.2
    "patches": ["dsh/bridge.patch.yml"]     // 相对 .stratix/ 解析
  },
  "history": { "retentionMonths": 6 }
}
```

**分层与合并规则**（D10）：

```
应用内置默认  <  用户级 ~/.stratix/config.json  <  项目级 .stratix/config/stratix.json  <  会话级临时覆盖
```

- **顶层键整段替换**（不做深合并）——与 dsh 的 patch 语义一致（`packages/bundle/base/cordis.patch.yml:6-8`：*"A patch replaces the targeted row's whole `config` rather than merging into it"*）。理由：深合并的隐式行为在多源叠加时最难排查；整段替换让「这一层改了什么」永远可读。
- 例外只有一个：`agent.defaultRoleId` 这类**单值标量**天然整段替换，无需特例。

#### `skills/<name>/SKILL.md` —— 项目级技能

照 dsh 的 skill 形状：目录名 kebab-case、`SKILL.md` 带 YAML frontmatter（`name` / `description`）。**两级注入**照搬 dsh：首次只注入 `name + description` 目录，模型按需取全文（架构报告 §5.3：`packages/skill/skill-filesystem/src/tool-skill/src/index.ts:36`）。

**关键：`.stratix/skills/` 不会被 dsh 自动发现**——dsh 只自动看 `<projectRoot>/.dsh/skills` 与 `<projectRoot>/.agents/skills`（`packages/skill/skill-filesystem/src/index.ts:256-257`）。所以接法是 D6：**启动 dsh 会话时把 `.stratix/skills` 作为 `customSkillDirs` 传入**（`packages/skill/skill-filesystem/src/index.ts:58`），**不复制**、**不软链**进 `.dsh/skills`。

#### `history/*.jsonl` —— 任务史（append-only）

每行一条 JSON 事件。**行格式照 dsh session event 的纪律**（架构报告 §5.1）：

```jsonc
{"v":1,"ts":1762300000000,"kind":"mission/settled","ignorable":false,"payload":{ "missionId":"…","phase":"done","title":"…" }}
```

- **append-only**，归档即冻结（不可变）。
- **未知事件类型的处置**：读方遇到不认识且**没有** `ignorable: true` 的行 ⇒ **拒绝重建**（不是静默跳过）。默认**必须**显式标注 `ignorable`——理由照 dsh：漏标 = 过度拒绝（不便），默认 ignorable = 静默残缺（**安全事故**）（`2026-08-10-session-log-version-mechanism.md` 原文：*"The default is required: forgetting the marker over-refuses a resumable session (an inconvenience), while a default of ignorable would make the same mistake silently resume a gutted one (a safety failure)."*）。
- **按月分片**：避免单文件无限增长（`missions-YYYYMM.jsonl`）。

#### `dsh/profile.json` + `dsh/bridge.patch.yml` —— dsh 桥接件

```jsonc
// .stratix/dsh/profile.json
{
  "profile": "sdk",                 // dsh 侧 profile 名（部署面，不在本文件里）
  "provider": "deepseek-official",
  "model": "deepseek-v4-flash",
  "cwdStrategy": "project-root",    // cwd = 项目根
  "patches": ["bridge.patch.yml"],  // 相对本文件目录
  "mcpServers": [                   // 供 S5 路线（MCP 反注册）用
    { "name": "stratix", "transport": "stdio", "command": "stratix-mcp-server" }
  ]
}
```

```yaml
# .stratix/dsh/bridge.patch.yml
- insert:
    - id: stratix-dsh-bridge
      name: './plugins/dsh-bridge/dist/index.js'
      config:
        url: 'ws://127.0.0.1:7797/ws/world-sync'
```

**为什么 patch 能随项目走**：dsh 的 `--patch` 相对路径**按 patch 文件所在目录锚定成绝对 file URL**（集成报告 §3.5，`anchorInsertedPluginNames` 在 `packages/boot/app-boot/src/index.ts:547`）。所以把 patch 放进 `.stratix/dsh/` 里，路径解析是自洽的，**不需要 dsh 侧任何改动**。

> **形态约束**：patch 里只能有 `{insert:[...]}` 这类**声明式**操作，**不许**写自定义 tag / groups / aliases —— 照 dsh `validateGeneratedBundle` 的准入规则（架构报告 §4.3：`packages/experimental/creation-recommendations/src/generated-bundle.ts:16-50`）。Stratix 侧应有等价的静态校验（形状受限 + 宿主裁决），这正是架构报告 Top10 第 9 条。

### 1.4 版本化与迁移策略（参考 dsh session-format-status 的版本教训）

#### 1.4.1 dsh 的教训（逐条抄）

`docs/session-format-status.md` 与 `.agents/notes/implemented/architecture/2026-08-10-session-log-version-mechanism.md` 讲了一条完整的方法论。提炼成八条：

| # | dsh 的做法 | 对 `.stratix` 的映射 |
|---|---|---|
| L1 | **一个单调整数，不分 major/minor**——「能不能自动升级」是**那一步**的属性（它的 upgrader 存不存在），不是数字形状能提前承诺的属性 | `project.json.formatVersion` 单调整数；不写 `1.0` / `2.0` |
| L2 | **只有「已有判别器无法阻止错误解读」时才 bump**——「解析成功」不等于「兼容」；**静默跳过重建所需内容 = 错读** | bump 判据写进契约文档；判别器 = 字段级类型 + 枚举校验 |
| L3 | **按方向读规则**：版本相等→正常读；比读方新→**拒绝**并说明方向（"written by a newer harness — upgrade"）并指出原始产物路径；比读方旧→在内存里跑**完整相邻链**，**源文件字节与 inode 不变** | 见 §1.4.2 的读规则表 |
| L4 | **相邻链无缺口**——链生成与模块初始化**拒绝缺一步**的链，不暴露半截历史 | `.stratix/format-catalog.json` 记录每一步迁移；缺一步即拒绝加载该文件 |
| L5 | **`ignorable` 标记覆盖词汇增长**，普通新增事件**不 bump 版本** | `history/*.jsonl` 行格式照抄（§1.3） |
| L6 | **已接受的机器记录不可变**；版本 bump 需要**自己的 header 转换**，不能复用旧转换 | 归档 JSONL 冻结；每版 `formatVersion` 有独立的 header 字段语义 |
| L7 | **writer 常量与发布记录分离**——代码常量拥有 writer 号，文档记录 `latestReleasedVersion` + `evidenceTag`；**发布前不推进发布记录**，trunk 上永不回退 | Stratix 代码里一个 `STRATIX_PROJECT_FORMAT_VERSION` 常量；本文档 §1.4.5 是发布记录 |
| L8 | **整制品迁移会打爆内存**（116 MB 会话把 16 GB Node 进程耗尽）——迁移必须**流式/分片** | `history/` 迁移**逐行流式**，禁止整文件载入（`docs/PERFORMANCE_GUIDELINES.md`「任何循环处理超过 1000 条数据的，必须使用分片/分批处理」） |

#### 1.4.2 `.stratix` 的版本面

契约面有**三种独立的版本**，不要混：

| 版本 | 载体 | 谁写 | bump 判据 |
|---|---|---|---|
| **契约格式版本** | `project.json.formatVersion` | Stratix 写 | 字段语义变化且旧读方无法安全拒绝时（判别器不足） |
| **文件内事件词汇** | `history/*.jsonl` 每行的 `kind` | 事件生产者 | **永不 bump**——靠 `ignorable` 标记 |
| **依赖声明** | `project.json.engines.stratix` | 人工 | 引入不兼容的宿主契约时 |

#### 1.4.3 读规则（方向性）

| 读到 | 动作 |
|---|---|
| `formatVersion == 当前支持版本` | 正常读 |
| `formatVersion > 当前支持版本` | **拒绝**：报「本项目由更新的 Stratix 写入，请升级」，并**指出原始文件路径**（照 dsh `SessionFormatUnsupportedError` 与 `SessionPersistenceCorruptionError` 分开：前者不是损坏） |
| `formatVersion < 当前支持版本` | 在**内存里**跑完整的相邻迁移链（`format-catalog.json` 里 vN→vN+1 的每一步），**源文件字节、路径、inode 全不变**；只有「读-改-写」场景才发布新世代（写临时文件 → fsync → rename 原子替换） |

**为什么是「内存里迁移」而不是「就地升级」**：dsh 的 L3 原文 —— *"every event-body operation first runs the complete adjacent chain in memory and leaves the source path, bytes, and inode unchanged"*。对 `.stratix` 尤其重要：**契约文件可能被 git 跟踪**，就地改写会造成工作区脏状态、与并行分支冲突。就地升级只在用户**显式执行「升级契约」动作**时发生。

#### 1.4.4 相邻迁移链

`.stratix/format-catalog.json`：

```jsonc
{
  "catalogVersion": 1,
  "current": 2,
  "steps": [
    { "from": 1, "to": 2, "id": "v1→v2:add-engine-fingerprint", "kind": "header-only" },
    { "from": 2, "to": 3, "id": "v2→v3:split-history-shards", "kind": "stream-rewrite" }
  ]
}
```

规则（照 dsh L4）：

- 链必须**首尾相接、无缺口、无重复**，且 `steps.length == current - minVersion`。
- **缺一步 ⇒ 拒绝加载**该文件（不降级、不猜测）。
- 每一步迁移**只描述相邻版本**（不写「任意 v1→v9」的大跳），与 dsh 的 `SessionFormatMigration` 同构（`2026-08-31-released-session-format-migrations.md`）。
- `kind: "stream-rewrite"` 的步骤**必须逐行流式**（L8）。

#### 1.4.5 发布记录（照 L7）

| 项 | 值 | 说明 |
|---|---|---|
| writer 常量 | `STRATIX_PROJECT_FORMAT_VERSION` | 代码里唯一手写的当前 writer 号 |
| `latestFinalizedVersion` | 1 | 已接受兼容性基线 |
| `latestReleasedVersion` | 1 | 已发布格式 |
| `evidenceTag` | 待第一个 `.stratix` 契约格式随版本发布时填写 | 对应 dsh 的 `dsh-v0.2.0-rc.2` 角色 |

> **本文档本身即「发布记录」的双语等价物**。dsh 的教训之一是「发布记录与 writer 常量分离，发布前不推进记录，trunk 上永不回退」——本设计在实现时必须照做。

### 1.5 原子写与并发

- **原子写**：所有 `.stratix` 写入走「写临时文件 → fsync → `rename` 原子替换」，禁止原地 truncate（Windows 与崩溃场景下会留半截文件）。
- **项目级独占锁**：`.stratix/state/lock` 记录当前持有者（pid + instanceId + 时间戳）。**两个实例指向同一 project 时**（例如主仓与 worktree 共享契约）运行层写入必须串行——实现上是「按 projectId 加进程内互斥 + 跨进程文件锁」。
- **锁不是契约**：锁文件在 `state/`（不提交），且**启动时若发现陈旧锁（pid 已不存在）自动清理**。

---

## 2. 项目发现与注册

### 2.1 扫描根（workspace roots）

**核心约束：不扫全盘。** 性能预算（`docs/PERFORMANCE_GUIDELINES.md`「性能预算制」）决定了发现只能来自**有限的、可枚举的**来源。

三类根，优先级从高到低：

| 类 | 来源 | 数量上限 | 扫描深度 | 说明 |
|---|---|---|---|---|
| **R1 显式根** | 用户在设置里配置的目录（`~/.stratix/config.json` 的 `workspaceRoots`） | ≤ 20 个 | ≤ 2 层（根 + 直接子目录） | 用户说「扫这里」的地方 |
| **R2 最近使用** | 已注册实例的目录（注册表里 `lastOpenedAt` 排序） | ≤ 50 | 0（直接查 `.stratix`） | 只查已知路径，不遍历 |
| **R3 当前工作目录** | 进程 cwd / 用户在 UI 里打开的路径 | 1 | 向上 walk-up（≤ 32 层） | 「我现在在这儿」 |

**明确不做**：递归遍历 `~/`、mdfind / spotlight 全盘索引、跟随符号链接进系统目录。

**排除区**（扫描时跳过）：`node_modules/`、`.git/`、`$DSH_HOME`、`~/.stratix/`、系统目录（`/System`、`/usr`、`/private/var`）、隐藏目录（除显式指定的）。

**扫描预算**：单根 ≤ 500 个目录项、≤ 50 ms；单次全量刷新 ≤ 200 ms；并发根数 ≤ 2（对齐 `docs/PERFORMANCE_GUIDELINES.md`「禁止并行启动多个 CPU 密集型任务」的克制精神）。

### 2.2 发现算法（marker walk-up）

照 dsh 的 `findProjectRoot` 形状（`packages/context/agent-instructions/src/files.ts:232-246`；skill 侧同形实现 `packages/skill/skill-filesystem/src/index.ts:959-968`），但**换 marker 语义**：

```
findProjectRoot(startDir):
  current = realpath(startDir)
  loop:
    if exists(current/".stratix")        → 返回 current        （强 marker：它就是项目身份）
    if exists(current/".git")             → 返回 current + 标记 "needs-init"   （准项目：仓库但未初始化）
    parent = dirname(current)
    if parent == current                 → 返回 startDir + 标记 "needs-init"    （回落：dsh 同款，findProjectRoot 找不到 marker 时返回 cwd 本身而非报错）
    current = parent
```

三点差异与理由：

1. **dsh 的 marker 只有 `.git`**（`packages/context/agent-instructions/src/config.ts:11`：`DEFAULT_PROJECT_ROOT_MARKERS = ['.git']`）。Stratix 加 `.stratix` 作为**最高优先级 marker**，因为它是项目身份本身；`.git` 降为次选。
2. **`.git` 是文件还是目录都算命中**——与 dsh 一致（dsh 只判断 `pathExists`，`packages/skill/skill-filesystem/src/index.ts:962`）。这直接决定了 worktree 的行为（§2.5）。
3. **找不到 marker 时回落 cwd 而不是报错**——照 dsh 原文（`files.ts:246`：*"or `cwd` when no marker exists"*）。发现阶段**永不失败**，只标记「未初始化」，引导交给 UI。

**嵌套项目**：若 `a/` 内有 `.stratix`，`a/b/` 内也有 `.stratix`，则 `a/b` 是**独立项目**（就近原则，walk-up 先命中 `a/b`）。二者互不继承（`.stratix` **不做**目录级联继承——除非显式声明，见 §5.3 Q5）。

### 2.3 `.stratix` 缺失项目的引导流程

发现命中 `.git` 或回落 cwd 时，实例状态 = `needs-init`。引导分四步，**每步可中止且不留半成品**：

| 步 | 动作 | 失败处置 |
|---|---|---|
| 1. **预检** | 目录存在且是目录？可写？是否已在注册表？在排除区里？已有其它项目？ | 不可写 → 拒绝并给出原因；已在注册表 → 直接切到该实例（幂等） |
| 2. **git 决策** | 是 git 仓库？要不要 `git init`？ | 用户可跳过（非 git 项目合法） |
| 3. **写最小契约** | 只写 `project.json` + `.gitignore`（**不写** roster/history/state） | 原子写；失败则清理已写文件，不留半个 `.stratix` |
| 4. **注册** | 在注册表加一条 instance 记录（稳定 id + 规范化路径 + projectId） | 写 `.stratix/state/` 内的 pending 记录，重启后可续 |

**关键设计**：

- **引导是显式动作**，发现阶段只**标记**不写盘（与 dsh 的「workspace 无静态配置文件，靠运行时 API 创建」同构：`packages/workspace/workspace/src/spec.ts` 描述的持久化在 `$DSH_HOME/storages`）。
- **引导最小化**：只写两个文件。角色、配置、任务史一律**不预生成**——避免「空壳项目」污染契约。
- **不静默 git init**：非 git 目录也允许成为项目（产品愿景里「项目 = 文件夹」，git 是可选的）。

### 2.4 多 workspace 并存

**注册表位置**：用户数据目录（Electron `userData`）下的 `workspaces.json`——**不在 `.stratix/` 里**（注册表是**用户面**，项目契约是**项目面**；这与 dsh「配置与状态全在 `$DSH_HOME`」的分层一致）。

```jsonc
{
  "version": 1,
  "instances": [
    {
      "instanceId": "wsp_7a2c…",          // 稳定 id，路径移动后不变
      "projectId": "spx_9f3c…",          // 逻辑项目 id（= .stratix/project.json.id）
      "path": "/Users/kingj/code/Stratix-demo",
      "title": "Stratix 主线",
      "order": 0,
      "lastOpenedAt": 1762300000000,
      "pinned": true,
      "archived": false
    }
  ]
}
```

**规则**（逐条对照 dsh 的 workspace 注册表，集成报告 §4.4）：

| 规则 | dsh 做法 | Stratix 做法 |
|---|---|---|
| **唯一性判据** | 规范路径字符串相等（`packages/workspace/workspace/src/index.ts:503-513`：`resolveByPath` / `createCanonical`） | **完全相同**：路径经 `fs.realpath` 规范化后比较 |
| **路径规范化** | 创建时经 `fs.realpath`（`:224-243`） | 同 |
| **稳定 id + 规范路径** | Workspace 类型在 `:115`，同时有 id 与 path | 同（`instanceId` + `path`） |
| **顺序 / 置顶 / 归档** | `insertBefore`（`:321`）/ `pinSession`（`:455`）/ `archiveSession`（`:365`） | 同构 |
| **会话归属校验** | 会话的 `header.cwd` 规范化后必须等于 `Workspace.path`，否则 `cannot attach session …`（`packages/workspace/workspace/src/entity.ts:110-141`） | 会话的 `projectId` + 实例路径 realpath 必须匹配，否则拒绝挂载 |
| **目录不存在时** | — | 实例标记 `missing`，不自动删；给用户「路径已移动」的修复入口（realpath 失败的常见场景是**目录被移动/重命名**） |

**多项目并存的能力来源**：dsh 的 workspace 注册表是**多根管理器**（集成报告 §4.4 原文），Stratix 直接对齐这个形状——**不加**「标签 / 收藏夹 / 嵌套组」等额外维度（留给 §5.3 开放问题）。

### 2.5 主仓 vs worktree：是不是同一个项目？

**这是本设计里最需要用户拍板的一处**（§5.3 Q2），先给事实再给方案。

#### 事实（可查证）

| 事实 | 出处 |
|---|---|
| git worktree 目录里的 `.git` 是**文件**不是目录，内容为 `gitdir: <主仓>/.git/worktrees/<name>` | 实测本仓：`/Users/kingj/code/Stratix-demo/.git` 是 62 字节文件，内容 `gitdir: /Users/kingj/code/Stratix/.git/worktrees/Stratix-demo` |
| `git rev-parse --git-common-dir` → **主仓** `.git`；`--git-dir` → **worktree 私有** gitdir；`--show-toplevel` → **本 worktree 根** | 实测本仓：分别为 `/Users/kingj/code/Stratix/.git`、`…/.git/worktrees/Stratix-demo`、`/Users/kingj/code/Stratix-demo` |
| dsh 的 `findProjectRoot` 只判断 `.git` **是否存在**，不区分文件/目录 | `packages/skill/skill-filesystem/src/index.ts:962`（`pathExists(join(current, '.git'))`） |
| dsh 的 worktree 服务把检出目录放在 `<repoRoot>/.agents/worktrees/<branch>`，并 `ctx.workingDirectory.set` 到那里 | 集成报告 §4.5（`packages/experimental/worktree/src/index.ts:187-198`） |
| **`cd` 不改变会话的 workspace 归属**；会话归属按 `header.cwd` 判定 | 集成报告 §7 陷阱 #22（`packages/workspace/workspace/src/entity.ts:110-141`） |

#### 推论

- **dsh 的行为**：每个 worktree 都是**独立的 cwd**，即独立的「项目根」；`cd` 进 worktree 后，会话**仍留在**原 workspace 清单里。dsh **没有**「主仓与 worktree 是同一项目」这个概念——它只有「目录」。
- **Stratix 的机会**：我们有 `.stratix/project.json` 这份**可入 git 的契约**，于是可以比 dsh 多表达一件事：**血缘**。

#### 方案（建议采纳，待用户冻结）

> **主仓与 worktree = 同一 project（血缘相同）、不同 instance（物理不同）。**

| 维度 | 归属 | 理由 |
|---|---|---|
| **契约**（`project.json` / `roster/` / `config/` / `skills/` / `dsh/`） | **project 级**（随 git 传播，各副本内容相同） | 契约是「这个项目是什么」，副本之间应当一致；入 git 后天然一致 |
| **任务史**（`history/`） | **instance 级**（各副本独立积累，默认不提交） | 副本 = 独立存档；避免 JSONL 合并冲突（§1.2） |
| **运行态**（mission / task / session / character 运行态行） | **instance 级** | 运行态是物理的：agent 的 cwd、文件改动都在这个目录里；副本隔离是产品愿景 |
| **projectId** | 随契约传播 → 同仓库各副本**相同** | 靠 `vcs.commonDirFingerprint` 识别同源 |
| **instanceId** | 注册表分配 → 各副本**不同** | 物理身份，路径移动后不变（§2.4） |

**为什么不默认「共享同一个 `.stratix`」**：因为 `.stratix/` 若在仓库内，worktree checkout **必然**带出一份副本——想共享也做不到，除非用软链或 external path，而 dsh 的 worktree 服务明确写死了检出目录布局、Stratix 无从插手。**与其假装共享，不如把「契约共享 + 运行隔离」显式建模。**

**怎么发现「这两个 instance 是同源的」**：读 `project.json.instance.vcs.commonDirFingerprint`；一致 ⇒ 标记为「同源副本」，UI 上可提供「查看兄弟副本」。**不自动合并**，不自动同步（同步是 §5 非目标）。

---

## 3. 与 dsh 的对齐

### 3.0 前置：两份调研报告的 HEAD 差异核对（任务补充要求）

| 报告 | 所注 dsh HEAD | 与本次开工 HEAD（`fcc0ad4621`）的关系 |
|---|---|---|
| task_158《dsh 集成面测绘》 | `fcc0ad4621` | **完全一致** ⇒ 本文引用的 §4/§5 结论**无需复核差异** |
| task_157《插件架构深读》 | `ce7073d5`（更早） | 有漂移。`git diff --stat ce7073d5 fcc0ad4621` 显示 `packages/core/tool-executor-ptc`、`packages/extensions/tool-cordis`、`packages/extensions/cordis-client-runner`、`packages/sdk/server` 等均有改动；**但本文引用的 task_157 结论**（effect 化注册、seam 三件套、skill 两级注入、preset 写进 session header、session 事件流与 `SESSION_FORMAT_VERSION`）**均不落在改动面上**，可安全沿用 |

**dsh 的 Cordis 版本口径差异**（集成报告 §0.2 已澄清，本文照抄不混淆）：`vendor/README.md` 记的是**上游 cordis 版本** `4.0.0-rc.11`；`vendor/cordis/package.json` 的 `version` 字段是 **dsh 对这坨代码的发布版本号** `4.1.0`。读源码行为看前者，写依赖钉位看后者。

### 3.1 语义映射表（`.stratix` 元素 → dsh 概念）

| `.stratix` 元素 | dsh 对应物 | 依据（调研出处） | 判断 |
|---|---|---|---|
| 项目根（含 `.stratix/` 的目录） | `SessionHeader.cwd`（**不可变**绝对路径） | 集成报告 §4.1；`packages/core/session/src/types.ts:106` | ✅ **直接对齐**。Stratix 的项目根 = dsh session 的 `header.cwd` |
| 项目身份 + 实例注册 | `ctx.workspaceRegistry`（稳定 id + 规范路径的多根管理器） | 集成报告 §4.4；`packages/workspace/workspace/src/index.ts:195`、`:224-243`、`:503-513` | ✅ **直接对齐**（唯一性按 realpath 判等） |
| agent 当前落脚点 | `ctx.workingDirectory`（**可变**、per-session） | 集成报告 §4.3；`packages/session/working-directory/src/index.ts:57` | ✅ **直接对齐**：「项目身份 vs 落脚点」的**双目录模型**正是我们想要的 |
| 沙箱/权限边界 | `ctx.sandboxPolicy.workspaceRoot` **锚定不可变的 `header.cwd`** | 集成报告 §4.1 关键不变量；`packages/sandbox/sandbox-policy/src/index.ts:201` | ✅ **直接对齐**：「项目文件夹 = 沙箱根」，且**cd 不改边界** |
| `.stratix/skills/` | dsh skill provider 的 `customSkillDirs` | `packages/skill/skill-filesystem/src/index.ts:58` | ✅ **新增映射**（D6）：走自定义根，**不复制**进 `.dsh/skills` |
| 角色定义（能力组合） | `ctx.agentPresets`（声明式能力组合，**写进 session header**） | 架构报告 §5.2 | ✅ **直接对齐**（含「resume 必须是同一 composition」的纪律） |
| 任务史（append-only JSONL） | `ctx.sessions` 的 append-only `SessionEvent` 日志 + 投影 | 架构报告 §5.1 | ⚠️ **借形状，不借真相源**（铁律 1：WorldState 真相源在 Stratix core） |
| 契约格式版本 / 迁移 | `SESSION_FORMAT_VERSION` + 相邻迁移链 + `ignorable` 标记 | `docs/session-format-status.md`；架构报告 §5.1 | ✅ **直接对齐**（§1.4） |
| `.stratix/dsh/bridge.patch.yml` | `--patch` 覆盖层（相对路径按 patch 文件目录锚定） | 集成报告 §3.5；`packages/boot/app-boot/src/index.ts:547` | ✅ **直接对齐**（放项目里即可随项目走） |
| 项目根 `AGENTS.md` / `CLAUDE.md` | dsh 自动加载的项目指令 | `packages/context/agent-instructions/src/config.ts:12` | ✅ **直接对齐**（放在项目根，不放 `.stratix/`） |
| **`.stratix/` 目录本身** | **无对应物** | 集成报告 §4.6：「dsh **没有**项目级元数据目录约定」 | ⚠️ **Stratix 私有契约**：dsh 侧**不写**它（D7） |
| `.stratix/dsh/profile.json` 里的 `profile` | `profile`（`$DSH_HOME/profiles/<name>/`） | 集成报告 §2.2 | ❌ **不映射**（见 §3.2） |
| 角色 / 任务定义 | `bundle`（npm 包 + `cordis.patch.yml`） | 集成报告 §2.2 | ❌ **不映射**（见 §3.2） |

### 3.2 profile / bundle / working-directory 三者的映射裁决

集成报告 §4.6 的要点原文：**「`.stratix/` 与 dsh 的 `cordis.patch.yml` 是正交的——前者是项目契约（给 agent 读），后者是部署配置（给 harness 读）。不要把 `.stratix` 映射到 profile/bundle：profile 是 `$DSH_HOME` 下的**部署**概念，不是项目概念。」**

据此逐条裁决：

| dsh 概念 | 本质 | Stratix 对应 | 裁决 |
|---|---|---|---|
| **profile**（`$DSH_HOME/profiles/<name>/`：有序 bundle 列表 + 自己的 `cordis.patch.yml` + `node_modules` + `compatibility.json`） | **部署**：这台机器上这个 harness 装了什么 | `.stratix/dsh/profile.json` 里只有一个**引用名**（`"profile": "sdk"`），**内容不在项目里** | **引用，不镜像**。项目只声明「用哪个 profile 名」，profile 本体归 dsh 部署面 |
| **bundle**（npm 包，`dsh.bundle.patch` 声明） | **分发单位**：把配置行 + 代码打包分发给第三方 | 项目**不需要**成为 bundle。项目要装的东西走 dsh 已有的 `--patch` 快捷方式（集成报告 §3.5「不发布 npm 的两条捷径」） | **不映射**。若某项目真要分发一个 dsh 插件，那是**另一件事**（dsh 生态分发，见集成报告 C10 / S5） |
| **patch**（`--patch` 覆盖层；**整段替换 config，不合并**；相对路径按 patch 文件目录锚定） | **叠加层** | `.stratix/dsh/bridge.patch.yml` 就是**项目自带的 patch 文件** | ✅ **直接映射**——这是唯一真正对上的 dsh 配置概念 |
| **working-directory**（`ctx.workingDirectory`，per-session 可变；cd 不改沙箱边界、不移动会话日志） | **落脚点** | Stratix 的 agent 会话落脚点；**项目身份仍由项目根决定** | ✅ **直接映射**（语义照抄：cd 只追加事件，不改项目归属） |
| **cwd / header.cwd**（不可变） | **项目身份** | `.stratix` 所在目录 | ✅ **直接映射** |

**结论一句话**：`.stratix` ↔ **project**（项目契约）；dsh profile/bundle ↔ **deployment**（部署分发）。两者**正交**，桥接点只有一个——`.stratix/dsh/*.patch.yml`。

### 3.3 桥接件的三条硬约束

1. **不携带凭据**。dsh 的凭据读取顺序是「启动环境 → `<invocation cwd>/.env` → `$DSH_HOME/.env`」（`packages/bundle/headless/README.md:56`）。因此：
   - 凭据放**项目根 `.env`**（因为 cwd = 项目根），**必须 gitignore**；
   - `.stratix/` 内**一律不出现** token / api key / cookie；
   - `.stratix/dsh/profile.json` 只能写**环境变量名**，不写值。
2. **不写用户项目目录**。Stratix 若要把 `.stratix/skills` 交给 dsh，走 `customSkillDirs` 参数（§1.3），**不复制、不软链**到 `.dsh/skills`。
3. **形状受限 + 宿主裁决**。`.stratix/dsh/*.patch.yml` 只允许声明式 `{insert:[...]}`；加载前做静态准入校验（照架构报告 §4.3 的 `validateGeneratedBundle` 形状规则）。**坏 patch → 拒绝加载并报具体原因**，不静默跳过。

### 3.4 派活文案的坑（必须写进契约）

集成报告 §6.3 记录了一条会直接打到我们身上的坑：dsh SDK 高层 `run()` 的线缆入口是 `session/query`，它**自带斜杠命令路由**——`/compact` / `/permission <preset>` / `/plan` / `/goal [...]` 四类命中后**不回落到普通 prompt**（集成报告 §7 #25、#26）。

**契约含义**：`.stratix/config/stratix.json` 应有一个显式开关 `agent.dispatchPromptChannel: "session/query" | "session/prompt"`（默认 `session/query`，但**派活文案以 `/` 开头时自动改走 `session/prompt`**），避免角色 prompt 误触发 dsh 命令。这一条应当写进 `.stratix/dsh/README.md`。

### 3.5 「cwd = 项目根」的落地点（现成的接入点）

「agent 进入项目获得干净上下文当手脚」在 dsh 侧的实现就是 **cwd = 项目根**（集成报告 §4.2 路径 A/B/C/D 与 §4.6 的 S6「**直接用**」）。Stratix 侧的落地点**已经存在**：

```
SpawnOptions.cwd?          src/app/services/cli-transport/transport.ts:85   // 「工作目录。」
ProcessFactory options.cwd  src/app/services/cli-transport/transport.ts:120
runtime.ts:78               把 cwd: effective.cwd 传给进程工厂
node-process.ts:30,:70     工厂级 cwd，缺省继承当前进程
```

- `adapters/dsh.ts` 的 `prepare`（`:202`）**只合并 env，不碰 cwd**——dsh adapter 不需要改。
- **但全仓没有任何调用方给 `SpawnOptions.cwd` 赋值**：`task-service.ts:1027`、`:1138`、`chat-service.ts:578` 都只传 `sessionId` / `timeoutMs`。⇒ **当前所有 CLI 子进程都继承宿主进程 cwd**。

⇒ **契约含义**：`.stratix` 的「项目根」必须**经 `SpawnOptions.cwd` 落到每一次 agent 派发**上。这条同时覆盖全部 adapter——内建 kind 有 6 个（`claude-code` / `codex` / `opencode` / `kimi` / `openclaw` / `dsh`，`src/core/types.ts:611-618`）外加 `custom:` 前缀的自定义适配器，登记表是 `src/app/services/cli-transport/adapters/index.ts:40` 的 `CLI_ADAPTER_FACTORIES`——**一处改动，全适配器受益**，这是「项目 = 文件夹」最经济的一次兑现。

> 对 dsh 还有一条额外收益：dsh headless **没有 `--cwd`**（集成报告 §4.2 路径 D：工作目录 = 调用进程的 cwd），所以 `SpawnOptions.cwd` 是 headless 路线指定项目目录的**唯一**办法（集成报告 §7 #6）。

---

## 4. 与 Stratix 既有概念的归位（characters / missions / tasks / sessions）

### 4.1 现状（已核实）

| 概念 | 类型定义 | 是否有项目维度 | 落库 |
|---|---|---|---|
| 角色 | `CharacterView`（`src/core/types.ts:832`）、`AgentProfile`（`:806`） | ❌ **无** | `characters` 表（`src/app/services/persistence/game-save-dao.ts:26`） |
| 战场任务 | `MissionView`（`src/core/types.ts:315`）、`MissionPhase`（`:281`） | ❌ **无**（纯内存状态机） | **不落库**（`missions` 纯内存） |
| 角色任务 | `CharacterTask`（`src/core/types.ts:461`） | ❌ **无** | `character_tasks` 表（`src/app/services/persistence/task-record-dao.ts:63`） |
| 会话 | `SessionRecord`（`src/core/types.ts:1060`）、`SessionKind`（`:1040`） | ❌ **无** | `sessions` 表（`src/app/services/persistence/session-dao.ts:37`）+ `session_events` 表（`session-event-dao.ts:34`） |
| 世界态 | `WorldState`（`src/core/types.ts:1109`，含 `tasks` `:1145` / `sessions` `:1162`） | ❌ **无** | 纯内存（core store） |

> 全文件对 `workspace` / `scope` / `root` **零命中**；`project` 仅 1 处命中且是 `unit-projection.ts` 文件名里的 "pro**ject**ion"，并非项目概念。**`.stratix` 概念在本仓库尚不存在**（仓库根无 `.stratix/` 目录，`src/` 全目录 `workspace` 零命中）——本设计是**从零新增**，不是改已有物。

**存储现状**：**一个全局 SQLite**，位于 Electron `userData/data/`（`src/electron/main.ts:166-177` → `dataStoreService.initialize(dataDir)` → `src/stratix-data-store/StratixDataStore.ts:37-41` → `src/stratix-database/StratixDatabase.ts:103-108`，文件名 `stratix.db` + `.sqlite` 后缀 ⇒ 实际文件 `stratix.db.sqlite`；非 Electron 路径下默认 `stratix-data/stratix.db.sqlite`，相对进程 cwd）。表：`characters` / `unit_positions` / `character_tasks` / `sessions` / `session_events` / `pipelines` / `custom_agents` / `character_chat_messages` / `agent_health_events` / `exp_events` —— **全部平铺在同一库里，无项目维度**。

> ⚠️ **驱动不是 better-sqlite3**：生产驱动是 **sql.js（WASM）** 适配器（`src/stratix-database/sqlite-adapter.ts:1-18`，better-sqlite3 兼容 API）。含义有二：① 库在 service 进程内**整体驻留内存**，「大库分片」的收益有限、内存压力上升；② **存储独占铁律**（`docs/SERVICE-SPLIT-PLAN.md:101`：SQLite 只由 service 进程打开写）意味着**契约 reconcile 的写入必须走 service 进程**，不能由 Electron 侧直接落盘。

### 4.1.1 进程级单例——本设计最大的现实约束

三处**进程级单例**，且**都没有项目维度**：

| 单例 | 位置 | 持有 |
|---|---|---|
| `worldStore` | `src/core/store.ts:311`（`export const worldStore = createStore()`；工厂在 `:219`） | 全部 WorldState：units / missions / characters / tasks / sessions **在同一个 store 里** |
| `coreRuntime` | `src/core/runtime.ts:803`（`export const coreRuntime = createCoreRuntime()`） | 全部 manager 的装配（`CoreRuntimeOptions` 在 `:107-168`，**无 project/workspace 参数**） |
| 总线 emitter | `src/core/bus.ts:32`（三条固定通道 `command` / `world` / `state`；`resetBus()` 在 `:54`） | 全局事件 |

**推论（直接决定 D11）**：

- 「一个进程同时跑多个项目、各自一份世界态」需要把 `worldStore` / `coreRuntime` 改成**多实例**（按 instance 分片的 store + 按 instance 装配的 runtime），这是**改 core 契约**——撞铁律 1（真相唯一，`docs/SERVICE-SPLIT-PLAN.md:96`）、铁律 2（裁决在 core，`:97`）、铁律 3（总线铁律，`:98`）。
- 而「一个进程只激活一个项目、切换项目 = 换活跃实例」**不需要改 core 契约**：活跃实例是**装配期参数**（类似现在的 `CoreRuntimeOptions` 注入），切换 = 重新装配 + 重连（对照铁律 1 的 Electron 侧语义：「重连 = 全量 snapshot 覆盖，不做增量合并」）。

⇒ **采纳 D11**：多项目并存发生在**注册表层**（可注册 N 个项目、可切换），运行期同一时刻只有**一个活跃实例**。这与 dsh 的形态同构（dsh 一个 session = 一个 cwd = 一个项目根）。**代价**：切项目要重载世界态（一次全量 snapshot 覆盖），**收益**：core 契约零改动、真相源不分裂。

> **待用户确认**（§5.3 Q8）：若产品要求「同时看两个项目的战场」，D11 需要让位，届时必须先解掉 core 多实例化与三条铁律的冲突——那是另一个任务，不在本设计范围内。

**历史包袱**：`src/stratix-database/StratixDatabase.ts:764-779` 里**已有一张遗留 `projects` 表**（`project_id` / `name` / `path` / `status` …）以及带 `project_id` 外键的 `channels` / `messages` / `zones` 表——这是**旧 stratix-project 概念**（CLAUDE.md 记录的 D6「stratix-project 砍掉」）。它与本设计**不是同一个东西**，但**表名会撞**。

> **必须处理的撞名**（实现期铁律）：遗留 `projects` 表是**旧语义**（一个可变的「项目行」，带 status/priority），新语义是**文件即项目**（`.stratix/project.json`）。两者不可混用。裁决见 §4.4。

### 4.2 维度模型：project / instance 两个 id

```
project（逻辑）  id = .stratix/project.json.id      随契约传播，同仓库各副本相同
   │
   ├── instance（物理）id = 注册表稳定 id           一个目录一条记录
   │      ├── 运行态：missions / character_tasks / sessions / session_events / characters 运行态行
   │      └── history/（本地态任务史）
   └── 契约：project.json / roster/ / config/ / skills/ / dsh/
```

**运行期只有一个活跃 instance（D11）**——上图的「instance」维度在**存储层**是全量分区（每行带 `instance_id`），在**运行层**是「当前激活的那一个」。存储层保留分区，是为了让「切回上一个项目」不必重建历史。

**为什么不引入第三个维度**（如「工作区 = 多个项目的集合」）：dsh 的 workspace 注册表本身就是「多根管理器」，一个注册表里多条目即多项目（集成报告 §4.4）。**注册表 = workspace，条目 = instance，条目指向 project**。不另造层级。

### 4.3 逐概念的归位

#### 角色（characters）—— **拆成「契约」与「运行态」两份**

| 部分 | 位置 | 谁是真相源 | 同步方向 |
|---|---|---|---|
| **身份与能力**（名字、persona、能力组合、agent 绑定） | `.stratix/roster/<role-id>.json` | **契约是真相源** | 契约 → 运行层（单向 reconcile） |
| **能力组合快照** | session header（运行时写） | 运行层 | 每个 session 固化一份 |
| **运行态**（level / experience / 位置 / contextEnabled） | `characters` 表 | **运行层是真相源** | 不回写契约 |

- **reconcile 规则**（D3）：启动 / 契约变更时按 `roster/` 声明**期望状态**，对运行层做**声明式对账**：缺 → 建；能力组合变了 → 标记「需要重启会话」，**不静默改写历史 session 的快照**。
- **为什么不双向**：双向同步 = 两个真相源 = 冲突时无法裁决。单向 + 显式 diff 是唯一可调试的形态。
- **能力组合进 session header**：直接抄 dsh 的理由（架构报告 §5.2）——*"a resume that restored a different composition would replay history the model can no longer act on"*。Stratix 现在换角色再 resume 就有这个洞，本设计是它的修法。

#### 战场任务（missions）—— **实例级，纯内存不变**

- missions 是**纯内存状态机**（CLAUDE.md 记忆条目：missions 纯内存，不落库）。**本设计不改变这一点**（铁律 1：真相源在 core）。
- 归位方式：mission 状态机实例**属于某个 instance**；`MissionView` 增加 `instanceId`（或等价的项目维度）字段。
- **归档时**（终结后）写一份归档摘要进 `.stratix/history/missions-YYYYMM.jsonl`——这是 §1.3 任务史的来源。

#### 角色任务（character_tasks）—— **加项目维度，不换库**

- `character_tasks` 表加 `instance_id` 列（nullable）。
- 唯一性判据不变（`id`）。
- 查询一律带实例过滤；**跨实例查询是显式动作**（UI 上「查看全部项目的任务」），不做默认聚合。

#### 会话（sessions）—— **加项目维度 + 能力组合快照**

- `sessions` 表（会话摘要，`session-dao.ts:37`）与 `session_events` 表（事件流，`session-event-dao.ts:34`）各加 `instance_id`。
- session header 里额外记：`projectId` / `instanceId` / **角色能力组合快照** / **cwd**。
- **cwd 记两份**（对齐 dsh）：
  - `projectRoot`（不可变）—— 项目身份；
  - `effectiveCwd`（可变）—— agent 当前落脚点。
  照抄 dsh 的语义（集成报告 §4.3）：**cd 不改沙箱边界、不移动会话日志、不改变 workspace 归属**。
- 「私密数据不进会话日志」的能力已有现成对应：dsh 的 `ctx.sessionLogDeepSeek.registerExclusion(predicate)`（集成报告 S15）；Stratix 侧对应「某类事件不落 `session_events`」的排除谓词。
- **写入通道**：会话持久化已经收口在 `session-persister.ts`（`createSessionPersister` 在 `:75`，`dao = null` 即不落库）与 `session-reader.ts`（`:48`）——**项目维度的加列只需在这两个端口实现一次**，不必改每个 DAO。

### 4.4 迁移路径（不破坏现有数据）

**目标：零数据重写，零停机。**

| 步 | 动作 | 可回滚性 |
|---|---|---|
| M1 | `characters` / `character_tasks` / `sessions` / `session_events` 各加 `instance_id`（**nullable**，默认 NULL） | 加列是 SQLite 的可逆操作（保留旧列即可回退） |
| M2 | 旧行 `instance_id = NULL` → 语义定义为「**默认沙盒实例**」（一个内置的、永远存在的虚拟实例，对应旧行为） | 纯逻辑层，零数据改动 |
| M3 | core 契约加**可选**字段（`instanceId?: string`）——缺省 = 默认沙盒 | 与 `MissionBrief` / `checkpoints` 的可选字段惯例一致（`src/core/types.ts:315` 注释里写明了「加不加都行」的纪律） |
| M4 | 遗留 `projects` 表：**不删、不复用**。新语义**不复用**这张表（名字已被占用且语义不同）。新项目身份只来自 `.stratix/project.json` | 零风险；旧表继续服务旧代码路径，直到旧链路整体退役 |
| M5 | 引导：新实例创建时，其 `instance_id` 写入注册表；旧行不迁移（用户可显式执行「把默认沙盒的任务归入某项目」） | 显式、可撤销 |

**不做的事**：不把旧行批量回填（无意义——旧数据本来就没项目归属）、不新建 per-project 数据库文件（§0 D4）。

**写入通道的约束**：**存储独占铁律**（`docs/SERVICE-SPLIT-PLAN.md:101`：SQLite 只由 service 进程打开写，其余进程经 API 读）⇒ **契约 reconcile 的写入必须发生在 service 进程**（走既有 core/HudCommand 通道），Electron 侧只读契约文件、只发命令。这与铁律 2「裁决在 core」一致，也与「渐进迁移」铁律（`:102`：旧路径全程可用，只 `@deprecated` 不删代码）一致——本设计的全部迁移步骤都必须是**加法**，不删旧代码。

### 4.5 一张归位总表

| 概念 | 归属维度 | 存放 | 真相源 | 本设计的动作 |
|---|---|---|---|---|
| 角色定义（名字/persona/能力） | project | `.stratix/roster/` | ✅ 契约 | **新增**（声明式） |
| 角色运行态（等级/经验/位置） | instance | `characters` 表 | ✅ 运行层 | 加 `instance_id` |
| 战场任务（mission）状态 | instance | 内存 | ✅ core | 加实例维度（**不改纯内存**） |
| 角色任务（task） | instance | `character_tasks` 表 | ✅ 运行层 | 加 `instance_id` |
| 会话事件 | instance | `session_events` 表 | ✅ 运行层 | 加 `instance_id` + header 快照 |
| 任务史 | instance | `.stratix/history/*.jsonl` | ✅ 归档后冻结 | **新增**（append-only） |
| 项目元数据 | project | `.stratix/project.json` | ✅ 契约 | **新增** |
| 项目配置 | project | `.stratix/config/` | ✅ 契约 | **新增** |
| 角色能力组合快照 | instance | session header | ✅ 运行层 | **新增**（修 dsh 发现的洞） |
| 项目注册表 | user | `workspaces.json` | ✅ 注册表 | **新增** |

---

## 5. 边界与非目标

### 5.1 明确不做

| 不做 | 理由 / 出处 |
|---|---|
| **不做 IDE / 编辑器** | 本设计只管目录契约与发现；画面层是 Phaser/Electron，与文件编辑无关 |
| **不做包管理器 / 插件市场** | dsh 已有自己的市场面（集成报告 C10 / S5 评级「需上游配合」）；Stratix 不造第二套生态 |
| **不做云同步 / 多用户协作服务端** | 契约靠 git 传播已经够用；自建同步 = 第二套真相源 |
| **不做全盘扫描 / 系统索引** | 性能预算（§2.1）；dsh 也是走 marker walk-up 而非全盘索引 |
| **不把 `.stratix` 映射成 dsh profile / bundle** | profile 是**部署**概念（§3.2）；集成报告 §4.6 明确点名这条 |
| **不让 dsh 写 `.stratix`** | 对等原则 D7；dsh 的铁律是「配置与状态全在 `$DSH_HOME`」 |
| **不在 `.stratix` 存凭据** | §3.3 约束 1；dsh 的凭据链是「环境变量 → `<cwd>/.env` → `$DSH_HOME/.env`」 |
| **不把 mission 真相源从 core 挪进文件** | 铁律 1（`docs/SERVICE-SPLIT-PLAN.md`）；归档是**导出**，不是输入 |
| **不改 missions 纯内存的性质** | 现状与铁律一致；本设计只加归属维度 |
| **不做「一项目一库」** | D4；单库 + 索引列更优，且不制造 N 个迁移面 |
| **不实现任何本设计的内容** | 本任务=纯文档（验收要求「不改 src/」） |

### 5.2 性能预算（`docs/PERFORMANCE_GUIDELINES.md`）

| 场景 | 预算 |
|---|---|
| 单根扫描 | ≤ 500 目录项、≤ 50 ms |
| 单次全量刷新 | ≤ 200 ms；并发根数 ≤ 2 |
| 注册表规模 | ≤ 200 条实例；未置顶的按 `lastOpenedAt` LRU 淘汰 |
| 契约文件大小 | `project.json` ≤ 64 KiB；单个 `roster/*.json` ≤ 256 KiB；`config/*.json` ≤ 64 KiB（超限**拒绝加载并报原因**，不静默截断） |
| `history/*.jsonl` | 按月分片；单片 ≤ 50 MB / ≤ 10 000 行，滚动归档 |
| 迁移 | **逐行流式**，禁止整文件载入（L8 / 大文件打爆内存的教训） |
| 迁移链深度 | ≤ 8 步（超出应合并为一次重写，而不是拖长链） |
| reconcile | 契约变更 → 运行层对账 ≤ 50 ms / 每实例；增量做（按文件 mtime + 内容哈希指纹） |
| 锁 | 每 project 一把锁；等待 ≤ 5 s，超时降级为**只读打开**并提示 |

### 5.3 开放问题（需用户拍板后才能冻结）

| # | 问题 | 我的建议 | 影响面 |
|---|---|---|---|
| **Q1** | `.stratix/roster/`（角色定义）**是否入 git**？入 git ⇒ 同仓库所有副本共享同一套角色；不入 ⇒ 每个副本可长出自己的班底 | **入 git**（角色是「这个项目是什么」，副本应当一致） | 角色 reconcile、worktree 副本语义 |
| **Q2** | 主仓与 worktree **是否共享 mission 池**？ | **不共享**（按 instance 隔离；契约共享） | §2.5、§4.2 的 instance 维度是否必须 |
| **Q3** | `.stratix/history/` **是否入 git**？ | **默认不入**，提供显式开关 | JSONL 合并冲突、协作体验 |
| **Q4** | 目录名是否**固定**为 `.stratix`？ | 固定（生态接口需要稳定约定；dsh 那边是 `.dsh` / `.agents`） | 发现算法、文档、约定 |
| **Q5** | 是否支持**嵌套项目**（`.stratix` 内再套 `.stratix`）与契约继承？ | **支持嵌套识别，但不做继承**（就近原则） | 发现算法、配置分层 |
| **Q6** | `.stratix` 是否要支持**自定义 schema 扩展**（第三方字段）？ | 支持但**必须命名空间化**（`x-<vendor>.*`），未知字段读方**保留不解释** | 生态扩展性 |
| **Q7** | 遗留 `projects` 表的最终处置（旧 stratix-project 概念） | 本任务不动；退役计划另开 | 命名冲突、实现期撞名 |
| **Q8** | **是否接受 D11**（一进程只激活一个项目实例；多项目并存于注册表，切项目 = 重载世界态） | **建议接受**——core 三处单例（`worldStore` / `coreRuntime` / bus）都无项目维度，多实例化要改 core 契约、撞三条铁律 | 是否需要 core 多实例化（另一个任务） |
| **Q9** | 切项目时的**未归档数据**怎么办？（mission 纯内存、只存在于 worldStore） | 切走前**强制归档**到 `.stratix/history/` 或提示未完成；不做静默丢弃 | 数据丢失风险 |

### 5.4 后续实现路径（本任务不执行）

| 阶段 | 内容 | 依赖 |
|---|---|---|
| S1 | `.stratix` 契约读写器 + `project.json` schema + 原子写 | 本设计冻结 |
| S2 | 发现与注册（marker walk-up + `workspaces.json` 注册表） | S1 |
| S3 | 引导流程（needs-init → 初始化） | S2 |
| S4 | 运行态加 `instance_id`（M1–M3 迁移；写入走 service 进程，遵存储独占铁律） | S2 |
| S5 | 契约 ↔ 运行层 reconcile（roster → characters） | S4 |
| **S6** | **`SpawnOptions.cwd` 接线**：`task-service` / `chat-service` 派发时填 `cwd = 活跃实例的项目根` → 6 个内建 adapter + 自定义适配器一次受益（§3.5） | S2 |
| S7 | dsh 桥接（`customSkillDirs` 挂载 + patch 相对路径解析 + 派活文案 `/` 转义） | S1、S4、S6；**注意先解掉集成报告 §0.1.3 的版本钉位互斥**（`cordis ~4.0.5` → `~4.1.0`，`dsh-tools 0.2.1-rc.5` → `0.2.2-rc.1`） |
| S8 | 归档导出（missions/tasks → `history/*.jsonl`）+ 切项目时的未归档数据处置（Q9） | S4、S5 |

---

## 附录 A：完整目录树示例

```
my-game/
├── .stratix/
│   ├── project.json
│   ├── .gitignore
│   ├── roster/
│   │   ├── _index.json
│   │   ├── scout.json
│   │   └── builder.json
│   ├── config/
│   │   ├── stratix.json
│   │   └── permissions.json
│   ├── skills/
│   │   ├── recon/SKILL.md
│   │   └── build-order/SKILL.md
│   ├── history/
│   │   ├── missions-202611.jsonl
│   │   └── tasks-202611.jsonl
│   ├── dsh/
│   │   ├── profile.json
│   │   ├── bridge.patch.yml
│   │   └── README.md
│   └── state/
│       ├── lock
│       └── cache/
├── AGENTS.md
├── CLAUDE.md
├── .env                      # 凭据（gitignore）
├── .gitignore
├── src/
└── README.md
```

## 附录 B：调研结论 → 本设计的引用对照

| 调研结论 | 出处 | 本设计落点 |
|---|---|---|
| dsh 没有项目级元数据目录约定；配置与状态全在 `$DSH_HOME` | 集成报告 §4.6 | D1 / D7；§1.1 三方读写边界 |
| `.stratix` 与 `cordis.patch.yml` 正交；不要映射到 profile/bundle | 集成报告 §4.6 要点 | §3.2 裁决表 |
| `SessionHeader.cwd` 不可变 / `ctx.workingDirectory` 可变 | 集成报告 §4.1、§4.3 | §0 D2；§4.3「cwd 记两份」 |
| 沙箱根锚定不可变 `header.cwd`，cd 不改边界 | 集成报告 §4.1 关键不变量、§7 #20 | §4.3 归属校验；§2.5 |
| workspace 注册表 = 多根管理器，唯一性按规范路径判等 | 集成报告 §4.4 | §2.4 规则表 |
| 会话归属按 `header.cwd` 判定，cd 不改变归属 | 集成报告 §7 #22 | §2.5、§4.3 |
| dsh 无项目级 marker 约定，marker 是 `.git`，找不到则回落 cwd | `packages/context/agent-instructions/src/config.ts:11`、`files.ts:232-246` | §2.2 marker walk-up |
| skill 项目根：`.dsh/skills`（rank 100）/ `.agents/skills`（rank 200） | `packages/skill/skill-filesystem/src/index.ts:256-257` | §1.3；D6（用 `customSkillDirs`） |
| 技能两级注入（目录 → 全文） | 架构报告 §5.3 | §1.3 技能格式 |
| preset 决定工具集与 prompt，且**写进 session header**；换 composition 会让历史无法重放 | 架构报告 §5.2 | §1.3 角色能力组合；§4.3 快照 |
| session = append-only 事件 log，消息历史是投影 | 架构报告 §5.1 | §4.3 任务史形状（借形状不借真相源） |
| `SESSION_FORMAT_VERSION = 4`；单调整数；方向性拒绝；相邻链无缺口；`ignorable` 标记 | `docs/session-format-status.md`、架构报告 §5.1 | §1.4 全节（八条教训映射） |
| 整制品迁移会打爆内存，迁移必须流式 | `2026-08-31-released-session-format-migrations.md` | §1.4 L8；§5.2 迁移预算 |
| 产物形状受限 + 宿主静态准入校验 | 架构报告 §4.3、Top10 #9 | §3.3 约束 3 |
| `--patch` 相对路径按 patch 文件目录锚定 | 集成报告 §3.5 | §1.3 dsh 桥接件；§3.3 |
| dsh 凭据链：环境变量 → `<cwd>/.env` → `$DSH_HOME/.env` | `packages/bundle/headless/README.md:56` | §3.3 约束 1 |
| `session/query` 自带斜杠命令路由（4 类），命中不回落到 prompt | 集成报告 §0.1.2、§7 #25/#26 | §3.4 派活文案坑 |
| 版本兼容 = 声明范围 + 主机强制 + 显式风险豁免 | 架构报告 Top10 #7 | §1.3 `engines.stratix` |
| 一切注册都是 effect，卸载自动逆序回收 | 架构报告 Top10 #1 | §1.1 边界（agent 只读、dsh 不写） |
| 组合发生在 YAML 不在代码 | 架构报告 Top10 #4 | §1.3 桥接件用 YAML patch |
| Stratix 侧 rc.1 版本钉位互斥（`cordis ~4.0.5` 装不上 rc.1 的 `4.1.0`） | 集成报告 §0.1.3、§7 #16 | §5.4 S7 的前置条件 |
| **`SpawnOptions.cwd` 已定义但全仓无人赋值** → CLI 子进程继承宿主 cwd | `src/app/services/cli-transport/transport.ts:85`、`:120`；`adapters/dsh.ts:202` | §3.5（D12）；§5.4 S6 |
| **core 三处进程级单例**（`worldStore` / `coreRuntime` / 总线）均无项目维度 | `src/core/store.ts:311`、`src/core/runtime.ts:803`、`src/core/bus.ts:32` | §4.1.1 ⇒ D11（一进程只激活一个实例） |
| **存储独占铁律**：SQLite 只由 service 进程打开写 | `docs/SERVICE-SPLIT-PLAN.md:101` | §4.1、§4.4（reconcile 写入走 service 进程） |
| **渐进迁移铁律**：旧路径全程可用，只 `@deprecated` 不删代码 | `docs/SERVICE-SPLIT-PLAN.md:102` | §4.4（全部迁移步骤是加法） |
| 真相唯一铁律：WorldState 真相源在 service 进程的 core store | `docs/SERVICE-SPLIT-PLAN.md:96` | §4.1.1（D11 的取舍依据） |
| 裁决在 core：相位状态机只在 core runtime | `docs/SERVICE-SPLIT-PLAN.md:97` | §4.4（写入通道约束） |
| 生产 DB 驱动是 sql.js（WASM）适配器，非 better-sqlite3 | `src/stratix-database/sqlite-adapter.ts:1-18` | §4.1（内存驻留 ⇒ 库不宜无限增长） |
| 会话持久化已收口在 `session-persister.ts` / `session-reader.ts` 两个端口 | `src/app/services/persistence/session-persister.ts:75`、`session-reader.ts:48` | §4.3（会话项目维度只在这两个端口实现一次） |
