# QA-03 代码 review 整治 · 分诊表（task_223）

> 状态：**已收口**（2026-11-07，task_223）。分支 `demo/v3.3`。
> 交付物：本分诊表 + lint 豁免账本 `src/architecture/lint-waivers.ts`（+ 棘轮测试）+
> 死代码扫描器 `scripts/dead-code-scan.ts` + lint 类型工程 `tsconfig.eslint.json`。
> 口径：QA-02（task_222）已把「架构铁律」做成扫描器 + 豁免账本；本单把同一套**棘轮**手法用到 lint 与死代码上。

---

## 0. 一页摘要（前后对比）

| 维度 | 整治前 | 整治后 |
|------|--------|--------|
| `npx eslint .` error | **33**（同一棵树上用旧配置复测；开单时原始基线 153） | **0** |
| `npx eslint .` warning | 14（**但只扫到了 541/574 个文件**） | 19（**574/574 全部被扫到**） |
| 真正被 lint 的文件 | 541 / 574（33 个文件解析 FATAL ⇒ **零覆盖**） | **574 / 574** |
| 死代码（零引用 barrel 文件） | 20 个文件占位 | **0**（已删） |
| 死代码（完全未使用的导出） | 129 个 | **105 个**（删掉 24 个；剩 105 个按理由保留并记账） |
| 死代码（死本地类型 / 常量） | 7 个 | **0** |
| 死代码（未使用的 import 说明符） | ~30 处 | **0** |
| `npx tsc --noEmit` | — | **exit 0** |
| `npx jest --maxWorkers=2` | — | **364 suites / 6177 passed / 6 skipped**（全绿） |

> warning 从 14 涨到 19 **不是变差**：旧配置下 33 个文件根本没被解析（e2e-tests / plugins / tools 三棵树），
> 新覆盖到的代码里浮出 5 条新 warning。**error 清零 + 覆盖面从 541 扩到 574**，这是净收益。

---

## 1. ① lint 分诊收尾

### 1.1 根因（不是「153 条规则没配好」，是**三棵树零覆盖**）

开单时的 153 条 error 里，真正的性质只有两类：

| 类别 | 数量 | 性质 |
|------|------|------|
| `import/order` 等**机械规则**违规 | 120 | 真违规，但可以 `--fix` 机械修（**r1 批，commit 6173851 已修**） |
| **解析 FATAL**（"file was not found by the project service"） | 33 | **假违规 = 该文件根本没被 lint** |

根因：`parserOptions.project` 只配了 `./tsconfig.json`（`include: src/**/*`）。
于是 `e2e-tests/**`、`plugins/dsh-bridge/**`、`tools/**`、`bin/**` 这些目录
**不在任何 tsconfig 工程里** ⇒ type-aware parser 直接 FATAL ⇒ **这三棵树此前零 lint 覆盖**。
「`eslint .` 通过」此前是**假通过**。

### 1.2 修法（覆盖优先于改规则）

1. **新建 lint 专用类型工程 `tsconfig.eslint.json`**
   - why 不改 `tsconfig.json`：那是**构建**工程（`include: src/**/*`、`rootDir: src`、产物进 `dist/`），
     改它的 include 会把 `e2e-tests` 拖进 tsc 构建产物 ⇒ **那是产品语义变更，不该由 lint 单干**。
   - 口径：`include` = `src/**/*`（与构建工程同口径）+ `e2e-tests/**/*` + `bin/**/*` + `tools/**/*`；
     `rootDir` 从 `./src` 放宽到 `.`（e2e-tests 在 src 之外，否则 TS 报「文件不在 rootDir 下」）；
     `allowJs: true` + `checkJs: false`（bin/tools 是纯 JS）；`noEmit: true`（不产出任何东西）。
2. **`.eslintrc.cjs` 补 `overrides`**：仓里混着三种**模块语义**不同的代码 ——
   TS 模块（src / e2e-tests / plugins）、浏览器全局脚本（`tools/texture-generator/generators/**`，
   靠 `<script src>` 共享全局）、Node CLI（`tools/texture-generator/generate-textures.js`）。
   用同一套 module 语义 lint 它们 ⇒ `no-undef` / `no-unused-vars` / `import/order` 全是**假阳性**。
