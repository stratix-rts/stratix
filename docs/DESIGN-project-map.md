# DESIGN-project-map —— 项目 = 副本：Project 实体 / 多地图实例 / agent 干净上下文进入（设计 B）

> 状态：**草案，待冻结**（设计冻结需用户过目；本任务只交文档，不含实现）
> 任务：task_160。依赖：task_157（`docs/research/dsh-architecture.md`）、task_158（`docs/research/dsh-integration-map.md`）、**task_159（`docs/DESIGN-workspace.md`）**
> dsh 参照版本：只读仓库 `/Users/kingj/code/deepseek-harness`，**HEAD `fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`**（`@deepseek-ai/dsh-root@0.2.2-rc.1`）。开工前置已执行 `git pull`，结果「已经是最新的」—— HEAD 与 task_158 报告所注 HEAD **完全一致**，task_157 报告所注 HEAD（`ce7073d5`）更早、差异面见 §3.6
> 原则出处：`docs/SERVICE-SPLIT-PLAN.md` 七铁律（尤其铁律 1：WorldState 真相源在 Stratix core；铁律 3：总线铁律）；`docs/PERFORMANCE_GUIDELINES.md`
> 本任务**未修改任何 `src/` 代码**（纯设计文档）
> **姊妹文档**：[DESIGN-workspace.md](DESIGN-workspace.md)（设计 A，task_159）—— 本文档的「项目」概念**直接建立在它的 `.stratix` 目录契约之上**，接口互引见 §1.5 与 §6.3

---

## 0. 决策摘要（TL;DR）

**一句话**：把「每个项目是一张独立地图（游戏副本）」从愿景变成三层落点——**契约层**（`.stratix` 目录，task_159 已定）+ **实体层**（`Project` / `ProjectInstance` 进入 core 契约，实体挂 project）+ **世界层**（一图一 project 的场景切换与大厅态）；agent 进入副本 = **cwd 绑定项目文件夹 + 上下文注入协议升级 + 退出不携带**。

十四条关键决策：

| # | 决策 | 依据 |
|---|---|---|
| D1 | **不造第三个身份层**：沿用 task_159 的两层身份 —— **project（逻辑，`project.json.id`，随 git 传播）** + **instance（物理，一个目录，注册表一条稳定记录）**。所谓「一张地图 = 一个副本」= **一张地图 = 一个 instance** | task_159 §0 D2；§2.5 |
| D2 | **战场地图 ≡ ProjectInstance**：world 层的「副本」不是新实体，是 instance 的运行时投影。**副本 = 目录 = 地图 = 一份运行态**，四者同一物 | 产品愿景「项目 = 文件夹 = 游戏副本」 |
| D3 | **一进程同时只激活一个 instance**（运行期），多副本并存发生在**注册表层**。切副本 = 换活跃实例 + **全量重载世界态**（重连语义：snapshot 覆盖，不做增量合并） | task_159 §0 D11 / §4.1.1（core 三处单例 `worldStore` / `coreRuntime` / bus 均无项目维度）；铁律 1 |
| D4 | **大厅态 = workspace 总览**，是一个**独立的世界场景**（`LobbyScene`），不是一个 HUD 屏位。大厅态下 `activeInstanceId = null`、战场单位为空 | 产品愿景「大厅态 = workspace 总览」；§2.4 |
| D5 | **「副本间单位互不可见」由「一进程一活跃实例 + 切换即全量重载」保证**，**不靠"隐藏"实现**（隐藏 = 两份状态同时在内存 = 真相分裂，撞铁律 1） | 铁律 1；§2.3 |
| D6 | **Project 实体进 core 契约**：`ProjectView`（逻辑项目）+ `ProjectInstanceView`（物理副本）+ `WorldState.projects` / `projectInstances` / `activeInstanceId` 三个**可选增补字段**；命令侧加 `project.enter` / `project.exit` | core 契约增补一律走「可选增补」惯例（`src/core/types.ts:1119-1124`）；总线铁律 |
| D7 | **mission / task / session / character 运行态 / unit 全部挂 instance 维度**：加 `instanceId?: ProjectInstanceId \| null` 可选字段，缺省 = 默认沙盒实例 | task_159 §4.4 M1–M3 迁移路径；§1.4 |
| D8 | **characters 归 project 还是全局？——「定义归 project，运行态归 instance」**：`roster/` 里的角色**身份与能力组合**是契约（project 级）；`characters` 表里的 level / exp / 位置 / `externalSessionId` / `contextEnabled` 是**运行态（instance 级）**。同一个角色在两个副本各有**一份独立养成** | task_159 §4.3 已定「拆成契约与运行态两份」；本设计细化到「副本独立养成」；§1.3.3 |
| D9 | **character 行 id 改为 instance 内唯一**（`chr_<instanceId>_<roleId>`），新增 `role_id` 列 —— 这样 **unit id 格式不用改**（unit id = `CHARACTER_UNIT_ID_PREFIX + character.id`，`src/core/character/unit-projection.ts:42`），`unit_positions` 表主键也不用改 | §1.3.3；破除点 #14 |
| D10 | **agent 干净上下文进入 = 三件事**：① `SpawnOptions.cwd` = 项目根（接线点已存在但全仓无人赋值，task_159 D12）；② 上下文注入协议**从五区块演进为六区块**（新增 `<stratix-project>` 块，内容从 `.stratix` 读出）；③ **退出不携带**（任务会话一次性 + chat 会话不跨副本续发） | task_159 §3.5 / §5.4 S6；§3 |
| D11 | **项目上下文块的位置**：插在【角色设定】之后、**【引用会话】之前**（项目是最外层作用域：先知道自己站在哪个副本里 → 再看要接的那段历史 → 再看战场现状 → 最后看指令） | 现有顺序 `src/app/services/task-service.ts:280-290`；§3.3 |
| D12 | **上下文注入走 app 层，零 IO 纯函数 + provider 端口**，形状照抄 `src/app/services/stratix-context.ts`（纯 builder + provider + `resolve…` 吞错降级），**不读文件的动作放 app 层装配处** | 分层铁律（world/hud 零 IO，core 零 IO）；§3.3.2 |
| D13 | **dsh 侧对照**：dsh 的「干净上下文进入」= 新 Session + `header.cwd` = 项目根 + 模型上下文自动注入 `Current working directory: "<path>"`（本次在 HEAD `fcc0ad46` 复核）。Stratix 补的是 dsh 没有的那一半：**「这里是什么项目、有什么约定」** | 架构报告 §5.2 / §5.3；集成报告 §4.2 路径 D、§4.3；§3.5 |
| D14 | **实施三期**：**M1** 最小副本（单项目切图 + agent 进入）/ **M2** 多项目并行（注册表 + 多副本 + 独立养成）/ **M3** dsh 桥接（`cwd` 落到 dsh headless + preset 快照）。每期改动面与风险见 §5 | §5 |

**明确不做的**（详见 §6.1）：不做「同时看两个项目的战场」、不做一项目一库、不做 cloud sync、不把 `.stratix` 映射成 dsh profile/bundle、**不在本任务实现任何代码**。

---

## 1. Project 实体建模

### 1.1 三层物化：契约 → 实体 → 运行态

```
【契约层】.stratix/                      ← task_159 已定，本设计不改其目录契约
   project.json  ── id ──▶ 逻辑 project（spx_…，随 git 传播，同源副本相同）
   roster/      ── 角色身份与能力组合（project 级）
   config/      ── 项目级配置（project 级）
   dsh/         ── dsh 桥接件（project 级）

【实体层】core 契约（本设计新增）             ← §1.2
   ProjectView         逻辑项目的运行态投影
   ProjectInstanceView 物理副本（= 一个目录 = 一张地图 = 一个副本）
   WorldState.projects / .projectInstances / .activeInstanceId

【运行层】                                  ← §2 / §4
   instance 维度：missions / tasks / sessions / characters / units / unit_positions
   world 层：LobbyScene（总览） ⇄ BattlefieldScene（某 instance 的地图）
```

**关键不变量（三条）**：

1. **一个 instance = 一个目录 = 一张地图 = 一份运行态**。没有第四个概念。
2. **逻辑 project 与物理 instance 的关系是「一对多」**：主仓与 worktree = 同一 project、不同 instance（task_159 §2.5 的裁决，本设计沿用）。
3. **运行期同一时刻只有一个 instance 处于 active**（D3）。其余 instance 的运行态在库里，不在内存。

### 1.2 core/types.ts 契约扩展（TS 草案）

> 全部走「**可选增补**」惯例——契约增补不许打破既有 `WorldState` 构造点（core / hud 单测夹具）的编译（`src/core/types.ts:1119-1124` 的既有注记）。
> **本节是草案，本任务不改 `src/`。**

#### 1.2.1 新增类型

```ts
// ============================================================================
// ★ 项目实体（@since v3.3 / task_160 设计 B）
//   身份分层照 DESIGN-workspace.md §4.2：project（逻辑）/ instance（物理）。
//   本文件只冻结**形状与取值**，不读文件、不碰 IO（core 零 IO 铁律）。
// ============================================================================

/**
 * 项目实例 id（物理副本）。= 注册表里的稳定 id（task_159 §2.4 的 `instanceId`），
 * 路径移动后不变。**注意它不是路径派生** —— 路径会变，id 不该变。
 */
export type ProjectInstanceId = string;

/** 逻辑项目 id（= .stratix/project.json 的 id，随 git 传播，同源副本相同）。 */
export type ProjectId = string;

/**
 * 项目状态（运行层投影）。
 * - 'active'   有未终结的编组任务（地图上有活儿）；
 * - 'idle'     副本存在但没有在办的事；
 * - 'archived' 用户归档（大厅里收起，默认不展示）；
 * - 'missing'  目录不存在（被移动/重命名）—— 不自动删，给「路径已移动」的修复入口。
 */
export type ProjectStatus = 'active' | 'idle' | 'archived' | 'missing';

/**
 * 逻辑项目视图（契约面的运行层投影）。
 *
 * why 逻辑与物理要分两个类型：**契约随 git 传播**（同仓库各副本相同），
 *   **运行态是物理的**（各副本独立积累）。合成一个类型就必须选一个真相源，
 *   两种事实会互相污染。
 */
export interface ProjectView {
  /** 逻辑项目 id（= .stratix/project.json.id）。 */
  readonly id: ProjectId;
  /** 项目名（= project.json.name；缺失时回落目录名）。 */
  readonly name: string;
  /** 一句话说明（= project.json.description）。 */
  readonly description: string;
  /**
   * 契约格式版本（= project.json.formatVersion）。读方据此走方向性读规则
   * （照 dsh 的 SESSION_FORMAT_VERSION 纪律，见 DESIGN-workspace.md §1.4）。
   */
  readonly formatVersion: number;
  /**
   * 源指纹（= project.json.instance.vcs.commonDirFingerprint 的哈希）。
   * 一致 ⇒ 两个 instance 同源（主仓 / worktree）。**只用于识别，不自动合并**。
   */
  readonly sourceFingerprint?: string;
  /** 当前状态（见 ProjectStatus）。 */
  readonly status: ProjectStatus;
}

/**
 * 项目实例视图（物理副本 = 一个目录 = 一张地图）。
 *
 * why 与 ProjectView 分开：主仓与 worktree 的 id / 名字 / 契约完全相同，
 *   但路径、运行态、任务史各不相同 —— 合成一个类型就没有「同源不同物」的表达力。
 */
export interface ProjectInstanceView {
  /** 实例稳定 id（注册表分配，路径移动后不变）。 */
  readonly instanceId: ProjectInstanceId;
  /** 所属逻辑项目 id（= ProjectView.id）。 */
  readonly projectId: ProjectId;
  /** 规范化的绝对路径（fs.realpath 后的项目根 = 含 .stratix 的目录）。 */
  readonly path: string;
  /** 大厅里的展示标题（缺省 = 项目名）。 */
  readonly title: string;
  /** 最后一次进入的时刻（epoch ms；大厅排序用）。 */
  readonly lastOpenedAt: number;
  /** 置顶（大厅里排在最前）。 */
  readonly pinned: boolean;
  /** 归档（大厅里收起）。 */
  readonly archived: boolean;
  /** 路径不存在（被移动/重命名）。缺省 = 路径正常。 */
  readonly missing?: boolean;
}
```

#### 1.2.2 WorldState 增补（三个可选字段）

```ts
export interface WorldState {
  // …既有字段不动…

  /**
   * @since v3.3（task_160）逻辑项目清单。
   * 刻意可选：契约增补不许打破既有 WorldState 构造点（core / hud 单测夹具）的编译；
   * 读取方缺省时按「空清单」处理。
   * 体积有界：上限 MAX_PROJECTS（见下）。
   */
  projects?: readonly ProjectView[];

  /**
   * @since v3.3（task_160）项目实例清单（物理副本 = 一张地图）。
   * 上限 MAX_PROJECT_INSTANCES。缺省 = 空清单。
   */
  projectInstances?: readonly ProjectInstanceView[];

  /**
   * @since v3.3（task_160）当前激活的项目实例 id。
   *   - 非 null = 战场态（世界层渲染这个 instance 的地图）；
   *   - null / 缺省 = **大厅态**（workspace 总览，战场单位为空）。
   * why 用实例 id 而不是 project id：同源副本（主仓 / worktree）是两个 instance，
   *   各自一张地图 —— 激活的粒度是**物理副本**。
   */
  activeInstanceId?: ProjectInstanceId | null;
}
```

