# task_089 spike: Stratix-as-dsh-plugin——world_snapshot 进 ctx.tools 实测集成面

## 描述

桥 B：把 Stratix 包成一个 dsh 插件的 spike——只证集成面深浅，不做产品化。方案：docs/DSH-INTEGRATION-PLAN.md 第 2 节（先读它）。world-sync 协议：docs/WORLD-SYNC.md。

## Requirements

1. 新目录 `plugins/dsh-bridge/`（独立包，有自己的 package.json；**零反向依赖**——不进 core/gateway 依赖树，gateway 不 import 它）。
2. spike 三步：
   - 经 world-sync WS 连 Stratix service（hello→snapshot，协议照 docs/WORLD-SYNC.md）
   - 注册 **world_snapshot 单工具**进 `ctx.tools`（读投影，不写命令）
   - 在真实 dsh 实例里跑通：`npx -y @deepseek-ai/dsh`（合适 profile）加载本插件 → agent 问世界态 → 工具返回真 units
3. 产出必含（贴进任务 md）：
   - Cordis 插件最小形状实测记录（package.json dsh 字段/加载方式/ctx 用法）
   - gap 清单：离全 8 工具 + 写命令还差什么（逐条具体）
   - 一句判断：值不值得产品化（及理由）
4. 风险前置：dsh 是 dev preview，API 可能对不上文档——对不上就如实记录「文档 vs 实测」差异，**不硬凑**。service 需要在跑：可用 `PORT=7797` 起备用端口实例自测（**不碰 7524/7523/9222 上的用户 dev 实例**，不 pkill 按名扫杀，只杀自己 pid）。
5. 若网络拉不动 dsh 包：降级为「插件骨架 + 集成面设计稿 + 阻塞点清单」，明确标注未实测，任务可 completed 但判断段必须写「未验证」。

## Acceptance

- [x] plugins/dsh-bridge/ 存在且 gateway/core 零 import 它（grep 验证：`grep -rn "dsh-bridge" src/` 无输出，退出码 1）
- [x] md 含：插件形状实测 / gap 清单 / 值不值得产品化判断（§1 / §3 / §4，未降级）
- [x] dsh 实例内工具调用输出贴 md（§2.3，含 NDJSON tool_call / tool_result 原文）
- [x] npx tsc --noEmit 0 错（主仓回归；插件目录独立 tsconfig 亦 0 错）
- [x] 自测进程清理干净（无孤儿：自记 PID 79359 + 子进程 79387 已 kill，7797/7798 无监听）

## deliverables

- plugins/dsh-bridge/（spike 代码）
- 任务 md 里的实测记录与 gap 清单

---
> **2026-11-02 07:42 参考物料**：dsh 源码已浅克隆 `/Users/kingj/code/deepseek-harness`（232M，只读参考，勿在其内开发）。关键参考：`packages/bundle/headless/`（one-shot runner 契约）；`docs/cordis-tutorial/01-first-plugin.md`（插件最小形状教程）；`docs/cookbook/adding-a-plugin-preview.md`；小插件实例 `packages/document/`（188K，适合当模板读）。写码前先读教程与一个小插件包。

---

# ✅ 实测记录（2026-11-02，spike 已跑通，未降级）

## 0. 环境与自测进程（已清理）

| 项 | 值 |
|---|---|
| dsh | `@deepseek-ai/dsh@0.2.1-rc.5`（npm 实拉，走代理 `127.0.0.1:7890`；本地参考库 `/Users/kingj/code/deepseek-harness` 只读） |
| Stratix service | `PORT=7797 WS_PORT=7798 DATA_DIR=/tmp/stratix-dsh-spike`（`tsx src/stratix-gateway/index.ts`，PID 79359，**自测后已 kill**） |
| dsh profile | `DSH_HOME=/tmp/dsh-spike-home`，profile `stratix-spike`（bundles: `dsh-base` + `dsh-headless`） |
| LLM | MiniMax（OpenAI 兼容）：`api: openai-completions`，`baseURL: https://api.minimaxi.com/v1`，凭据走 `apiKeyEnv: LLM_API_KEY`（只传环境变量名，不落盘） |

**未碰用户资产**：7524 / 7523 / 9222 上的用户 dev 实例全程未动；清理只杀自记 PID（79359），没用 pkill 按名扫杀。