3. **`import/core-modules` 补插件自有依赖**：`@deepseek-ai/cordis` / `dsh-tools` / `schemastery`
   装在 `plugins/dsh-bridge` 自己的 node_modules 里 ⇒ 根目录解析不到 ⇒ `import/no-unresolved` 误报。
   纯 lint 侧声明，不装包、不改构建、不进产物（与既有 pixelfx 条目同理由）。
4. **显式忽略 `tmp/`**：ESLint 8 **不读 .gitignore**，而 `tmp/` 是 gitignore 掉的本地草稿区 ⇒ 不忽略就会解析 FATAL。
5. 机械修复：`eslint --fix`（import/order、import/newline-after-import 等）。
   **一处危险修复已回退手改**：`import/no-duplicates` 的自动修复把**值导入** `createTaskManager`
   误改成 type-only（`import { PipelineRunnerPort , createTaskManager, type TaskManager }`）⇒ 运行时断裂 ⇒
   `git checkout` 回退后手工合并三个文件（`src/core/runtime.ts`、`src/app/services/pipeline-service.ts`、
   `src/hud/screens/character-screen.ts`）。

### 1.3 豁免账本（QA-02 同款棘轮）

`src/architecture/lint-waivers.ts` —— 登记 `.eslintrc.cjs` 里**每一处**范围/语义/依赖解析豁免，
每条带 `reason` + `followUp`；`src/architecture/__tests__/lint-waivers.test.ts` 做**账实一致**断言：

- 配置里有、账本里没有 ⇒ **未登记豁免** ⇒ 测试失败；
- 账本里有、配置里没有 ⇒ **过期豁免** ⇒ 测试失败。

账本 11 条（L-01 … L-11）：依赖与构建产物 / vendor / scripts / 历史空目录 /
**测试文件（已知覆盖缺口）** / 配置文件 / tmp 草稿区 / pixelfx core-modules / dsh core-modules /
纹理生成器 browser 脚本 override / 纹理生成器 Node CLI override。

> 棘轮不是摆设：写账本时我把 `pixelfx/fx/scifi/emb-blast` 写成了 `emb-blast`（配置里是 `emp-blast`），
> 测试当场抓出「过期豁免」——**账实一致这条断言当场生效**。

### 1.4 已知覆盖缺口（**报告，不在本单修**）

- **测试文件整体不参与 lint**（`tests` / `**/*.test.ts` / `**/*.spec.ts` / `**/__tests__/**`）⇒ 账本 L-05。
  收掉它需要：把 `tsconfig.test.json` 加进 `parserOptions.project` + 一次性清历史 style 债。
  本单不收：会一次性爆出成百上千条 error，把「error 清零」冲垮。**另开单。**
- `rules` 里关掉的通用规则（`no-explicit-any` / `no-console` / `ban-ts-comment` /
  `explicit-module-boundary-types` / `no-var-requires` / `no-empty-function`）是**风格口径**，
  不是「某片代码逃过检查」⇒ 不重复登记（见账本文件头说明）。

---

## 2. ② 死代码扫描

### 2.1 扫描器（`scripts/dead-code-scan.ts`，`npm run dead:scan`）

用 TypeScript Compiler API 扫三件事：

- **A 文件类**：仓内没有任何文件 import 它（注释掉的 import 不算数）。
- **B 完全未使用的导出**：export 了但没人 import **且**本地也没人用。
- **C 仅内部使用的导出**：`export` 多余（代码是活的）—— 可选清理，本单不动。

关键在于**别把活文件误判成死的**，扫描器因此带三类补充证据：
① barrel `export *` / `export {}` 链式解析；② **非 import 形态的引用**
（HTML 的 `<script src>`、package.json 的 script、路径拼接、同目录相对引用）；
③ **动态 import 的具名解构**（`const { X } = await import(...)` / `import(...).then(m => m.X)`）。

> 第③项是补出来的：首跑把 `buildGraphFromWorkflow` 判成「完全未使用」，人工核对发现
> `src/agent-platform/ipc/execution.ts:40` 正是 `const { buildGraphFromWorkflow } = await import(...)` 用的
> —— 扫描器只记了文件引用、没记具名导出 ⇒ **假阳性**。补上后 B 类 129 → 128。

### 2.2 候选清单（**先出清单再动手**）

A 类共 24 个零引用文件，分诊结果：