#### 1.2.3 实体挂 project 维度（五个可选字段）

```ts
export interface MissionView {
  // …既有字段不动…
  /**
   * @since v3.3（task_160）所属项目实例 id。
   * 缺省 / null = **默认沙盒实例**（旧数据语义：一个没有项目归属的全局战场）。
   * 为什么要它：mission 是纯内存状态机（不落库），但「这张图上有哪些编组任务」
   *   必须是副本内的事 —— 否则切副本时 mission 池会串。
   */
  readonly instanceId?: ProjectInstanceId | null;
}

export interface CharacterTask {
  // …既有字段不动…
  /** @since v3.3（task_160）所属项目实例 id；缺省 = 默认沙盒实例。 */
  readonly instanceId?: ProjectInstanceId | null;
}

export interface CharacterView {
  // …既有字段不动…
  /**
   * @since v3.3（task_160）所属项目实例 id。
   * ⚠️ 与 §1.3.3 的「行 id instance 内唯一」配套：本字段是**冗余但权威**的归属声明，
   *   `role_id` 才是「它是 roster 里哪个角色」。两者都要，缺一不可：
   *   只有 role_id ⇒ 不知道这个角色住在哪个副本；只有 instanceId ⇒ 不知道它是谁。
   */
  readonly instanceId?: ProjectInstanceId | null;
  /**
   * @since v3.3（task_160）对应的**逻辑角色 id**（= .stratix/roster/<role-id>.json 的 id）。
   * 缺省 / null = 未绑定到契约角色（老角色、或用户手建的散兵）。
   */
  readonly roleId?: string | null;
}

export interface SessionRecord {
  // …既有字段不动…
  /**
   * @since v3.3（task_160）会话所属项目实例 id。
   * 用途：① 切副本时**不跨副本续发**（上下文携带 = 泄漏）；② 会话列表按副本过滤。
   */
  readonly instanceId?: ProjectInstanceId | null;
}

export interface UnitView {
  // …既有字段不动…
  /**
   * @since v3.3（task_160）所属项目实例 id。
   * 单位 id 已由 instance 化的 character id 派生（见 §1.3.3），本字段是显式声明。
   */
  readonly instanceId?: ProjectInstanceId | null;
}
```

#### 1.2.4 上限常量（core/types.ts 冻结）

```ts
/** @since v3.3（task_160）逻辑项目数上限（注册表 ≤ 200 条，超出按 lastOpenedAt LRU 淘汰）。 */
export const MAX_PROJECTS = 200;

/** @since v3.3（task_160）项目实例数上限（同上；与 DESIGN-workspace.md §5.2 的「注册表 ≤ 200」对齐）。 */
export const MAX_PROJECT_INSTANCES = 200;

/** @since v3.3（task_160）项目上下文块体积上限（含标签）。比战场现状块小 —— 项目契约信息少。 */
export const STRATIX_PROJECT_CONTEXT_MAX_CHARS = 2_000;

/** @since v3.3（task_160）项目上下文块的包裹标签（与 <stratix-context> 同款形状）。 */
export const STRATIX_PROJECT_CONTEXT_TAG_OPEN = '<stratix-project>';
export const STRATIX_PROJECT_CONTEXT_TAG_CLOSE = '</stratix-project>';
```

#### 1.2.5 命令与事件（总线铁律的落点）

```ts
export type HudCommand =
  // …既有命令不动…
  /**
   * @since v3.3（task_160）进入副本（激活一个项目实例）。
   * 发出方：HUD 大厅的「进入」按钮。
   * core 裁决：实例存在？未归档？路径在？→ 写 WorldState.activeInstanceId
   *   并广播；**同时把该实例的世界态载入 store**（全量重载，见 §2.2）。
   * world 消费：同名 WorldEvent `project.changed` → 场景切换（大厅 → 战场）。
   */
  | { type: 'project.enter'; instanceId: ProjectInstanceId }
  /**
   * @since v3.3（task_160）退出副本（回到大厅态）。
   * core 裁决：先把该实例的**未归档数据**按 DESIGN-workspace.md §5.3 Q9 处置
   *   （强制归档到 .stratix/history/ 或拒绝并提示），再写 activeInstanceId = null。
   */
  | { type: 'project.exit' };

export type WorldEvent =
  // …既有事件不动…
  /**
   * @since v3.3（task_160）激活副本变更（core → world）。
   * 载荷：instanceId（null = 回到大厅态）。
   * 消费者：world 层场景路由（大厅 ⇄ 战场 + 载入仪式）。
   * why 走 world 通道而不是 state 通道：这是一次**切换指令**（瞬态），
   *   不是「当前长什么样」的状态 —— 与 camera.center / camera.shake 同一两段式。
   */
  | { type: 'project.changed'; instanceId: ProjectInstanceId | null };
```

> **不新增第四条总线通道**（`src/core/bus.ts:23-27` 三通道固定）。新命令走 `command` 通道，新事件走 `world` 通道 —— 与 `task.*` / `camera.*` 的先例一致。

### 1.3 现状全局平铺实体的迁移路径

#### 1.3.1 现状（已核实）

| 概念 | 类型定义 | 现状归属 | 落库 |
|---|---|---|---|
| 角色档案 + 养成 | `CharacterView`（`src/core/types.ts:832`） | **全局单份** | `characters` 表（`src/app/services/persistence/game-save-dao.ts:92` DDL） |
| 单位 | `UnitView`（`src/core/types.ts:214`） | 全局单份，id = `prefix + character.id`（`src/core/character/unit-projection.ts:42`） | `unit_positions` 表（`game-save-dao.ts:107` DDL，PK = `character_id`） |
| 战场任务 | `MissionView`（`src/core/types.ts:315`） | **全局扁平数组** `WorldState.missions` | **不落库**（纯内存） |
| 角色任务 | `CharacterTask`（`src/core/types.ts:461`） | 全局扁平数组 `WorldState.tasks` | `character_tasks` 表（`task-record-dao.ts:135` DDL） |
| 会话 | `SessionRecord`（`src/core/types.ts:1060`） | 全局扁平数组 `WorldState.sessions` | `sessions` + `session_events` 表（`session-dao.ts:102` / `session-event-dao.ts:66` DDL） |
| 经验流水 | `ExpSource`（`src/core/types.ts:1573`） | 全局角色级 | `exp_events` 表（`exp-event-dao.ts:68` DDL，列 `character_id / delta / reason / level / created_at`） |
| 世界态 | `WorldState`（`src/core/types.ts:1109`） | **单份**，`worldStore` 单例（`src/core/store.ts:311`） | 纯内存 |

> **遗留 `projects` 表**（`src/stratix-database/StratixDatabase.ts:765`）是**旧 stratix-project 概念**（带 status / priority / zone_config 的可变项目行），全仓**无任何读写**。新语义**不复用**这张表 —— 表名已被占用且语义不同（task_159 §4.1.1 / §4.4 M4 已裁决）。本设计沿用该裁决。

#### 1.3.2 迁移路径（加法，零数据重写，零停机）

照 task_159 §4.4 的五步迁移，本设计**追加** instance 维度的三步（M4–M6 已在 task_159 占位）：

| 步 | 动作 | 可回滚性 |
|---|---|---|
| **N1** | `characters` / `character_tasks` / `sessions` / `session_events` / `exp_events` / `unit_positions` 各加 `instance_id` 列（**nullable**） | 加列可逆（保留旧列即可回退） |
| **N2** | 旧行 `instance_id = NULL` → 语义定义为「**默认沙盒实例**」（一个内置的、永远存在的虚拟 instance，对应旧行为） | 纯逻辑层，零数据改动 |
| **N3** | core 契约加**可选**字段（`instanceId?: ProjectInstanceId \| null`）—— 缺省 = 默认沙盒 | 与 `MissionBrief` / `checkpoints` 的可选增补惯例一致 |
| **N4** | `characters` 行 id 改为 **instance 内唯一**：`chr_<instanceId>_<roleId>`；新增 `role_id` 列（= roster 角色 id） | 旧行 id 不变（默认沙盒实例下 `chr_<sandbox>_<roleId>` 与旧 id 不同 ⇒ **需要一次性 id 重写**）。⚠️ 见下方风险 |
| **N5** | `unit_positions` 表 PK 仍是 `character_id` —— 因为 N4 之后 `character_id` 本身已是 instance 内唯一 ⇒ **PK 不用改** | 零改动 |
| **N6** | 引导：新实例创建时，其 roster 的角色**物化**进该实例的 `characters` 行（契约 → 运行层的单向 reconcile，task_159 D3） | 显式、可撤销 |

> **N4 的 id 重写是本设计唯一有数据风险的迁移步**。三条缓解：
> ① 只在**首次启用多副本**时对**非默认沙盒**的行做重写（默认沙盒的行保持旧 id）；
> ② `characters.id` 的引用方（`unit_positions.character_id` / `character_tasks.character_id` / `sessions.participants`）在同一事务里同步更新；
> ③ 重写前先把旧 id → 新 id 的映射写进 `.stratix/state/`（可回滚）。
> **裁决建议**：M1/M2 期间**先不做 N4**——改为「一个角色在一个 instance 内一份运行态」由 **`role_id` + `instance_id` 复合唯一**表达，`characters.id` 保持旧格式不变（但允许同 role 在多 instance 有多行 ⇒ 需要 id 唯一化 ⇒ 冲突）。
> **最终裁决（冻结建议）**：`characters.id` 保持**全局唯一**，多副本时**同一角色在每个副本各有一行**，行 id 由 `role_id + instanceId` 派生 ⇒ **必然要重写**。所以：**采纳 N4**，并把「一次性 id 重写」列入 M2 的风险清单（§5.2）。

#### 1.3.3 characters 归 project 还是全局？—— 裁决

**答：两头都不是 —— 拆成「定义（project 级）」与「运行态（instance 级）」两份。**

| 部分 | 归属 | 存放 | 真相源 | 跨副本是否共享 |
|---|---|---|---|---|
| **角色定义**：名字 / persona / 能力组合（工具白名单 / 斜杠命令 / 技能 / systemPrompt 段）/ agent 绑定 | **project** | `.stratix/roster/<role-id>.json` | ✅ 契约 | ✅ 共享（随 git 传播，同源副本一致） |
| **角色运行态**：level / experience / 位置（`unit_positions`）/ `externalSessionId` / `contextEnabled` | **instance** | `characters` 表（加 `instance_id` + `role_id`） | ✅ 运行层 | ❌ **不共享**（副本独立养成） |

**三条理由**：

1. **「角色是谁」是契约，「角色长成什么样」是存档**。把 level/exp 放进 roster 就意味着每次涨级都要改契约文件 —— 而契约是**随 git 传播**的，改它会造成工作区脏状态与分支冲突（DESIGN-workspace.md §1.4.3 的理由同源）。
2. **副本隔离是产品愿景**（「各玩各的存档」）。A 副本做的任务给 A 副本的角色涨经验、B 副本的角色纹丝不动 —— 这才是「副本」的手感。若 exp 全局，两个副本共用一条成长线，副本语义漏气。
3. **agent 的外部会话 id 必须是副本级的**：`CharacterView.externalSessionId` 是 CLI 侧的 resume 凭据（`src/app/services/chat-service.ts:537-544`）。它必须跟着副本走 —— 否则在 A 副本聊过天，去 B 副本 resume 同一个 CLI 会话 = **跨副本携带上下文**（正是 §3.4 要禁止的）。

**代价与缓解**：同一个角色在 N 个副本 ⇒ N 行 characters ⇒ 契约 reconcile 要往 N 个 instance 物化。缓解：reconcile 按 instance 增量做（按文件 mtime + 哈希指纹，DESIGN-workspace.md §5.2 的 ≤ 50 ms/实例预算），且**只物化被 roster 声明的角色**。

### 1.4 副本维度的容量上限：全局配额 vs 每副本配额

**问题**：现状四个池与四个上限全是全局的 —— `MAX_MISSIONS=100`（`src/core/types.ts:63`）、`MAX_TASKS=100`（`:96`）、`MAX_SESSIONS=200`（`:116`）、`MAX_CHARACTERS=64`（`:675`）。切副本后这些配额是「全副本共享一份」还是「每副本一份」？

**裁决：M1/M2 期间维持全局配额**，理由：

- 现状裁剪逻辑吃的是整份数组（`src/core/mission/manager.ts:239` `dropSettledMissions(state.missions, this.maxMissions - 1)`；`src/core/task/manager.ts:220` 同款；`src/core/session/manager.ts:345` 同款）——改成 per-project 配额要动三处裁剪 + 依赖判定，是 core 契约改动（撞铁律 1/2）。
- **但**切副本时 **store 只装活跃 instance 的实体**（§2.2 的全量重载）⇒ 副本内看到的配额是「活跃副本那一份」，而**落库层**按 `instance_id` 分区后，各副本的行数之和可能超过全局上限 ⇒ **裁剪必须改为按 instance 分组后再判**。