## 1. Cordis 插件最小形状（实测，文档 vs 实测一致）

照 dsh 官方两篇文档（`docs/cordis-tutorial/01-first-plugin.md`、`docs/cookbook/adding-a-tool.md`）+ 本地源码 `packages/core/tools/src/index.ts`：

```ts
export const name = 'stratix-dsh-bridge'   // 诊断标签
export const inject = ['tools']             // 依赖的服务；cordis 等它就位再装载本插件
export const Config = z.object({ ... })     // 部署侧配置（profile patch 的 config: 段）
export function apply(ctx: Context, config: BridgeConfig): void {
  ctx.tools.register(defineTool({ name: 'stratix_world_snapshot', ... }))
}
```

实测到的 5 条硬事实（不是文档抄的，是跑出来的）：

1. **`ctx.tools` 是服务属性投影**，不是 `ctx.get('tools')`。它由 `inject: ['tools']` 声明依赖后自动出现（`packages/core/tools/src/index.ts:32-36` 的 Context 增补 + `super(ctx, 'tools')`）。
2. **工具必须声明 `output: { schema, render }`** —— 缺 `render`（或 `presentationMeta`）在注册时被 `TypeError` 拒掉：`tool "x" must declare output { schema, render, presentationMeta? }`。
3. **模型看到的是 `output.render()` 的产物，不是规范值本身**（规范值只进日志/卡片，不进模型）。踩坑实录：首版 render 只给一句汇总（`2 unit(s)`），模型收到后回复「这可能是 harness 自己维护的 in-memory mock」—— 改成 `JSON.stringify(value)` 把真数据铺出去，模型才正确读出 Alpha / Bravo 两个单位。
4. **注册是 effect 式的**：插件 fiber 卸载时工具自动注销（`register()` 返回的 disposer 由注册层持有）。本插件自持的 WS 连接另用 `ctx.effect(() => () => client.stop())` 挂 disposer。
5. **装载方式有三条**（spike 走第 1 条）：
   - `--patch <file>` 覆盖层 + `insert` 行。**相对路径按 patch 文件所在目录锚定成绝对 file URL**（dsh 的 `anchorInsertedPluginNames`，`packages/boot/app-boot/src/index.ts:547-556`）→ 这份 patch 能原地跟着仓库走，不必发布 npm、不必装 pnpm。
   - `dsh plugin --profile <name> add <pkg>`：走 **pnpm**（本机没装 pnpm，故未走这条）。
   - 自己往 profile 的 `cordis.patch.yml` 写 `insert` 行。

**「文档 vs 实测」差异（只此一处，其余对得上）**：教程说「`cordis.yml` 是一份插件条目列表」，但真实 dsh CLI 的 profile 里 `cordis.yml` 恒为 `[]`（注释写着「Edit cordis.patch.yml, not this file」），真正生效的是 **bundle patch → profile patch → home patch → `--patch` 覆盖层** 四层叠加（`packages/boot/app-boot/src/profile-context.ts:74-85`）。教程那套 `cordis.yml` 是**教学 launcher** 的形状，不是 CLI 产品的形状。

## 2. 三步跑通（真实 dsh 实例，真实 agent，真实 units）

### 2.1 第 1 步：经 world-sync WS 连 service

插件内 WS 客户端（`plugins/dsh-bridge/src/world-sync-client.ts`）：`hello{protocolVersion:1, clientId}` → service 回一份全量 `snapshot` → 之后收广播；断连按退避重连（封顶 5s）；卸载时关 socket 与定时器。

service 侧日志（自测实例）：

```
[service] boot ok（characters=0 units=0 records=0 runtime=running）
[world-sync] endpoint ready on /ws/world-sync
Stratix Gateway running on 127.0.0.1:7797 (standalone mode)
```

为了让快照里有**真** units，先用 `command.forward` 建了 2 个角色 + 1 个编组任务（`character.create` ×2 → `mission.create` ×1），快照确实长这样：