| 分诊 | 数量 | 处置 |
|------|------|------|
| `[入口]` 进程入口（天然没人 import） | 5 | 保留（`src/electron/main.ts`、`src/electron/preload.ts`、`src/app/main/main-entry.ts`、`src/hud/dev/hud-dev-entry.ts`、`src/app/dev/hello-loop-entry.ts`） |
| `[活]` 非 import 形态被引用 | 8 | 保留（HTML `<script src>` / package.json script / 路径拼接） |
| `[保留]` 实现完整、尚未接线 | 11 | 保留 + 登记理由与后续处置（账本在扫描器 `KEPT_DEAD_FILES`） |
| `[候选]` 真正可删 | **0** | —— |

人工确认时**抓出 3 个假阳性**（都已排除，不在清单里）：
`src/stratix-gateway/mcp/bin/stratix-mcp.ts`（被 `bin/stratix-mcp.js` 用路径拼出来引用）、
`src/world/dev/main.ts`（被 `src/world/dev/world-dev.html` 引用）、
`src/stratix-tailscale/interactive-login.ts` + `test-embedded.ts`（package.json 挂了 script）。

### 2.3 处置结果

**（a）删掉 20 个零引用 barrel / re-export 壳**（纯门面，零语义，删了不影响任何运行时）：

```
src/agent-platform/index.ts                  src/stratix-gateway/agent/index.ts
src/agent-platform/orchestration/index.ts    src/stratix-gateway/api/retry/index.ts
src/agent-platform/providers/index.ts        src/stratix-gateway/command-transformer/index.ts
src/agent-platform/workflow/index.ts         src/stratix-gateway/lra/index.ts
src/core/unit/index.ts                       src/stratix-gateway/mcp/index.ts
src/stratix-agent/runtime/index.ts           src/stratix-lra-bridge/index.ts
src/stratix-core/mcp/index.ts                src/stratix-orchestration/index.ts
src/stratix-core/permission/index.ts         src/stratix-orchestration/worker/index.ts
src/stratix-core/services/index.ts           src/stratix-tailscale/index.ts
src/world/appearance/index.ts                src/world/objects/index.ts
```

> ⚠️ **中途的教训（记录在案）**：删掉这些 barrel 后，一度**级联孤儿化**了十来个实现文件
> （GatewayRetryAdapter / LRAWatcher / ContextCompressionService / RelevanceScorer / TailscaleService / part-config.ts …）。
> 那批文件是「**实现完整、只是还没接线**」的功能模块 —— 删掉等于抹掉已写好的功能，
> **属于产品决策，不是死代码整治该做的事** ⇒ 全部 `git checkout` 恢复，改登记在保留账本里。

**（b）删掉 24 个未使用的导出**（全部经人工逐个核对：全仓 0 引用 + 本地 0 引用）：

*① 真·未使用的导出（定义处 0 引用）—— 18 个，声明整体删除：*

- HUD（16）：`focusUnitCommand`、`replayToneColor`、`REPLAY_ICONS`、`availableAppActions`、
  `findAppCommand`、`clearDraftTitle`、`subscribeDraftTitle`、`createMemoryStorage`、`cliCommandNames`、
  `sessionsSignature`、`TopbarItemRole`、`OnboardingSummaryRow`、`resolveSummaryRows`、`resolveSettings`、
  `engineeringVisible`、`getActiveIconSetId`
- app（1）：`InstanceScopedTable`
- core（1）：`coreRuntime`（默认单例无人启动）

  > `coreRuntime` 删得掉，依据是它自己的注释：「构造本身没有副作用」，且全仓无人 import。
  > `src/core/types.ts` 的 `MAX_PROJECTS` **不删** —— 它在契约文件里，是上限口径的事实源（见 §3 的 N4）。

*② 冗余再导出（底层定义仍在别处、且仍被别处使用，只是这个门面没人用）—— 6 个，只删再导出那一行：*

`httpBaseFromWorldSyncUrl`（app/services/day-replay.ts）、`PersistedAgentHealthEventKind`
（app/services/persistence/agent-health-record.ts）、`PersistedTaskStatus`
（app/services/persistence/task-record.ts）、`MAX_SESSION_EVENTS_PER_INSTANCE` /
`MAX_SESSION_EVENTS_PER_SESSION`（app/services/persistence/capacity-limits.ts）、
`INFO_LAYERS`（hud/layers/info-layer.ts；定义在 core/info-layer.ts，仍被 layer-switch.ts 与单测用）。