**分阶段**：

| 期 | 上限口径 | 改动点 |
|---|---|---|
| M1 | 全局配额，**只支持一个 instance** ⇒ 无冲突 | 无 |
| M2 | 落库层**按 instance 分组判配额**（`group by instance_id` 后各自比上限）；内存层仍全局（因为只装活跃一份） | `mission/manager.ts:239` / `task/manager.ts:220` / `session/manager.ts:345` 的裁剪入参改为分组视图 |
| M3+ | 若产品要求「同时看两个副本」，才需要真正的多 store（**另一个任务**，见 §6.2 Q1） | — |

### 1.5 与 DESIGN-workspace.md 的接口（显式互引）

> **本节是 task_159 与 task_160 的接缝**。task_159 冻结 `.stratix` 目录契约与项目注册表；task_160 把那份契约**升格为「一张地图 = 一个副本」的可运行形态**。两者**不重复造概念**，只各加一层。

| 方向 | task_159（设计 A）产出 | task_160（本设计）消费 / 扩展 | 接缝口径 |
|---|---|---|---|
| **项目身份** | `project.json.id`（`spx_…`，逻辑 project） | `ProjectView.id` ← 直接映射，**不新增 id 生成规则** | 逻辑 project id 是**唯一**的项目身份来源 |
| **副本身份** | 注册表 `workspaces.json` 的 `instanceId`（`wsp_…`，物理 instance） | `ProjectInstanceView.instanceId` ← 直接映射 | **同一个 id，不另造** |
| **项目 ↔ 副本关系** | `instances[].projectId` 指向 `project.json.id` | `ProjectInstanceView.projectId` ← 直接映射 | 一对多（主仓 / worktree 同源） |
| **副本 = 地图** | ❌（task_159 只到「注册表 + 目录契约」） | ✅ **新增**：一张地图 ≡ 一个 instance | **本设计对 task_159 的唯一扩展点** |
| **大厅态** | ❌ | ✅ **新增**：大厅 = workspace 注册表的可视化 | 大厅读的就是 task_159 的 `workspaces.json` |
| **切换 = 重载世界态** | D11「一进程只激活一个实例，切项目 = 重载世界态」 | ✅ **落地**：切副本 = 换 `activeInstanceId` + 全量重载 | **完全沿用 task_159 的 D11**，本设计不推翻 |
| **agent cwd = 项目根** | D12 + §5.4 S6（`SpawnOptions.cwd` 接线点已存在但无人赋值） | ✅ **落地**：cwd = 活跃 instance 的 `path` | 同一个字段、同一处接线 |
| **项目上下文注入** | ❌（task_159 只到「roster 能力组合进 session header」） | ✅ **新增**：`<stratix-project>` 块，从 `.stratix` 读出 | 内容全部来自 task_159 定义的目录契约 |
| **未归档数据处置** | Q9（切走前强制归档 or 提示） | ✅ **落地**：`project.exit` 的 core 裁决 | 同一个开放问题的落地 |
| **存储独占铁律** | §4.4「契约 reconcile 的写入必须走 service 进程」 | ✅ 沿用：`.stratix` 读写与实例切换都在 service 进程 | 不违反 |
| **维度字段命名** | 落库列名 **`instance_id`**（§4.4 M1 已定：characters / character_tasks / sessions / session_events 各加 `instance_id`）；契约侧字段名 **`instanceId`**（§4.4 M3 已定：`instanceId?: string`） | ✅ **沿用同一套词**：core 契约字段 = `instanceId`；本设计的 `ProjectInstanceId` 只是它的**具名类型别名**（`export type ProjectInstanceId = string`） | **不引入第三套词**。⚠️ 命名陷阱：逻辑 project 用 `projectId`（类型 `ProjectId`），物理副本用 `instanceId`（类型 `ProjectInstanceId`）—— **两者不可互换** |

> **命名纪律（本设计的自我约束）**：
> - **`projectId`** ⇒ 永远指**逻辑项目**（`ProjectId`，随 git 传播，同源副本相同）；
> - **`instanceId`** ⇒ 永远指**物理副本**（`ProjectInstanceId`，路径移动后不变）；
> - **`instance_id`** ⇒ 上两者在**落库列名**上的唯一写法（沿用 task_159 §4.4 M1）。
> 任何「`projectId` 字段装着 instance id」或「`instanceId` 字段装着 project id」的写法都是**违规**，评审时按此条打回。

**一句话接口**：

> **task_159 回答「项目是什么、怎么被找到」；task_160 回答「项目长什么样（一张地图）、agent 怎么进去干活、活干在哪」。**
> 两者的公共锚点是 **`.stratix/project.json.id`（逻辑）+ `workspaces.json` 的 `instanceId`（物理）** 这一对 id —— **本设计不新增第三种 id**。

### 1.6 Project 契约面 ↔ 运行层的单向 reconcile

沿用 task_159 D3（契约 → 运行层单向，永不反向），本设计补上「按 instance 物化」这一步：

```
.stratix/roster/_index.json + roster/<role-id>.json
        │
        │  reconcile（单向；按 mtime + 内容哈希增量；≤ 50 ms/实例）
        ▼
characters 表（instance_id = 目标 instance，role_id = roster 角色 id）
        │
        │  能力组合变了 → 标记「需要重启会话」，不静默改写历史 session 的快照
        ▼
session header（能力组合快照 + instanceId + cwd）
```

**三条纪律**（照 task_159 §4.3）：

1. 缺 → 建；能力组合变了 → **标记需要重启会话**（不改写历史快照）。
2. **不回写契约**（运行态是 level/exp，不进 roster）。
3. reconcile **在 service 进程做**（存储独占铁律）。

---

## 2. 多地图实例（副本）

### 2.1 场景形态

| 形态 | world 场景 | `activeInstanceId` | HUD | 单位/建筑 |
|---|---|---|---|---|
| **大厅态** | `LobbyScene`（新） | `null` | 大厅总览（项目卡片网格 + 进入按钮 + 状态摘要） | 无 |
| **战场态** | `BattlefieldScene`（既有） | 某个 instance | 既有 HUD（命令面板 / agent 侧栏 / 事件轨…） | 该 instance 的单位 + 建筑/区域 |

**大厅态与战场态是 world 层的一等场景切换**，不是 HUD 换屏。理由：大厅要显示**每个副本的地图缩略/状态**，那属于世界层的渲染职责（HUD 零 Phaser 依赖，`src/hud/` 不 import world）。

**切换路径**：

```
大厅（LobbyScene）
   │  HUD 点「进入」→ HudCommand project.enter {instanceId }
   ▼
core 裁决（runtime.ts 接地）→ 写 WorldState.activeInstanceId + 重载该实例世界态
   │  → WorldEvent project.changed {instanceId}
   ▼
world 层：LobbyScene.stop() → BattlefieldScene.start('battlefield', { instanceId })
   │
   ▼
战场（BattlefieldScene，载入仪式）
```

反向：`project.exit` → `activeInstanceId = null` → `BattlefieldScene.stop()` → `LobbyScene.start()`。

> **场景数据通道**：Phaser 的 `scene.start(key, data)` 天然支持携带数据 ⇒ **`instanceId` 走 scene data，不走全局变量**。这是解除「BattlefieldScene 单例假设」的关键抓手（破除点 #1）。

### 2.2 进入副本的仪式与加载语义

**仪式（纯表现，world 层做，不进 core 契约）**：

| 拍 | 内容 | 时长 |
|---|---|---|
| ① 黑场落下 | 场景切换时全屏遮罩（`scene.start` 前） | ~120 ms |
| ② 副本名牌 | 副本名 + 分支（`vcs.branch`）+ 路径尾段 + 「在办 N 条任务」 | ~400 ms |
| ③ 地块点亮 | 地面层按该副本的 mission/任务布局**逐格点亮**（复用 `building-layer` 的 flipCard/raiseFlag 语汇） | 逐格 stagger |
| ④ 单位入场 | 该副本的单位**逐个落位**（`unit-layer` 的入场动效，stagger 40 ms/个） | 逐个 |
| ⑤ 交还控制 | 遮罩淡出，相机回到 `overviewPose()` | ~200 ms |

> **仪式感的工程含义**：它让「切副本」成为**一次可感知的边界**，而不是「画面突然变了」。代价是 ~1.2 s 的过场 —— 必须**可跳过**（任意输入 / ESC 立即淡出），否则高频切副本会变成惩罚。

**加载语义（铁律 1）**：

> **切副本 = 全量重载，不是增量合并。**
> 具体地：core 在 `project.enter` 的裁决里，把目标 instance 的 missions / tasks / sessions / characters / units **从库里整份载入 store**，然后广播一份**完整的新 WorldState**。
> 与 world-sync 的重连语义同款（`src/stratix-gateway/api/websocket/world-sync/protocol.ts:11-15`：*"重连 = 全量 snapshot 覆盖本地，不做增量合并"*）。

**为什么必须全量而不是增量**：

- 副本之间是**互不可见的独立世界**（D5）。若做增量，两个副本的单位会同时在内存里（哪怕只渲染一个）—— 那就是两份真相（撞铁律 1）。
- 切换时**不做跨副本状态搬运**。上一副本的内存态**整体丢弃**。

**离开副本前：未归档数据处置**（task_159 Q9 的落地）：

| 情形 | 处置 |
|---|---|
| 该副本有未终结的 mission | `project.exit` **拒绝**并回 Notice：「有 N 条未收工的编组任务」→ HUD 弹确认 |
| 用户确认退出 | 先**归档**到 `.stratix/history/missions-YYYYMM.jsonl`（append-only，冻结），再切 |
| 无未终结数据 | 直接切 |
| 归档失败 | **拒绝切换**并报具体原因（不静默丢弃、不半归档） |

### 2.3 副本间单位互不可见：机制保证

**保证链（三层，缺一不可）**：

| 层 | 机制 | 出处 |
|---|---|---|
| **① 状态层** | store 在任一时刻只装**一个** instance 的实体（missions / tasks / characters / units） | D3 + §2.2 全量重载；`worldStore` 单例（`src/core/store.ts:311`） |
| **①' 存储层** | 每行带 `instance_id`；查询一律带 instance 过滤，**跨 instance 查询是显式动作** | task_159 §4.3；§1.3.2 N1/N2 |
| **② 渲染层** | 战场场景只渲染**当前 scene data 指定的 instance** 的单位；大厅场景不渲染任何单位 | `UnitRegistry`（`src/world/objects/unit-registry.ts:57`）持有 Map；切场景时随场景销毁 |

**明确不做**：**不做「隐藏」实现**（把 B 副本的单位 `visible = false`）。理由：隐藏 = 两份状态同时在内存 = 真相分裂；且 `UnitRegistry` 的 `objects` Map 会无界增长（perf 铁律：数据不许无限增长）。

> **一个例外要说清楚**：`characters` 表里**确实**同时存在各副本的行（存储层不隔离行）。这不违反「互不可见」——「互不可见」说的是**世界态与渲染层**，不是数据库。HUD 查询时按 instance 过滤（§1.3.2 N2）。

### 2.4 大厅态 = workspace 总览

**大厅的三块内容**（数据源全部是 task_159 的注册表 + 运行态摘要）：

| 块 | 内容 | 数据源 |
|---|---|---|
| **副本卡片网格** | 每个 instance 一张卡：名字 / 路径尾段 / 分支 / 状态（active/idle/missing）/ 最近进入时间 / 在办任务数 | `WorldState.projectInstances` + `WorldState.activeInstanceId` |
| **同源副本提示** | 同一 `sourceFingerprint` 的实例标「同源副本」，可跳转查看 | `ProjectView.sourceFingerprint`（task_159 §2.5） |
| **发现与引导** | 「添加副本」→ 发现流程（task_159 §2.3 的 needs-init 引导） | task_159 §2.2–§2.3 |

**大厅的三条纪律**：

1. **大厅不持有任何业务真相** —— 它只读 `WorldState`（铁律 1）。
2. **大厅不发业务命令** —— 它只发 `project.enter` / `project.exit`（总线铁律）。
3. **大厅不落库** —— 注册表的增删由 service 进程的注册表端口负责（task_159 §2.4）。

**大厅与 HUD 的关系**：大厅是 world 场景；HUD 的命令面板在大厅态下**降级**（不可派单 —— 没有活跃副本就没有执行上下文；派单按钮显示「先进入一个副本」）。

### 2.5 BattlefieldScene 单例假设的破除点清单

> 全部精确到文件 + 行号。「性质」列区分 **🔴 硬阻断**（不改就跑不对）/ **🟡 需改造**（不改会串数据）/ **🟢 表现层**（只影响观感）。

