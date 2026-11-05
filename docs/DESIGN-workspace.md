# DESIGN-workspace —— Workspace / `.stratix` 目录契约与项目发现（设计 A）

> 状态：**r1 修订中（尚未冻结）**
> 任务：task_159（r1 修订：task_164）。依赖：task_157（`docs/research/dsh-architecture.md`）、task_158（`docs/research/dsh-integration-map.md`）
> **姊妹文档**：[DESIGN-project-map.md](DESIGN-project-map.md)（设计 B，task_160）—— 本文档回答「项目是什么、怎么被找到」，它回答「项目长什么样（一张地图 = 一个副本）、agent 怎么进去干活、活干在哪」。**接缝在 §4.2 的 project / instance 两个 id**：本设计的 `project.json.id`（逻辑）与 `workspaces.json` 的 `instanceId`（物理）是 task_160 的两个锚点，task_160 **不新增第三种 id**，其 core 契约侧的 instance 维度字段沿用本文 §4.4 的 `instanceId` / `instance_id` 命名
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
| **D13** | **`.stratix/` 是「半可信输入面」**：它随 git 传播 ⇒ **一次 `git clone` 就带来任意的契约文本**。因此契约文本一律**当作数据而非指令**；`--patch` 覆盖层**不得承载代码**（禁 `!!js` 与一切自定义 tag） | dsh `--patch` 的 schema 允许 `!!js`（`packages/boot/app-boot/src/index.ts:266,576`；`vendor/loader/src/config/utils.ts:5-14` 的 `new Function('ctx','expr',…)`）⇒ 若原样透传 = **仓库里的任意 JS 在宿主进程里执行** |
| **D14** | **D11 的适用域 = 「Stratix 独立进程模式」**：dsh 宿主的隔离单位是 **session/scope**，Stratix 的隔离单位是**进程** ⇒ 在「Stratix 作为 dsh 插件被嵌入」形态下，D11 **不成立**，必须把 `activeInstanceId` / worldStore 降到 **scope 级**（另立任务，见 §7 推迟清单） | dsh `packages/core/scope/src/index.ts:131-146` `createScope`；`packages/core/agent-loop/src/agent.ts:147` 每 agent 一个 scope；`packages/core/agent/src/index.ts:250` 一进程多 session |

**明确不做的**（详见 §5）：不做 IDE、不做包管理器/插件市场、不做云同步、不做全盘索引、不把 `.stratix` 变成 dsh profile、**不在本任务实现任何代码**。

> <!-- r1: 修订，见 design-review-r1.md#R1-10 —— 既有 project 概念清点（§4.1.2 新增）；见 design-review-r1.md#R1-04 —— 默认沙盒须物化（§4.4 M2）；见 design-review-r1-dsh.md#A1 —— 威胁模型（D13）；见 design-review-r1-dsh.md#B1 —— D11 适用域（D14） -->
> **本轮（r1）修订基线**：`docs/review/design-review-r1.md`（42 条）与 `docs/review/design-review-r1-dsh.md`（A 面 7 + B 面 8）的**逐条下落表见本文 §附录 C**。

---

## 1. `.stratix` 目录契约

### 1.1 三条边界（谁写、谁读、谁不碰）

`.stratix` 的全部设计压力来自一个事实：**它同时被三方读**。

| 读者 | 读什么 | 写什么 | 内容可信度 |
|---|---|---|---|
| **Stratix 宿主**（app/gateway/core） | 全部 | 契约初始化、运行态物化、`state/` | ✅ 可信（本地宿主写入） |
| **agent**（通过 dsh / CLI / 文件系统） | **只读**：`project.json`、`roster/`、`config/`、`skills/`、`history/` | **零**（agent 不得改契约；需要改就提 PR/派单给角色） | ⚠️ **可读但不可信**（随 VCS 传播，见 D13） |
| **dsh** | 通过 `--patch` 读 `.stratix/dsh/*.patch.yml`；通过 `customSkillDirs` 读 `.stratix/skills/`；通过 `cwd` 感知项目根 | **零**（对等 D7） | ⚠️ **可读但不可信**（同上） |

> **为什么 agent 只读**：dsh 的设计哲学里，模型看到的是**注册面**（`ctx.tools`）与**按需加载的文档**（skill），不是可写的项目配置（架构报告 §5.3 的两级注入模型）。让 agent 能改 `.stratix/`，等于在项目里开第二套可写真相源，与「契约层单向 reconcile」（D3）冲突。