```json
{"seq": 7,
 "units": [{"id":"unit_character_1793577863178_1","name":"Alpha","status":"idle","missionId":"mission_1793577863279_1","power":0,"characterId":"character_1793577863178_1","level":1},
           {"id":"unit_character_1793577863179_2","name":"Bravo","status":"idle","missionId":"mission_1793577863279_1","power":0,"characterId":"character_1793577863179_2","level":1}],
 "missions": [{"id":"mission_1793577863279_1","title":"spike 验证任务","unitIds":["unit_character_1793577863178_1","unit_character_1793577863179_2"],"phase":"pending"}],
 "characters": [{"id":"character_1793577863178_1","name":"Alpha","level":1,"agentKind":"claude-code"},{"id":"character_1793577863179_2","name":"Bravo","level":1,"agentKind":"dsh"}]}
```

### 2.2 第 2 步：注册 `world_snapshot` 单工具进 `ctx.tools`

```
[stratix-dsh-bridge] 已注册工具 stratix_world_snapshot，world-sync 端点 ws://127.0.0.1:7797/ws/world-sync。
[stratix-dsh-bridge] 已连接 ws://127.0.0.1:7797/ws/world-sync，已发送 hello。
[stratix-dsh-bridge] 收到 snapshot seq=9，units=2。
```

### 2.3 第 3 步：真实 dsh 实例里 agent 问世界态 → 工具返回真 units

命令（`dsh --profile stratix-spike --patch bridge.patch.yml --patch llm-example.patch.yml`），stdout 原文：

```
战场当前状态（seq=10）：

**单位（2 个）**
| 单位 | 绑定角色 | 类型 | 等级 | 战力 | 状态 | 所属任务 |
|---|---|---|---|---|---|---|
| Alpha | Alpha | claude-code | 1 | 0 | idle | spike 验证任务 |
| Bravo | Bravo | dsh | 1 | 0 | idle | spike 验证任务 |

**任务（1 个）**
- **spike 验证任务**（`mission_1793577863279_1`）— 阶段：**pending**，包含 Alpha 和 Bravo 两个单位。

**角色名册（2 个）**
- Alpha（level 1，agentKind: claude-code）
- Bravo（level 1，agentKind: dsh）

要点：目前只有一个任务且仍处于 pending 阶段，两个单位都是 idle、尚未开始执行；两者的 power 都为 0，等级为 1。
```

`--json` 的 NDJSON 事件（**工具调用帧原文**，证明是 agent 自主发起的工具调用）：

```json
{"type":"status","phase":"step_start","turn":1,"step":1}
{"type":"text","text":"I'll read the battlefield state now."}
{"type":"tool_call","callId":"call_01a19996cf9b702fa91851ba","tool":"stratix_world_snapshot","input":{"includeCharacters":true}}
{"type":"tool_result","callId":"call_01a19996cf9b702fa91851ba","status":"completed","result":"Stratix 世界快照（seq=11）：2 个单位 / 1 个任务 / 2 个角色。\n{\n  \"attached\": true,\n  \"seq\": 11,\n  \"units\": [\n    {\n      \"id\": \"unit_character_1793577863178_1\",\n      \"name\": \"Alpha\",\n      \"status\": \"idle\",\n      \"missionId\": \"mission_1793577863279_1\",\n      \"power\": 0,\n      \"characterId\": \"character_1793577863178_1\",\n      \"level\": 1\n    }, … ]}"}
{"type":"status","phase":"step_end","turn":1,"step":1,"usage":{"inputTokens":6349,"outputTokens":39,"totalTokens":6599,"cacheReadTokens":211}}
{"type":"status","phase":"turn_end","turn":1,"reason":{"kind":"completed"}}
```

### 2.4 负向路径：service 不在 → 如实报「未附着」，不假装战场为空

把插件指向一个死端口（`ws://127.0.0.1:7999`）再跑一次：

```json
{"type":"tool_call","callId":"call_01a19996f734742c92df2fe4","tool":"stratix_world_snapshot","input":{}}
{"type":"tool_result","callId":"call_01a19996f734742c92df2fe4","status":"completed","result":"Stratix 世界快照不可用：状态面未附着：尚未收到 Stratix service 的全量快照（当前没有真相，不是战场为空）。"}
```

模型的解读也正确：「这不是『战场为空』，而是快照数据源本身还没有附着上来」—— 对齐 world-sync §1.3「未附着 ≠ 空态」。

## 3. gap 清单（离全 8 工具 + 写命令还差什么，逐条具体）

### A. 工具面（8 → 1）