| # | 位置 | 单例假设 | 破除方式 | 性质 |
|---|---|---|---|---|
| **1** | `src/world/scenes/BattlefieldScene.ts:103` `BATTLEFIELD_SCENE_KEY = 'battlefield'` | **一个固定 scene key**（常量） | key 不变，但**启动数据走 Phaser scene data**：`scene.start('battlefield', { instanceId })`；场景在 `init(data)` 读出并冻结 `this.instanceId` | 🔴 |
| **2** | `src/world/scenes/BattlefieldScene.ts:142` `private readonly units = new UnitRegistry(...)` | 单位注册表是**字段初始化器**（构造即建，跨副本存活） | 随场景生命周期重建（Phaser `scene.start` 会重建场景实例 ⇒ 天然重建）；**不要**把 `UnitRegistry` 提到场景外/模块级 | 🔴 |
| **3** | `src/world/scenes/BattlefieldScene.ts:155` `taskFx` / `:169` `speechBoard` / `:185` `replayBoard` | 三个**表现态板**是场景字段（`TaskFxBoard` `src/world/objects/task-fx.ts:157`、`SpeechBubbleBoard` `src/world/objects/speech-bubble.ts:103`、`ReplayBoard` `src/world/objects/replay-board.ts:109`） | 随场景重建（保持现状即可）；**禁止**把它们提到模块级单例 | 🟡 |
| **4** | `src/world/scenes/BattlefieldScene.ts:161` `private readonly mapBoard = new MapBoard(...)` | 地图对账板持有 `regionSlots` Map + `nextSlot` 游标（`src/world/objects/task-building.ts:300-307` `slotFor`）—— **区域占格顺序是跨副本累积的** | 随场景重建；每个副本的区域占格从中心向外**各算各的**（现状语义正好） | 🔴 |
| **5** | `src/world/scenes/BattlefieldScene.ts:253` `this.bridge = createWorldBridge(this)` | 桥接层订阅**全局** core/bus 的 state 通道（`src/world/bridge/bus-adapter.ts:47`），把**全局** `WorldState` 全量转给场景 | 桥接层**按 scene 的 `instanceId` 过滤**后再转（`WorldState.units` / `missions` / `tasks` 已带 `instanceId`）—— 或让 core 广播时只带活跃 instance 的实体（更彻底，见 D3） | 🔴 **最硬的一处** |
| **6** | `src/world/scenes/BattlefieldScene.ts:296-297` + `src/world/objects/unit-registry.ts:33` `UNIT_POSITION_SEED_KEY = 'stratix:unit-position-seed'` | 恢复站位种子是 **game.registry 里的全局键**（组合根 `src/app/main/main-entry.ts:1383` `booting.registry.set(UNIT_POSITION_SEED_KEY, injection.positionsByUnitId)`）⇒ **A 副本的位置会漏到 B 副本** | 键按 instance 分区：`stratix:unit-position-seed:<instanceId>`；或由 bridge 按 instance 注入（不依赖 registry 全局键） | 🔴 |
| **7** | `src/world/objects/unit-registry.ts:57` `UnitRegistry` + `:63` `spawnCursor` | 新单位沿**全局网格游标**落位（`SPAWN_GAP` / `SPAWN_MARGIN`），游标跨副本累积 ⇒ 副本 B 的单位接着 A 的位置继续排 | 随场景重建（游标归零）；落位种子按 instance 分区（#6） | 🟡 |
| **8** | `src/world/objects/task-building.ts:51,53` `REGION_COLUMNS = 7` / `REGION_ROWS = 5` | 战场被切成 **7×5 = 35 格**（一块全局的地图） | 每副本**各有一块 35 格的地图**（同一套布局算法，各算各的）；现状 `cells[slot % cells.length]` 的环绕叠放逻辑天然支持 | 🟢 |
| **9** | `src/app/main/main-entry.ts:1372-1377` `new Phaser.Game({ scene: [BattlefieldScene] })` | 场景表是**静态数组**，只装了一个场景 | 场景表加 `LobbyScene`；两个场景**互斥启动**（一个跑就另一个停） | 🔴 |
| **10** | `src/world/bridge/bus-adapter.ts` `WorldScenePort` 接口（`syncUnits` / `syncTasks` 签名） | 端口签名**无 instance 维度** | 两种做法：① 端口方法加 `instanceId` 参数；② 桥接层内部持有 `instanceId` 并在转发前过滤（**推荐**：端口签名零改动 ⇒ HUD / world 测试夹具不破） | 🔴 |
| **11** | `src/core/store.ts:311` `worldStore`（工厂 `:219`，初值 `:76` `createInitialState`） | **单份** `WorldState`（units/missions/tasks/characters/sessions 全是扁平数组） | 切副本 = **重载**这份 store 的内容（全量替换，不做增量合并）。不改成多 store（D3） | 🔴 |
| **12** | `src/core/runtime.ts:803` `coreRuntime`（工厂 `:359`，store 绑定 `:360`） | 装配**无 project 参数**；各域 manager（mission `:122` / character `:128` / task `:135` / session `:142`）全部绑这一个 store | 保持单例；**新增**一个「切换 instance」的装配期动作（重载 store + 重算投影）。**不改 manager 签名** | 🔴 |
| **13** | `src/core/bus.ts:32` `const emitter = mitt<CoreEventMap>()` | 总线是**模块级单例**，载荷不带任何项目标识 | 不改总线结构（**不新增第四条通道**）；项目归属靠 **payload 里的 `instanceId` 字段**（广播层过滤） | 🟡 |
| **14** | `src/core/character/unit-projection.ts:42` `id: \`${CHARACTER_UNIT_ID_PREFIX}${character.id}\`` | 单位 id 由**全局唯一**的 character id 派生 | **不改单位 id 格式** —— 改的是 character id 的**唯一性范围**（instance 内唯一，§1.3.3 N4）⇒ 单位 id 自动 instance 内唯一 | 🟢（前提是 N4 落地） |
| **15** | `src/app/services/persistence/game-save-dao.ts:107` `unit_positions` DDL（PK = `character_id`） | 位置按**全局** character id 存 | character id 变 instance 内唯一后，PK 天然够用 ⇒ **表结构零改动**（只加 `instance_id` 列便于按副本查询） | 🟢 |
| **16** | `src/hud/screens/main-screen.ts:611-620` `currentScreen` / `CurrentScreen = 'main' \| 'settings' \| 'character'` | HUD 屏位**没有大厅态** | 大厅是 world 场景 ⇒ HUD 屏位**不加**；HUD 在大厅态下**降级**（派单入口禁用 + 提示「先进入一个副本」） | 🟢 |
| **17** | `src/hud/panels/command-catalog.ts` | 命令目录是**全局**一份 | 大厅/战场共用；新增 `project.enter` / `project.exit` 两条命令（走同一目录机制） | 🟢 |
| **18** | `src/app/main/main-entry.ts:1383` `booting.registry.set(UNIT_POSITION_SEED_KEY, injection.positionsByUnitId)` | 组合根注入**一份**站位种子 | 注入按 instance 的**种子 Map**（`Map<instanceId, Map<unitId, Point>>`）或改为 bridge 按 instance 取 | 🟡 |
| **19** | `src/core/types.ts:1113,1145,1162` `WorldState.missions` / `.tasks` / `.sessions` | 三个**全局扁平数组** | 加载时按 `instance_id` 过滤（core 侧过滤，不是渲染侧）；过滤后的数组进 store | 🔴 |
| **20** | `src/core/types.ts:63,96,116,675` `MAX_MISSIONS` / `MAX_TASKS` / `MAX_SESSIONS` / `MAX_CHARACTERS` | 四个**全局**配额 | M1 不动；M2 落库层按 instance 分组判配额（§1.4） | 🟡 |

**破除点小结**：**🔴 12 处 / 🟡 5 处 / 🟢 5 处**（共 22 项，含重复计）。最硬的三处是 **#5（桥接层转发全局状态）**、**#6（全局站位种子键）**、**#19（全局扁平数组）** —— 这三处不解决，切副本必然串数据。

---

## 3. agent 干净上下文进入

### 3.1 「干净上下文进入」的三件事（定义）

> 产品愿景原文：「进入项目 = 一个干净上下文的 Agent（『手脚』），获得当前项目和任务的上下文，完成任务开发。」

拆成三个可实施的机制：

| # | 机制 | 现状 | 本设计落点 |
|---|---|---|---|
| **①** | **落脚点绑定**：agent 的工作目录 = 项目文件夹 | ❌ `SpawnOptions.cwd` 已定义（`src/app/services/cli-transport/transport.ts:85`）且已透传到进程工厂（`:120`），但**全仓无任何调用方赋值** ⇒ CLI 子进程继承宿主 cwd | 派单时填 `cwd = 活跃 instance 的 path` |
| **②** | **上下文注入**：agent 知道「这是哪个项目、有什么约定」 | ❌ 只有 `<stratix-context>` 战场现状块（4 分节：角色档案 / 同场角色 / 近期任务 / 最近对话，`src/app/services/stratix-context.ts:146-171`），**不含项目信息** | 新增 `<stratix-project>` 块，内容从 `.stratix` 读出 |
| **③** | **退出不携带**：agent 离开副本时，副本里的上下文不跟着跑到别处 | ⚠️ 任务会话一次性（`sessionId: null`，`src/app/services/task-service.ts:1027`）⇒ 天然不携带；但 **chat 会话可 resume**（`src/app/services/chat-service.ts:537-544` 用 `externalSessionId` 种入会话）⇒ **会携带** | chat 会话绑 instance；**跨副本禁止 resume**（§3.4） |

### 3.2 ① cwd 绑定项目文件夹

**接线点（已存在，接线即可）**：

```
SpawnOptions.cwd?         src/app/services/cli-transport/transport.ts:85
ProcessFactory options.cwd src/app/services/cli-transport/transport.ts:120
runtime.ts:78              把 cwd: effective.cwd 传给进程工厂
node-process.ts:30,:70     工厂级 cwd，缺省继承当前进程
```

**接线方案**：

| 派发路径 | 位置 | 填什么 |
|---|---|---|
| 角色任务派发 | `src/app/services/task-service.ts:1027` `transport.spawn(prompt, { sessionId: null, timeoutMs })` | `cwd: activeInstance.path` |
| 角色任务续发（plan-first 批准） | `src/app/services/task-service.ts:1138` | 同上（**同一副本**） |
| 聊天派发 | `src/app/services/chat-service.ts:578` 附近 | 同上 |
| agent 互聊 | `src/app/services/agent-chat-service.ts` | 同上 |
| pipeline 步骤 | `src/app/services/pipeline-service.ts` | 同上 |

**一处改动，全适配器受益**：内建 kind 有 6 个（`claude-code` / `codex` / `opencode` / `kimi` / `openclaw` / `dsh`，`src/core/types.ts:611-618`）+ `custom:` 前缀的自定义适配器，登记表 `src/app/services/cli-transport/adapters/index.ts:40` 的 `CLI_ADAPTER_FACTORIES` —— **不需要改任何 adapter**（`adapters/dsh.ts` 的 `prepare` 只合并 env、不碰 cwd）。

**对 dsh 的额外收益**：dsh headless **没有 `--cwd`**（集成报告 §4.2 路径 D：工作目录 = 调用进程的 cwd）⇒ `SpawnOptions.cwd` 是 headless 路线指定项目目录的**唯一**办法。

**边界（现在没有、将来要有）**：cwd = 项目根 ⇒ agent **能离开项目根**（`cd ..`）。dsh 有沙箱（`ctx.sandboxPolicy.workspaceRoot` 锚定不可变的 `header.cwd`，集成报告 §4.1）。Stratix 侧 M3 之前**不做沙箱**（自建沙箱是另一个任务），但**必须记录**「cwd 是项目根」这一事实，且在 M3 与 dsh 桥接时对齐（§6.2 Q4）。

### 3.3 ② 上下文注入协议：现状五区块 → 演进六区块

#### 3.3.1 现状：注入链的五区块

派单 prompt 的拼装在 `src/app/services/task-service.ts:269-291` `buildTaskPrompt(character, taskPrompt, contextBlock?, referenceBlock?, options?)`。实际注入链的**五个区块**（按 prompt 内顺序）：

| 区块 | 内容 | 产出者 | 注入位置 |
|---|---|---|---|
| **B1 角色设定** | 引导语「你将扮演「X」这个角色执行任务…」+ `【角色设定】` persona 全文 | `buildTaskPrompt`（`task-service.ts:281,283`） | 最前 |
| **B2 引用会话** | `【引用会话 <title>(<id>) 摘要/时间线】…` | `resolveSessionReferences`（`task-service.ts:981`） | persona 之后 |
| **B3 战场现状** | `<stratix-context>` 块（内含 4 分节：角色档案 / 同场角色 / 近期任务 / 最近对话） | `resolveStratixContextBlock`（`src/app/services/stratix-context.ts:363`） | B2 之后 |
| **B4 任务指令** | `【任务指令】` + 原文；标题待生成时追加 `TASK_TITLE_INSTRUCTION`（`task-service.ts:301`） | `buildTaskPrompt`（`:286,288`） | B3 之后 |
| **B5 工作方式** | `【工作方式】` plan-first 尾部指令（`TASK_PLAN_INSTRUCTION`，`task-service.ts:338`） | `personaPlanFirst(persona)` 分支（`:290`） | **恒在最后** |