**（c）删掉 7 个死的本地类型 / 常量**（文件内声明、全仓无人用）：
`AuditLogCountRow`（AuditLogRepository）、`AgentBackgroundRow`（AgentCheckpoint）、
`AgentZoneBindingRow`（SkillRepository）、`CUSTOM_AGENT_ID_RE`（core/custom-agent）、
`SQL_JS_WASM_PATH`（sqlite-adapter）、`DEFAULT_TASK_LIMIT` / `DEFAULT_SEARCH_LIMIT`（TaskQueueService）。

**（d）删掉 ~30 处未使用的 import 说明符**（只删**说明符**，保留 import 语句本身 ——
模块求值副作用不动）：`agent-chat-service.ts`、`electron/main.ts`、`EnhancedStratixAgent.ts`、
`BashSkillExecutor.ts`、`SessionRuntime.ts`、`OpenClawConnectionStore.ts`、6 个 `*Repository.ts`、
`routes/agentOrchestration.ts`、`routes/openclaw.ts`、`routes/skill.ts`、`websocket/StatusSync.ts`、
`command-transformer/SkillExecutor.ts`、`demo-one-to-many.ts`、`background/BackgroundAgentService.ts`、
`messaging/AgentMessageRouter.ts`、`m2-scenario.ts`、`OrchestrationSync.ts` 等。

**（e）保留但标注的 3 处「假阳性 / 契约未兑现」**（只加注释，**不改语义**）：

| 位置 | 现象 | 处置 |
|------|------|------|
| `src/stratix-gateway/api/client.ts` | `const { success, ...rest } = data;` —— `success` 是**属性省略惯用法**，不是死变量 | 加注释说明为什么留着（ESLint 的 no-unused-vars 在这里是假阳性） |
| `src/stratix-orchestration/background/BackgroundAgentService.ts` | `options` 参数**完全没被读**（`autoRestart` / `maxRestarts` 没接） | 加 TODO：契约未兑现，保留参数是为了不改 public API 签名 |
| `src/stratix-openclaw-adapter/LocalOpenClawAdapter.ts` 等 4 处 | 未使用的局部变量 | 改为直接取用（不改行为） |

### 2.4 剩下 105 个「完全未使用的导出」—— 保留 + 记账

| 类别 | 数量 | 保留理由 |
|------|------|---------|
| 在 legacy 包内（`src/stratix-*`、`src/agent-platform`） | 99 | 整个 legacy 包在**退役路径**上（CLAUDE.md 已登记），删它们的导出是「提前做产品决策」；随包退役一并删（其中 37 个是 `export default` 形式 —— **公开 API 形态**，删 = 改模块契约） |
| 其它（非 legacy） | 6 | `src/core/types.ts` 的 `MAX_PROJECTS`（契约上限口径的事实源）、`src/world/appearance/*` 5 个（属 §2.2 的**保留账本**模块：实现完整未接线） |

> 另有 C 类「仅内部使用、`export` 多余」728 个 —— `export` 关键字多余但**代码是活的**，
> 去掉 `export` 零风险但收益近零（728 处改动面大、review 成本高）⇒ **列为可选清理，本单不做**。

---

## 3. ③ 命名一致性抽查（M0–M2 新代码 vs 冻结文档）

抽查对象：`src/core/{types,capacity,runtime,project,instance*,roster*,session*}`、
`src/app/services/**` 的 project/instance service、`src/world/**` 与 `src/hud/**` 的 instance 命名。
基准：`docs/DESIGN-project-map.md`（§1.2.3 / §1.3.2 / §1.4 / §1.5 / 附录 A 词表）、
`docs/DESIGN-workspace.md`、`docs/REFACTOR_PLAN_V3.md`、`docs/WORLD-SYNC.md`、`docs/SESSION-PLAN.md`、
`src/core/types.ts`（契约单一事实源）。

### 3.1 实质问题 7 条