> <!-- r1: 修订，见 design-review-r1.md#R1-19 —— 补「内容可信度」列：写权限边界 ≠ 内容可信度边界；契约来自 VCS ⇒ 半可信 -->
> **可信度的含义**：**写权限**边界（agent 只读）与**内容可信度**边界（契约文本可能是恶意的）是**两件事**。D13 与 §3.3 约束 3/4 治后者。

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
│   │                                 ←   ⚠️ M3 才定型（词表 + 执行点），M1/M2 **不产出**（见 §7 推迟清单）
│   │
│   ├── skills/                       ← 【契约】项目级技能（Markdown + frontmatter）
│   │   └── <skill-name>/SKILL.md     ←   照 dsh skill 形状（kebab-case 名 + YAML frontmatter）
│   │                                 ←   ⚠️ M3 预留，M1/M2 **不创建**（空壳目录会被提交进 git）
│   │
│   ├── history/                      ← 【本地态·默认不提交】已归档任务史（append-only JSONL）
│   │   ├── missions-YYYYMM.jsonl     ←   已终结 mission 的归档摘要
│   │   └── tasks-YYYYMM.jsonl        ←   已终结角色任务的归档摘要
│   │
│   ├── dsh/                          ← 【契约】dsh 桥接件（声明式，不含凭据）
│   │   ├── profile.json              ←   接入参数（profile 名 / provider / model / patch 列表）
│   │   ├── bridge.patch.yml          │   供 `dsh --patch` 叠加的 patch（YAML，声明式）
│   │   └── README.md                 ←   人类可读说明（给不熟 dsh 的人）
│   │                                 ←   ⚠️ M3 预留，M1/M2 **不创建**（dsh 路线在 M3，rc.1 钉位互斥未解）
│   │
│   └── state/                        ← 【本地态·绝不提交】运行期临时物
│       ├── lock                      ←   **本目录内**的进程锁（⚠️ 不承担 project 级互斥，见 §1.5）
│       └── cache/                    ←   可重建缓存（如 discovery 结果指纹）
│
├── AGENTS.md                         ← dsh 自动加载的项目指令（dsh 约定位置，非 .stratix 独有）
├── CLAUDE.md                         ← 同上（dsh 的候选清单：AGENTS.md / CLAUDE.md）
├── .env                              ← dsh 的凭据读取位置（`<invocation cwd>/.env`）
│                                     ←   ⚠️ **必须由「项目根 `.gitignore`」排除**（`.stratix/.gitignore` 管不到它）
└── ...（项目自身源码）
```

<!-- r1: 修订，见 design-review-r1.md#R1-18 —— `.env` 的 gitignore 责任在项目根，不在 `.stratix/.gitignore`；cwd=项目根 ⇒ 项目 `.env` 自动进入每个 agent 子进程的环境（凭据边界见 §3.3 约束 5） -->
<!-- r1: 修订，见 design-review-r1.md#R1-33 —— `skills/` 与 `dsh/` 整体推到 M3，M1/M2 不创建空壳目录 -->
<!-- r1: 修订，见 design-review-r1.md#R1-30 —— `config/permissions.json` 在 M1/M2 不产出（避免死契约） -->
<!-- r1: 修订，见 design-review-r1.md#R1-17 —— `.stratix/state/lock` 降级为「本目录内进程锁」；project 级跨进程锁见 §1.5 -->

**两类内容的分界**（`.stratix/.gitignore` 自己声明）：

```
# .stratix/.gitignore
history/          # 任务史：默认本地积累（避免 worktree 合并冲突）
state/            # 运行期临时物
```

- **契约（可提交）**：`project.json` / `roster/` / `config/` /（`skills/` / `dsh/` —— **M3 预留，M1/M2 不创建**）
- **本地态（默认不提交）**：`history/` / `state/`

> **为什么 `history/` 默认不提交**：`.stratix/` 随 git 传播时，worktree 会 checkout 出**同一份** `history/*.jsonl`；两个副本各自追加 → git 对 JSONL 的合并极差。副本语义本就是「各玩各的存档」（产品愿景：项目 = 文件夹 = 游戏副本），故任务史**默认本地**；团队协作需要时用**显式开关**开启提交（见 §5.3 开放问题 Q3）。

> <!-- r1: 修订，见 design-review-r1.md#R1-33 —— 契约面清单收窄：M1/M2 不产出 `skills/` / `dsh/`（避免空壳随仓库传播 + 白占契约文件大小预算） -->

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
  "agents": {
    "defaultRoleId": "scout",               // 默认派单角色
    "defaultProfile": "stratix-default"     // dsh 侧 profile 名（部署面，见 §3.2）
  },
  "engines": { "stratix": ">=3.3.0" },       // 版本兼容声明（借 dsh 的 engines.dsh）
  "links": { "dsh": "dsh/profile.json" }
}
```

<!-- r1: 修订，见 design-review-r1.md#R1-01 —— `instance` 整块迁出 `project.json`：
     `path` / `branch` / `commonDirFingerprint` 是**物理副本级**事实（主仓在 master、worktree 在 demo/v3.3），
     而 `project.json` 是**契约（可提交）且各副本内容必须相同**（§2.5 的核心裁决）。
     留在契约里 ⇒ ① 每次切分支/提交都产生 git 冲突；② 注入给 agent 的分支是**假的**（工作区当前分支 ≠ 已提交进 git 的那个值）。
     三项 instance 级字段全部落到注册表 `workspaces.json`（§2.4），它本就是「一个目录一条记录」。 -->

- `id` 用**本地生成的稳定 id**（`spx_` + 22 位 base62），**不用目录路径派生**——路径会变，id 不该变（对齐 dsh：Workspace 有稳定 id + 规范路径两件事）。
- **`project.json` 只放 project 级字段**（`id` / `name` / `description` / `formatVersion` / `agents` / `engines` / `links`）。**任何副本级事实（路径、当前分支、git common dir 指纹）一律不进本文件**（落 `workspaces.json`，§2.4）。
- **同源识别改由注册表提供**：`workspaces.json` 条目上的 `vcs.commonDirFingerprint`（= `git rev-parse --git-common-dir` 路径的哈希）→ 用来识别「这些副本来自同一个仓库」（见 §2.5）。
- **注入给 agent 的分支改为运行时读取**：`<stratix-project>` 块若要带分支，由 app 层在派发时执行 `git rev-parse --abbrev-ref HEAD`（**读当前 worktree 的实际分支**，不是读契约）；读不到（非 git 项目）⇒ **该字段整项省略**，不填占位值。

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
    "systemPrompt": null                    // ⚠️ 【只读·非权威】追加 system prompt 段的**建议片段**；
                                           //    ⚠️ 权威 systemPrompt 只允许来自本地用户设置，不得来自仓库文件
                                           //    （见 §3.3 约束 4；本字段进入 agent 上下文时必须带数据边界）
  },
  "state": {                                // 运行态字段的**默认值**（运行层可被覆盖）
    "level": 1, "experience": 0,
    "contextEnabled": true
  }
}
```

> **「角色 = 能力组合」的出处**：架构报告 §5.2 指出 dsh 的 preset 是「一组具名的、声明式的子 Cordis 插件行」，决定「这个 session 的工具集和 prompt」，并**被写进 session header**——理由原文是 *"a resume that restored a different composition would replay history the model can no longer act on"*。Stratix 现在的角色只是「一个名字 + 一段 prompt 串」，**换角色再 resume，同一段历史里的工具语义就变了**（架构报告 §5.2 原文指出的真实存在的洞）。本设计把角色升级为能力组合，并要求**能力组合快照进 session header**（§4.3）。

<!-- r1: 修订，见 design-review-r1.md#R1-19 —— `capabilities.systemPrompt` 原样进 system prompt 层 ⇒ 一次 `git clone` 就能越过用户层注入指令。
     修订：① 仓库里的 `systemPrompt` **降级为「建议片段」**，进 prompt 时必须带数据边界；② 权威 systemPrompt 只允许来自**本地用户设置**；
     ③ `description` / `persona` / `systemPrompt` 各自单字段长度上限（§3.3 约束 4）。 -->

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

照 dsh 的 skill 形状：目录名 kebab-case、`SKILL.md` 带 YAML frontmatter（`name` / `description`）。**两级注入**照搬 dsh：首次只注入 `name + description` 目录，模型按需取全文（架构报告 §5.3：`packages/skill/tool-skill/src/index.ts:36`；两级注入由 `packages/skill/skill-filesystem/src/index.ts:251-269` 的根收集 + `packages/skill/skill/src/index.ts` 的目录形态共同承担）。

**关键：`.stratix/skills/` 不会被 dsh 自动发现**——dsh 只自动看 `<projectRoot>/.dsh/skills` 与 `<projectRoot>/.agents/skills`（`packages/skill/skill-filesystem/src/index.ts:256-257`）。所以接法是 D6：**启动 dsh 会话时把 `.stratix/skills` 作为 `customSkillDirs` 传入**（`packages/skill/skill-filesystem/src/index.ts:58`），**不复制**、**不软链**进 `.dsh/skills`。

<!-- r1: 修订，见 design-review-r1-dsh.md#A7 —— 路径修正：`packages/skill/skill-filesystem/src/tool-skill/src/index.ts` 在 dsh HEAD 上不存在，正确路径是 `packages/skill/tool-skill/src/index.ts` -->

> ⚠️ **优先级约束（新增）**：`customSkillDirs` 挂载的技能 rank = **300**，而 dsh 自动发现的 `.dsh/skills` = **100**、`.agents/skills` = **200**，且「**数字小的赢**」（`packages/skill/skill-filesystem/src/index.ts:35-37,260`；`packages/skill/skill/src/index.ts:78,808`）。
> ⇒ **`.stratix/skills` 是最低优先级**：项目里只要存在同名技能，自动发现的根会抢走。
> **对策**（与 §3.3 约束 3 同口径）：① 项目技能用**独立命名空间**（`.stratix/skills` 下的 `<project-skill-id>` 与 dsh 约定名不重叠）；② reconcile 期做**重名校验**——撞名即**拒绝加载并报具体原因**（不是「谁赢谁上」）。
> <!-- r1: 修订，见 design-review-r1-dsh.md#A3 —— 补 skill rank 优先级约束（原先只判「✅ 直接对齐」，漏了优先级） -->

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
# 只放【声明式】行；指向一个【已安装】的 npm bundle 行，不指向仓库内的 JS 文件。
- insert:
    - id: stratix-dsh-bridge
      name: '@stratix/dsh-bridge'          # 已安装的 bundle（npm 分发单元），不是仓库内的 dist/*.js
      config:
        url: 'ws://127.0.0.1:7524/ws/world-sync'
```

**为什么 patch 能随项目走**：dsh 的 `--patch` 相对路径**按 patch 文件所在目录锚定成绝对 file URL**（集成报告 §3.5，`anchorInsertedPluginNames` 在 `packages/boot/app-boot/src/index.ts:547`）。所以把 patch 放进 `.stratix/dsh/` 里，路径解析是自洽的，**不需要 dsh 侧任何改动**。

<!-- r1: 修订，见 design-review-r1-dsh.md#A2 —— 三处载荷修正：
     ① 示例曾写 `name: './plugins/dsh-bridge/dist/index.js'`（契约树里**没有** `plugins/` 目录），
        而 dsh 的 `anchorInsertedPluginNames` 会把 `./` 开头的名字**锚定成绝对 file:// URL 并被 Loader 直接 import()**
        ⇒ 等于执行一个 git 跟踪的 `dist/*.js`（A1 的静态校验管不到它做了什么）。改为指向**已安装的 npm bundle**。
     ② 端口 `7797` 在代码里根本不存在，且与 160 §4.1 的结论（world-sync = **7524**）自相矛盾 ⇒ 统一到 7524。
     ③ 机器相关值（端口、绝对路径）**不进 git 跟踪的契约** ⇒ 由 Stratix 在 spawn 时生成临时 patch（写进 $DSH_HOME 或临时目录）。 -->

> **形态约束**：patch 里只能有 `{insert:[...]}` 这类**声明式**操作，**不许**写自定义 tag / groups / aliases —— 照 dsh `validateGeneratedBundle` 的准入规则（架构报告 §4.3：`packages/experimental/creation-recommendations/src/generated-bundle.ts:16-50`）。Stratix 侧应有等价的静态校验（形状受限 + 宿主裁决），这正是架构报告 Top10 第 9 条。

> 🔴 **但 `validateGeneratedBundle` 管不到 `--patch` 覆盖层**（见 §3.3 约束 3 的正式表述）：生成型 bundle 用 `parseDocument(..., { schema: 'core', customTags: [] })` 拒绝一切自定义 tag；而 `--patch` 覆盖层的 schema 是 `entryListSchema`（`packages/boot/app-boot/src/index.ts:266`）→ **允许 `!!js`**。

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
| `formatVersion < 当前支持版本` | 在**内存里**跑完整的相邻迁移链，**源文件字节、路径、inode 全不变**；只有「读-改-写」场景才发布新世代（写临时文件 → fsync → rename 原子替换）。**⚠️ M1 不实现此路径**（`formatVersion` 恒为 1 ⇒ 走不到；迁移链随第一个 bump 一起设计，§1.4.4） |

**为什么是「内存里迁移」而不是「就地升级」**：dsh 的 L3 原文 —— *"every event-body operation first runs the complete adjacent chain in memory and leaves the source path, bytes, and inode unchanged"*。对 `.stratix` 尤其重要：**契约文件可能被 git 跟踪**，就地改写会造成工作区脏状态、与并行分支冲突。就地升级只在用户**显式执行「升级契约」动作**时发生。

#### 1.4.4 相邻迁移链（M1 只实现两条读规则，链本身推迟到「第一个 bump」）

**M1 实现范围（本设计冻结的部分）**——只有两条规则：

| 读到 | M1 的动作 |
|---|---|
| `formatVersion == 1`（当前支持版本） | **正常读** |
| `formatVersion > 1` | **拒绝并报原始文件路径**（「本项目由更新的 Stratix 写入，请升级」） |

**推迟到「第一个 bump 的那一刻」才设计**（见 §7 推迟清单）：相邻迁移链的具体形态、发布记录字段、方向性读规则的完整实现。触发条件 = `STRATIX_PROJECT_FORMAT_VERSION` 从 1 变成 2 的那一刻。

**为什么迁移目录不进项目**（推迟的理由）：

- `.stratix/format-catalog.json` 让「每一步迁移」**随仓库传播、随分支分叉**；而迁移器必须**跟着读方（宿主代码）走** —— 老项目目录里没有新版本的目录，就没法被新版本迁移；不同项目可能带着不同版本的目录。
- 这与 L7（「writer 常量与发布记录分离」）及 dsh 的实际选择相反：dsh 的迁移目录是**编译期静态**的（`packages/session/session-format/src/catalog.ts:25` *"Compile a **build-static** physical codec and adjacent migration catalog."*，由 `scripts/gen-session-format-catalog.ts` 在构建期校验）。
- ⇒ **迁移步骤以代码为准**（每个版本一个函数 + 单测），项目里**只保留 `formatVersion` 一个字段**。

<!-- r1: 修订，见 design-review-r1.md#R1-31 —— 整套迁移 apparatus 在 formatVersion 恒为 1 的阶段全是空转，且迁移目录放错了地方（应在代码里，不在项目里）。
     同时修掉原 §1.4.4 示例里**违反它自己两行前写的规则**的错误：示例 `steps.length=2` 而 `current - minVersion = 2-1 = 1`；
     且链的终点 3 > `current` 2 —— 按「缺一步 ⇒ 拒绝加载」，那个目录会让所有 v1 项目被拒。 -->

**（保留为将来的设计输入）**——当真的要 bump 时，下列纪律必须成立：

- 链必须**首尾相接、无缺口、无重复**。
- **缺一步 ⇒ 拒绝加载**（不降级、不猜测）。
- 每一步迁移**只描述相邻版本**（不写「任意 v1→v9」的大跳），与 dsh 的 `SessionFormatMigration` 同构（`2026-08-31-released-session-format-migrations.md`）。
- `kind: "stream-rewrite"` 的步骤**必须逐行流式**（L8）。

<!-- r1: 修订，见 design-review-r1-dsh.md#A6 —— 补 dsh 的两条实际语义：
     ① dsh 的链**没有下限**（`packages/session/session-format/src/catalog.ts:37-39` 要求 v0..vN 每个整数版本都有 codec），
        ⇒ 正确性判据与 dsh 一致 —— **从 0 到 current 每个版本都必须有对应形态**；原设计允许 `minVersion` 只是本地优化。
     ② dsh 的迁移目录是**编译期静态**的 ⇒ 迁移以代码为准（见上）。 -->

#### 1.4.5 发布记录（照 L7）

| 项 | 值 | 说明 |
|---|---|---|
| writer 常量 | `STRATIX_PROJECT_FORMAT_VERSION` | 代码里唯一手写的当前 writer 号 |
| `latestFinalizedVersion` | 1 | 已接受兼容性基线 |
| `latestReleasedVersion` | 1 | 已发布格式 |
| `evidenceTag` | 待第一个 `.stratix` 契约格式随版本发布时填写 | 对应 dsh 的 `dsh-v0.2.0-rc.2` 角色 |

> **本文档本身即「发布记录」的双语等价物**。dsh 的教训之一是「发布记录与 writer 常量分离，发布前不推进记录，trunk 上永不回退」——本设计在实现时必须照做。

### 1.5 原子写与并发

- **原子写**：所有 `.stratix` 写入走「写临时文件 → `fsync(file)` → `rename` 原子替换 → `fsync(父目录)`」，禁止原地 truncate（Windows 与崩溃场景下会留半截文件）。
  - **临时文件名必须带 pid + 随机后缀**：`<目标名>.tmp-<pid>-<rand>`。若用固定名（如 `project.json.tmp`），同 pid 的两次并发写会互相覆盖临时文件 ⇒ `rename` 出半截内容。
  - **必须 `fsync` 父目录**：只 fsync 文件不 fsync 父目录 ⇒ 崩溃（掉电）后可能丢目录项（`rename` 的持久性需要 fsync 父目录保证）。
  - **同一目标同一时刻只有一把锁**（锁粒度按 projectId，见下）。
- **项目级独占锁（跨进程）**：**按 `projectId` 放在共享位置** `$DATA_DIR/locks/<projectId>.lock`（与库同寿命、同目录规则，见 §2.4）。记录持有者（pid + instanceId + 时间戳）。
  - **为什么不能放 `.stratix/state/lock`**：主仓与 worktree 是**两个目录、两份 `.stratix/state/`** ⇒ 那是**两把不同的锁文件**，锁不住同一个 `projectId`。本设计举的正是「主仓与 worktree 共享契约」这个主用例，而它恰恰是锁不住的那个。
  - **`.stratix/state/lock` 降级**为「**本目录内的进程锁**」，明确它**不承担** project 级互斥。
  - **锁不是契约**：锁文件在库目录（不提交），且**启动时若发现陈旧锁（pid 已不存在）自动清理**。
  - **等待超时**：等待 ≤ 5 s；超时**拒绝本次写入并报具体原因**（"project <id> 正被 pid <n> 持有"）。**⚠️ 当前应用没有只读模式** ⇒ 原文写的「降级为只读打开」是兑现不了的承诺，已删除；「只读模式」是 M2 的交付物（见 §7 推迟清单）。

<!-- r1: 修订，见 design-review-r1.md#R1-24 —— 原子写补「临时名带 pid+随机后缀」与「fsync 父目录」两处缺失语义 -->
<!-- r1: 修订，见 design-review-r1.md#R1-17 —— project 级跨进程锁从 `.stratix/state/lock`（主仓/worktree 是两把不同的锁）移到 `$DATA_DIR/locks/<projectId>.lock`；删除兑现不了的「只读打开」降级承诺 -->

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

**发现任务规格（补齐「谁跑、在哪跑、结果放哪」）**：

| 项 | 规格 |
|---|---|
| **在哪个进程跑** | **service 进程**（存储独占 + 后台任务面；Electron 主进程只发命令不扫盘） |
| **同步还是后台** | **后台异步**，**不阻塞首帧**（Electron 侧首屏渲染「上次结果 + 增量刷新中」） |
| **三段预算** | `stat` ≤ 500 项 / `realpath` ≤ 50 项 / JSON 解析 ≤ 20 项（不是 500 项都做 realpath —— 那在冷缓存下必然超 50 ms） |
| **结果落哪** | `.stratix/state/cache/discovery.json`（带**指纹 + mtime**；命中即跳过该项） |
| **失效策略** | 指纹（根路径 + mtime + 目录项计数）变化 ⇒ 该项失效；全量刷新 ≤ 200 ms |
| **并发** | 根间并发 ≤ 2；同一根内串行 |

<!-- r1: 修订，见 design-review-r1.md#R1-25 —— 原预算只有数字，没有落点（谁跑/在哪跑/同步还是后台/结果放哪/失效策略）。补齐「发现任务规格」 -->

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
3. **找不到 marker 时回落 cwd 而不是报错**——照 dsh 原文（`packages/context/agent-instructions/src/files.ts:229` 的 JSDoc *"or `cwd` when no marker exists"*；回落代码在 `:344` `if (parent === current) return resolve(cwd)`）。发现阶段**永不失败**，只标记「未初始化」，引导交给 UI。

<!-- r1: 修订，见 design-review-r1-dsh.md#A7 —— 行号偏移修正：原文引 `files.ts:246`（函数收尾行），实际 JSDoc 在 `:229`、回落代码在 `:344` -->

> ⚠️ **两套「项目根」会分叉（dsh 侧事实，Stratix 侧的对策）**：
> dsh 内部有**两个不同的项目根查找器**——**指令侧**（`packages/context/agent-instructions/src/files.ts:232-246`）marker **可配**（`packages/context/agent-instructions/src/config.ts:11` `DEFAULT_PROJECT_ROOT_MARKERS = ['.git']`，但 `:20` `projectRootMarkers?: string[]` 可由行 config 覆盖）；**技能侧**（`packages/skill/skill-filesystem/src/index.ts:959-968`）**自己的一份**，第 962 行**硬编码** `pathExists(join(current, '.git'))`，**没有任何配置口**。
> ⇒ **Stratix 的对策**（两条，写进契约）：
> ① 生成 patch 时给 agent-instructions 行显式设 `projectRootMarkers: ['.stratix', '.git']`（这是**能对齐的一侧**）；
> ② 技能侧不可配 ⇒ **不依赖 dsh 的项目级技能根**，全部走 `customSkillDirs`（与 D6 一致）；
> ③ **不变量**：**agent 的 spawn cwd 必须是项目根，不得是子目录**（否则 `AGENTS.md` / `CLAUDE.md` 不加载；且 dsh 的 workspace 挂载校验 `realpath(header.cwd) === workspace.path` 会直接失败）。
> <!-- r1: 修订，见 design-review-r1-dsh.md#A4 —— dsh 的两个项目根查找器语义不同（一个可配一个硬编码）⇒ Stratix 必须显式对齐指令侧并锁死「cwd = 项目根」不变量 -->

**嵌套项目**：若 `a/` 内有 `.stratix`，`a/b/` 内也有 `.stratix`，则 `a/b` 是**独立项目**（就近原则，walk-up 先命中 `a/b`）。二者互不继承（`.stratix` **不做**目录级联继承——除非显式声明，见 §5.3 Q5）。

### 2.3 `.stratix` 缺失项目的引导流程

发现命中 `.git` 或回落 cwd 时，实例状态 = `needs-init`。引导分四步，**每步可中止且不留半成品**：

| 步 | 动作 | 失败处置 |
|---|---|---|
| 1. **预检** | 目录存在且是目录？可写？是否已在注册表？在排除区里？已有其它项目？**项目根 `.gitignore` 是否排除 `.env`？** | 不可写 → 拒绝并给出原因；已在注册表 → 直接切到该实例（幂等）；`.env` 未被排除 → **提示**（不自动改用户的 `.gitignore`） |
| 2. **git 决策** | 是 git 仓库？要不要 `git init`？ | 用户可跳过（非 git 项目合法） |
| 3. **写最小契约** | 只写 `project.json` + `.gitignore`（**不写** roster/history/state）。**⚠️ 若 `.stratix/project.json` 已存在 ⇒ 绝不重生成 `id`**，只补缺失字段 | 原子写；失败则清理已写文件，不留半个 `.stratix` |
| 4. **注册** | 在注册表加一条 instance 记录（稳定 id + 规范化路径 + projectId + `dev`/`ino` + `vcs` 指纹） | 写 `.stratix/state/` 内的 pending 记录，重启后可续 |

**关键设计**：

- **引导是显式动作**，发现阶段只**标记**不写盘（与 dsh 的「workspace 无静态配置文件，靠运行时 API 创建」同构：`packages/workspace/workspace/src/spec.ts` 描述的持久化在 `$DSH_HOME/storages`）。
- **引导最小化**：只写两个文件。角色、配置、任务史一律**不预生成**——避免「空壳项目」污染契约。
- **不静默 git init**：非 git 目录也允许成为项目（产品愿景里「项目 = 文件夹」，git 是可选的）。
- **`id` 永不重生成**（幂等性保证）：`.stratix/project.json` **已存在** ⇒ 只补缺失字段，**不重生成 `id`**。否则「用户删掉 `.stratix/` 后重新引导 / 换机器 / userData 被清空后从零引导」会生成新的 project id ⇒ 注册表里的旧 `projectId` 变成**悬空引用**，旧 `instanceId` 下积累的运行态行认不出来。
  - **`id` 生成算法**：`spx_` + 22 位 base62，**随机 + 碰撞检查**（不路径派生）。
  - **「id 永不变」的保证边界**：只承诺「**不重生成**」，**不承诺「跨机器唯一」**——靠 git 传播已足够。
- **悬空检测**：进大厅时校验 `project.json.id == 实例.projectId`；不一致 ⇒ 标 **`project-mismatch`**，并给出**两个显式动作**：**重新关联**（把注册表条目指向新 id）/ **迁移运行态**（把旧 `instance_id` 分区的行改挂到新 project 下）。
  <!-- r1: 修订，见 design-review-r1.md#R1-23 —— 重新引导会重生成 project id、打断既有身份：补「已存在 ⇒ 绝不重生成」+ `project-mismatch` 悬空检测 + 明确 id 生成算法与保证边界 -->
- **凭据边界检查**（步骤 1）：项目根 `.env` 是 dsh 的凭据读取位置（`<invocation cwd>/.env`），而 cwd = 项目根 ⇒ **项目根 `.gitignore` 必须排除 `.env`**（`.stratix/.gitignore` 管不到项目根）。引导时检查并提示。
  <!-- r1: 修订，见 design-review-r1.md#R1-18 —— 引导流程补一步「检查项目根 .gitignore 是否含 .env」 -->

### 2.4 多 workspace 并存

**注册表位置**：**用户数据目录**下的 `workspaces.json`——**不在 `.stratix/` 里**（注册表是**用户面**，项目契约是**项目面**；这与 dsh「配置与状态全在 `$DSH_HOME`」的分层一致）。

**路径规则（与库同一条，dev / prod 一致）**：

```
DATA_DIR 环境变量（若设）→ Electron userData/data/ → 回落 'stratix-data'（相对进程 cwd）
```

- 实测依据：`src/stratix-gateway/index.ts:116` `dataDir = process.env.DATA_DIR || 'stratix-data'`（**相对进程 cwd**）；`src/electron/main.ts:166-177` 用 `app.getPath('userData')` + `/data` 起 gateway。
- ⇒ 原设计只写 Electron 口径是**不够的**：**dev 下 gateway 是独立进程**（`scripts/restart-backend.sh` 起 `stratix-gateway`，端口 7524）⇒ 它的 cwd 与 Electron 不同 ⇒ 看不到 Electron 的 userData ⇒ 注册表与库分居两处、dev/prod 行为不同。
- **`workspaces.json` 与 `stratix.db.sqlite` 同目录**（便于一起备份 / 迁移）。

```jsonc
{
  "version": 1,
  "instances": [
    {
      "instanceId": "wsp_7a2c…",          // 稳定 id，路径移动后不变
      "projectId": "spx_9f3c…",          // 逻辑项目 id（= .stratix/project.json.id）
      "path": "/Users/kingj/code/Stratix-demo",
      "title": "Stratix 主线",
      "dev": 16777234,                    // fs.statSync().dev —— 同源判定用
      "ino": 987654321,                   // fs.statSync().ino —— 同源判定用
      "vcs": {                            // ← 【instance 级】不进 project.json（§1.3 的 R1-01 修订）
        "kind": "git",
        "commonDirFingerprint": "sha256:3b7a…"   // = git rev-parse --git-common-dir 路径的哈希
      },
      "order": 0,
      "lastOpenedAt": 1762300000000,
      "pinned": true,
      "archived": false
    }
  ]
}
```

<!-- r1: 修订，见 design-review-r1.md#R1-01 —— `vcs.commonDirFingerprint`（与 `path`、当前分支同属 instance 级事实）从 `project.json` 迁到本注册表 -->
<!-- r1: 修订，见 design-review-r1.md#R1-26 —— 注册表路径与库路径用**同一条规则**（DATA_DIR → Electron userData → 回落 stratix-data），dev/prod 一致；与 `stratix.db.sqlite` 同目录 -->
<!-- r1: 修订，见 design-review-r1.md#R1-22 —— 注册表条目补 `dev` / `ino`（`fs.statSync` 一次即可），用于「同源判定」 -->

**规则**（逐条对照 dsh 的 workspace 注册表，集成报告 §4.4）：

| 规则 | dsh 做法 | Stratix 做法 |
|---|---|---|
| **唯一性判据** | 规范路径字符串相等（`packages/workspace/workspace/src/index.ts:503-513`：`resolveByPath` / `createCanonical`） | **完全相同**：路径经 `fs.realpath` 规范化后比较 |
| **路径规范化** | 创建时经 `fs.realpath`（`:224-243`） | 同 |
| **稳定 id + 规范路径** | Workspace 类型在 `:115`，同时有 id 与 path | 同（`instanceId` + `path`） |
| **顺序 / 置顶 / 归档** | `insertBefore`（`:321`）/ `pinSession`（`:455`）/ `archiveSession`（`:365`） | 同构 |
| **会话归属校验** | 会话的 `header.cwd` 规范化后必须等于 `Workspace.path`，否则 `cannot attach session …`（`packages/workspace/workspace/src/entity.ts:110-141`） | 会话的 `projectId` + 实例路径 realpath 必须匹配，否则拒绝挂载 |
| **目录不存在时** | — | 实例标记 `missing`，不自动删；见下方「目录被移动 / 被删除」的判定算法 |

**「路径已移动」的修复入口 —— 可判定的算法**（原设计只给了名词「修复入口」，没有算法）：

| 情形 | 判定 | 动作 |
|---|---|---|
| **目录被删除** | 路径 `realpath` 失败 **且** `dev`/`ino` 也无从比对 | 条目标 `missing` **保留**，供用户手动清理（不自动删） |
| **目录被移动 / 重命名** | 在**新路径**下发现 `.stratix/project.json`，其 `id` 与注册表中某条 **`missing` 条目**的 `projectId` **相同** ⇒ 判定「同项目被移动」 | **复用原 `instanceId`**，更新 `path` / `dev` / `ino`，清掉 `missing` 标记（**不新建一条**） |
| **同源判定（辅助）** | 新旧条目的 `dev` + `ino` **都相同** ⇒ 同一 inode（硬链接 / bind mount 场景） | 同样复用原 `instanceId` |

> **为什么必须这样**：唯一性判据是「realpath 规范化后相等」⇒ 移动后的新路径与旧路径**必然不相等** ⇒ 若不补这条算法，注册表会出现「同一物理目录两条 instance 记录」，且旧的那条**永不清理**。

<!-- r1: 修订，见 design-review-r1.md#R1-22 —— 补「目录被移动 vs 被删除」的判定算法与 `dev`/`ino` 同源判定 -->

> ⚠️ **这是 Stratix 自己的注册表，不是 dsh 的 workspace 注册表**（两者**同名不同物**，不合并、不互相同步）：
> dsh 的 workspace 注册表在 `$DSH_HOME/storages`（`packages/workspace/workspace/src/spec.ts`），语义是「**一个目录 ↔ N 个并发 session**」的**导航分组**；Stratix 的 instance 是「**一个目录 = 一个执行隔离单元，同一时刻只激活一个**」。
> 形状对齐（稳定 id + realpath 唯一性）、**语义不等价**。若 Stratix 将来被嵌入 dsh 宿主，**不向 dsh 注册 workspace**（否则会把 N 个并发 session 挂到同一个（唯一活跃的）instance 上）。
> <!-- r1: 修订，见 design-review-r1-dsh.md#B6 —— instance（执行隔离单元）vs dsh Workspace（导航分组单元）语义不等价：映射表的判断语从「✅ 直接对齐」降级 -->

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
| **projectId** | 随契约传播 → 同仓库各副本**相同** | 靠注册表条目的 `vcs.commonDirFingerprint` 识别同源（**instance 级事实不进契约**，§1.3） |
| **instanceId** | 注册表分配 → 各副本**不同** | 物理身份，路径移动后不变（§2.4） |

**为什么不默认「共享同一个 `.stratix`」**：因为 `.stratix/` 若在仓库内，worktree checkout **必然**带出一份副本——想共享也做不到，除非用软链或 external path，而 dsh 的 worktree 服务明确写死了检出目录布局、Stratix 无从插手。**与其假装共享，不如把「契约共享 + 运行隔离」显式建模。**

**怎么发现「这两个 instance 是同源的」**：读**注册表**里各 instance 条目的 `vcs.commonDirFingerprint`（`= git rev-parse --git-common-dir` 路径的哈希；**不在 `project.json` 里** —— 见 §1.3 的 R1-01 修订）；一致 ⇒ 标记为「同源副本」，UI 上可提供「查看兄弟副本」。**不自动合并**，不自动同步（同步是 §5 非目标）。

<!-- r1: 修订，见 design-review-r1.md#R1-01 —— 同源指纹的读取源从 `project.json.instance.vcs` 改为注册表条目（instance 级事实不进契约） -->

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
| 项目身份 + 实例注册 | `ctx.workspaceRegistry`（稳定 id + 规范路径的多根管理器） | 集成报告 §4.4；`packages/workspace/workspace/src/index.ts:195`、`:224-243`、`:503-513` | ⚠️ **形状对齐、语义不等价**：唯一性判据同（realpath），但 dsh 的 Workspace 是**导航分组**（一个目录挂 N 个并发 session，`packages/workspace/workspace/src/README.md:8-9`），Stratix 的 instance 是**执行隔离**（同一时刻只激活一个）。**两套注册表不合并**（§2.4） |
| agent 当前落脚点 | `ctx.workingDirectory`（**可变**、per-session） | 集成报告 §4.3；`packages/session/working-directory/src/index.ts:57` | ✅ **直接对齐**：「项目身份 vs 落脚点」的**双目录模型**正是我们想要的 |
| 沙箱/权限边界 | `ctx.sandboxPolicy.workspaceRoot` **锚定不可变的 `header.cwd`** | 集成报告 §4.1 关键不变量；`packages/sandbox/sandbox-policy/src/index.ts:201` | ✅ **直接对齐**：「项目文件夹 = 沙箱根」，且**cd 不改边界** |
| `.stratix/skills/` | dsh skill provider 的 `customSkillDirs` | `packages/skill/skill-filesystem/src/index.ts:58` | ⚠️ **需补优先级约束**（D6）：走自定义根，**不复制**进 `.dsh/skills`；但 rank 300 **低于** `.dsh/skills`(100) / `.agents/skills`(200) ⇒ 必须独立命名空间 + 重名校验（§1.3 skills 段） |
| 角色定义（能力组合） | `ctx.agentPresets`（声明式能力组合，**写进 session header**） | 架构报告 §5.2 | ✅ **直接对齐**（含「resume 必须是同一 composition」的纪律） |
| 任务史（append-only JSONL） | `ctx.sessions` 的 append-only `SessionEvent` 日志 + 投影 | 架构报告 §5.1 | ⚠️ **借形状，不借真相源**（铁律 1：WorldState 真相源在 Stratix core） |
| 契约格式版本 / 迁移 | `SESSION_FORMAT_VERSION` + 相邻迁移链 + `ignorable` 标记 | `docs/session-format-status.md`；架构报告 §5.1 | ✅ **直接对齐**（§1.4） |
| `.stratix/dsh/bridge.patch.yml` | `--patch` 覆盖层（相对路径按 patch 文件目录锚定） | 集成报告 §3.5；`packages/boot/app-boot/src/index.ts:547` | ⚠️ **直接对齐，但仅在「一进程一项目」模式下成立**（`--patch` 是**进程级**启动参数，`apps/cli/src/args.ts:170`；被嵌入形态下项目级差异必须走 per-session 数据，见 §3.2 补注） |
| 项目根 `AGENTS.md` / `CLAUDE.md` | dsh 自动加载的项目指令 | `packages/context/agent-instructions/src/config.ts:12` | ✅ **直接对齐**（放在项目根，不放 `.stratix/`）；⚠️ 但**只在 cwd 恰是项目根且 marker 命中时成立** ⇒ 不变量「spawn cwd = 项目根」（§2.2 补注） |
| **既有 `projectPath` / `project_id`（仓库里的旧 project 概念）** | dsh 无对应物 | `src/stratix-gateway/agent/AgentOrchestrationService.ts:64`；`src/stratix-orchestration/task-queue/TaskQueueService.ts:84` | ❌ **不映射**（**待退役**）：形状相近但语义不同（编排层的「项目/zone」），本轮不改造，**但新代码不得复用这两个名字**（§4.1.2） |
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
| **patch**（`--patch` 覆盖层；**整段替换 config，不合并**；相对路径按 patch 文件目录锚定） | **叠加层** | `.stratix/dsh/bridge.patch.yml` 就是**项目自带的 patch 文件** | ✅ **直接映射**——这是唯一真正对上的 dsh 配置概念。⚠️ **但 `--patch` 与 profile 都是进程级的**（`apps/cli/src/args.ts:170`；`packages/boot/plugin-manager/README.md` *"Changes affect every session using the profile."*）⇒ **项目级 patch 只在「一进程一项目」（独立进程模式）下可生效**；被嵌入形态下项目级差异必须走 **per-session 数据**（`.stratix` 读取 + 工具/Remote 参数），**不得走 patch** |
| **working-directory**（`ctx.workingDirectory`，per-session 可变；cd 不改沙箱边界、不移动会话日志） | **落脚点** | Stratix 的 agent 会话落脚点；**项目身份仍由项目根决定** | ✅ **直接映射**（语义照抄：cd 只追加事件，不改项目归属） |
| **cwd / header.cwd**（不可变） | **项目身份** | `.stratix` 所在目录 | ✅ **直接映射** |

**结论一句话**：`.stratix` ↔ **project**（项目契约）；dsh profile/bundle ↔ **deployment**（部署分发）。两者**正交**，桥接点只有一个——`.stratix/dsh/*.patch.yml`。

### 3.3 桥接件的硬约束（五条）

1. **不携带凭据**。dsh 的凭据读取顺序是「启动环境 → `<invocation cwd>/.env` → `$DSH_HOME/.env`」（`packages/bundle/headless/README.md:56`）。因此：
   - 凭据放**项目根 `.env`**（因为 cwd = 项目根），**必须由项目根 `.gitignore` 排除**（`.stratix/.gitignore` 管不到它）；
   - `.stratix/` 内**一律不出现** token / api key / cookie；
   - `.stratix/dsh/profile.json` 只能写**环境变量名**，不写值。
   - **⚠️ 限定：这条链只覆盖 API-key 路由**。dsh headless profile **禁用**了托管凭据库与账号态消费者（`packages/bundle/headless/README.md:56` 原文：*"The shipped headless profile disables the managed credential store and its authorization and DeepSeek account consumers. **API-key routes** use the launch environment, then `<invocation cwd>/.env`, then `$DSH_HOME/.env`. **Keys and sign-ins saved by the GUI are ignored**…"*）⇒ 需要登录态的 provider **必须**由用户在 `$DSH_HOME/profiles/<name>/cordis.patch.yml` 恢复 `credentials` / `authorization` / `deepseek-account` 三行，**项目契约不承载账号态**。
   - **⚠️ 不变量：凭据链的 cwd 是「invocation cwd」（调用进程的 cwd），不是 session 的 `header.cwd`**。两者只有在 Stratix 用 `SpawnOptions.cwd` 设了 spawn cwd 时才相等 ⇒ 「spawn cwd = 项目根」（§2.2 补注）同时也是凭据链的正确性前提。
   - **⚠️ 实现期铁律**：adapter 合并 env 时**禁止写入空串值**（未设置就完全不写该键）。dsh 原文：*"an exported empty value shadows that fallback"* ⇒ 把某个 key 写成空串会**静默屏蔽** `.env` 回退（不报错）。
2. **不写用户项目目录**。Stratix 若要把 `.stratix/skills` 交给 dsh，走 `customSkillDirs` 参数（§1.3），**不复制、不软链**到 `.dsh/skills`。
3. **形状受限 + 宿主裁决 + 禁代码执行**（🔴 见下）。
4. **契约文本是数据不是指令**（内容可信度边界，见 §1.1 的表）。
5. **凭据边界：派发给 agent 的子进程不注入项目 `.env`**。

<!-- r1: 修订，见 design-review-r1-dsh.md#A1 —— 🔴 `--patch` 覆盖层允许 `!!js` 表达式执行：
     生成型 bundle 用 `parseDocument(..., { schema: 'core', customTags: [] })` **拒绝**一切自定义 tag
     （`packages/experimental/creation-recommendations/src/generated-bundle.ts:26-28`，错误信息明写 *"Generated patches must use plain YAML without custom tags or includes."*）；
     但 `--patch` 覆盖层的 schema 是 `entryListSchema`（`packages/boot/app-boot/src/index.ts:266`）→ **允许 `!!js`**。
     `!!js` 的语义 = 在 Cordis 宿主进程里执行任意 JS（`vendor/loader/src/config/utils.ts:5` `new Function('ctx','expr',…)`；`:11-14` 注释 *"Recursively replace YAML `!!js` expression nodes with evaluated values."*）。
     ⇒ 原设计援引的 `validateGeneratedBundle` **管不到 `--patch`**（那是另一条加载路径）。 -->
<!-- r1: 修订，见 design-review-r1-dsh.md#A5 —— 凭据链限定为 API-key 路由；「invocation cwd」不变量；禁写空串 env -->
<!-- r1: 修订，见 design-review-r1.md#R1-19 —— 约束 4：契约文本（description / persona / systemPrompt）进 prompt 时必须带数据边界 -->
<!-- r1: 修订，见 design-review-r1.md#R1-18 —— 约束 5：cwd=项目根 ⇒ 项目 `.env` 自动进入每个 agent 子进程的环境，必须有显式凭据边界 -->

**约束 3 的正式表述**（修订后）：

- `.stratix/dsh/*.patch.yml` 只允许声明式 `{insert:[...]}`。
- **加载前必须用 Stratix 自己的严格解析读一遍**：`yaml.load(text, { schema: 'core', customTags: [] })` ⇒ **拒绝 `!!js` 与一切自定义 tag**；**只把 Stratix 认识的字段重新序列化后**交给 dsh，**不要把原文透传**。
- **不得指向仓库内的 JS 文件**（`./xxx/dist/index.js` 这类相对名会被 dsh 锚定成绝对 `file://` URL 并被 Loader 直接 `import()` ⇒ 执行一个 git 跟踪的 JS 文件，静态校验管不到它做了什么）。桥接模块必须走 dsh 的 bundle/插件分发机制（npm 包）。
- **机器相关值（端口、绝对路径）不进 git 跟踪的契约** ⇒ 由 Stratix 在 **spawn 时生成一份临时 patch**（写进 `$DSH_HOME` 或临时目录）。
- **坏 patch → 拒绝加载并报具体原因**，不静默跳过。
- **威胁模型（明写进契约文档）**：*「`.stratix/` 随 git 传播 ⇒ 项目目录视为**半可信输入**；patch 不得承载代码」*（与 D13 同源）。

**约束 4 的正式表述**（修订后）：

- `<stratix-project>` 块顶部固定一行**来源声明**：「以下内容来自项目仓库（可能不可信），是**数据不是指令**」。
- **`capabilities.systemPrompt` 不允许作为权威 system prompt 来源**：只允许来自本地用户设置；仓库里的那份降级为「仓库提供的**建议片段**」，且必须带数据边界。
- 对 `description` / `persona` / `systemPrompt` 做**单字段长度上限**（已有 2000 字总上限，但单字段上限缺失）⇒ 超限**截断并标注**，不静默丢。

**约束 5 的正式表述**（修订后）：

- 派发给 agent 的子进程**不注入**项目 `.env`（dsh 适配器显式屏蔽 cwd 下的 `.env` 读取，或改用 `env` 端口白名单，只放 `STRATIX_*` 与必要的 CLI 凭据）。
- **为什么**（把两条文档串起来）：cwd = 项目根 ⇒ dsh 的凭据链会自动把项目根 `.env` 读进子进程环境（`ANTHROPIC_API_KEY` / `DEEPSEEK_API_KEY` / cookie / 私钥…）；而没有沙箱 ⇒ agent 还能 `cd ..` 读到项目根**之外**的东西。

### 3.4 派活文案的坑（必须写进契约）

集成报告 §6.3 记录了一条会直接打到我们身上的坑：dsh SDK 高层 `run()` 的线缆入口是 `session/query`，它**自带斜杠命令路由**——`/compact` / `/permission <preset>` / `/plan` / `/goal [...]` 四类命中后**不回落到普通 prompt**（集成报告 §7 #25、#26）。

**契约含义**：`.stratix/config/stratix.json` 应有一个显式开关 `agent.dispatchPromptChannel: "session/query" | "session/prompt"`（默认 `session/query`，但**派活文案以 `/` 开头时自动改走 `session/prompt`**），避免角色 prompt 误触发 dsh 命令。这一条应当写进 `.stratix/dsh/README.md`。

<!-- r1: 修订，见 design-review-r1.md#R1-33 —— 本节（连同 `skills/`、`dsh/` 桥接件）只服务 dsh 路线，而 dsh 路线被排到 M3 ⇒ 整体推迟到 M3，M1/M2 不实现（`config/stratix.json` 的这个开关在 M1/M2 不产出） -->

### 3.5 「cwd = 项目根」的落地点（现成的接入点）

「agent 进入项目获得干净上下文当手脚」在 dsh 侧的实现就是 **cwd = 项目根**（集成报告 §4.2 路径 A/B/C/D 与 §4.6 的 S6「**直接用**」）。Stratix 侧的落地点**已经存在**：

```
SpawnOptions.cwd?          src/app/services/cli-transport/transport.ts:85   // 「工作目录。」
ProcessFactory options.cwd  src/app/services/cli-transport/transport.ts:117-121（类型起于 117，options 行在 120）
runtime.ts:78               把 cwd: effective.cwd 传给进程工厂
                           ⚠️ 完整路径：src/app/services/cli-transport/runtime.ts:78
                              （不是 src/core/runtime.ts:78 —— 那里是一行 import，路径同名歧义）
node-process.ts:30,:70     工厂级 cwd，缺省继承当前进程
```

- `adapters/dsh.ts` 的 `prepare`（`:202`）**只合并 env，不碰 cwd**——dsh adapter 不需要改。
- **但全仓没有任何调用方给 `SpawnOptions.cwd` 赋值**：`task-service.ts:1027`、`:1138`、`chat-service.ts:578`、`agent-chat-service.ts:696` 都只传 `sessionId` / `timeoutMs`。⇒ **当前所有 CLI 子进程都继承宿主进程 cwd**。

<!-- r1: 修订，见 design-review-r1.md#R1-15 —— `runtime.ts:78` 路径歧义修正为 `src/app/services/cli-transport/runtime.ts:78`；`ProcessFactory` 标注 `:117-121` -->

> ⚠️ **「一处改动，全适配器受益」的适用范围**：`SpawnOptions.cwd` 覆盖的是 **cli-transport 这条派发链路**。仓库里**还有另一条链路已经在按项目传 cwd** —— `src/stratix-gateway/agent/AgentOrchestrationService.ts:64` `startAgent(agentId, projectPath, zoneId)`，`:101` / `:108` 把 `projectPath` 传进 `OpenClawAgent` / `LLMAgent`（编排语义，**不是** instance 语义）。
> ⇒ 两条链路在 M2 前**并存**；M2 时统一到 instance 维度（编排链路的退役见 §4.1.2）。
> <!-- r1: 修订，见 design-review-r1.md#R1-10 —— 「一处改动全适配器受益」不完整：core 侧不是唯一派发路径 -->

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

> **`types.ts` 这一层**：对 `workspace` / `scope` / `root` **零命中**；`project` 仅 1 处命中且是 `unit-projection.ts` 文件名里的 "pro**ject**ion"（`src/core/types.ts:259` 的注释）。**`.stratix` 概念在 core 契约层尚不存在**（仓库根无 `.stratix/` 目录，`src/` 全目录 `workspace` 零命中）——本设计的**契约层**是**从零新增**。
>
> ⚠️ **但「整个仓库没有 project 概念」是错的**：同族表 `tasks` / `conversations` 仍在写 `project_id`，编排层仍在按 `projectPath` 起 agent。**完整清点见 §4.1.2**。

<!-- r1: 修订，见 design-review-r1.md#R1-10 —— 原句「`src/` 全目录 `workspace` 零命中」被当成了「整个仓库没有 project 概念」的依据 —— 这个推断是错的。
     修正：`types.ts` 层结论仍成立（字面属实），但必须补上仓库里**活着的** project 概念清点（§4.1.2），否则「不复用旧表」的裁决只解决了表名、没解决语义。 -->

**存储现状**：**一个全局 SQLite**，位于 Electron `userData/data/`（`src/electron/main.ts:166-177` → `dataStoreService.initialize(dataDir)` → `src/stratix-data-store/StratixDataStore.ts:37-41` → `src/stratix-database/StratixDatabase.ts:103-108`，文件名 `stratix.db` + `.sqlite` 后缀 ⇒ 实际文件 `stratix.db.sqlite`；非 Electron 路径下默认 `stratix-data/stratix.db.sqlite`，相对进程 cwd）。表：`characters` / `unit_positions` / `character_tasks` / `sessions` / `session_events` / `pipelines` / `custom_agents` / `character_chat_messages` / `agent_health_events` / `exp_events` —— **全部平铺在同一库里，无项目维度**。

> ⚠️ **驱动不是 better-sqlite3**：生产驱动是 **sql.js（WASM）** 适配器（`src/stratix-database/sqlite-adapter.ts:1-18`，better-sqlite3 兼容 API）。含义有二：① 库在 service 进程内**整体驻留内存**，「大库分片」的收益有限、内存压力上升；② **存储独占铁律**（`docs/SERVICE-SPLIT-PLAN.md:101`：SQLite 只由 service 进程打开写）意味着**契约 reconcile 的写入必须走 service 进程**，不能由 Electron 侧直接落盘。

### 4.1.1 进程级单例——本设计最大的现实约束

三处**进程级单例**，且**都没有项目维度**：

| 单例 | 位置 | 持有 | 在 dsh 宿主里对应什么（B 面） |
|---|---|---|---|
| `worldStore` | `src/core/store.ts:311`（`export const worldStore = createStore()`；工厂在 `:219`） | 全部 WorldState：units / missions / characters / tasks / sessions **在同一个 store 里** | **scope-owned store**（dsh 的 `createScope` 让 scoped context 拥有它自己的一切注册） |
| `coreRuntime` | `src/core/runtime.ts:803`（`export const coreRuntime = createCoreRuntime()`） | 全部 manager 的装配（`CoreRuntimeOptions` 在 `:107-168`，**无 project/workspace 参数**） | **scope-scoped runtime**（`packages/core/scope/src/index.ts:131-146` *"The scoped context … owns every registration made through it"*） |
| 总线 emitter | `src/core/bus.ts:32`（三条固定通道 `command` / `world` / `state`；`resetBus()` 在 `:54`） | 全局事件 | dsh 的 **scoped 事件**（`packages/core/scope/src/index.ts:160-168` *"events flow up the chain, never down"*） |

<!-- r1: 修订，见 design-review-r1-dsh.md#B5 —— 「进程级单例」清单在「被兼容」语境下要加一列「在 dsh 宿主里对应什么」：
     dsh 已经给出「同进程多份隔离状态」的标准解法（scope）；Stratix 的「不做多实例」在独立进程模式成立，在插件模式下就变成了「不跟宿主的能力对齐」。 -->

**推论（直接决定 D11）**：

- 「一个进程同时跑多个项目、各自一份世界态」需要把 `worldStore` / `coreRuntime` 改成**多实例**（按 instance 分片的 store + 按 instance 装配的 runtime），这是**改 core 契约**——撞铁律 1（真相唯一，`docs/SERVICE-SPLIT-PLAN.md:96`）、铁律 2（裁决在 core，`:97`）、铁律 3（总线铁律，`:98`）。
- 而「一个进程只激活一个项目、切换项目 = 换活跃实例」**不需要改 core 契约**：活跃实例是**装配期参数**（类似现在的 `CoreRuntimeOptions` 注入），切换 = 重新装配 + 重连（对照铁律 1 的 Electron 侧语义：「重连 = 全量 snapshot 覆盖，不做增量合并」）。

⇒ **采纳 D11**：多项目并存发生在**注册表层**（可注册 N 个项目、可切换），运行期同一时刻只有**一个活跃实例**。这与 dsh 的形态同构（dsh 一个 session = 一个 cwd = 一个项目根）。**代价**：切项目要重载世界态（一次全量 snapshot 覆盖），**收益**：core 契约零改动、真相源不分裂。

> ⚠️ **D11 的适用域 = 「Stratix 独立进程模式」**（D14）：dsh 宿主**一个进程并发跑多个 session**（`packages/core/agent/src/index.ts:250` `private store = new Map<SessionId, AgentEntry>()`），每个 session 一个 scoped context；而 Stratix 的隔离单位是**进程**（一份 worldStore + 一个全局 `activeInstanceId`）。
> ⇒ 在「Stratix 被嵌入 dsh 宿主」形态下，D11 **不成立**：同宿主进程的 N 个并发 session 会**共享同一份世界态与同一个 `activeInstanceId`** —— 而这正是 160 §3.4 R3（「chat / 互聊会话不得跨副本续发」）与 D5（「副本间单位互不可见」）要禁止的事情（在独立进程模式下由「一进程一实例」兜住，在插件模式下这个兜底直接消失）。
> **正解不是「同时看两个战场」**，而是「**同一进程里每个 session scope 各有一份世界态**」⇒ 与 160 §6.2 Q1「不做同时看两个项目的战场」（那是**一个 session 内**的 UI 需求）**不冲突**，应当**单独立项**（见 §7 推迟清单「B 面：scope 级隔离」）。

<!-- r1: 修订，见 design-review-r1-dsh.md#B1 —— 🔴 D11 / D3「一进程一活跃实例」与 dsh 宿主的并发多会话模型正面冲突（插件化在当前隔离模型下不成立）：写死适用域 + 把 scope 级隔离单独立项 -->

> **待用户确认**（§5.3 Q8）：若产品要求「同时看两个项目的战场」，D11 需要让位，届时必须先解掉 core 多实例化与三条铁律的冲突——那是另一个任务，不在本设计范围内。

**历史包袱**：`src/stratix-database/StratixDatabase.ts:764-779` 里**已有一张遗留 `projects` 表**（`project_id` / `name` / `path` / `status` …）以及带 `project_id` 外键的 `channels` / `messages` / `zones` 表——这是**旧 stratix-project 概念**（CLAUDE.md 记录的 D6「stratix-project 砍掉」）。它与本设计**不是同一个东西**，但**表名会撞**。

> **必须处理的撞名**（实现期铁律）：遗留 `projects` 表是**旧语义**（一个可变的「项目行」，带 status/priority），新语义是**文件即项目**（`.stratix/project.json`）。两者不可混用。裁决见 §4.4。

### 4.1.2 既有 project / zone / projectPath 语义的清点与裁决

> **为什么要这一节**：`.stratix` 契约层确实是新增的，但**仓库里已经有一个活着的 `project` 概念**（编排层的「项目/zone」语义）。它与本设计的 `projectId`（逻辑项目）**不是同一个东西**，却**同名**。不显式裁决，将来会出现「按此条打回」把现存的合法代码也判成违规。

| 既有概念 | 位置 | 语义 | 与新 `projectId` / `instanceId` 的关系 |
|---|---|---|---|
| `projects` 表 | `src/stratix-database/StratixDatabase.ts:765` `CREATE TABLE IF NOT EXISTS projects (project_id TEXT PRIMARY KEY, … zone_config TEXT, …)` | **旧 stratix-project 概念**（可变的「项目行」，带 status / priority / zone_config） | **不复用、不删除**（§4.4 M4）；新语义只来自 `.stratix/project.json` |
| `tasks.project_id` | `src/stratix-orchestration/task-queue/TaskQueueService.ts:84` `INSERT INTO tasks (task_id, zone_id, project_id, …)` | 编排层的项目/zone 分组 | **待退役**（本轮不改造）；**新代码不得复用 `project_id` 这个名字** |
| `conversations.project_id` | `src/stratix-orchestration/messaging/AgentMessageStore.ts:58` `INSERT INTO conversations (conversation_id, type, name, zone_id, project_id, …)` | 同上 | 同上 |
| `projectPath` | `src/stratix-gateway/agent/AgentOrchestrationService.ts:64` `startAgent(agentId, projectPath, zoneId)`；`:101` / `:108` 传给 `OpenClawAgent` / `LLMAgent` | **按项目给 agent 传工作目录**的既有链路 | **待退役**；本设计的对应物是 `SpawnOptions.cwd = 活跃 instance 的 path`（§3.5 / §5.4 S6b）。两条链路 M2 前并存 |
| `chat-history-dao.ts:14` 注释 | `src/app/services/persistence/chat-history-dao.ts:14` | 「messages 表自 v1 起就是**项目/频道**聊天（`project_id` / `channel_id` 形状）」 | 历史形状说明；**新契约面不沿用** |
| `LRAService.init(projectPath, name)` | `src/stratix-gateway/lra/LRAService.ts:37-40`（`lra init --name … { cwd: projectPath }`） | 给 LRA 初始化一个工作目录 | **待退役**；新语义 = instance 路径 |

> 全仓 `project` 命中 **153** 处（排除 `projection` / 测试）；`src/stratix-orchestration` 是**接线的**（`src/stratix-gateway/index.ts:29,351` import `OrchestrationSync` / `TaskQueueService`）。

**三条裁决**：

1. **命名纪律的适用范围**：本设计的「`projectId` ⇒ 永远指逻辑项目」纪律**约束新契约面**（`src/core/types.ts` / `.stratix/` / 新 DAO 列）；**既有** orchestration 的 `project_id` / `projectPath` 属**待退役项**，本轮**不改造**，但**新代码不得复用这两个名字**。
2. **`projects` 表的处置不变**（§4.4 M4）：表本身无读写，但**同族的 `tasks` / `conversations` 表仍在写 `project_id`** ⇒ 「新语义不复用旧表」解决了**表名**，**没解决语义**。⇒ 显式记为待退役项，退役计划另开任务（§5.3 Q7）。
3. **派发链路的收敛点**：M2 时把 orchestration 的 `projectPath` 统一到 instance 维度（M1/M2 并存期不阻断）。

<!-- r1: 修订，见 design-review-r1.md#R1-10 —— 新增 §4.1.2「既有 project / zone / projectPath 语义的清点与裁决」；命名纪律补适用范围 -->

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

> **下游落地（设计 B）**：本节的「instance 维度」在 [DESIGN-project-map.md](DESIGN-project-map.md) §1.2 被展开为 core 契约的 `instanceId?: ProjectInstanceId | null` 可选字段（缺省 = 默认沙盒实例），并进一步把「一张地图 = 一个副本」落成 world 层的场景切换（该文 §2，含 BattlefieldScene 单例假设的破除点清单）。该文的命名纪律与本文一致：`projectId` ⇒ 逻辑项目，`instanceId` ⇒ 物理副本，落库列名 `instance_id`。

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
- **写入通道**：会话持久化已经收口在 `session-persister.ts`（`createSessionPersister` 在 `:75`，`dao = null` 即不落库）与 `session-reader.ts`（`:48`）——端口收口免掉的是「**每个业务调用点**」，**不是** DAO 本身。

  > **加列的真实改动面（四处 × 每张表）**：
  > ① **DAO 的 DDL**（每表 2–3 处副本，见 160 §4.5 B5）；
  > ② **DAO 的 INSERT / UPDATE 列清单**（`session-dao.ts:136-160` `upsertSessionRecord` 的 SQL **写死了 10 个列名** + `ON CONFLICT(id) DO UPDATE SET` 的字段列表）；
  > ③ **读映射**（`session-reader.ts:58` `rows.map(toSessionRecord)` / `:95` `toSessionRecord(row)`；`session-persister.ts:114` `toPersistedSession(record)` 返回**定长字段集**的对象）；
  > ④ **端口的字段传递**。
  > `session_events` 同构（`session-event-dao.ts`）。

<!-- r1: 修订，见 design-review-r1.md#R1-11 —— 「加列只需在这两个端口实现一次，不必改每个 DAO」**低估了改动面**：端口只是传字段的管道，DAO 的列清单是硬编码的。
     修正为「DDL + INSERT/UPDATE 列清单 + 读映射 + 端口字段传递」四处。 -->

### 4.4 迁移路径（不破坏现有数据）

**目标：零数据重写，零停机。**

> **步号命名约定（本设计 M 步 = 存储迁移；160 的 N 步 = instance 维度附加）**——两文各用自己的字母域，引用时必须带前缀，避免第三次引用时撞号。
> **实施期归属**：M 步由 **160 的 M2** 执行（见 160 §5.1 的分期；R1-32：M1 只有一个 instance ⇒ 六张表的 `instance_id` 在 M1 **没有任何读者** ⇒ 不在 M1 付迁移风险）。

| 步 | 动作 | 可回滚性 |
|---|---|---|
| M1 | `characters` / `character_tasks` / `sessions` / `session_events` / `exp_events` / `unit_positions` **各加 `instance_id`**（**nullable**，默认 NULL）——**六张表**（与 160 §1.3.2 N1 一致） | 加列是 SQLite 的可逆操作（保留旧列即可回退）——但**见下方回滚矩阵** |
| M2 | 旧行 `instance_id = NULL` → 语义定义为「**默认沙盒实例**」——**必须物化成一条真实 instance 记录**（`DEFAULT_INSTANCE_ID` 常量 + 注册表一条记录 + 大厅一张卡），否则历史数据**不可达**（见下方 🔴 补注） | 纯逻辑层，零数据改动 |
| M3 | core 契约加**可选**字段（`instanceId?: string`）——缺省 = 默认沙盒 | 与 `MissionBrief` / `checkpoints` 的可选字段惯例一致（`src/core/types.ts:315` 注释里写明了「加不加都行」的纪律） |
| M4 | 遗留 `projects` 表：**不删、不复用**。新语义**不复用**这张表（名字已被占用且语义不同）。新项目身份只来自 `.stratix/project.json` | 零风险；旧表继续服务旧代码路径，直到旧链路整体退役 |
| M5 | 引导：新实例创建时，其 `instance_id` 写入注册表；旧行不迁移（用户可显式执行「把默认沙盒的任务归入某项目」——**一次性迁移动作，带预览**，且必须**先把目标 instance 的 roster 物化完**再迁） | 显式、可撤销 |
| **M6** | **占位**：留给 160 后续追加的存储迁移步（**当前无内容**；160 的 N 步 ≠ M 步，两域不撞号） | — |

<!-- r1: 修订，见 design-review-r1.md#R1-06 —— ① 加列表以 160 的 **6 张表**为准回写（原文只列 4 张，少了 `exp_events` / `unit_positions`）；
     ② 补 **M6 占位**（原文 160 声称「M4–M6 已在 task_159 占位」，但 159 当时只有 M1–M5，且 M4/M5 语义与 160 的 N4/N5/N6 撞车） -->

> 🔴 **默认沙盒必须物化（补注）**：默认沙盒实例承载**全部历史数据**（`instance_id = NULL` 的 characters / character_tasks / sessions / session_events 行）。若它只是**虚拟的**（不在注册表 `workspaces.json` 里、无 `path`、不在 `WorldState.projectInstances` 里、id 是 `null`），则：大厅**没有它的卡片**（卡片逐个来自 `projectInstances`）、`project.enter` 的判据「实例存在？未归档？**路径在？**」对它**永远判否**、`activeInstanceId` 也**没有合法取值**指向它（`null` = 大厅）⇒ **M1 上线后：用户既有的角色、任务、会话既不在大厅里、也进不去**。
> **裁决（采纳 R1-04 方案 a）**：把默认沙盒**物化成一个真实 instance** —— 注册表给它一条记录（`path` = 用户当前工作目录）、`instanceId` = 固定常量 `DEFAULT_INSTANCE_ID`、大厅给它一张卡；旧行按 `instance_id IS NULL OR instance_id = '<DEFAULT_INSTANCE_ID>'` 命中；`project.enter` 的裁决为它加一条**特例**：「默认沙盒无路径校验」。

<!-- r1: 修订，见 design-review-r1.md#R1-03 / #R1-04 —— ① `null` 在兄弟字段上表达两种互斥状态（`activeInstanceId === null` 读作「大厅」，实体 `instanceId === null` 读作「默认沙盒」）⇒ 统一为：**给默认沙盒一个真实 id**，让 `null` 在所有字段上恒义 = 「未归属 / 大厅」；
     ② 默认沙盒实例**不可达** ⇒ M1 上线后存量数据全部消失 ⇒ 必须物化（注册表条目 + 大厅卡片 + 路径校验特例）。 -->

**回滚矩阵**（原文只有「加列可逆」一句，三个真问题一个没答）：

| 阶段 | 回滚动作 | 残留影响 | 用户可见后果 | **是否支持降级** |
|---|---|---|---|---|
| **M1 加列**（六表 + `instance_id`） | 旧版本代码继续跑（它的 SELECT 不含新列） | 旧代码**看到全部 instance 的行混在一起**（不分副本） | 副本列表失去分副本过滤 | ✅ **支持降级**（旧列保留即可） |
| **M2 默认沙盒物化** | 撤掉注册表条目 + 大厅卡片 | 旧行 `instance_id IS NULL` 仍按旧语义命中 | 历史数据重新「不可达」（回到今天的状态） | ✅ 支持降级 |
| **160 N4（character id 重写）** | **无降级路径** | 旧 id 已改；`unit_positions` / `character_tasks` / `sessions.participants` 已同步改写 | **旧版本代码按旧 id 找角色 ⇒ 找不到 ⇒ 角色全丢** | ❌ **不支持降级到 M1 版本，只支持前滚** |
| **契约面 v1→v2** | 契约回滚靠 git（`.stratix/` 是 git 跟踪的）✅ | `history/` 与 `state/` 是**本地态**（默认不提交）⇒ 契约回滚后本地 `history/*.jsonl` 里的 `missionId` / 角色 id 与旧契约**对不上** | 「归档了但读不回来」 | ⚠️ 契约可回滚，**本地态不可** ⇒ 回滚前须导出 `history/` |

> **必须写进 M2 前置决策**：*「N4 之后不支持降级到 M1 版本，只支持前滚」*。

<!-- r1: 修订，见 design-review-r1.md#R1-38 —— 「加列是 SQLite 的可逆操作」远不够：(a) 应用回滚时旧代码会看到全部 instance 的行混在一起、N4 之后更会「按旧 id 找角色找不到 ⇒ 角色全丢」；
     (b) 数据回滚需 id 映射表（见 160 §1.3.2）；(c) 契约回滚后本地 `history/` 与旧契约对不上。补回滚矩阵并明确「N4 之后只前滚」。 -->

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
| 项目元数据 | project | `.stratix/project.json` | ✅ 契约 | **新增**（**只放 project 级字段**；instance 级事实落注册表） |
| 项目配置 | project | `.stratix/config/` | ✅ 契约 | **新增** |
| 角色能力组合快照 | instance | session header | ✅ 运行层 | **新增**（修 dsh 发现的洞） |
| 项目注册表 | user | `workspaces.json` | ✅ 注册表 | **新增**（含 **instance 级事实**：path / dev / ino / vcs 指纹 / 默认沙盒条目） |

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
| **不做「Stratix 作为 dsh 插件被嵌入」的形态实现** | 插件形态（B 面**五层**：宿主 Service / `ctx.tools` 工具面 / `@Remote` 控制面 / 双面包客户端半边 / npm 分发单元）**已在本轮由姊妹文档定义**（[DESIGN-project-map.md](DESIGN-project-map.md) §0 D15 + §5.3.2「B 面」），但**实现**推迟：它要先解掉 **scope 级隔离**（D14 / §7 **P8**）。⇒ 本轮只冻结「**独立进程模式**」，B 面实现另立任务（§7 **P7**） |
| **不做沙箱** | dsh 有沙箱（`ctx.sandboxPolicy.workspaceRoot` 锚定不可变 `header.cwd`），Stratix 侧自建沙箱是另一个任务；M3 之前只做**凭据边界**（§3.3 约束 5） |
| **不在 M1/M2 产出 `config/permissions.json`** | 它会是一张**死契约**（无词表、无 schema、无执行点）；定型随 M3 的 dsh 桥接一起做（§7 推迟清单） |
| **不实现任何本设计的内容** | 本任务=纯文档（验收要求「不改 src/」） |

### 5.2 性能预算（`docs/PERFORMANCE_GUIDELINES.md`）

| 场景 | 预算 |
|---|---|
| 单根扫描 | ≤ 500 目录项、≤ 50 ms |
| 单次全量刷新 | ≤ 200 ms；并发根数 ≤ 2 |
| 注册表规模 | ≤ 200 条实例；未置顶的按 `lastOpenedAt` LRU 淘汰 |
| 契约文件大小 | `project.json` ≤ 64 KiB；单个 `roster/*.json` ≤ 256 KiB；`config/*.json` ≤ 64 KiB（超限**拒绝加载并报原因**，不静默截断） |
| `history/*.jsonl` | 按月分片；单片 ≤ 50 MB / ≤ 10 000 行，滚动归档 |
| **落库索引** | `instance_id` 列**一律配索引**（`characters` / `character_tasks` / `sessions` / `session_events` / `exp_events` / `unit_positions`）；「按副本过滤」是热路径，**必须走索引**，不许全表扫。索引创建属 `schema_version` 迁移的一部分（且必须落在**每一处 DDL 副本**上，见 160 §4.5 B5） |
| **`session_events` 行数上限** | 每 instance 每会话 ≤ 2 000 条；每 instance 总量 ≤ 50 000 条 ⇒ 超出**按会话滚动归档**到 `history/`。**理由**：事件表 append-only，`MAX_SESSIONS` 只管会话数不管事件数 ⇒ 行数完全无界；而生产驱动是 sql.js（WASM）⇒ **库整体驻留内存** ⇒ 无界增长直接吃内存（撞 `docs/PERFORMANCE_GUIDELINES.md`「数据不许无限增长」） |
| 迁移 | **逐行流式**，禁止整文件载入（L8 / 大文件打爆内存的教训） |
| 迁移链深度 | ≤ 8 步（超出应合并为一次重写，而不是拖长链）——**⚠️ 该预算在 M1 不适用**（迁移链随第一个 bump 才存在，§1.4.4） |
| reconcile | 契约变更 → 运行层对账 ≤ 50 ms / 每实例；增量做（按文件 mtime + 内容哈希指纹） |
| 锁 | 每 project 一把锁（**跨进程锁在 `$DATA_DIR/locks/<projectId>.lock`**，§1.5）；等待 ≤ 5 s，超时**拒绝本次写入并报具体原因**（**无只读模式**；「只读模式」是 M2 的交付物） |

<!-- r1: 修订，见 design-review-r1.md#R1-20 —— 性能预算表原本**没有一条关于落库索引**，`session_events` 也没有行数上限（事件表 append-only ⇒ 无界增长，而生产驱动 sql.js 整体驻留内存）。补两条。 -->
<!-- r1: 修订，见 design-review-r1.md#R1-17 —— 锁预算删掉兑现不了的「只读打开」降级；锁位置与 §1.5 对齐 -->
<!-- r1: 修订，见 design-review-r1.md#R1-31 —— 迁移链深度的适用范围（M1 不存在迁移链） -->

### 5.3 开放问题（**共享主表** —— 159 与 160 合并去重后的唯一来源）

> **本表是 159 与 160 的共享开放问题表**。160 的 §6.2 **只引用编号**，不重复列问题。
> **每条都有「默认值」（不拍板也能开工的那个）与「最晚拍板时点」** —— 没有这两列的开放问题**会阻塞开工**，这是本轮修订的硬要求。
> **冻结顺序**：**159 先冻 → 160 引用本表 → 两文同时落一次「已拍板」记录**。（原 160 §6.3 写「若 159 的裁决与本文冲突，以 159 为准」——那意味着 160 的内容是条件性的，冻结顺序错了会返工。）

| # | 问题 | **默认值**（不拍板也能开工） | **最晚拍板时点** | 我的建议 | 影响面 |
|---|---|---|---|---|---|
| **Q1** | `.stratix/roster/`（角色定义）**是否入 git**？ | **入 git** | M1 前 | 入 git（角色是「这个项目是什么」，副本应当一致） | 角色 reconcile、worktree 副本语义 |
| **Q2** | 主仓与 worktree **是否共享 mission 池**？ | **不共享**（按 instance 隔离；契约共享） | M1 前 | 不共享 | §2.5、§4.2 的 instance 维度 |
| **Q3** | `.stratix/history/` **是否入 git**？ | **默认不入**，提供显式开关 | M2 前 | 默认不入 + 显式开关 | JSONL 合并冲突、协作体验 |
| **Q4** | 目录名是否**固定**为 `.stratix`？ | **固定** | M1 前 | 固定（生态接口需稳定约定；dsh 那边是 `.dsh` / `.agents`） | 发现算法、文档、约定 |
| **Q5** | 是否支持**嵌套项目**（`.stratix` 内再套 `.stratix`）与契约继承？ | **支持识别、不做继承**（就近原则） | M2 前 | 同默认值 | 发现算法、配置分层 |
| **Q6** | `.stratix` 是否要支持**自定义 schema 扩展**（第三方字段）？ | 支持但**必须命名空间化**（`x-<vendor>.*`），未知字段**保留不解释** | M3 前 | 同默认值 | 生态扩展性 |
| **Q7** | 遗留 `projects` 表 + 编排层 `project_id` / `projectPath` 的最终处置 | **不删、不复用、不改造**（显式记为待退役项） | M3 前 | 本轮不动；退役计划另开 | 命名冲突、实现期撞名、§4.1.2 |
| **Q8** | **是否接受 D11**（一进程只激活一个项目实例）？ | **接受**，**且适用域 = 独立进程模式**（D14） | M1 前 | 接受 —— core 三处单例都无项目维度，多实例化撞三条铁律 | 是否需要 core 多实例化（另一个任务） |
| **Q9** | 切项目时的**未归档数据**怎么办？（mission 纯内存） | 切走前**强制归档**到 `.stratix/history/` 或提示未完成；**不做静默丢弃** | M1 前 | 同默认值 | 数据丢失风险 |
| **Q10** | **exp 是否按副本独立养成**？（原 160 Q2） | **是**（副本 = 各玩各的存档） | M2 前 | 是 —— 共享成长线会让副本语义漏气 | `characters` / `exp_events` 表结构；`grantExperience` 口径 |
| **Q11** | **agent 能否离开项目根？**（沙箱边界；原 160 Q4） | **不能离开**（与 dsh `sandboxPolicy.workspaceRoot` 对齐）；**M1/M2 不做沙箱**，但**必须做凭据边界**（§3.3 约束 5） | **M1 前**（凭据边界）/ M3 前（沙箱本体） | 不能离开 | 安全基线（CLAUDE.md 的「PermissionPolicy 默认 deny」） |
| **Q12** | **是否支持「Stratix 作为 dsh 插件被嵌入」**（B 面）？ | **本轮冻结的只有「独立进程模式」**；B 面**形态已定义但不做实现**（scope 级隔离未立项） | M3 前 | 不做实现，另立任务（§7 **P7** / **P8**） | 插件形态五层 + core 契约隔离模型返工 |
| **Q13** | **N4 的一次性 character id 重写**是否采纳？（原 160 Q3） | **采纳，但推迟到 M2**；默认沙盒实例的行不改 id | M2 前 | 采纳 + 推迟 | 四表迁移脚本；**降级不支持**（§4.4 回滚矩阵） |
| ~~Q14~~ | ~~大厅卡片由 HUD 画还是 world 画？~~（原 160 Q5） | ✅ **已按默认值裁决：HUD 画**（world 的 LobbyScene 只画背景 ⇒ world 零业务状态，铁律 1） | — | — | 160 §2.4 / §5.1 |
| ~~Q15~~ | ~~切副本的仪式动画是否可跳过？~~（原 160 Q6） | ✅ **已按默认值裁决：可跳过**，且仪式瘦身为**两拍**（R1-34） | — | — | 160 §2.2 |

<!-- r1: 修订，见 design-review-r1.md#R1-29 —— 159（9 问）与 160（7 问）合并去重为**一张共享开放问题表**（原重叠至少 4 个）；每条补「默认值」与「最晚拍板时点」两列；冻结顺序固定为「159 先冻 → 160 引用」；
     原 160 Q5 / Q6 已按默认值直接裁决，不再作为开放问题。 -->

### 5.4 后续实现路径（本任务不执行）

> **与 160 的分期对应**：本表的 S 步按 **M0 / M1 / M2 / M3** 四期归位（分期定义见 160 §5.1 的修订版）。**S6 被拆成 S6a / S6b**（R1-05）。
> **M1 任务拆分建议**（≤20 min 粒度 + 验收要点 + dsh 双面向）见 **160 §7**。

| 阶段 | 期 | 内容 | 依赖 |
|---|---|---|---|
| S1 | M0 | `.stratix` 契约读写器 + `project.json` schema + 原子写（临时名 `<name>.tmp-<pid>-<rand>` → `fsync(file)` → `rename` → `fsync(父目录)`） | 本设计冻结 |
| S2 | M1 | 发现与注册（marker walk-up + `workspaces.json` 注册表，**路径规则与库同一条**）+ 发现任务规格（§2.1） | S1 |
| S3 | M1 | 引导流程（needs-init → 初始化；**已存在的 `project.json` 不重生成 id** + `.env` gitignore 检查） | S2 |
| S4 | **M2** | 运行态加 `instance_id`（M1–M3 迁移；写入走 service 进程，遵存储独占铁律）——**⚠️ 归 M2 而非 M1**（R1-32：M1 只有一个 instance ⇒ 六表加列在 M1 没有任何读者） | S2 |
| S5 | M2 | 契约 ↔ 运行层 reconcile（roster → characters，按 instance 物化） | S4 |
| **S6a** | **M0** | **`SpawnOptions.cwd` 透传 + `cwdProvider` 端口**（默认返回 `undefined`，**行为与今天完全一致** ⇒ 零风险、可独立实施） | 无 |
| **S6b** | M1 | **`cwdProvider` 的实现从 `WorldState.activeInstanceId` 取 instance 的 `path`**（`task-service` / `chat-service` / `agent-chat-service` 派发时填 `cwd = 活跃实例的项目根` → 6 个内建 adapter + 自定义适配器一次受益，§3.5） | 160 M1（`activeInstanceId` 存在） |
| S7 | **M3** | dsh 桥接（`customSkillDirs` 挂载 + patch 相对路径解析 + 派活文案 `/` 转义）——**⚠️ 含 A1 的 `!!js` 拒绝校验** | S1、S4、**S6a**；**注意先解掉集成报告 §0.1.3 的版本钉位互斥**（`cordis ~4.0.5` → `~4.1.0`，`dsh-tools 0.2.1-rc.5` → `0.2.2-rc.1`） |
| S8 | M2 | 归档导出（missions/tasks → `history/*.jsonl`）+ 切项目时的未归档数据处置（Q9） | S4、S5 |

<!-- r1: 修订，见 design-review-r1.md#R1-05 —— 🔴 实施顺序成环：159 S6（cwd = 活跃实例的项目根）依赖 160 的 `activeInstanceId`，而 160 M1 的依赖又含 S6 ⇒ 环。
     修订：S6 拆成 **S6a**（无依赖：`SpawnOptions.cwd` 透传 + `cwdProvider` 端口，默认 `undefined`，行为与今天一致）与 **S6b**（依赖 160 M1：实现从 `activeInstanceId` 取 path）；
     160 M1 的依赖改为「S1/S2/S4/S6**a**」，并注明「S6b 由本设计提供」。 -->
<!-- r1: 修订，见 design-review-r1.md#R1-32 —— S4（加列）归 **M2**；S6a 归 M0；S7 归 M3 -->

---

## 6. 验收与测试策略（本设计的实现期验收判据）

> **为什么必须有这一节**：r1 评审发现两份文档**全文没有测试策略** —— 没有 M1/M2 的验收标准、没有回归清单、没有「怎么证明没串副本」的测试设计。而 M1 的核心风险恰恰是**串数据**（这类 bug 只能靠测试兜住）。
> **本节是 159（契约 / 注册表 / 发现 / 迁移 / 锁 / 凭据边界）侧的测试设计**；160 §5.4 有 world / world-sync 侧的对应清单，**两侧合起来才是完整验收**。

| # | 验收项 | 判据 | 层级 |
|---|---|---|---|
| **T1** | **契约读写器** | 读 `project.json`：正常 / `formatVersion` 大于当前 → **拒绝并报原始文件路径** / 缺字段 → 按「可选增补」惯例处理 | 单测 |
| **T2** | **原子写** | ① 临时文件名为 `<name>.tmp-<pid>-<rand>`（**两次并发写不互相覆盖**）；② `fsync(file)` → `rename` → `fsync(父目录)` 三步都被调用（可 mock 断言）；③ 写失败不留半截文件 | 单测 |
| **T3** | **发现（marker walk-up）** | ① `.stratix` 命中优先于 `.git`；② `.git` 是**文件**也算命中（worktree 场景）；③ 找不到 marker ⇒ 回落 cwd 并标 `needs-init`，**永不失败**；④ 嵌套 `.stratix` ⇒ 就近原则 | 单测 |
| **T4** | **引导幂等** | ① `.stratix/project.json` 已存在 ⇒ **不重生成 id**；② 注册表已有该路径 ⇒ 直接切到该实例；③ 引导中断不留半成品 | 单测 |
| **T5** | **注册表路径规则** | `DATA_DIR` > Electron userData > `stratix-data` 三档，**dev / prod 走同一条规则**；`workspaces.json` 与 `stratix.db.sqlite` **同目录** | 单测 |
| **T6** | **目录移动判定** | ① 新路径下 `project.json.id` == 某条 `missing` 条目的 `projectId` ⇒ **复用原 `instanceId`**、不新建条目；② 删除 ⇒ 条目保留标 `missing` | 单测 |
| **T7** | **跨进程锁** | 两个进程同时持同一 `projectId` ⇒ 后者等待 ≤ 5 s，超时**拒绝写入并报具体原因**（**不是**只读降级） | 集成测试 |
| **T8** | **迁移** | 新库 + v1 旧库**双夹具**，断言 `instance_id` 列在**每一处 DDL 副本**上存在（每表 2–3 处，见 160 §4.5 B5）；**必须同时覆盖「新库建表」与「旧库升级」两条路径** | 集成测试 |
| **T9** | **默认沙盒可见性** | M1 上线后：既有 characters / character_tasks / sessions / session_events **在大厅里可见、可进入**（R1-04 的核心回归） | 集成测试 |
| **T10** | **cwd 真的进了子进程** | 用**假 `ProcessFactory`** 断言 `options.cwd === activeInstance.path`（注入点可测：`node-process.ts:70` `spawnOptions.cwd ?? options.cwd`） | 单测 |
| **T11** | **凭据边界** | 派发给 agent 的子进程环境**不含**项目根 `.env` 的任何键（§3.3 约束 5）；adapter 合并 env **不写入空串** | 单测 |
| **T12** | **`--patch` 准入** | 含 `!!js` / 任何自定义 tag 的 patch ⇒ **拒绝加载并报具体原因**；合法 patch ⇒ **只重新序列化 Stratix 认识的字段**（不原文透传） | 单测 |
| **T13** | **契约文本是数据不是指令** | `<stratix-project>` 块顶部含**来源声明**；仓库里的 `capabilities.systemPrompt` 被降级为「建议片段」且带数据边界；`description` / `persona` / `systemPrompt` 超单字段上限 ⇒ **截断并标注** | 单测 |
| **T14** | **skill 重名校验** | `.stratix/skills` 与 `.dsh/skills` / `.agents/skills` 撞名 ⇒ **拒绝加载并报具体原因** | 单测 |
| **T15** | **发现任务预算** | 扫描在**后台**执行，**不阻塞首帧**；三段预算（stat ≤ 500 / realpath ≤ 50 / 解析 ≤ 20）不被突破 | 性能测试 |

<!-- r1: 修订，见 design-review-r1.md#R1-16 —— 🔴 两份文档没有任何测试策略，M1/M2 的验收判据不存在。补 §6「验收与测试策略」。 -->

---

## 7. 推迟清单（被砍掉 / 推迟的决策 —— **不留僵尸决策**）

> 本节收纳**从正文移出**的决策。**每条写明：原在哪、为什么推迟、什么时候回来、回来的触发条件。**

| # | 被推迟的决策 | 原位置 | 为什么推迟 | 什么时候回来 |
|---|---|---|---|---|
| **P1** | **相邻迁移链 / 发布记录 / 方向性读规则的完整设计** | §1.4.4（r1 前） | `formatVersion` 恒为 1 ⇒ 整套 apparatus 全是空转；且迁移目录放项目里是**错的**（迁移器必须跟读方走） | **第一次 bump `formatVersion` 的那一刻**（R1-31） |
| **P2** | **`.stratix/skills/` 与 `.stratix/dsh/` 的落地** | §1.2 契约树 | 只服务 dsh 路线，而 dsh 路线在 M3（且 rc.1 版本钉位互斥未解）⇒ M1/M2 产出的是**空壳目录**（会被提交进 git、随仓库传播、白占契约体积预算） | **M3**（R1-33） |
| **P3** | **`config/permissions.json` 的词表 / schema / 执行点** | §1.2 / §1.3 | 声明了但**无 schema、无执行点** ⇒ M1/M2 期间是一张**死契约** | **M3**（随 dsh 桥接一起定型，执行点 = 派发前裁剪工具集 / gateway 侧过滤 MCP 工具）（R1-30） |
| **P4** | **只读打开模式**（锁超时的降级路径） | §1.5 / §5.2 | 当前应用**没有只读模式** ⇒ 那是一个兑现不了的承诺 | **M2**（R1-17） |
| **P5** | **六表加 `instance_id` 的迁移实施**（含 `schema_version` 迁移） | §4.4 M1 | M1 只有一个 instance ⇒ 加列**没有任何读者** ⇒ M1 为了 M2 的需求先付 M1 的全部迁移风险 | **M2**（R1-32） |
| **P6** | **160 N4 的一次性 character id 重写实施** | 160 §1.3.2 N4 | 本设计只给口径；实施含停机窗口 / 备份 / 校验 / 回滚四步，是**独立交付物** | **M2**，且是 M2 的**前置决策**（R1-38 / R1-41） |
| **P7** | **B 面（Stratix 作为 dsh 插件被嵌入）的形态实现** | 160 §5.3.2「B 面」（**形态已定义**，五层） | r1 前形态**一层都没定义**；本轮已在 160 §5.3.2 定义五层与三条能力面，但**实现**依赖 **scope 级隔离**（D14），后者要动 core 契约最底层 ⇒ 本条推迟的是**实现**，不是定义 | **另立任务**（B3 / R1-35） |
| **P8** | **scope 级隔离**（把 `activeInstanceId` / worldStore 从进程级降到 dsh 的 session scope 级） | D14 | 与 core 三条铁律正面相撞；**不是**「同时看两个战场」，是**跨 session 隔离**，属契约层变更 | 插件化（P7）的前置条件（B1 / B5） |
| **P9** | **世界同步端口的 `port: 0`（OS 分配）支持** | 160 §4.1 | 只在「同一宿主多实例」形态下才是硬需求 | 与 P7 同批（B2） |
| **P10** | **编排链路（`projectPath` / `project_id`）的退役与统一到 instance 维度** | §4.1.2 | 本轮不改造既有代码（最小变更）；但**新代码不得复用这两个名字** | **M2**（R1-10） |
| **P11** | **五拍仪式中的后三拍**（除「名牌 → 淡出」之外的三拍） | 160 §2.2 | 仪式服务于「让用户看清发生了什么」，两拍已足够达成该目的；后三拍是**表演性开销**，且与 §5.2 性能预算冲突 | **有实测证据表明两拍不足以传达状态时**（R1-34） |

<!-- r1: 修订，见 design-review-r1.md#R1-31 / #R1-33 / #R1-30 / #R1-17 / #R1-32 / #R1-34；见 design-review-r1-dsh.md#B1 / #B2 / #B3 —— 新增「推迟清单」章节：被砍掉的决策全部从正文移出并登记在此，不留僵尸决策。 -->

---

## 附录 A：完整目录树示例

```
my-game/
├── .stratix/
│   ├── project.json          # 只放 project 级字段（instance 级事实落注册表）
│   ├── .gitignore
│   ├── roster/
│   │   ├── _index.json
│   │   ├── scout.json
│   │   └── builder.json
│   ├── config/
│   │   ├── stratix.json
│   │   └── permissions.json      # ⚠️ M3 才产出（M1/M2 不创建）
│   ├── skills/                   # ⚠️ M3 预留（M1/M2 不创建）
│   │   ├── recon/SKILL.md
│   │   └── build-order/SKILL.md
│   ├── history/
│   │   ├── missions-202611.jsonl
│   │   └── tasks-202611.jsonl
│   ├── dsh/                      # ⚠️ M3 预留（M1/M2 不创建）
│   │   ├── profile.json
│   │   ├── bridge.patch.yml
│   │   └── README.md
│   └── state/
│       ├── lock                  # 本目录内进程锁（不承担 project 级互斥）
│       └── cache/
├── AGENTS.md
├── CLAUDE.md
├── .env                      # 凭据（必须由**项目根 .gitignore** 排除）
├── .gitignore                # ← .env 的排除责任在这里（不是 .stratix/.gitignore）
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
| 会话持久化已收口在 `session-persister.ts` / `session-reader.ts` 两个端口 | `src/app/services/persistence/session-persister.ts:75`、`session-reader.ts:48` | §4.3（端口收口免掉业务调用点，**不免 DAO**：加列 = DDL + INSERT/UPDATE 列清单 + 读映射 + 端口字段传递） |
| **`--patch` 覆盖层允许 `!!js` 表达式执行**（生成型 bundle 的 `validateGeneratedBundle` 管不到它） | `packages/boot/app-boot/src/index.ts:266,576`；`vendor/loader/src/config/utils.ts:5-14` | §3.3 约束 3（禁 `!!js` + 重新序列化）；D13（威胁模型） |
| **skill rank：`.dsh/skills`=100 / `.agents/skills`=200 / `customSkillDirs`=300（数字小的赢）** | `packages/skill/skill-filesystem/src/index.ts:35-37,256-260`；`packages/skill/skill/src/index.ts:78,808` | §1.3 skills 段（独立命名空间 + 重名校验） |
| **dsh 的两个项目根查找器：指令侧 marker 可配 / 技能侧硬编码 `.git`** | `packages/context/agent-instructions/src/config.ts:11,20`；`packages/skill/skill-filesystem/src/index.ts:959-968` | §2.2 补注（`projectRootMarkers` + 「cwd = 项目根」不变量） |
| **headless profile 只对 API-key 路由走凭据链；GUI 保存的登录态被忽略** | `packages/bundle/headless/README.md:56` | §3.3 约束 1（限定 + 账号态恢复说明） |
| **dsh 的迁移目录是编译期静态的（build-static codec + catalog）** | `packages/session/session-format/src/catalog.ts:25,37-39` | §1.4.4（迁移以代码为准；正确性判据 = 从 0 到 current 每个版本都有形态） |

---

## 附录 C：评审意见逐条下落表（修订 / 反驳 / 推迟）

<!-- r1: 新增（task_164 requirement 1/4）—— **本表是两份评审报告（42 + 15 = 57 条）的全量主表**。
     三选一：**修订** = 已改正文（给落点）／**反驳** = 书面反驳（给理由）／**推迟** = 移入推迟清单（给去处）。
     「落在哪份文档」列标明该条主要落在 159（本文）/ 160（[DESIGN-project-map.md](DESIGN-project-map.md)）/ 两份都落。 -->

### C.1 R1 主评审（42 条）—— 全量

| # | 等级 | 一句话 | 下落 | 落在哪 | 落点 / 理由 |
|---|---|---|---|---|---|
| **R1-01** | 🔴 | instance 级数据被放进 git 跟踪的契约文件 | **修订** | 两份 | 159 §1.3 —— `instance` 整块迁出 `project.json`（`vcs` / `commonDirFingerprint` 落注册表）；160 §3.3.3 分支/路径来源改口 |
| **R1-02** | 🔴 | 核心命令的语义要求 core 做 IO | **修订** | 160 | 160 §1.2.5 **端口注入** + 失败语义表；§2.2 执行侧；§4.5 **B1′** |
| **R1-03** | 🔴 | `null` 在兄弟字段上表达两种互斥状态 | **修订** | 两份 | 159 §4.4 M2 + 160 §1.2.1/§1.2.3 —— 默认沙盒给**真实 id** `DEFAULT_INSTANCE_ID`；`null` 恒义 = 未归属 |
| **R1-04** | 🔴 | 默认沙盒实例不可达 ⇒ M1 上线存量数据全消失 | **修订** | 两份 | 159 §4.4 M2 + 160 §2.4「默认沙盒卡」六项口径 |
| **R1-05** | 🔴 | 实施顺序成环 | **修订** | 两份 | 159 §5.4 —— **S6 拆 S6a/S6b**；160 §5.4 依赖矩阵修正① |
| **R1-06** | 🟡 | 加列表与迁移步编号两处不一致 | **修订** | 两份 | 159 §4.4 加列表回写为 **6 张表**；160 §1.3.2「步号分层纪律」（M 步 / N 步） |
| **R1-07** | 🟡 | `ProjectStatus` 放错类型，无人生产无人消费 | **修订** | 160 | 160 §1.2.1 —— status 下移到 `ProjectInstanceView` |
| **R1-08** | 🟡 | 一次切换有两个信号源，顺序会打架 | **修订** | 160 | 160 §1.2.5 —— 唯一权威信号 = `project.changed`；§2.5 破除点 #23 |
| **R1-09** | 🔴 | 「`scene.start` 会重建场景实例 ⇒ 天然重建」是错的 | **修订（附一处纠正）** | 160 | 160 §2.5 头号前提修正 + 真值表 + #2/#3/#4/#21。⚠️ **纠正**：`speechBoard` 在 `create()` 里 new ⇒ **会**重建，不受影响 |
| **R1-10** | 🔴 | 「`project` 仅 1 处命中」不成立 | **修订** | 两份 | 159 §4.1.2 新增清点表（8 行）+ 三条裁决；159 §3.5 补「一处改动全适配器受益」不完整；命名纪律补适用范围；160 §1.3.1.1 同表 |
| **R1-11** | 🟡 | 「加列只需在端口实现一次」低估改动面 | **修订** | 两份 | 159 §4.3 —— 加列 = **DDL + INSERT/UPDATE 列清单 + 读映射 + 端口字段传递**（四处同步）；160 §4.5 B6 |
| **R1-12** | 🟡 | 「每张表两份 DDL」实为三份 | **修订** | 160 | 160 §4.5 **B6**（DAO / `createTables` / `migrate*` 三处） |
| **R1-13** | 🟡 | 破除点表行号系统性偏移 | **修订** | 160 | 160 §2.5 全表重校 + 核验基线头注 |
| **R1-14** | 🔴 | 「场景表只装了一个场景」不成立 | **修订** | 160 | 160 §2.5 **#9** —— `FxAssetScene` 常驻，不打断 |
| **R1-15** | 🟢 | `runtime.ts:78` 路径歧义 | **修订** | 两份 | 159 §3.5 + 160 §3.2 —— 写全 `src/app/services/cli-transport/runtime.ts:78` |
| **R1-16** | 🔴 | 两份文档没有任何测试策略 | **修订** | 两份 | 159 §6 新增 **T1–T15**；160 §7 每条任务带验收要点 |
| **R1-17** | 🔴 | 跨进程锁对「主仓 vs worktree」主用例无效 | **修订** | 159 | 159 §1.5 —— 锁移到 `$DATA_DIR/locks/<projectId>.lock`；`.stratix/state/lock` 降级为目录内进程锁；删掉兑现不了的「只读打开」（⇒ P4） |
| **R1-18** | 🔴 | cwd = 项目根 ⇒ 项目 `.env` 自动进入每个 agent 进程 | **修订** | 两份 | 159 §1.2 / §2.3（引导检查 `.gitignore` 含 `.env`）/ §3.3 **约束 5**（凭据边界）；160 §3.2 同口径 |
| **R1-19** | 🟡 | 契约面是不可信输入，却被原样灌进 prompt | **修订** | 两份 | 159 §1.1 加「内容可信度」列（契约 = 可读但不可信，来自 VCS）；§1.3 `systemPrompt` 降级；§3.3 **约束 4**（数据边界）；160 §3.3.3 来源声明行 + 单字段上限 + 注入特征过滤 |
| **R1-20** | 🟡 | 落库层没有索引预算；`session_events` 无行数上限 | **修订** | 两份 | 159 §5.2 补两行（`instance_id` 一律配索引 / `session_events` 行数上限 + 滚动归档）；160 §1.4 B4b |
| **R1-21** | 🟡 | 「落库层按 instance 分组判配额」对 missions 不成立 | **修订** | 160 | 160 §1.4 拆成「① 内存池（不需 `group by`）/ ② 落库表总量上限（新增）」；§4.5 拆 B4a/B4b |
| **R1-22** | 🟡 | 目录被移动 / 注册表漂移没有算法 | **修订** | 159 | 159 §2.4 补判定算法（`dev`/`ino` 同源判定、目录移动 vs 删除）；注册表条目补 `dev`/`ino` |
| **R1-23** | 🟡 | 重新引导会重生成 project id，打断既有身份 | **修订** | 159 | 159 §2.3 —— 「已存在 ⇒ **绝不重生成**」+ `project-mismatch` 悬空检测 + id 生成算法与保证边界 |
| **R1-24** | 🟡 | 原子写的并发与崩溃语义缺失 | **修订** | 159 | 159 §1.5 —— 临时名 `<名>.tmp-<pid>-<rand>` + `fsync(file)` → `rename` → `fsync(父目录)` |
| **R1-25** | 🟡 | 扫描预算没有落点（谁跑/在哪跑/结果放哪/失效策略） | **修订** | 159 | 159 §5.2 补「发现任务规格」四栏 |
| **R1-26** | 🟡 | 注册表路径与库路径规则不一致，dev 下落空 | **修订** | 159 | 159 §2.4 —— 注册表路径与库路径**同一条规则**（DATA_DIR → Electron userData → 回落 stratix-data） |
| **R1-27** | 🟡 | 「加 instanceId 即破坏性 ⇒ 必须升协议版本」结论过强且自相矛盾 | **修订（采纳方案 a，推翻原结论）** | 160 | 160 §4.1 —— `instanceId?` 可选 ⇒ **协议版本保持 2**；老客户端降级行为写明 |
| **R1-28** | 🟡 | 「一进程一活跃实例」与「客户端按 instance 订阅」两头都写了一点 | **修订（采纳方案 a）** | 160 | 160 §4.1 —— `instanceId` 只做记账与校验，**不做路由**；`command.forward` 不带 `instanceId`；选项 (b) ⇒ 160-Q18 |
| **R1-29** | 🟡 | 16 个待拍板点，去重/默认值/最晚拍板时点全缺 | **修订** | 两份 | 159 §5.3 —— **共享主表**（Q1–Q15，每条带默认值 + 最晚拍板时点）；160 §6.2 只引用编号 + 5 条本设计特有 |
| **R1-30** | 🟢 | 权限预设没有 schema、没有执行点 —— 一张死契约 | **推迟** | 159 | 159 **§7 P3** —— M1/M2 不产出 `config/permissions.json`（避免死契约）；M3 随 dsh 桥接定型 |
| **R1-31** | 🟡 | 迁移 apparatus 在 formatVersion 恒为 1 时空转，迁移目录放错地方 | **修订** | 两份 | 159 §1.4.4 —— M1 只实现两条读规则，链本身推迟；迁移目录**移回代码里**（§1.4.4「迁移以代码为准」）；159 **§7 P1** |
| **R1-32** | 🔴 | M1 不是「最小」：LobbyScene 与六表 DDL 迁移都不该在 M1 | **修订** | 两份 | 159 §5.4 S 步按 **M0/M1/M2/M3** 归位（S4 → M2、S6a → M0）；160 §5.1 拆 M0/M1/M2；159 **§7 P5** |
| **R1-33** | 🟡 | `skills/` 与 `dsh/` 桥接件应整体推到 M3 | **修订** | 159 | 159 §1.2 目录树标注「M3 预留，M1/M2 不创建」+ 契约面清单收窄；159 **§7 P2** |
| **R1-34** | 🟢 | 五拍仪式可砍到两拍 | **修订** | 160 | 160 §2.2 —— 两拍（名牌 → 淡出）；另三拍 ⇒ 159 §7 **P11** |
| **R1-35** | 🔴 | 漏掉真正卡 M1 的两个阻断点 | **修订** | 160 | 160 §4.5 —— B 列表 5 → **7 条**（新增 **B0 表现态残留 / B1′ IO 分层**，均 M1） |
| **R1-36** | 🟡 | M1 风险表缺三项 | **修订** | 160 | 160 §5.1 风险表补三项（含「大厅缺省画什么」「站位种子 fallback 缓解不成立」）；§1.2.2 空态口径 |
| **R1-37** | 🟡 | 依赖矩阵自相矛盾（M2 依赖了 M3 的内容） | **修订** | 160 | 160 §5.4 —— M1 去掉 S4、**M2 去掉 S7** |
| **R1-38** | 🔴 | 回滚方案只答了「加列可逆」 | **修订** | 两份 | 159 §4.4 **回滚矩阵**（阶段 × 动作 × 残留 × 后果 × **是否支持降级**）；160 §1.3.2 同矩阵 + 160-Q20 |
| **R1-39** | 🔴 | id 重写的三条缓解里有两条不可执行 | **修订** | 160 | 160 §1.3.2「N4b 的可判定规则」三条逐条改写（默认沙盒 id 不改 + 禁解析 id 字符串 / `participants` 是 JSON blob / 映射表落**库内**） |
| **R1-40** | 🔴 | id 重写会顺手打破 R3「跨副本禁止 resume」 | **修订（采纳方案 b）** | 160 | 160 §1.3.2 —— `externalSessionId` 独立成表 `session_external_refs`（主键 `(external_session_id, instance_id)`）；§3.4 R3 判据升级；160-Q16 |
| **R1-41** | 🟡 | 一次性重写的停机窗口、校验与失败恢复没定义 | **修订** | 160 | 160 §1.3.2「N4b 的迁移验收清单」六步 + 四条校验；§5.2 把「迁移 + 校验脚本」列为交付物；159 §7 P6 |
| **R1-42** | 🟢 | 「把默认沙盒的任务归入某项目」缺预览与前置条件 | **修订** | 两份 | 160 §1.3.2 **N7** —— 带预览 + 必须先完成 N6 物化；159 §4.4 M5 同口径 |

### C.2 dsh 双面评审（15 条）—— 全量

| # | 等级 | 一句话 | 下落 | 落在哪 | 落点 / 理由 |
|---|---|---|---|---|---|
| **A1** | 🔴 | `--patch` 覆盖层允许 `!!js` 表达式执行，设计的静态校验没覆盖 | **修订** | 159 | 159 §3.3 **约束 3** —— 显式拒绝 `!!js` 与一切自定义 tag；**用 Stratix 自己的严格解析读一遍、只把认识的字段重新序列化**（不原文透传）；159 §0 **D13** 威胁模型；修正对 `validateGeneratedBundle` 的援引口径（它管的是 bundle 生成，不是 `--patch`） |
| **A2** | 🟡 | patch 示例引用不存在的目录 + 端口自相矛盾（7797 vs 7524）+ 机器相关值进 git | **修订** | 两份 | 159 §1.3 —— patch 只放**声明式行**（指向已安装的 npm bundle 行），**不指向仓库内 JS 文件**；机器相关值由 Stratix 在 spawn 时生成临时 patch；端口口径统一到 **7524**（删 7797） |
| **A3** | 🟡 | `.stratix/skills` rank 300 < 项目根 100/200，同名技能被抢走 | **修订** | 159 | 159 §1.3 skills 段 —— 独立命名空间 + **重名校验**（撞名即拒绝加载并报具体原因）；§3.1 映射表判断语从「✅ 直接对齐」降级 |
| **A4** | 🟡 | 两套「项目根」会分叉（skill 侧硬编码 `.git`，指令侧可配） | **修订** | 两份 | 159 §2.2 —— 生成 patch 时显式设 `projectRootMarkers: ['.stratix', '.git']`；技能侧不可配 ⇒ 全走 `customSkillDirs`；**锁死「agent 的 spawn cwd 必须是项目根」不变量** |
| **A5** | 🟡 | 凭据链只对 API-key 路由成立；空串 env 会屏蔽 `.env` 回退 | **修订** | 159 | 159 §3.3 **约束 1** —— 限定 API-key 路由 + 账号态恢复说明；写明「凭据链的 cwd 是 **invocation cwd**」并声明与 `SpawnOptions.cwd` 的一致性是**不变量**；**禁写空串 env** |
| **A6** | 🟢 | dsh 的迁移链无下限、目录是编译期静态的 | **修订** | 两份 | 159 §1.4.4 —— 「**正确性判据 = 从 0 到 current 每个版本都有形态**」；迁移以**代码**为准，`.stratix/format-catalog.json` 降级为记录/审计用伴随文件 |
| **A7** | 🟢 | 3 处 path:line 偏差 | **修订** | 两份 | 159 §1.3 / §2.2 / §3.5 与 160 §3.5 / §3.6 —— 行号改到 HEAD 实际值 |
| **B1** | 🔴 | D11「一进程一活跃实例」与 dsh 宿主的并发多会话模型正面冲突 | **修订** | 两份 | 159 §0 **D14** 写死适用域；160 §0 D3 + §5.3.2「B1/B5：隔离模型返工」四条裁决；160-Q18；159 §7 **P8** |
| **B2** | 🔴 | world-sync 固定端口在嵌入形态下必然冲突（dsh 有 `port: 0`） | **修订** | 两份 | 160 §4.1 + §5.3.2「B2」；160-Q19；159 §7 **P9** |
| **B3** | 🔴 | 真正的 dsh 插件有四层形态，设计的 B 面一层都没有 | **修订** | 160 | 160 §0 **D15** + §5.3.2「B 面」整节（**五层**：宿主 Service / 模型可见工具 / `@Remote` 控制面 / 双面包 / npm 分发）；159 §7 **P7** |
| **B4** | 🟡 | 能力面未定义：`stratix_world_snapshot` 是 MCP 而非 dsh 原生工具 | **修订** | 160 | 160 §5.3.2「能力面三层」表（A 面 MCP / B 面原生）；`.stratix/dsh/profile.json` 的 `mcpServers` 定义为 **Stratix 私有形状** + 到 dsh 行的翻译规则 |
| **B5** | 🟡 | core 单例 vs 嵌入：dsh 已给出 scope 标准解法 | **修订** | 两份 | 159 §4.1.1「进程级单例」清单加一列「**在 dsh 宿主里对应什么**」；160 §5.3.2 四条裁决（scope-owned store / scope-scoped runtime / scoped 事件 / scope-scoped façade） |
| **B6** | 🟡 | instance（执行隔离）vs dsh Workspace（导航分组）语义不等价 | **修订** | 两份 | 159 §3.1 映射表判断语从「✅ 直接对齐」降级为「⚠️ 形状对齐、语义不等价」；160 §2.4「两个注册表的关系」+ §6.1「不向 dsh 注册 workspace」 |
| **B7** | 🟡 | `--patch` / profile 是进程级 ⇒ 项目级桥接件无处安放 | **修订** | 两份 | 159 §3.2 结论句补「项目级 patch 只在**一进程一项目**下可生效；被嵌入形态走 per-session 数据」；160 §5.3.2「B7」；§6.1 同口径 |
| **B8** | 🟢 | 可借用的现成 seam：`ctx.forge` | **推迟（登记为开放问题）** | 160 | 160 §5.3.2「B8」+ **160-Q17**（默认值 = **不映射**，并写明「为什么」：派单对象是本地 agent 而非代码宿主；将来若造工作请求语义**必须复用 forge 的形状**而非平行造一套）⇒ **不是默默跳过** |

### C.3 三类「非修订」的留痕（汇总）

**（a）评审不完全正确、已书面纠正的（4 处）**

| 评审处 | 评审的说法 | 处置 | 理由 |
|---|---|---|---|
| R1-09 子项 | `speechBoard` 是字段初始化器 ⇒ 气泡板跨副本 | **纠正该子项** | 实测 `BattlefieldScene.ts:182` 声明、`:300` 在 `create()` 里 new ⇒ **`scene.start` 会重建它** ⇒ 不受影响。其余四个全盘采纳 |
| R1-09 前提 | 「`scene.start` 会重建场景实例」 | **推翻前提** | 评审自己的实测成立 ⇒ 原设计前提作废 ⇒ 全部破除点改为「`init()` 显式 reset」 |
| R1-27 结论 | 「加 `instanceId` ⇒ 破坏性 ⇒ 必须升协议版本」 | **推翻结论，采纳诊断** | 字段可选 ⇒ 老客户端零改动 ⇒ 不升版本。评审指出的「结论过强 + 同段自相矛盾」被采纳 |
| R1-38(b) | 「N4 之后没有旧 id 可回退」 | **部分采纳 + 补强** | 成立；本文补「**映射表必须与库同寿命**」⇒ 落库而非 gitignore 的本地态 |

**（b）推迟的 —— 分两级登记，完整表见 §7（P1–P11）**

*整条推迟（该条意见的下落 = 推迟，共 2 条）*

| 意见 | 去处 | 回来的条件 |
|---|---|---|
| **R1-30** 权限预设无 schema / 无执行点 | §7 **P3**（`config/permissions.json` 词表 / schema / 执行点） | M3 随 dsh 桥接定型 |
| **B8** `ctx.forge` seam 是否映射 | 160 **§6.2 Q17**（默认值 = 不映射，并写明理由） | 若将来造「工作请求」语义，**必须复用 forge 的形状** |

*主条修订、子项推迟（子项进 §7，共 9 条）*

| 意见 | 修订的部分（正文已改） | 推迟的子项（去处） |
|---|---|---|
| R1-31 | 迁移目录移回代码里；M1 只实现两条读规则 | 迁移链本体 ⇒ **P1** |
| R1-32 | 相位重排为 M0/M1/M2/M3 | 六表加列的实施 ⇒ **P5** |
| R1-33 | 契约树标注「M3 预留」 | `skills/` + `dsh/` 目录落地 ⇒ **P2** |
| R1-34 | 仪式瘦身为两拍 | 后三拍 ⇒ **P11** |
| R1-17 | 锁移到 `$DATA_DIR/locks/` | 「只读打开」降级路径 ⇒ **P4** |
| R1-10 | 清点表 + 三条裁决 + 命名纪律 | 编排链退役 ⇒ **P10** |
| R1-38 / R1-41 | 回滚矩阵 + 迁移验收清单（口径已给全） | N4 一次性重写的**实施** ⇒ **P6** |
| B1 / B5 | D14 写死适用域 + 四条隔离裁决 | scope 级隔离的实施 ⇒ **P8** |
| B3 / B2 | 五层形态已定义（160 §5.3.2）+ `port: 0` 口径 | 形态实现 ⇒ **P7**；`port: 0` 实施 ⇒ **P9** |

**（c）明确「不做 / 另立任务」的（不是跳过，是有出处的裁决）**：

| 项 | 出处 | 理由 |
|---|---|---|
| world-sync 的**按 instance 路由** | 160 §4.1（作废原适配点 #2） | R1-28 —— 单活跃实例下不需要；真要支持 = 撞 D3 与三条铁律 ⇒ 160-Q18 |
| `command.forward` 携带 `instanceId` | 160 §4.1（作废） | 同上 |
| 协议版本 2 → 3 | 160 §4.1（作废） | R1-27 —— 字段可选 ⇒ 不需升版本 |
| 双面包（浏览器侧插件半边） | 160 §5.3.2 第 ④ 层 | M3 只做 node 半边；浏览器 UI 需求未立项 |
| 既有 orchestration `project_id` / `projectPath` 的改造 | 159 §4.1.2 / 主表 Q7 | 本轮不改造（最小变更）；**新代码不得复用这两个名字** |

### C.4 统计

| 类别 | 条数 | 备注 |
|---|---|---|
| **修订**（含采纳但纠正） | **55** | R1 主评审 41 + dsh 14；每条给正文落点 |
| **整条推迟** | **2** | R1-30（→P3）、B8（→160-Q17） |
| — 其中：主条修订 + 子项推迟 | 9 | 见 C.3(b) 第二表 |
| **书面反驳 / 纠正留痕** | **4 处** | R1-09 子项 / R1-09 前提 / R1-27 结论 / R1-38(b) —— **已含在上述 55 条内**（「采纳但纠正」不另计条目） |
| **合计** | **57 条全部有下落** | 42（R1）+ 15（dsh），**零沉默跳过** |

> **核对口径**：🔴 16 + 🟡 22 + 🟢 4 = 42（R1）；A 面 7（🔴1/🟡4/🟢2）+ B 面 8（🔴3/🟡4/🟢1）= 15（dsh）。
> **🔴 全修**：R1 的 16 条 🔴 与 dsh 的 4 条 🔴（A1/B1/B2/B3）**共 20 条全部已改正文**，无一条整条推迟、无一条反驳。
> **🟡 逐条裁决**：22 条全部有「修订或书面反驳」二选一的明确下落；R1-27 是唯一的「推翻原结论、采纳诊断」条目。
> **🟢 酌情**：4 条（R1-15/30/34/42）+ A6/A7/B8 全部有下落；仅 R1-30 与 B8 是整条推迟。