> ⚠️ **一个现存的口径瑕疵**（本设计顺带记录，不在本次改）：`buildTaskPrompt` 的参数顺序是 `(character, taskPrompt, contextBlock, referenceBlock)`，但调用点 `task-service.ts:1011-1016` 传的是 `(character, task.prompt, contextBlock, references.block, {...})` —— 即**第三参是战场现状、第四参是引用会话**；而函数体里的插入顺序是 `reference` 先于 `context`（`:284-285`）。⇒ **B2/B3 的实际顺序 = 引用会话 → 战场现状**，与函数签名给人的印象相反。本设计的新区块按**实际顺序**插入（即在 B1 之后、B2 之前）。

#### 3.3.2 演进：六区块（新增 B1′ 项目上下文）

```
B1  角色设定（引导语 + 【角色设定】persona）
B1′ 【项目上下文】<stratix-project> … </stratix-project>      ← 新增
B2  引用会话
B3  战场现状 <stratix-context> … </stratix-context>
B4  【任务指令】（+ 标题指令）
B5  【工作方式】（plan-first，恒在最后）
```

**为什么 B1′ 插在这个位置**（D11）：

- **作用域由外到内**：项目（我在哪个副本里）→ 引用会话（我要接着哪段历史）→ 战场现状（此刻场上有什么）→ 指令（做什么）。
- **不插在 B4 之后**：指令之后的内容会被模型读成「补充要求」，而不是「环境说明」。
- **不插在 B1 之前**：项目身份不是角色设定的一部分；放在 persona 之前会让「你将扮演 X」的开场被项目信息冲淡。
- **不插在 B2 之后**：引用会话是「这次任务要接着的那段历史」（task_107 的定位），它比项目更靠近任务。

#### 3.3.3 `<stratix-project>` 块的内容契约

**数据源全部来自 task_159 定义的 `.stratix` 目录契约**（agent 只读，Stratix 侧读）：

| 分节 | 内容 | 源文件 |
|---|---|---|
| `# 项目` | 名字 / 一句话说明 / 逻辑 id / 分支 / 项目根路径 | `.stratix/project.json`（`name` / `description` / `id` / `instance.vcs.branch`） |
| `# 可用角色` | 角色名 + 逻辑 id + 绑定 agent 种类（白名单口径，见 task_159 §1.3 的 `roster/_index.json`） | `.stratix/roster/_index.json` + `roster/<role-id>.json` |
| `# 项目约定` | 默认角色 / 并发上限 / 权限预设 | `.stratix/config/stratix.json`（`agent.*`） |
| `# 项目技能` | 技能名列表（**只列名**，不注入全文 —— 两级注入，架构报告 §5.3） | `.stratix/skills/*/SKILL.md` 的目录名 |
| `# 指令文件` | `AGENTS.md` / `CLAUDE.md` 是否存在（存在则说明「已自动加载，无需你读」） | 项目根的文件存在性 |

**渲染形状**（与 `<stratix-context>` 同款：分节小标题 + `#` 前缀 + 说明行 + 体积上限 + 从尾段砍）：

```
<stratix-project>
以下是当前项目的契约快照，供你完成任务时遵守（这不是用户消息）：
# 项目
雨林哨站（spx_9f3c2a1b7d4e5f60）
一句话说明：…
分支 demo/v3.3 · 根目录 /Users/kingj/code/Stratix-demo
# 可用角色
- 斥候（scout）· claude
- 工匠（builder）· claude-code
# 项目约定
默认角色 scout · 并发上限 2 · 权限预设 project-safe
# 项目技能
scout-recon · build-order
# 指令文件
AGENTS.md · CLAUDE.md（已自动加载）
</stratix-project>
```

**体积预算**：`STRATIX_PROJECT_CONTEXT_MAX_CHARS = 2000` 码点（含标签）。比战场现状块（`STRATIX_CONTEXT_MAX_CHARS = 4000`，`stratix-context.ts:53`）小 —— 项目契约信息少。**截断策略照抄**：逐段拼装 → 超限从**尾部段整段砍** → 只剩首段仍超限则硬截正文并保标签配对。

**不注入什么（明确）**：

| 不注入 | 理由 |
|---|---|
| **凭据 / token / api key** | `.stratix` 内一律不出现凭据（task_159 §3.3 约束 1）；本块只写环境变量名 |
| **`.stratix/history/` 的内容** | 任务史是本地态、默认不提交；agent 不需要读别人的历史 |
| **`roster/<role-id>.json` 的 persona 全文** | persona 已经通过 B1 内嵌了；重复注入会让 prompt 膨胀 |
| **技能全文** | 两级注入（架构报告 §5.3）：目录进 prompt，全文由模型按需取 |
| **另一个副本的任何信息** | 副本互不可见（D5） |

#### 3.3.4 谁来读 `.stratix`（分层铁律）

**core / world / hud 全部零 IO**（铁律）。所以：

| 层 | 职责 |
|---|---|
| **core** | 只冻结契约**形状**（`ProjectView` / `ProjectInstanceView` 等类型与上限常量），**不读文件** |
| **app（service 进程）** | 读 `.stratix` → 组装 `ProjectContextInput` → 提供端口 |
| **world / hud** | 零 IO，不碰 `.stratix` |

**新增文件（草案）**：`src/app/services/project-context.ts` —— **完全照抄 `src/app/services/stratix-context.ts` 的三段式**：

```
① buildProjectContextBlock(input): string        纯函数（渲染 + 截断）
② createProjectContextProvider(deps): Source      provider 工厂（注入件）
③ resolveProjectContextBlock(source, ...): string service 侧统一入口（吞错降级为 ''）
```

- **零 IO**：本文件只拼串；读 `.stratix` 的动作在 app 层装配处（组合根）用 `fs` 读，**读到的结果作为纯数据注入**。
- **吞错降级**：与 `resolveStratixContextBlock` 同口径 —— 「上下文是增强，不是依赖，坏了不能绑架任务回路」（`stratix-context.ts:10-11`）。
- **装配位置**：`src/app/main/main-entry.ts`（组合根）+ gateway 侧 `src/stratix-gateway/service/`（service 进程）。

**注入点**：与 B3 同一注入点 —— `src/app/services/task-service.ts:1011-1016`（首发）；**续发路径不重注**（`buildResumedTaskPrompt` 走 `buildTaskPrompt`，**不传** project 块 ⇒ 首发的项目块已在上下文里；与 `<stratix-context>` 同口径，task_053 也只在首发注入）。

**开关**：沿用两级开关的思路，但**独立于** `STRATIX_CONTEXT_TOGGLE_KEY`（战场现状的开关）—— 新增 `STRATIX_PROJECT_CONTEXT_TOGGLE_KEY = 'stratix.project.context.enabled'`（缺省 = 开）。理由：战场现状是「此刻场上有什么」，项目上下文是「你站在哪」—— 后者关掉会让 agent 不知道自己该改哪个目录，代价更大；两者粒度不同，不该共用一个开关。

### 3.4 ③ 退出不携带

**四条不携带规则**：

| # | 规则 | 机制 | 出处 |
|---|---|---|---|
| **R1** | **任务会话天然不携带** | 常规任务 `sessionId: null`（一次性会话，无续发）⇒ 下一次派单是新会话、无历史 | `src/app/services/task-service.ts:1027`；文件头「会话隔离」段（`:31`） |
| **R2** | **plan-first 续发不重注项目块** | `buildResumedTaskPrompt` 只重建「首发语义」（persona + 引用 + 战场现状 + 指令），**项目块不重建**（首发已含） | `task-service.ts:375-388`；§3.3.2 |
| **R3** | **chat / 互聊会话不得跨副本续发** | `externalSessionId` 变成 **instance 级**（§1.3.3）⇒ 切副本后 A 副本的外部会话 id 在 B 副本不存在 ⇒ resume 不可能。**并且** resume 时校验「会话所属 instance == 当前活跃 instance」，不符则按「首发」处理（不复用外部会话） | `src/app/services/chat-service.ts:537-544`；`src/app/services/agent-chat-service.ts` 的 resume 路径（`:941`） |
| **R4** | **任务产出不回流到别的副本** | 任务终态落 `character_tasks`（带 `instance_id`）+ 回报给**同 instance** 的 mission（`missionId` 钥匙，task_076）⇒ 副本 A 的任务不会让副本 B 的 mission 收工 | `src/app/services/task-service.ts:773` `onMissionSettled`；`src/stratix-gateway/service/mission-report.ts:76` |

**R1 之外还要说的**：**dsh 侧的「退出」语义**。dsh 的 session 是 append-only 事件 log，**resume 会重放历史**（架构报告 §5.1）。Stratix 的「退出副本」= **不再 resume 该副本的任何会话**；若 dsh 侧仍留着 session log，那只是**磁盘上的日志**，不会被 Stratix 再次挂载（挂载条件 = 「会话归属 instance == 活跃 instance」，R3 的校验）。

### 3.5 与 dsh session / preset 语义的对照

> dsh 参照版本：只读仓库 HEAD **`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`**（`@deepseek-ai/dsh-root@0.2.2-rc.1`）。开工前置已 `git pull`（「已经是最新的」）。**下表右侧的 dsh 结论已在本 HEAD 上逐条复核**（复核项见 §3.6）。

| 语义轴 | dsh 怎么做（出处） | Stratix 现状 | 本设计取法 |
|---|---|---|---|
| **「进入一个项目」** | `SessionHeader.cwd` = 项目根（**不可变**绝对路径）；`packages/core/session/src/types.ts:106` | ❌ 子进程继承宿主 cwd | `SpawnOptions.cwd` = 活跃 instance 的 `path`（§3.2） |
| **「模型知道自己在哪」** | 模型上下文自动注入 `Current working directory: "<path>"`（`packages/session/working-directory/src/index.ts:172-174`，`contextText`） | ❌ | 我们注入 `<stratix-project>`（**互补**：dsh 说「在哪」，我们说「这是啥」） |
| **「干净上下文」** | 新建 session（**不 resume**）；session = append-only 事件 log，消息历史是**投影**（架构报告 §5.1） | 任务会话已一次性（`sessionId: null`） | ✓ 沿用；**明确拒绝**用 fork 造副本（fork 是会话分叉，不是世界副本 —— 集成报告 §4.6 的判断） |
| **「能力组合」** | **preset** = 一组具名的、声明式的子 Cordis 插件行，决定「这个 session 的工具集和 prompt」，**写进 session header**（`packages/core/session/src/types.ts:133-135`）；理由原文 *"a resume that restored a different composition would replay history the model can no longer act on"* | 角色 = 数据库一行（名字 + persona + agent 绑定） | **借**：角色升级为能力组合（task_159 §1.3）+ **快照进 session header**（task_159 §4.3）；本设计补：**进入副本时选定角色，退出后不可换**（对标 `agent-preset/locked`） |
| **「会话开始后不许换 preset」** | `packages/preset/agent-preset-registry/src/index.ts:364` 抛 `RemoteError('agent-preset/locked', 'This session has already started')` | 无此约束 | 同款约束：会话一旦建立，**角色/能力组合冻结**；切副本 ⇒ 新会话 ⇒ 可换 |
| **「可变的落脚点 vs 不可变的项目身份」** | `ctx.workingDirectory` 可变（per-session），但**沙箱根锚定不可变的 `header.cwd`**（集成报告 §4.1：*"有效工作目录 cd 不改变沙箱边界"*） | 无 | **对齐**：项目身份 = instance（不可变）；agent 可在项目内 cd，但**不得离开项目根**（M3 与 dsh 桥接时对齐，见 §6.2 Q4） |
| **「多项目并存」** | `ctx.workspaceRegistry` = **多根管理器**（稳定 id + 规范路径 + 顺序 + 置顶/归档），唯一性按 realpath 判等（集成报告 §4.4） | ❌ 一张全局图 | **直接对齐** task_159 §2.4 的 `workspaces.json`；大厅 = 这个注册表的可视化 |
| **「会话归属校验」** | 会话的 `header.cwd` 规范化后必须 == `Workspace.path`，否则 `cannot attach session …`（集成报告 §4.4 / `packages/workspace/workspace/src/entity.ts:110-141`） | 无 | **对齐**：会话的 `instanceId` 必须 == 活跃 instance，否则**拒绝挂载**（R3） |
| **「profile / bundle vs 项目契约」** | profile 是 `$DSH_HOME` 下的**部署**概念；**dsh 没有项目级元数据目录约定**（集成报告 §4.6） | — | **沿用 task_159 §3.2 裁决**：`.stratix` ↔ project；profile ↔ deployment；桥接点只有 `.stratix/dsh/*.patch.yml` |
| **「agent 只读契约面」** | dsh 不留项目级配置/状态（配置与状态全在 `$DSH_HOME`） | — | **沿用 task_159 D7**：`.stratix` 对 agent **只读**；agent 要改就派单给角色 |