| # | 位置 | 现象 | 与冻结文档的差 | 影响面 | 建议动作 |
|---|------|------|---------------|--------|---------|
| **N1** | `src/core/types.ts:903-910` | `CharacterView` **缺 `roleId` 字段**；且注释把「`role_id`」写成了「**行 id**」 | 文档 §1.2.3 明写 `readonly roleId?: string \| null;`，且原句是「**`role_id`** 才是『它是 roster 里哪个角色』」；§1.3.2 N4b 规则① 另加硬约束「禁止解析 id 字符串判断身份，一律用 `role_id` 列」 | 跨层 + **core 契约是 public API**（`WorldState.characters` 全量广播）；按现注释实现就会去解析行 id 字符串 —— 正是 N4b 明令禁止的 | **仅报告**：补字段 = 契约增补（产品语义），注释若改成「role_id」又会指向一个尚不存在的字段。**须 task_175 负责人确认 M1-01 范围** |
| **N2** | `src/core/types.ts:1181` vs `src/hud/screens/lobby-catalog.ts:80` | `active`/`idle` **一词两义**：契约 `ProjectStatus` 的 `'active'` = 有未终结的编组任务；HUD `LobbyCardStatus` 的 `'active'` = 它正是 `activeInstanceId` | 文档 §1.2.1 与 §2.4 **自相矛盾**（§2.4 写「status = idle，除非它正是 activeInstanceId ⇒ active」） | 跨层；且契约侧 `'active'` 目前**没有生产者**（`default-sandbox.ts:116` 只写 `'idle'`）⇒ 契约注释描述的状态机已与真实行为脱节 | **仅报告**：文档 owner + 架构拍板统一口径 |
| **N3** | `src/app/services/persistence/character-id-rewrite.ts:217` | character 行 id 格式 = `` `${roleId}_${instanceId}` `` | 文档 **D9（`:30`）与附录 A（`:1521`）= `chr_<instanceId>_<roleId>`**，而 **§1.3.2 N4b 规则①（`:488`）= `<roleId>_<instanceId>`** —— 文档两处互斥（顺序相反、前缀不同） | 落库 id 格式 → `unit_id` 派生 → `sessions.participants`；改格式 = 数据迁移 + N4c 映射表失效 | **仅报告不改代码**（代码跟的是可判定的那条规则①，且已落库）；请文档 owner 统一附录 A / D9 的表述 |
| **N4** | `src/core/types.ts:715`、`src/core/capacity.ts:39` | `MAX_CHARACTERS = 64` 的注释**未标口径**；「每副本」靠别名 `MAX_CHARACTERS_PER_INSTANCE` 转出，而**按副本口径使用的调用点仍用未标口径的名字** | 文档 §1.4 M2 行明确把 64 定位为「**每 instance** 上限 64」，但承载它的常量名不含 `PER_INSTANCE` | 数值/口径可读性（非行为 bug —— 三处调用点语义已一致）；`docs/MCP-SPEC.md:179,980,1125` 引用了 `MAX_CHARACTERS = 64` | **仅报告**（低风险改法：给 `core/types.ts:715` 补口径注释 + 让副本侧调用点改用 `MAX_CHARACTERS_PER_INSTANCE`） |
| **N5** | `src/app/services/persistence/character-id-rewrite.ts:118` | `RewritePlan.sandboxIds` 实际指的是「**默认沙盒里那些角色行的 id 列表**」，却与「沙盒**实例** id」撞形 | 附录 A 里「沙盒 id」唯一指 `DEFAULT_INSTANCE_ID = 'wsp_sandbox'`（单值） | 内部结构（N4b 迁移报告字段），非 public API | **仅报告**：低风险改名（`sandboxCharacterIds`），但会动到 N4b 迁移脚本的输出字段 ⇒ 随 N3 的口径确认一并处理 |
| **N6** | `src/electron/preload.ts:107` vs `:408` | `instanceId` 在**同一个 public API 文件**里指两件事：`provider.create(instanceId, …)` = LLM provider 实例；`loadSessionExternalRef(characterId, instanceId)` = 项目副本 | 附录 A 规定 `instanceId` ⇒ 物理副本，全仓唯一含义 | public API（渲染进程可见），但属**遗留 agent-platform**（在退役路径上） | **仅报告不改**：改名会破 renderer 侧契约；随模块退役一并消失最省事 |
| **N7** | `src/app/services/persistence/default-sandbox.ts:76` | 沙盒逻辑项目 id = `'spx_sandbox'`，不是「`spx_` + 22 位 base62」 | 附录 A 词表 | 目前只在内存注册表用一处，**无落库、无外部消费** ⇒ 现状无实际冲突 | **仅报告**：若将来沙盒条目要落 `workspaces.json`，须改成按 base62 生成的真 id，或在词表里把沙盒列为例外 |