| # | 缺什么 | 具体差在哪 |
|---|---|---|
| A1 | 另外 7 个工具：`stratix_task_assign` / `stratix_task_status` / `stratix_task_cancel` / `stratix_mission_create` / `stratix_mission_status` / `stratix_chat_send` / `stratix_registry`（+ 扩展位 `stratix_mission_checkpoint`） | 每个都要：独立 input schema + description 四要素（何时用/何时不用/边界/错误码）+ 规范值 output schema + `render`。不是复制粘贴 —— 任务面要懂相位机（`task.cancel` 只认 `queued`），mission 面要懂编组原子性 |
| A2 | **切片/分页**：MCP 版 `stratix_world_snapshot` 默认按 `filters` 切片 + `limit` 收口（missions≤100 / tasks≤100 / characters≤64），dsh 版目前是**全量回灌** | 不补切片，一次工具调用就把整个世界推进模型上下文。dsh 版要加 `filters` / `limit` 参数（dsh 的参数 DSL 支持 array/object/oneOf，够用） |
| A3 | **`next` / `poll` 引导**：MCP 版返回 `{ok:true,data:{...,"poll":{"tool":"stratix_task_status","args":{...}}}}` | dsh 版的工具 description 里没有「下一步调哪个工具带什么参数」，模型只能靠记工具名。补法：在 description 里写死，或在规范值里带 `next` 字段 |
| A4 | **工具命名空间**：MCP 的 `stratix_` 前缀是 MCP server 的命名空间；dsh 的工具名是**进程级全局注册表**的名字 | 同名会与别的插件撞（`register` 遇到重复会抛）。产品化要定前缀策略（如 `stratix_world_snapshot` 保留，但要在 description 里声明命名空间归属） |
| A5 | **错误码面**：MCP 版有统一错误码表（`not_attached` / `rejected` / `internal_error` 等） | dsh 版的工具失败语义是「抛异常 = isError」，没有 Stratix 侧的错误码分类。要做全量工具，得把 core 的拒绝原因映射成 dsh 的失败面 |

### B. 写命令面（0 → N）

| # | 缺什么 | 具体差在哪 |
|---|---|---|
| B1 | **两帧没实现**：`command.forward`（发）与 `command.ack`（收） | 插件要发命令帧、自生成 `commandId`、按 `commandId` 关联 ack |
| B2 | **ack 语义翻译**：`ack.ok=false` 时把 `error.code` / `message` / `stale` 带进规范值 | core 的业务拒绝（`rejected`）与协议故障（`internal_error`）在 dsh 侧要能被模型区分 |
| B3 | **写后落地判定**：写只经 `command.forward`，真相在**随后的 snapshot** 里 | 不能拿 ack 当「状态已变」；插件要等下一份 snapshot 才算落地（dsh 侧就是工具返回时读最新投影） |
| B4 | **超时 = 结果未知，不重发** | world-sync 明写：超时后重发可能重复落地。插件**不能**自动重试 —— 这条要写进工具契约 |
| B5 | **危险操作的「人确认」无处安放** | Stratix 铁律是 PermissionPolicy 默认 deny + 危险操作 UI 确认。dsh headless **没有 UI**；dsh 有 `tools/pre-execute` / `ctx.tools.guard()` / approval 扩展点，但「要人确认」在 one-shot 场景要么拒绝要么自动放行 —— 这一条**未解决**，是写面产品化的主要拦路虎 |
| B6 | **审计** | Stratix 要求写操作全审计；dsh 的会话日志与 Stratix 侧的审计是两套，得定谁是事实源 |

### C. 工程面