**三条「我们比 dsh 多做的」**（本设计的净增量）：

1. **项目契约的语义层**：dsh 只知道「cwd 是哪个目录」，不知道「这个目录是个什么项目、有哪些角色、有什么约定」。`<stratix-project>` 补上这一层。
2. **世界的副本隔离**：dsh 的多根只是「多个 cwd」，**没有「切换 = 重载世界态」这层**（dsh 一个 session 一个 cwd，多 session 可共享 checkout）。Stratix 的副本是**独立世界态**（missions / tasks / characters 各自独立）。
3. **养成隔离**：dsh 没有养成；Stratix 的 exp 按副本独立结算（§1.3.3）。

**三条「我们必须抄 dsh 的纪律」**：

1. **能力组合快照进 session header**（`packages/core/session/src/types.ts:133-135` 的理由原文）。
2. **会话开始后不许换 preset**（`agent-preset/locked`）。
3. **append-only 事件日志 + 投影**（架构报告 §5.1）—— 本设计用于 `.stratix/history/*.jsonl`（task_159 §1.3 已定），**不借它当真相源**（铁律 1）。

### 3.6 dsh 结论的 HEAD 复核记录

**开工前置**：`cd /Users/kingj/code/deepseek-harness && git pull` → 「已经是最新的」；HEAD = **`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`**（`Merge pull request #7873 from deepseek-harness/merge/release-dsh-0.2.2-rc.1-to-master`，2026-11-04）。

**与 task_157 / task_158 的 HEAD 关系**：

| 报告 | 所注 HEAD | 与本次的关系 |
|---|---|---|
| task_158《dsh 集成面测绘》 | `fcc0ad4621` | **完全一致** ⇒ 其 §4 / §5 结论可直接引用 |
| task_157《插件架构深读》 | `ce7073d5`（更早） | 有漂移，但**本文引用的 task_157 结论**（preset 写进 session header、session 事件流与 `SESSION_FORMAT_VERSION`、skill 两级注入）**均不落在改动面上** |

**本次在 HEAD `fcc0ad46` 上逐条复核的 dsh 结论**（读源码，非引用旧报告）：

| # | 结论 | 复核位置（HEAD `fcc0ad46`） | 复核结果 |
|---|---|---|---|
| 1 | session header 的 `cwd` 是不可变绝对路径 | `packages/core/session/src/types.ts:106` | ✅ 一致（`readonly cwd?: string`，注释 *"Absolute working directory the session was created in"*） |
| 2 | `agentPreset` 写进 session header（能力组合随会话固化） | `packages/core/session/src/types.ts:133-135` | ✅ 一致（注释原文 *"the preset decides the session's tools and prompt: a resume that restored a different composition would replay history the model can no longer act on"*） |
| 3 | 会话开始后不许换 preset（`agent-preset/locked`） | `packages/preset/agent-preset-registry/src/index.ts:364-368` | ✅ 一致（`throw new RemoteError('agent-preset/locked', 'This session has already started', …)`） |
| 4 | 模型上下文自动注入 `Current working directory: "<path>"` | `packages/session/working-directory/src/index.ts:172-174`（`contextText`） | ✅ 一致（`return \`Current working directory: ${JSON.stringify(this.get(session))}.\``） |
| 5 | 工作目录是 system-prompt 上下文贡献（required、prepend） | `packages/session/working-directory/src/index.ts:90-110` | ✅ 一致（`ctx.systemPrompt.context({ name: 'working-directory:current', required: true, … })` + `system-prompt/assemble` 的 `prepend: true`） |
| 6 | session 可 fork（会话分叉） | `packages/core/session/src/index.ts:1403` | ✅ 一致（`fork(source, boundary?, childSessionId?)`）—— **但本设计不用它造副本**（fork 是会话分叉，不是世界副本） |
| 7 | 会话挂载到 workspace 时校验 cwd 一致 | `packages/workspace/workspace/src/entity.ts:110-141` | ✅ 一致（`cannot attach session '…' to workspace '…': its stored header carries no cwd to validate against`） |

> **结论**：dsh 0.2.2-rc.1 **未变更**本设计依赖的 session / preset / working-directory 语义面。§3.5 的对照表可直接引用。

---

## 4. 既有机制复用审计

> 审计口径：**「能直接复用的」/「需要加 project 维度的」/「必须改造的」**三档。全部结论带 `path:line`。

### 4.1 world-sync 协议

**现状**（已核实）：

| 项 | 位置 | 结论 |
|---|---|---|
| 协议契约层 | `src/stratix-gateway/api/websocket/world-sync/protocol.ts` | 纯类型 + 纯函数，**零运行时依赖**（不 import ws，`:8` 明令） |
| 传输端点 | `src/stratix-gateway/api/websocket/world-sync/endpoint.ts:223` `WorldSyncEndpoint` | 单 store（`:225`）+ `sessions` 集合（`:246`）+ **全 service 统一 seq**（`:344`） |
| 每连接会话 | `src/stratix-gateway/api/websocket/world-sync/session.ts:107` `WorldSyncSession` | 「一条 WS 连接 = 一个会话」= **传输层**会话，与 core/session 的业务会话不是一回事 |
| 挂载 | `endpoint.ts:552` `attachWorldSyncEndpoint` → 调用点 `src/stratix-gateway/index.ts:321` | 挂在 gateway 的**同一个 HTTP server** 上，路径 `/ws/world-sync`（`protocol.ts:47`） |
| 客户端 | `src/app/services/remote-store/remote-store.ts:170` `createRemoteStore` | 浏览器原生 WebSocket，收 snapshot **全量覆盖** |
| **端口** | `src/stratix-gateway/index.ts:114`（`PORT \|\| '3010'`）、dev 实跑 `scripts/restart-backend.sh:9`（`PORT=7524`）、客户端缺省 `remote-store.ts:152` `DEFAULT_WORLD_SYNC_PORT = 7524` | ⚠️ **不是 7525**（7525 是历史端口，见 `scripts/kill-ports.sh:8`；`WS_PORT` 3011 跑的是老的 `StatusSync`，`endpoint.ts:210-211` 明确不复用） |

**结论：协议**无任何 project / 订阅 / 房间概念** —— 消息型只有六种（`protocol.ts:62-68`），`hello` 只有 `protocolVersion` + `clientId`（`:128-134`），广播把**同一份** snapshot 推给所有连接（`endpoint.ts:479`），快照内容 = `store.getState()`（`:341-346`），命令/事件载荷**不带任何路由标识**。

**适配点（4 处）**：

| # | 位置 | 适配 | 破坏性？ |
|---|---|---|---|
| 1 | `protocol.ts:128` `HelloMessage` | 加 `instanceId`（客户端报出它要看的副本） | ⚠️ **破坏性** ⇒ 必须升 `WORLD_SYNC_PROTOCOL_VERSION`（`protocol.ts:41`，当前 2）→ 老 service 回 `unsupported_version` 并断连（`session.ts:204-212`）—— 这是**正确的响亮失败** |
| 2 | `protocol.ts:157` `CommandForwardMessage` / `:229` `EventForwardMessage` | 载荷带 `instanceId`（否则命令无法路由到正确的 store —— `endpoint.ts:352` 只收到裸 command） | ⚠️ 破坏性 ⇒ 同 #1 一起升版本 |
| 3 | `protocol.ts:145` `SnapshotMessage.state` | 要么按 project 过滤，要么 `WorldStateWire` 带 `activeInstanceId` | 加字段是**非破坏性**（可只升 MIN 不升 MAX） |
| 4 | `endpoint.ts:246` `sessions` 集合 + `:341` `issueSnapshot` | 单 store 语义要改（多 store，或 store 内按 instance 分区） | 内部改造 |

**裁决**：**M1 不动 world-sync**（单副本场景下协议语义完全不变）；**M2 加 instanceId 并升协议版本到 3**（MIN 仍 1 —— v1/v2 客户端只用到 hello / snapshot / command.forward / command.ack，那套语义一字未改）。

**可直接复用的**：`toWireState` / `fromWireState` 的无损互转（`protocol.ts:282`）、全量覆盖的重连语义、seq 统一发号、ack 超时兜底（`protocol.ts:59`，5 s）。

### 4.2 mission 状态机

**现状**（已核实）：

| 内容 | 位置 |
|---|---|
| 纯函数状态机 | `src/core/mission/machine.ts:203` `applyMissionAction`；相位机 `:13-18`；动作词表 `:59-69`；终态判定 `:72-76` |
| 建任务工厂 | `src/core/mission/machine.ts:177` `createMission`（brief `:135`、dependsOn `:154`） |
| checkpoint | `src/core/mission/machine.ts:257` `appendMissionCheckpoint`（append-only，终态拒，上限 `MAX_MISSION_CHECKPOINTS=64` **per-mission**） |
| 依赖判定 | `src/core/mission/machine.ts:315` `isMissionUnlocked` / `:346` `resolveMissionDependencies` / `:372` `findMissingDependencies` |
| 腾位置 | `src/core/mission/machine.ts:436` `dropSettledMissions` |
| 写入面 | `src/core/mission/manager.ts:213-220`（`maxMissions`）/ `:239` 裁剪 / `:256` 写 `state.missions` / `:438` 确认守门 |
| 命令入口 | `src/core/runtime.ts:484-508`（mission.create / assign / confirm / cancel / remove / checkpoint） |

**结论**：missions 是 `WorldState.missions` 的**一个扁平数组**，manager 全程操作这一份，**无任何 per-project 索引**；依赖判定吃**全量数组**（`manager.ts:438` `findMissingDependencies(next, state.missions)`）。

**加 `mission.instanceId` 够不够？—— 不够，三处全局耦合**：

| # | 耦合 | 出处 | 适配 |
|---|---|---|---|
| 1 | **上限是全局的** | `MAX_MISSIONS = 100`（`src/core/types.ts:63`）→ `manager.ts:220`；裁剪 `manager.ts:239` `dropSettledMissions(state.missions, this.maxMissions - 1)` 用**整份数组** | 落库层按 instance 分组判配额（§1.4） |
| 2 | **裁剪是全局有序的** | `machine.ts:436-442` 按数组顺序丢终态，不区分项目 | 分组后各自裁 |
| 3 | **依赖判定会跨 project 误判** | `machine.ts:346-365` `resolveMissionDependencies` 用 `new Map(allMissions.map(...))` 建**全量索引** ⇒ A 项目的任务可依赖到 B 项目的 mission id 而被判「已满足」 | **按 project 过滤后再传入**（`manager.ts:438` 改成传过滤后的数组） |

**可直接复用的**：相位机本体（零改动）、checkpoint 的 append-only 语义（**per-mission**，天然副本内）、`MissionBrief` 四段契约（**per-mission**，天然副本内）、`canRemoveMission`。

**结论**：**mission 状态机本体零改动**；改的是**喂给它的数组**（按 instance 过滤）+ **上限语义**（分组判）。

### 4.3 任务回报链

**现状链路**（已核实）：

```
transport 跑完/失败
 → task-service.ts:838 / :1086 / :1159  settle(record, 'task_failed' | 'task_completed')
 → task-service.ts:760  settle()  ← 唯一终态收口
     ├─ :762  recordTaskSession(record)    → :719 建 task_run 会话并收尾
     ├─ :763  recordMissionSession(record) → :736 建 mission_run 会话
     ├─ :764  deps.onTaskSettled(record)   → 组合根 main-entry.ts:1514（pipeline + 成果物面板）
     ├─ :773  deps.onMissionSettled(record)→ main-entry.ts:1484-1488
     │        completed → missionManager.completeMission(missionId)
     │        failed    → missionManager.cancelMission(missionId)
     │        service 侧兜底：src/stratix-gateway/service/mission-report.ts:76
     ├─ :780  deps.pushNotice(...)
     └─ :799  emitExp(record.characterId, source)
              → task-service.ts:645 emitExp → :649 emitWorldEvent({type:'exp.gained', …})
              → app/services/progression-service.ts:66 handle → :69 characterManager.grantExperience
                 → core/character/manager.ts:411（同一次 setState 内写 characters[index] + units[].level）
              → progression-service.ts:76 persistExpEvent → exp_events 表
              → progression-service.ts:94 emitWorldEvent level.up
```

**端口声明**：`src/app/services/task-service.ts:459` `onTaskSettled` / `:464` `onMissionSettled` / `:493` `onMissionTitle` / `:474` `missionExists`。

**加 project 维度的适配点**：