### 3.2 已确认对齐（要点）

- **标识符层逐字一致**：`ProjectInstanceId` / `ProjectId` / `instanceId` / `projectId` 与附录 A 词表一致；
  五个实体（`MissionView`/`CharacterTask`/`CharacterView`/`SessionRecord`/`UnitView`）都带
  `instanceId?: ProjectInstanceId | null`，注释统一写「null = **未归属**」
  ⇒ 「null 恒义 = 未归属/大厅」的 r1 裁决在**契约层被完整贯彻**。
- `DEFAULT_INSTANCE_ID = 'wsp_sandbox'` 逐字一致；COALESCE 口径**收在两处且口径相同**
  （`core/project/entity-scope.ts:45` 与 `app/services/persistence/instance-scope.ts:101`，
  两文件头互相点名）⇒ 杜绝了「HUD 看得见、战场看不见」的老漂移。
- 命令/事件/失败词表对齐 §1.2.5：`project.enter` / `project.exit` / `project.changed` /
  `project.enter.failed` / `project.exit.failed`；`PortFailureReason` 六值与失败语义表逐项对应。
- 落库列名统一 `instance_id`（六表），新表名 `character_id_map` / `session_external_refs` 与 §1.3.2 一致；
  复合唯一索引 `(role_id, instance_id)` 一致。
- 归档路径与格式对齐：`.stratix/history/missions-YYYYMM.jsonl`、`.stratix/history/session-events-YYYYMM.jsonl`。
- M2-09 编排层收编干净：`routes/agentOrchestration.ts` 改收 `instanceId`、显式退役 `projectPath` 并回 400。
- 跨层口径唯一出处做得好：`src/core/project/instance-display.ts` 收了「路径尾段/在办任务数/显示名/归属」四份口径，
  HUD 与 world 名牌都消费它（HUD 不 import world 的约束下仍零漂移）。
- `projectId` 未被复用：全仓只出现在逻辑项目语义的四处，无一处拿它表示副本。

### 3.3 待确认（**不敢自己拍板的 6 条**）

| # | 问题 | 需谁拍板 |
|---|------|---------|
| 1 | character 行 id 以哪条为准（N3：文档两处互斥） | task_160 文档作者 |
| 2 | `ProjectStatus 'active'` 到底指什么（N2） | 文档 owner + 架构 |
| 3 | `CharacterView.roleId` 是否属 M1-01 必交（N1） | task_175 负责人 |
| 4 | `MAX_CHARACTERS` 是否要按「每副本」重命名（N4） | 文档 owner（MCP-SPEC 有三处引用） |
| 5 | 遗留 `provider.create(instanceId)` 的处置（N6） | 退役时间表 owner |
| 6 | 沙盒逻辑项目 id `'spx_sandbox'` 是否允许作例外（N7） | task_159 契约作者 |

---

## 4. 验证（原样贴出）

```
$ npx eslint .
✖ 19 problems (0 errors, 19 warnings)

$ npx tsc --noEmit
（无输出，exit 0）

$ npx tsc -p tsconfig.test.json --noEmit
（无输出，exit 0）

$ npx jest --maxWorkers=2 --silent
Test Suites: 364 passed, 364 total
Tests:       6 skipped, 6177 passed, 6183 total
Time:        33.886 s
```

（364 = 原 363 + 本单新增的 lint 豁免账本棘轮测试 1 个套件 / 4 条用例。）

---

## 5. 后续单（本单只记账，不修债）

| 编号 | 事项 | 性质 |
|------|------|------|
| L-05 | 把测试文件纳入 lint 覆盖（先清历史 style 债） | 覆盖率缺口 |
| 保留账本 11 条 | 「实现完整未接线」的模块：接进主线 或 随 legacy 退役删除 | 产品决策 |
| 保留账本 11 条 | `ContextCompressionService` vs `core/session/manager.ts` 的**两套上下文压缩口径**二选一 | 真重复，需拍板 |
| B 类 105 条 | legacy 包（99）与 `export default`（37）的导出，随包退役一并处理 | 随退役 |
| C 类 728 条 | 「仅内部使用」的 `export` 关键字多余 —— 可选清理 | 低优先 |
| N1–N7 | 命名一致性 7 条实质问题 + 6 条待确认 | 见 §3.3 的拍板人 |