| # | 缺什么 | 具体差在哪 |
|---|---|---|
| C1 | **依赖分发** | 现在靠 `--patch` 相对路径 + 插件自带 `node_modules`（本地装了一份 `@deepseek-ai/dsh-tools`，与宿主那份**不是同一模块实例**）。注册/执行不受影响（纯对象传递），但版本漂移风险真实存在。产品化要么发 npm 让包管理器统一解析，要么走 dsh 的 plugin manager |
| C2 | **协议副本要手动跟** | 插件自带一份 world-sync 线格式最小切片（主仓 `src/` 零 import 是硬要求）。主仓协议「只加不删」，但插件这份切片仍要人工跟 —— 协议已有 `protocolVersion`，可用它做版本门 |
| C3 | **断连期 stale 语义缺失（真 bug 级）** | 重连期间插件仍持有**旧快照**，工具会照旧返回旧 seq，模型拿到过期真相却不知情。world-sync §1.3 要求客户端把本地视图标 stale —— 插件这层**没做**（`attached` 只区分「有没有快照」，不区分「快照新不新」）。补法：记 `lastSnapshotAt` + 连接态，断连即 `attached:false` 或加 `stale:true` 字段 |
| C4 | **无鉴权** | world-sync 端点无鉴权（本机绑 127.0.0.1）。service 一旦暴露到网络，这条通道是裸的 |
| C5 | **无单测** | spike 没写单测。插件本身零 IO 依赖（只有 WS 客户端可测），补测试成本低 |
| C6 | **多实例** | 一个 dsh 进程 = 一个插件实例 = 一条 WS 连接；多实例各持一条（广播口径，seq 全 service 可比） |
| C7 | **LLM 路由要自己配** | dsh 出厂把默认模型钉在官方 DeepSeek 路由（`deepseek-official:deepseek-flash`），无 DeepSeek 凭据直接 `MISSING_CREDENTIAL` 退出。接任意 OpenAI 兼容网关要自己写 `llm-pi-ai` 的 `providers` 段（`api: openai-completions` + `baseURL` + `models` + `apiKeyEnv`）。这是**部署侧**成本，不是插件成本，但每个部署都要付 |

## 4. 一句判断：值不值得产品化

**读面不值得单独产品化；写面才有价值，但要等 dsh 脱 dev preview 再说 —— 而如果只是为了「让 dsh 的 agent 看得见 Stratix」，更划算的路子根本不是写 Cordis 插件。**

理由：

1. **集成面比预想的浅且干净**：约 150 行插件 + 1 行 patch 就接通，工具注册 / 生命周期 / 卸载 / 断连重连全部按预期工作。这一条**证实了 dsh 的插件面能承载 Stratix 的读面**，方案文档 §2 的假设成立。
2. **但读面的增量价值接近零**：Stratix 已经有 MCP 面（8 工具）、REST、WS 三条通道，dsh 插件只是**再开一个入口**，不带来任何新能力，却要长期维护一条随 dsh 破坏性变更走的适配面（dev preview 声明在案）。
3. **真正的岔路口在 MCP client**：dsh 自带 `@deepseek-ai/dsh-mcp-client`（官方 CLI 依赖里就有）。如果目标是「dsh 的 agent 能用 Stratix 的 8 个工具」，**把 Stratix 的 MCP server 直接挂进 dsh** 是零适配成本的路径，8 个工具一到位就是 8 个，不存在本 gap 清单里 A1–A5 那五条重写。写 Cordis 插件只在「要利用 dh 特有的插件能力（HMR、工具 guard、PTC 模式）」时才划算。
4. **写面（派单/建编组任务）才是 dsh 侧独占的价值** —— 别的 harness 接 Stratix 也只能读不能写。但写面的拦路虎是 B5（危险操作的人确认在 headless 无处安放）与 B6（审计事实源），不是技术问题，是**产品与安全决策**，得先有决策再有代码。
5. **因此**：本 spike 的产出按「骨架 + 事实」归档 —— 插件形状、world-sync 客户端、工具注册契约这三件已被验证是稳定的，可复用；但**不排产品化**。触发重估的三个条件：① dsh 出 1.0 或 API 稳定一个季度；② dsh 的 MCP client 走不通（比如 MCP 面覆盖不了的需求）；③ Stratix 决定开放写命令面给外部 harness。

## 5. 未尽事项

- 插件**没写单测**（C5）；`world-sync-client.ts` 的重连/stale 行为是可测的纯逻辑，值得补。
- **stale 语义（C3）没修** —— 修它要改 `attached` 的定义（加连接态/时间戳），属于协议语义变更，本 spike 只记录不擅自改。
- 插件的 `dist/` 与 `node_modules/` 不入库（`.gitignore`），**用之前必须先 `npm install && npm run build`**。
- 没走 `dsh plugin --profile <name> add` 那条路（本机无 pnpm）；那条路才是第三方插件的正规分发方式，spike 未验证。
- 没试 dsh 的 `web` / `tui` profile（只验了 `headless` one-shot）。