| # | 适配点 | 说明 | 性质 |
|---|---|---|---|
| 1 | `settle()` 的**收口**不变 | 终态收口在 `task-service.ts:760`，**一处** —— instance 维度只需在收口处把 `record.instanceId` 带上 | 🟢 零改动 |
| 2 | **mission 回报的钥匙是 `missionId`** | `record.missionId`（`CharacterTask.missionId`，task_076）⇒ 只要 mission 与 task 同 instance，回报**天然不跨副本**。**前提**：core 的 mission 池按 instance 过滤（§4.2 #3） | 🟢 |
| 3 | **`emitExp(record.characterId, source)`** | exp 落在**全局角色**上（`CharacterView.experience`，`src/core/types.ts:837`）⇒ 需改成按 (instance, character) 结算 | 🟡 见 §4.4 |
| 4 | **会话记录** | `recordTaskSession` / `recordMissionSession` 建的会话要带 `instanceId`（`SessionRecord.instanceId`）⇒ 会话列表按副本过滤、跨副本禁止 resume | 🟡 |
| 5 | **`mission-report.ts:76` 的兜底** | `settleMissionFromTaskReport` 查表判存在性 ⇒ 查表要带 instance 过滤 | 🟡 |
| 6 | **`missionExists` 端口（`task-service.ts:474`）** | 存在性校验要带 instance（防止 `mission_id` 指到别的副本的 mission） | 🟡 |

**可直接复用的**：整个回报链的结构（**收口唯一**是它的最大优点 —— project 维度只需要在收口处带一个字段，不用改 6 个调用点）。

### 4.4 exp 养成

**现状**（已核实）：

| 项 | 位置 | 结论 |
|---|---|---|
| 字段 | `CharacterView.experience` / `.level`（`src/core/types.ts:832-837`） | **角色级**，无 project 维度 |
| 写入面 | `src/core/character/manager.ts:411-459` `grantExperience`（同一次 `setState` 内「查找 → 判定 → 累加 → 等级结算 → `units[].level` 同步」） | 唯一入口 |
| 纯函数 | `src/core/character/growth.ts:61` `grantExperience`（增量校验 + 不可变投影） | 零改动 |
| 事件源 | `ExpSource = 'task_completed' \| 'task_failed' \| 'chat_round'`（`src/core/types.ts:1573`） | 权重表 `src/core/progression/weights.ts:26-34`（50 / 10 / 5） |
| chat 轮 | `src/app/services/agent-chat-service.ts:615-618` | 同上 |
| 落库 | `src/app/services/persistence/exp-event-dao.ts:68` `exp_events`（列 `character_id / delta / reason / level / created_at`） | **无 project 维度** |
| 契约 | `src/core/character/manager.ts:21` 注释：**经验没有对应的 HudCommand**，只暴露给程序化入口 | 零改动 |

**裁决：exp 归 instance（副本独立养成）**（§1.3.3 的理由 2）。

**适配点**：

| # | 适配点 | 说明 |
|---|---|---|
| 1 | `characters` 表加 `instance_id` | 同一角色在两个副本 ⇒ 两行，各自 level/exp |
| 2 | `exp_events` 表加 `instance_id` | 流水按副本分区（审计口径） |
| 3 | `grantExperience(characterId, amount)` 的调用方（**唯一**：`progression-service.ts:69`）带上 instance | 签名可保持（character id 本身已 instance 内唯一 ⇒ **签名零改动**） |
| 4 | `core/character/manager.ts:411` 的「查找」 | `characters` 数组里按 id 找（id 已 instance 内唯一）⇒ **零改动** |
| 5 | `units[].level` 同步（`:411` 同一次 setState 内） | 单位也是 instance 内 ⇒ 零改动 |
| 6 | `ExpSource` 词表 | **零改动**（来源语义与副本无关） |

**结论：exp 层的适配成本极低** —— 因为 §1.3.3 的 N4（character id instance 内唯一）已经把「查哪一行」的问题解决了。**exp 的「归哪个副本」变成一个纯粹的「加列」问题。**

### 4.5 汇总：五个硬阻断点

| # | 阻断点 | 为什么硬 | 解决期 |
|---|---|---|---|
| **B1** | **协议层无 project 概念**（`protocol.ts:41,128,157,229`） | 加字段即破坏性变更；命令无法路由 | M2（升协议版本到 3） |
| **B2** | **广播层是全量单份**（`endpoint.ts:341-346,479`；`store.ts:311`） | 按 project 投影要同时改协议与端点 | M2 |
| **B3** | **四个池 + 四个上限全是全局的**（`types.ts:63,96,116,675` + 四个 manager 的裁剪）+ **依赖判定吃全量数组**（`machine.ts:346`） | 不改则副本互相挤配额、依赖跨副本误判 | M2 |
| **B4** | **养成挂全局角色**（`types.ts:837` + `character/manager.ts:411` + `exp_events`） | 不改则副本共享一条成长线 | M2（成本最低，因为 N4 已铺垫） |
| **B5** | **持久化层每张表两份 DDL** | `characters` / `character_tasks` / `sessions` / `session_events` / `exp_events` / `unit_positions` 的 DDL **在 DAO 侧与 `StratixDatabase` 侧各一份**（各 DAO 文件头都写明「两处同步改」）⇒ 加列必须**两边同步** + `schema_version` 迁移（`src/stratix-database/StratixDatabase.ts:159`） | M1（M1 只加 `instance_id` 列） |

---

## 5. 实施分期

### 5.1 M1 —— 最小副本（单项目切图 + agent 进入）

**目标**：**一个**项目实例下能「进副本 → 派单 → agent 在项目根干活 → 退出」，且大厅/战场两个形态可用。**不追求多项目并行**。

**改动面**：

| 层 | 改动 | 文件 |
|---|---|---|
| **core 契约** | 加 `ProjectView` / `ProjectInstanceView` / `ProjectStatus` / `ProjectInstanceId` 类型；`WorldState` 加 `projects?` / `projectInstances?` / `activeInstanceId?`；`MissionView` / `CharacterTask` / `CharacterView` / `SessionRecord` / `UnitView` 各加 `instanceId?`；`HudCommand` 加 `project.enter` / `project.exit`；`WorldEvent` 加 `project.changed`；上限常量 `MAX_PROJECTS` / `MAX_PROJECT_INSTANCES` / `STRATIX_PROJECT_CONTEXT_MAX_CHARS` | `src/core/types.ts` |
| **core 运行时** | `runtime.ts` 接地 `project.enter` / `project.exit`（裁决 + 写 `activeInstanceId` + 发 `project.changed`）；`store.ts` 加「按 instance 重载」的装配期动作 | `src/core/runtime.ts`、`src/core/store.ts` |
| **持久化** | 六张表加 `instance_id` 列（**两侧 DDL 同步**）；`schema_version` 迁移 | `src/app/services/persistence/*-dao.ts`、`src/stratix-database/StratixDatabase.ts` |
| **app 服务** | 新增 `src/app/services/project-context.ts`（三段式，纯函数 + provider + resolve）；组合根装配「读 `.stratix` → 注入 provider」；`task-service.ts` 派发时填 `SpawnOptions.cwd` | `src/app/services/project-context.ts`（新）、`src/app/services/task-service.ts`、`src/app/main/main-entry.ts` |
| **world** | 新增 `src/world/scenes/LobbyScene.ts`；`BattlefieldScene` 读 scene data 的 `instanceId`、按 instance 过滤转发、站位种子键分区；组合根场景表加 `LobbyScene`、按 instance 注入站位种子 | `src/world/scenes/LobbyScene.ts`（新）、`src/world/scenes/BattlefieldScene.ts`、`src/world/bridge/bus-adapter.ts`、`src/app/main/main-entry.ts` |
| **HUD** | 大厅卡片网格（挂在既有 HUD 之上，world 场景是 LobbyScene）；派单入口在大厅态降级 | `src/hud/screens/main-screen.ts`（或新增 `src/hud/screens/lobby-panel.ts`）、`src/hud/panels/command-catalog.ts` |

**M1 的关键取舍**：

- **单实例** ⇒ N4（character id instance 内唯一）**暂不做** ⇒ `characters.id` 不变 ⇒ `unit_positions` PK 不变 ⇒ **迁移风险最低**。
- 但 `<stratix-project>` 块**照做**（M1 的价值一半在这儿）—— 它不依赖多实例，只依赖「读 `.stratix`」。
- `SpawnOptions.cwd` 接线**照做**（task_159 S6）—— 同上。
- world-sync **不动**（单实例下语义不变）。

**风险**：

| 风险 | 等级 | 缓解 |
|---|---|---|
| `project.enter` 的重载语义与「重连 = 全量覆盖」不一致（core 侧自己重载 vs world-sync 侧重连） | 🟡 | 两处都走「全量替换 store 内容」这一条路径，不做增量 |
| 大厅场景与 HUD 的职责边界（谁画卡片） | 🟡 | 大厅卡片**由 HUD 画**（数据在 `WorldState`），world 的 `LobbyScene` 只画背景与氛围 ⇒ **world 零业务状态**（铁律 1） |
| 站位种子键分区改坏老存档 | 🟡 | 保留旧键作 fallback（读不到新键时回落旧键） |
| `instance_id` 列的 DDL 双写遗漏 | 🔴 | 加列走 `schema_version` 迁移（`StratixDatabase.ts:159`），**两侧 DDL 必须同步**（每个 DAO 文件头都写明了这一点）⇒ 迁移测试必须断言新列存在 |

### 5.2 M2 —— 多项目并行

**目标**：注册表里 N 个副本，可任意切换；副本间**互不可见**；**各自独立养成**。

**改动面（在 M1 之上）**：

| 层 | 改动 |
|---|---|
| **契约/注册表** | 实现 task_159 的 `workspaces.json` 注册表（marker walk-up 发现 + needs-init 引导 + 原子写）；`ProjectView.sourceFingerprint` 同源识别 |
| **core** | mission / task / session 的**依赖判定与裁剪按 instance 分组**（`machine.ts:346`、`manager.ts:239` / `task/manager.ts:220` / `session/manager.ts:345`） |
| **持久化** | **N4：character id instance 内唯一**（`chr_<instanceId>_<roleId>`）+ 新增 `role_id` 列 + 一次性 id 重写（含 `unit_positions` / `character_tasks` / `sessions.participants` 的同事务更新）；`exp_events` 加 `instance_id` |
| **契约 reconcile** | roster → characters 的**按 instance 物化**（单向、增量、≤ 50 ms/实例） |
| **world-sync** | `hello` / `command.forward` / `event.forward` 带 `instanceId`；**协议版本 2 → 3**（MIN 仍 1）；端点 sessions 分组 |
| **HUD** | 大厅支持多卡片、排序 / 置顶 / 归档 / 同源副本提示 |

**风险**：

| 风险 | 等级 | 缓解 |
|---|---|---|
| **一次性 id 重写**（N4）是最危险的一步 | 🔴 | 映射表先落 `.stratix/state/`；同事务更新引用方；默认沙盒实例的行**不改 id**；提供回滚脚本 |
| 契约 reconcile 的性能（每次切副本都要物化） | 🟡 | 增量（mtime + 哈希指纹）+ ≤ 50 ms/实例预算（task_159 §5.2） |
| 副本配额互相挤（B3） | 🟡 | 落库层按 instance 分组判配额（§1.4） |
| world-sync 升版本打断旧客户端 | 🟡 | MIN 仍 1；老客户端只用到未变的消息型；`unsupported_version` 是响亮失败（`session.ts:204-212`） |
| 副本多了以后大厅渲染卡顿 | 🟡 | ≤ 200 实例上限 + 分页 / 虚拟化（perf 铁律） |

### 5.3 M3 —— dsh 桥接

**目标**：把「agent 进入副本」落到 dsh 上 —— dsh headless / SDK 会话的 `header.cwd` = 项目根；dsh preset ↔ Stratix 角色的能力组合对齐。

**改动面**：

| 项 | 内容 |
|---|---|
| **cwd 落地** | `SpawnOptions.cwd` → dsh adapter（headless 只能靠进程 cwd，集成报告 §4.2 路径 D）；dsh adapter 的 `prepare`（`src/app/services/cli-transport/adapters/dsh.ts:202`）只合并 env ⇒ cwd 走 transport 层，**adapter 零改动** |
| **preset 对齐** | `.stratix/roster/<role-id>.json` 的 `capabilities` → dsh preset 声明；**能力组合快照进 session header**（task_159 §4.3 + 架构报告 §5.2 的理由） |
| **技能挂载** | `.stratix/skills` 经 `customSkillDirs` 挂载（task_159 D6），**不复制**进 `.dsh/skills` |
| **patch 锚定** | `.stratix/dsh/bridge.patch.yml` 走 `--patch`（相对路径按 patch 文件目录锚定，集成报告 §3.5） |
| **斜杠命令转义** | 派活文案以 `/` 开头时改走 `session/prompt`（集成报告 §6.3 / §7 #25、#26） |
| **沙箱边界** | 项目根 = 沙箱根（对齐 dsh 的 `sandboxPolicy.workspaceRoot` 锚定不可变 `header.cwd`）；**Stratix 侧当前无沙箱** ⇒ M3 要么引入、要么显式声明「无边界」（§6.2 Q4） |
| **前置阻塞** | ⚠️ **Stratix 侧的 rc.1 版本钉位互斥**（集成报告 §0.1.3 / §7 #16：`cordis ~4.0.5` 装不上 rc.1 的 `4.1.0`；`dsh-tools 0.2.1-rc.5` → `0.2.2-rc.1`）**必须先解掉** |

**风险**：