---

## 6. 拍板执行记录（2026-11-07 · task_225 / QA-05）

> **拍板原文（用户 2026-11-07 10:56）**：「文档和代码冲突的以文档为准，其他你自行判断即可，你的建议没问题。」
> 本节是 §3 的 **N1–N7** 七条命名问题的落地记录：逐条处置 + 账本登记 + 验证。
> ★ **冻结文档（`docs/DESIGN-*.md`）零改动** —— 文档侧的自相矛盾只**登记**、不替文档 owner 改文档。

### 6.1 逐条处置

| # | 拍板 | 落地动作 | 落点 |
|---|------|---------|------|
| **N1** | **修**（契约缺口） | ① `CharacterView` 增 `readonly roleId?: string \| null`（可选增补 ⇒ 不破既有构造点）；② `instanceId` 的注释里「**行 id** 才是…」改正为「**`roleId`**（= `role_id` 列）才是…」并补「禁止解析 id 字符串判身份」；③ **生产侧填充**：DAO 读口 `SELECT … role_id` ⇒ `PersistedCharacterRecord.roleId` ⇒ `recordToCharacterView` 填进视图；④ 补测试（5 条） | `src/core/types.ts`（CharacterView）<br>`src/app/services/persistence/game-save-dao.ts`（读口 + 记录类型）<br>`src/app/services/persistence/character-record.ts`（翻译层）<br>`src/app/__tests__/persistence/character-view-role-id.test.ts`（新增） |
| **N2** | 文档为准 → **§2.4 语义胜出** | `ProjectStatus` 契约注释改为 §2.4 语义（`'active'` = **它正是 `activeInstanceId`**；`'idle'` = 副本存在但不是当前活跃副本），**旧注释「active = 有未终结的编组任务」删除**。代码侧本就与 §2.4 一致（大厅卡片按 `activeInstanceId` 判 active / idle；默认沙盒恒写 `'idle'`）⇒ **只改注释，零行为变更**；顺带给 HUD 的 `LobbyCardStatus` 补一句「与契约同义」的口径指针（那一词两义的疑点本就在这两处之间） | `src/core/types.ts`（`ProjectStatus`）<br>`src/hud/screens/lobby-catalog.ts`（`LobbyCardStatus` 口径指针）<br>矛盾登记见 §6.2 的 **D-1** |
| **N3** | 文档为准 → **N4b 规则①胜出** | **代码现状不动、零数据迁移**：角色行 id 仍是 `<roleId>_<instanceId>`，身份判定仍**只看 `role_id` 列**（`planCharacterIdRewrite` 已是这个口径）。附录 A / D9 的互斥表述**只登记**，等文档 owner 统一 | 无代码改动<br>矛盾登记见 §6.2 的 **D-2** |
| **N4** | 低风险改名（建议已批） | ① `MAX_CHARACTERS` 补**口径注释**（= **每 instance** 上限 64；跨副本总量是另一条线 `MAX_CHARACTERS_TOTAL`）；② **副本口径调用点**改用别名 `MAX_CHARACTERS_PER_INSTANCE`（core manager 建档守门 / MCP 工具快筛 / roster 物化护栏 / instance 加载 四处）；③ MCP-SPEC 三处引用加**口径说明**（注释级澄清，未新增版本行 —— §5.5 只记**工具面变更**） | `src/core/types.ts`、`src/core/capacity.ts`<br>`src/core/character/manager.ts`<br>`src/stratix-gateway/mcp/tools/character.ts`<br>`src/app/services/persistence/{roster-materializer,instance-loader-node}.ts`<br>`docs/MCP-SPEC.md`（:179 / :980 / :1125） |
| **N5** | 低风险改名（建议已批） | `RewritePlan.sandboxIds` → **`sandboxCharacterIds`**（含**迁移脚本输出字段**同步改：报告 JSON 的 `sandboxIds` → `sandboxCharacterIds`，独立校验脚本读基线同步改） | `src/app/services/persistence/character-id-rewrite.ts`<br>`src/app/services/persistence/n4b-migration.ts`<br>`scripts/verify-n4b-character-ids.ts`<br>`src/app/__tests__/persistence/character-id-rewrite-n4b.test.ts` |
| **N6** | 等退役 | **账本登记**，不改代码（见 §6.2 的 **D-3**） | — |
| **N7** | 记账 | **账本登记**，不改代码（见 §6.2 的 **D-4**） | — |