| 风险 | 等级 | 缓解 |
|---|---|---|
| rc.1 版本钉位互斥 | 🔴 | M3 启动前先解依赖钉位（独立任务） |
| dsh 的 session log 与 Stratix 的会话语义不一致（dsh = append-only log + 投影） | 🟡 | 只借形状不借真相源（铁律 1）；Stratix 的真相仍是 core store |
| dsh 的 `working-directory` 可变 ⇒ agent 可能 cd 离开项目根 | 🔴 | 与沙箱边界一并决策（§6.2 Q4） |
| 派活文案误触 dsh 斜杠命令 | 🟡 | `dispatchPromptChannel` 开关（task_159 §3.4） |

### 5.4 三期对照表

| | **M1 最小副本** | **M2 多项目并行** | **M3 dsh 桥接** |
|---|---|---|---|
| **目标** | 单项目：进副本 → 派单 → agent 在项目根干活 → 退出 | N 个副本并行、互不可见、独立养成 | dsh 会话落在项目根；角色 = dsh preset |
| **core 契约** | 加类型 + 可选字段 + 两条命令 + 一个事件 | 加分组判配额 / 依赖隔离 | 加能力组合快照 |
| **持久化** | 六表加 `instance_id`（双侧 DDL） | N4 id 重写 + `role_id` + `exp_events.instance_id` | 不变 |
| **world** | `LobbyScene` + scene data + 种子键分区 | 多实例切换 + 场景重建 | 不变 |
| **HUD** | 大厅（单卡片）+ 降级 | 多卡片 / 排序 / 置顶 / 归档 / 同源提示 | 不变 |
| **world-sync** | 不动 | 协议 2 → 3（带 `instanceId`） | 不变 |
| **dsh** | 不碰 | 不碰 | cwd / preset / skills / patch / 斜杠转义 |
| **最大风险** | DDL 双写遗漏 | **一次性 id 重写** | **rc.1 版本钉位互斥** |
| **依赖** | task_159 的 S1/S2/S4/S6 | task_159 的 S3/S5/S7/S8 | M1 + M2 + 依赖钉位解锁 |

---

## 6. 边界与开放问题

### 6.1 明确不做

| 不做 | 理由 |
|---|---|
| **不做「同时看两个项目的战场」** | D3 / task_159 D11：core 三处进程级单例（`worldStore` / `coreRuntime` / bus）均无项目维度，多实例化要改 core 契约、撞三条铁律。这是**另一个任务**（§6.2 Q1） |
| **不做一项目一库** | 单库 + `instance_id` 索引列更优（task_159 D4）；不制造 N 个迁移面 |
| **不做隐藏式隔离** | 隐藏 = 两份状态在内存 = 真相分裂（铁律 1）；且 `UnitRegistry` 的 Map 会无界增长 |
| **不做 dsh profile / bundle 映射** | profile 是部署概念（集成报告 §4.6）；桥接点只有 `.stratix/dsh/*.patch.yml` |
| **不做云同步 / 多用户协作服务端** | 契约靠 git 传播已经够用；自建同步 = 第二套真相源（task_159 §5.1） |
| **不改 `.stratix` 目录契约** | 本设计**消费** task_159 的契约，不改它。若要改（如加「副本外观」字段），需另开任务并同步改 task_159 |
| **不实现任何本设计的内容** | 本任务 = 纯文档（验收要求「不改 src/」） |

### 6.2 开放问题（需用户拍板）

| # | 问题 | 建议 | 影响面 |
|---|---|---|---|
| **Q1** | **是否接受 D3**（一进程只激活一个副本；多副本并存于注册表，切副本 = 重载世界态） | **建议接受** —— core 三处单例无项目维度，多实例化撞三条铁律 | 是否需要 core 多实例化（另一个任务） |
| **Q2** | **是否接受「exp 按副本独立养成」**（§1.3.3 / §4.4） | **建议接受** —— 副本 = 各玩各的存档；共享成长线会让副本语义漏气 | `characters` / `exp_events` 表结构；`grantExperience` 的结算口径 |
| **Q3** | **是否接受 N4 的一次性 character id 重写**（§1.3.2） | **建议接受**，但**推迟到 M2**，且默认沙盒实例的行不改 id | `characters` / `unit_positions` / `character_tasks` / `sessions` 四表的迁移脚本 |
| **Q4** | **agent 能否离开项目根？**（§3.2 / §5.3） | **建议**「不能」—— 与 dsh 的 `sandboxPolicy.workspaceRoot` 对齐；但 Stratix 侧当前**无沙箱** ⇒ 要么 M3 引入、要么显式声明「无边界」并写进 `.stratix/config/permissions.json` | 安全基线（CLAUDE.md 的「PermissionPolicy 默认 deny」） |
| **Q5** | **大厅卡片由 HUD 画还是 world 画？** | **建议 HUD 画** —— 数据在 `WorldState`，world 的 `LobbyScene` 只画背景 ⇒ world 零业务状态（铁律 1） | M1 的 world / HUD 分工 |
| **Q6** | **切副本时的仪式动画是否可跳过？** | **建议可跳过**（任意输入即淡出）—— 否则高频切副本变成惩罚 | M1 的 world 表现 |
| **Q7** | **副本内是否可以再开子副本**（嵌套项目） | **建议支持识别、不做继承**（task_159 Q5 的同一裁决） | 发现算法、注册表 |

### 6.3 与 task_159 的关系（一句话）

> **task_159 冻结「项目是什么、怎么被找到」（`.stratix` 目录契约 + `workspaces.json` 注册表）；task_160 冻结「项目长什么样、agent 怎么进去干活」（Project 实体 + 一图一副本的场景切换 + 干净上下文进入）。**
> 二者的公共锚点是 **`project.json.id`（逻辑）+ `instanceId`（物理）** 这一对 id；本设计**不新增第三种 id**，也**不修改 task_159 的目录契约**。
> 若 task_159 的开放问题（Q1–Q9）的裁决与本文冲突，**以 task_159 为准**（它是更早、更底层的一层），本文相应条目需回改。

---

## 附录 A：id 与术语词表

| 词 | 形状 | 归属 | 出处 |
|---|---|---|---|
| **逻辑项目 id** | `spx_` + 22 位 base62 | 契约（`.stratix/project.json.id`），随 git 传播 | task_159 §1.3 |
| **实例 id** | `wsp_` + … | 注册表（`workspaces.json` 的 `instanceId`），路径移动后不变 | task_159 §2.4 |
| **角色 id（逻辑）** | roster 文件名 | 契约（`.stratix/roster/<role-id>.json`） | task_159 §1.3 |
| **character 行 id** | `chr_<instanceId>_<roleId>`（M2 起） | 运行层（`characters.id`） | 本设计 §1.3.2 N4 |
| **单位 id** | `CHARACTER_UNIT_ID_PREFIX + character.id` | 运行层 | `src/core/character/unit-projection.ts:42`（**格式不变**） |
| **mission id** | 现有生成规则 | 运行层（纯内存） | `src/core/mission/machine.ts:177` |
| **默认沙盒实例** | 内置虚拟 instance | `instance_id = NULL` 的旧行语义 | task_159 §4.4 M2；本设计 §1.3.2 N2 |

> **命名对照速查**：`projectId` ⇒ 逻辑项目（`ProjectId`）；`instanceId` ⇒ 物理副本（`ProjectInstanceId`）；落库列名统一 `instance_id`。**两者不可互换**（见 §1.5 的命名纪律）。

## 附录 B：调研与代码引用对照

| 结论 | 出处 | 本设计落点 |
|---|---|---|
| dsh 的 session header `cwd` 不可变绝对路径 | `packages/core/session/src/types.ts:106`（**HEAD `fcc0ad46` 复核**） | §3.5 / §3.6 #1 |
| dsh 把 preset（能力组合）写进 session header | `packages/core/session/src/types.ts:133-135`（**复核**） | §3.5；task_159 §4.3 |
| 会话开始后不许换 preset（`agent-preset/locked`） | `packages/preset/agent-preset-registry/src/index.ts:364-368`（**复核**） | §3.5 |
| 模型上下文注入 `Current working directory: "<path>"` | `packages/session/working-directory/src/index.ts:172-174`（**复核**） | §3.5 / §3.6 #4 |
| 工作目录作为 required 的 system-prompt 上下文（prepend） | `packages/session/working-directory/src/index.ts:90-110`（**复核**） | §3.6 #5 |
| session 可 fork | `packages/core/session/src/index.ts:1403`（**复核**） | §3.5（**不用它造副本**） |
| 会话挂载 workspace 校验 cwd 一致 | `packages/workspace/workspace/src/entity.ts:110-141`（**复核**） | §3.5（R3） |
| dsh 无项目级元数据目录；profile 是部署概念 | 集成报告 §4.6 | §0 D13 / §6.1 |
| dsh workspace 注册表 = 多根管理器 | 集成报告 §4.4 | §2.4 / §3.5 |
| dsh headless 无 `--cwd`，只能靠进程 cwd | 集成报告 §4.2 路径 D | §3.2 / §5.3 |
| dsh skill 两级注入（目录 → 全文） | 架构报告 §5.3 | §3.3.3（项目技能只列名） |
| `SpawnOptions.cwd` 已定义但全仓无人赋值 | `src/app/services/cli-transport/transport.ts:85,120` | §3.2 |
| core 三处进程级单例，无项目维度 | `src/core/store.ts:311`、`src/core/runtime.ts:803`、`src/core/bus.ts:32` | §0 D3 / §2.5 #11–#13 |
| 真相唯一 / 裁决在 core / 存储独占 / 渐进迁移四铁律 | `docs/SERVICE-SPLIT-PLAN.md:96,97,101,102` | §1.4 / §4 |
| 四个池与四个上限全是全局的 | `src/core/types.ts:63,96,116,675` | §1.4 / §4.2 #1 / §4.5 B3 |
| mission 依赖判定吃全量数组 | `src/core/mission/machine.ts:346-365` | §4.2 #3 |
| 任务回报链终态收口唯一 | `src/app/services/task-service.ts:760` | §4.3 |
| exp 写入面唯一（`grantExperience`） | `src/core/character/manager.ts:411-459`；纯函数 `src/core/character/growth.ts:61` | §4.4 |
| 每张表两份 DDL（DAO 侧 + `StratixDatabase` 侧） | `game-save-dao.ts:92,107` / `task-record-dao.ts:135` / `session-dao.ts:102` / `session-event-dao.ts:66` / `exp-event-dao.ts:68` + `src/stratix-database/StratixDatabase.ts:518,549,213,428,447,383` | §4.5 B5 |
| 遗留 `projects` 表（旧语义，全仓无读写） | `src/stratix-database/StratixDatabase.ts:765` | §1.3.1（不复用） |
| world-sync 全局单份 snapshot、无订阅概念 | `src/stratix-gateway/api/websocket/world-sync/protocol.ts:62-68,128,145`；`endpoint.ts:246,341-346,479` | §4.1 |
| world-sync 端口是 **7524**（不是 7525） | `src/stratix-gateway/index.ts:114`、`scripts/restart-backend.sh:9`、`remote-store.ts:152` | §4.1 |
| `stratix_world_snapshot` 投影四段、全量无过滤 | `src/stratix-gateway/mcp/tools/world.ts:31,248-308` | §4（需按 instance 过滤） |
| 单位 id 由 character id 派生 | `src/core/character/unit-projection.ts:42` | §1.3.3 / §2.5 #14 |
| `unit_positions` PK = `character_id` | `src/app/services/persistence/game-save-dao.ts:107` | §1.3.2 N5 / §2.5 #15 |
| 站位种子走 game.registry 全局键 | `src/world/objects/unit-registry.ts:33`；组合根 `src/app/main/main-entry.ts:1383` | §2.5 #6 / #18 |
| `MapBoard` 持有跨副本累积的占格游标 | `src/world/objects/task-building.ts:300-307` | §2.5 #4 |
| 战场地块 7×5 = 35 格 | `src/world/objects/task-building.ts:51,53` | §2.5 #8 |
| HUD 屏位只有 main / settings / character | `src/hud/screens/main-screen.ts:611-620` | §2.5 #16 |
| 现状注入链五区块 + 拼装位置 | `src/app/services/task-service.ts:269-291,1011-1016` | §3.3.1 / §3.3.2 |
| 战场现状块的四分节与 4000 字上限 | `src/app/services/stratix-context.ts:146-171,53` | §3.3.3 |
| 三段式（纯函数 + provider + resolve 吞错）的既有范式 | `src/app/services/stratix-context.ts:202,263,363` | §3.3.4 |
| 任务会话一次性（`sessionId: null`） | `src/app/services/task-service.ts:1027`（文件头「会话隔离」`:31`） | §3.1 ① / §3.4 R1 |
| chat 会话用 `externalSessionId` resume | `src/app/services/chat-service.ts:537-544` | §3.4 R3 |
| 遗留 `projects` 表与新语义撞名 | `src/stratix-database/StratixDatabase.ts:765` | §1.3.1（task_159 §4.4 M4 已裁决） |