### 6.2 账本登记（不改代码 / 不改冻结文档，等 owner 处理）

| 编号 | 事项 | 性质 | 现状与处置口径 |
|------|------|------|-------------|
| **D-1** | **N2 的文档矛盾**：`docs/DESIGN-project-map.md` §1.2.1 说「`'active'` = 有未终结的编组任务」，§2.4 说「`status` = idle（除非它正是 `activeInstanceId` ⇒ active）」—— **同一份冻结文档内部互斥** | 冻结文档只读 ⇒ **本单不改文档**；按 §2.4 落地（更具体、且与代码现状一致） | 待**文档 owner + 架构**统一 §1.2.1 的措辞（建议把 §1.2.1 的 `ProjectStatus` 注释改成 §2.4 口径）。本单已把 core 契约注释指向 §2.4 并注明出处 |
| **D-2** | **N3 的文档矛盾**：附录 A（`:1521` 附近）与 D9（`:30`）写 `chr_<instanceId>_<roleId>`，而 §1.3.2 N4b **规则①**（`:488` 附近）写 `<roleId>_<instanceId>` —— **顺序相反、前缀不同** | 冻结文档只读 ⇒ **本单不改文档、不做数据迁移**；代码跟**规则①**（它是 N4b 执行的专项冻结规则，更具体；且已落库） | 待 **task_160 文档作者**统一附录 A / D9 的表述。⚠️ 在文档统一之前**不得**按附录 A / D9 改 id 格式（那是数据迁移级动作） |
| **D-3** | **N6**：`src/electron/preload.ts` 同一个 public API 文件里 `instanceId` 指两件事 —— `provider.create(instanceId, …)` = **LLM provider 实例**；`loadSessionExternalRef(characterId, instanceId)` = **项目副本**（附录 A 规定 `instanceId` ⇒ 物理副本，全仓唯一含义） | public API（渲染进程可见）+ 属**遗留 agent-platform**（在退役路径上） | **不改**：改名会破 renderer 侧契约；随该模块退役一并消失最省事。待**退役时间表 owner** 排期 |
| **D-4** | **N7**：默认沙盒的**逻辑项目 id** = `'spx_sandbox'`（`DEFAULT_SANDBOX_PROJECT_ID`），不是「`spx_` + 22 位 base62」那种生成式 id（附录 A 词表） | 目前只在**内存注册表**用一处，**无落库、无外部消费** ⇒ 现状无实际冲突 | **不改**：若将来沙盒条目要落 `workspaces.json`，须改成按 base62 生成的真 id，或在附录 A 词表里把沙盒**列为例外**。待 **task_159 契约作者**确认 |

### 6.3 口径附注（改名前先说清「谁该用哪个」）

- **N4 的两处「故意不改」**（改了就是误标口径）：
  - `src/core/store.ts` 的 `replaceEntities` —— 那条 `MAX_CHARACTERS` 是**广播体积**口径的截断
    （WorldState 全量广播必须有数），不是副本名册口径；
  - `src/app/services/persistence/character-record.ts` 的 `buildRestoreInjection` —— 它消费的快照
    **可能跨副本**（`loadGameSnapshot(db)` 不带 instanceId ⇒ 全库行）⇒ 那是**全局**口径。
- **N5 的改名理由**：`sandboxIds` 里的每个值是「默认沙盒里那些**角色行**的 id」，
  与「沙盒**实例** id」（`DEFAULT_INSTANCE_ID = 'wsp_sandbox'`，**单值**）撞形 ⇒ 改名消歧。
  报告 JSON 的字段名同步改 ⇒ **旧报告文件不再被读作基线**（重跑一次迁移即重新生成）。

### 6.4 验证（原样贴出）

见本单的任务回执（`npx tsc --noEmit` + 全仓 `npx jest --maxWorkers=2` 的原样输出）。
