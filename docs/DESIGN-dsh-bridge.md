# DESIGN-dsh-bridge —— dsh 桥接中间件设计（M3-00）

> **状态**：设计稿，**纯设计单、零代码改动**（2026-11-06 07:47 用户拍板方向）。
> **产出目的**：把「Stratix 集成 dsh」（A 面）与「Stratix 被 dsh 集成为插件」（B 面）两个方向的接口处做成**一个中间件包（防腐层）**——不管哪一边变动，都只改中间件这一个包。
>
> **dsh 参照仓库**：`/Users/kingj/code/deepseek-harness`（只读）。开工前已执行 `git pull`，结果「已经是最新的」。
> **所读 HEAD**：`fcc0ad462172522aaf5c93a7b2e01f6b9f0b0159`
> （`Merge pull request #7873 … merge/release-dsh-0.2.2-rc.1-to-master`；`package.json:3` = `@deepseek-ai/dsh-root@0.2.2-rc.1`）。
> **dsh repo freshness 规则**：本文所有 dsh 侧引用均以上述 HEAD 为准；HEAD 变更后本文结论需按 §4 的「变动吸收矩阵」重判，而不是重新调研。
>
> **上游依据（只读引用，本文不修改它们）**：
> - `docs/DESIGN-workspace.md` §8.1（双面向小结）、§7 推迟清单 P1–P11
> - `docs/DESIGN-project-map.md` §5.3 / §5.3.2 / §7（P1–P11 中 B 面相关条目）
> - `docs/review/design-review-r1-dsh.md`（B1–B8：隔离进程级→scope 级 / 插件形态四层缺位 / 固定端口改 port 0 / `ctx.forge` 可复用缝）
>
> **本单不做**：不写任何代码；不改 `DESIGN-workspace.md` / `DESIGN-project-map.md`；不改 `HEARTBEAT.md` / `lra.md` / `.long-run-agent`。

---

## 0. 结论速览

| # | 结论 | 落点 |
|---|---|---|
| 1 | 中间件 = **一个包**（`@stratix/dsh-bridge`，沿用现 spike 的 `plugins/dsh-bridge/`），内含**两个对外适配器**（dsh→Stratix / Stratix→dsh）+ **一个纯翻译内核** | §1 |
| 2 | 对内稳定契约 **= `src/core/types.ts` 的既有导出**（`HudCommand` / `WorldEvent` / `WorldState` / `InstanceLoaderPort` / `ProjectArchivePort` / `PortResult` / `PortFailureReason`），**一个新端口都不造** | §1.3 |
| 3 | B 面插件形态按 **工具 / 事件 / 远程 / 生命周期 4 层面 + npm 分发形态**定义（对齐冻结文档 §5.3.2 的五层表，见 §2.0 口径对照） | §2 |
| 4 | 版本钉位：**rc 钉死精确版本可用；正式版发布时只动中间件的三个位置**（依赖钉位 / `engines.dsh` 区间 / 翻译层），**不动 core、不动 `.stratix`、不动工具名与事件载荷** | §3 |
| 5 | 变动吸收矩阵分**形状变化**（只许改翻译层）与**语义变化**（改中间件内核，必要时显式记一条 core 适配点）两档，并设**逃逸阀**：改 Stratix core 或自有协议 ⇒ 不算「被中间件吸收」 | §4 |
| 6 | 与 M1 衔接：`InstanceLoaderPort`（`src/core/types.ts:1375`）与 `project.changed`（`src/core/types.ts:2184`）**已按「未来 `@Remote` follow 流的载荷原型」设计** ⇒ 中间件直接复用，不重造 | §5 |

**本单识别出的两个「不能靠中间件吸收」的硬点**（先说清楚，避免读者误判边界）：

- **B 面的隔离单位**（B1/B5）：dsh 的隔离单位是 **session/scope**（`packages/core/scope/src/index.ts:137` `createScope`），M1 的隔离单位是**进程**（D11/D3）。⇒ 中间件**不解决**这个问题，它只规定中间件的形状必须**对 scope 友好**（per-session 状态挂 scope，不挂进程级单例）。真正的返工是**推迟清单 P8**，不在本单。
- **A 面事件面的载体**：world-sync 的 service→client 方向目前**只有** `snapshot` / `command.ack` / `error`（`src/stratix-gateway/api/websocket/world-sync/protocol.ts:13-15`）——`event.forward` 是 **client→service** 方向。⇒ `project.changed` 这类**意图事件**在 A 面当前**没有 wire 载体**（见 §2.2 与 §4 的 V6）。

---

## 1. 中间件包边界

### 1.1 三层结构

```
┌────────────────────────────────────────────────────────────────────┐
│ dsh 侧                                                              │
│   cordis ctx（ctx.tools / ctx.remote / ctx.forge）│ dsh CLI（NDJSON） │
└───────────┬──────────────────────────────────────┬─────────────────┘
            │ ▲                                    ▼ │
   ┌────────┴──────────────┐          ┌──────────────┴─────────────┐
   │ 适配器 OUT            │          │ 适配器 IN                   │
   │ (Stratix → dsh)       │          │ (dsh → Stratix)            │
   │ translate + 投影       │          │ 翻译 + 派发                 │
   └────────┬──────────────┘          └──────────────┬─────────────┘
            │ ▲                                    ▼ │
   ┌────────┴──────────────────────────────────────┴─────────────┐
   │ 中间件内核（稳定契约层）                                        │
   │  · 复用 core/types.ts 的既有契约（**不新造端口**）                 │
   │  · 只新增两样东西：① 纯翻译函数  ② 能力面清单（capability manifest） │
   └────────┬──────────────────────────────────────┬─────────────┘
            │ ▼                                    ▲ │
   ┌────────┴──────────────┐          ┌──────────────┴─────────────┐
   │ app 侧 IO 实现          │          │ core 裁决（零 IO）           │
   │ InstanceLoaderPort 等   │          │ project.enter / project.exit│
   └────────────────────────┘          └────────────────────────────┘
```

### 1.2 包边界：五条硬规则

| 规则 | 内容 | 理由 | 代价 |
|---|---|---|---|
| **B1 单向依赖** | 中间件包**可以** import `@/core/types` 的类型，**不得** import `src/app/**` 的任何模块 | core 是零 IO 纯逻辑层（`CLAUDE.md` 铁律）；app 层是 IO 的家。中间件若是「双向」就会把 app 的 IO 拖进 core 可达范围 | 中间件包内**拿不到** app 的实现 ⇒ 端口实现必须由 Stratix 侧在**组合根**注入（如 `src/app/main/main-entry.ts` 那样） |
| **B2 翻译层是纯函数** | 中间件内核（`translate/`）**零 IO、零时钟、零随机**；IO 只在两侧适配器的**边缘** | 可单测（纯函数输入→输出）+ 符合「core 零 IO」精神向 dsh 侧延伸；形状变化只改这一层（§4 R1） | 翻译层拿不到「现在几点了 / 随机 token」⇒ 这类需求必须显式作入参 |
| **B3 不新造端口** | 内部稳定契约 = `src/core/types.ts` 的既有导出；中间件**只新增**纯翻译函数与能力面清单 | 「稳定契约」的价值在于**只有一个**真相源；再造一套 DTO 会引入第二个真相源，形状变化就变成「两处都要改」 | 内部契约**继承了 core 的形状**——core 加字段时中间件会看到类型变化（但那是**编译期**可见的，不是运行时破坏） |
| **B4 端口实现不反向调 core** | `InstanceLoaderPort` 实现方**不得**反向调 core 的命令通道（`src/core/types.ts:1367` 明写「端口实现方**不得反向调用 core 的命令通道**（避免裁决重入）」） | 裁决重入会让「inspect → load → 写 activeInstanceId → 广播」四拍（`src/core/runtime.ts:451`）变成环 | inbound 适配器只能**发 core 命令**让 core 去调端口，**不能**自己调端口再回头写状态 |
| **B5 dsh 依赖零渗漏** | 主仓 `src/` **零** `@deepseek-ai/*` npm 依赖；dsh 的依赖只允许出现在中间件包的 `package.json` | 换 dsh 版本 = 改一个包的 manifest（A 面的 adapter 只是**字符串常量** `DSH_PACKAGE_NAME = '@deepseek-ai/dsh'`，`src/app/services/cli-transport/adapters/dsh.ts:51`，不 import dsh 包） | 主仓无法直接复用 dsh 的**类型**（如 `defineTool` 的类型）⇒ 这类类型只在中间件包内用 |

### 1.3 内部稳定契约清单（**复用，不新造**）

| 既有契约（`src/core/types.ts`） | 位置 | 谁消费 | 中间件怎么用 |
|---|---|---|---|
| `HudCommand` | core/types.ts | 两侧 inbound | dsh 侧的调用**翻译成** `HudCommand` 投进 core 命令总线（**不新造命令类型**） |
| `WorldEvent`（含 `project.changed` / `project.enter.failed` / `project.exit.failed`） | `src/core/types.ts:2184` / `:2191` / `:2200` | 两侧 outbound | 事件面载荷 = core 的 `WorldEvent` **子集原样透传**（§2.2） |
| `WorldState`（含 `activeInstanceId?`） | `src/core/types.ts:1517` | 两侧 outbound | 工具面与状态面的唯一数据源；A 面经 `toWireState`（`src/stratix-gateway/api/websocket/world-sync/protocol.ts:282`）投影 |
| `InstanceLoaderPort` | `src/core/types.ts:1375` | **不由中间件直接调** | 中间件发 `project.enter` 命令 → core 裁决 → core 调端口（§5 衔接点 ①） |
| `ProjectArchivePort` | `src/core/types.ts:1392` | 同上 | 同上（`project.exit`） |
| `PortResult` | `src/core/types.ts:1324` | 两侧 | 失败**不用异常**表达；中间件翻译层保持 `ok:false` 形状 |
| `PortFailureReason`（冻结分类枚举） | `src/core/types.ts:1302` | 两侧 | **失败语义的唯一词表**；B 面透传，A 面保真度降级（§2.2 决策 D2.4） |
| `ProjectInstanceId` | `src/core/types.ts:1174` | 两侧 | 「本次调用属于哪个副本」的统一标识（§5 衔接点 ④） |

> ⚠️ **中间件内核新增的两样东西**（**不是**端口、**不是** DTO）：
> 1. **纯翻译函数**（`translate/`）：`WorldState → 工具规范值`、`WorldEvent → 事件面载荷`、`HudCommand → dsh 调用`。
> 2. **能力面清单**（`contract.ts`）：一份**单一真相源**，列出本中间件暴露哪些工具 / 哪些 Remote 方法 / 哪些事件、每个的入参出参与失败形态。注册、契约测试、版本兼容矩阵**都从它生成**（不各写一份）。

### 1.4 两个对外适配器

| | **适配器 IN**（dsh → Stratix） | **适配器 OUT**（Stratix → dsh） |
|---|---|---|
| **触发源** | dsh 侧发起：宿主 Remote 调用 / 模型工具执行 / dsh CLI 事件流 | Stratix 侧发起：core 状态变化 / core 事件 / 派单请求 |
| **落点** | core 命令总线（`HudCommand`） | dsh 侧的面：`ctx.tools` / `ctx.remote` / stream |
| **A 面载体** | dsh CLI 的 NDJSON 行（`src/app/services/cli-transport/adapters/dsh.ts`） | dsh CLI 启动参数（`SpawnOptions`）+ world-sync WS |
| **B 面载体** | `ctx.remote.stratix.*` / 工具 `execute` | `ctx.tools.register(defineTool(...))` / `@Remote({mode:'stream'})` |
| **失败语义** | 保持 `PortResult` / `PortFailureReason` 形状 | 映射到 dsh 的错误通道（Remote 抛错 / 工具 `execute` 抛错） |
| **现状** | A 面**已有**：`src/app/services/cli-transport/adapters/dsh.ts`（NDJSON→`TransportEvent`）；B 面**无** | A 面**部分**（派单 spawn 已有）；B 面**有 spike**：`plugins/dsh-bridge/src/index.ts:64`（`apply(ctx, config)`） |

### 1.5 中间件包布局（**设计稿，非实现**）

```
plugins/dsh-bridge/                    ← 沿用现 spike 位置（最小变更），包名 @stratix/dsh-bridge
├── package.json                        engines.dsh + peerDependencies（§3）
├── src/
│   ├── index.ts                        Cordis 插件入口：name / inject / Config / apply
│   ├── contract.ts                     能力面清单（工具 / Remote / 事件的单一真相源）
│   ├── translate/                      纯翻译层（零 IO，可单测）
│   │   ├── world-state.ts              WorldState → 工具规范值
│   │   ├── world-event.ts              WorldEvent → 事件面载荷
│   │   └── commands.ts                 HudCommand → dsh 调用
│   ├── inbound/                        dsh → Stratix
│   │   ├── remote.ts                   ctx.remote.stratix.* → core 命令
│   │   └── tool-exec.ts                工具 execute → core 命令 / 端口只读
│   ├── outbound/                       Stratix → dsh
│   │   ├── tool.ts                     ctx.tools.register
│   │   ├── remote.ts                   @Remote 方法集
│   │   └── stream.ts                   @Remote({mode:'stream'}) follow 流
│   └── capability.ts                   能力探测（替代版本探测，§3 决策 D3.3）
```

### 1.6 中间件**不做**什么（边界外的红线）

| 不做 | 为什么 | 归属 |
|---|---|---|
| 副本/实例的**隔离单位**下沉 | dsh 用 scope（`packages/core/scope/src/index.ts:137`），M1 用进程级 | **推迟清单 P8**（core 契约层的活） |
| `.stratix` 契约的**解析** | M0-05 已落（`src/app/services/project-context.ts`） | 既有实现，中间件不重做 |
| 副本的**装载/归档 IO** | `InstanceLoaderPort` / `ProjectArchivePort` 由 app 侧实现 | 既有实现（M1-05 / M1-07） |
| 鉴权与**权限策略** | Stratix 的 `PermissionPolicy 默认 deny` 是自己的基线 | 见 §2.5 与 OPEN-8 |
| 副本的**注册表** | Stratix 的 `workspaces.json` 与 dsh 的 `ctx.workspaceRegistry` 是两套（评审 B6） | **不合并、不互相同步** |

---

## 2. B 面插件形态定义（工具 / 事件 / 远程 / 生命周期 4 层面 + npm 分发）

### 2.0 与冻结文档的口径对照

`DESIGN-project-map.md` §5.3.2 已定义五层（①宿主侧插件 / ②模型可见工具 / ③宿主可见控制面 / ④双面包客户端半边 / ⑤分发单元），本文按任务口径重组为「4 层面 + npm 分发」，**并补齐冻结文档留白的「事件」与「生命周期」两处的可执行定义**：

| 本文层面 | 冻结文档 §5.3.2 对应 | 本文的增量 |
|---|---|---|
| 工具面 | ② 模型可见工具 | 补**工具名映射表**（A 面 `mcp__` 前缀 ↔ B 面原生名） |
| 远程面 | ③ 宿主可见控制面 | 补**方法签名 + `remoteAccess` 资源准入的注册形态** |
| **事件面** | ③ 能力面表第三行「事件订阅」 | **提升为独立层**：冻结文档只给了「原生 follow 流」一句话；本文定义**载荷原型 / 基线语义 / 重连语义 / 失败可见性** |
| **生命周期面** | ① 宿主侧插件（入口与 effect 回收）+ ④ 双面包 | 冻结文档把「卸载随 fiber 逆序回收」一句话带过；本文定义**装载顺序 / 失败不半注册 / 资源清单 / 卸载顺序** |
| npm 分发 | ⑤ 分发单元 | 补**依赖钉位形态**（`peerDependencies` + `engines.dsh`，§3） |

### 2.1 工具面（模型可见）

| 决策 | 理由 | 代价 |
|---|---|---|
| **D2.1** 工具**原生注册**进 `ctx.tools`（`packages/core/tools/src/index.ts:99` `ToolsService`；`packages/core/tools/src/index.ts:106` 用 `ScopedLayers` ⇒ 注册表**本身是 scope 感知的**），名字**不带** `mcp__` 前缀 | B 面里 Stratix 的代码**就在宿主进程内**（`packages/boot/plugin-manager/README.md:31`：「installed Host code executes in-process outside the workspace sandbox」），绕一圈 MCP（起子进程 → stdio → 再被接回来）是**绕远路** | 工具名在 A 面与 B 面**不同** ⇒ 需要映射表（D2.2）；模型看到的工具名不稳定，A 面开发者要记两套 |
| **D2.2** 维护**一张工具名映射表**（`contract.ts` 内）：`stratix_world_snapshot` ↔ `mcp__stratix__world_snapshot`（dsh 的 MCP 命名规则见 `packages/mcp/mcp-client/src/index.ts:4`：「(`mcp__<serverName>__<rawName>`)」） | 两面工具集合**必须等价**，否则模型在 A 面学会的工具在 B 面不存在 | 映射表是**手写**的（dsh 的 MCP 工具名在**运行时**才定）⇒ 需一条契约测试守住 |
| **D2.3** 工具集合**首期只做 3 个**：`stratix_world_snapshot` / `stratix_character_profile` / `stratix_task_report`（**全部只读**） | 冻结文档 §5.3.2 已列这三个；写命令面（`command.forward`）会把「world-sync 命令 → core 裁决 → 端口 IO」整条写链拖进 B 面，风险远高于读面 | 模型看不到 Stratix 的**写**能力 ⇒ B 面只是「能看见战场」，不是「能指挥战场」 |
| **D2.4** 工具 `execute` 内部**只读** core 状态投影；**不**经 world-sync WS 取数 | B 面下 core 就在同进程，多绕一层 WS 是自找延迟与失败模式 | 依赖 B 面的 scope 隔离已落地（P8）⇒ P8 之前 B 面工具**只能**是「当前活跃实例」的退化视图（OPEN-1） |

### 2.2 事件面（状态变更订阅）

**核心事实（实测）**：world-sync 的方向契约是写死的（`src/stratix-gateway/api/websocket/world-sync/protocol.ts:13-15`）——
「客户端 → service：`hello`、`command.forward`、**`event.forward`**（世界事件写入口）」；「service → 客户端：`snapshot`（唯一的状态面）、`command.ack`、`error`」。
⇒ **`event.forward` 是 client→service，不是 service→client**。`project.changed` / `project.enter.failed` 这类**意图事件**在 A 面当前**没有 wire 载体**。

| 决策 | 理由 | 代价 |
|---|---|---|
| **D2.5** 事件面的**载荷原型 = core 的 `WorldEvent` 子集原样透传**（`project.changed` 的 `{ instanceId: string \| null }` 载荷形状在 M1 就定死，`src/core/types.ts:2180-2182` 明写「它就是将来 `@Remote({mode:'stream'})` follow 流的**载荷原型**（baseline + increments），形状先定 ⇒ M3 不用改协议」） | M1 已经把载荷形状钉死并**预留**了 M3 的位置 ⇒ 中间件**不重造**事件载荷 | 事件载荷**继承** core 的形状 ⇒ core 改 `WorldEvent` 联合类型时中间件要跟（编译期可见） |
| **D2.6** **A 面事件面 = 「状态推导 + 失败不可见」**；**不**新增 service→client 事件帧、**不**升 world-sync 协议版本（保持 2） | ① `activeInstanceId` 走**状态载荷**（`toWireState` 是 `...state` 展开，`src/stratix-gateway/api/websocket/world-sync/protocol.ts:282-293`）⇒ 切换成功**可从状态变化推导**；② 新增消息型 = **破坏性变更**（`docs/WORLD-SYNC.md` §7.4 口径）⇒ 要升版本 ⇒ 老客户端按 `unsupported_version` **直接断开**（`src/stratix-gateway/api/websocket/world-sync/protocol.ts:31-32`） | **A 面看不到失败**：core 拒绝进入/退出时**状态不变 ⇒ 无快照广播** ⇒ `project.enter.failed` / `project.exit.failed` 在 A 面**不可见**（这是本设计识别出的第二个硬点，见 OPEN-4） |
| **D2.7** **B 面事件面 = `@Remote({mode:'stream'})` 的 follow 流**（服务端→客户端单向流；基线 + 增量；重连换基线） | dsh 侧有现成的一等概念：`@Remote` / `@RemoteScope` 装饰的方法生成 `ctx.remote.<namespace>`（`packages/typert/protocol/src/index.ts:282` `export function Remote`；`packages/typert/protocol/src/index.ts:369` `export function RemoteScope`） | 需要 dsh 的 `@RemoteScope` 按 session 解析 scoped context（评审 B5）⇒ **依赖 P8** |
| **D2.8** 引入**失败信息保真度分档**（两档），显式暴露而不抹平：**高档** = 结构化 `PortFailureReason`（B 面：core 在同进程，事件带 `reason`）；**低档** = 泛化 code + 自由文本（A 面：world-sync 回执只有 `ack{ok:false, code:'rejected', message:'命令被 core 状态机拒绝：…'}`，`src/stratix-gateway/api/websocket/world-sync/endpoint.ts:376-384`） | 评审 A7/B4 的共同教训：**两套语义不等价时，写明不等价**，不要用「翻译」把差异抹平 | 中间件的失败返回类型要能同时表达两档（高档枚举 / 低档 `{code, message}`）⇒ 契约不是单一形状 |

### 2.3 远程面（宿主可见控制面）

| 决策 | 理由 | 代价 |
|---|---|---|
| **D2.9** 远程面暴露 `ctx.remote.stratix.*`，**四个方法**：`listInstances()` / `enterInstance(instanceId)` / `exitInstance()` / `dispatchTask(roleId, prompt)` | 与 core 的既有命令一一对应（`project.enter` / `project.exit`），不新造语义 | `dispatchTask` 的载荷（角色 id、派活文案）依赖 A 面 M3 的派单文案策略（斜杠转义）⇒ 跨单 |
| **D2.10** `enterInstance` / `exitInstance` 的实现 = **发 core 命令**（`HudCommand`），**不**直接调 `InstanceLoaderPort` | 铁律「裁决在 core」；且 `InstanceLoaderPort` 实现方**不得反向调 core**（`src/core/types.ts:1367`）⇒ 反过来中间件也不能绕过 core 直调端口 | 远程调用是**异步**的（core 裁决 → 端口 IO → 广播），调用方拿不到同步的最终态 ⇒ 必须靠事件面（D2.7）补齐结果 ⇒ **远程面与事件面必须同批实现** |
| **D2.11** 权限走 dsh 的 **`remoteAccess` 资源模型**：注册 `stratix/instance` 资源 kind + 读者（评审 B3-3 引 `packages/api/workspace-controller/README.md`） | 被嵌入后 Stratix 代码在**宿主进程内、workspace sandbox 之外**执行 ⇒ 必须有宿主侧准入 | Stratix 自己的 `PermissionPolicy 默认 deny` 基线与 dsh 的准入是**两套**⇒ 边界要划（OPEN-8） |
| **D2.12** **不向 dsh 注册 workspace** | dsh 的 Workspace 是**导航分组**（一目录 N 会话），Stratix 的 instance 是**执行隔离**（同时一个活跃）——语义不等价（评审 B6） | Stratix 副本在 dsh 的侧边栏里**不可见**；宿主要看到副本必须走 `listInstances()` Remote |

### 2.4 生命周期面

| 决策 | 理由 | 代价 |
|---|---|---|
| **D2.13** 入口形状照 dsh 插件约定：`export const name` / `export const inject` / `export const Config` / `export function apply(ctx, config)`（现 spike 已符合，`plugins/dsh-bridge/src/index.ts:26`/`:29`/`:64`） | dsh 的插件三形态（函数 / 类 / 对象）见 `docs/cordis-primer.md`；spike 已实测过这条路径 | 形态被 dsh 约定锁死 ⇒ dsh 改插件约定就是**形状变化**（§4 V1） |
| **D2.14** **所有注册都是 effect**：中间件自己持有的资源（WS 连接、订阅句柄、scope 句柄）**必须**挂 disposer，卸载时**逆序**回收（先停 IO，再注销注册） | 「一切注册都是 effect」在 dsh 侧是 `ctx.effect` / disposer（`packages/experimental/forge/src/index.ts:16-31` 是范本：`ctx.forge.register(provider)` 是 effect） | 漏挂 disposer = 卸载后残留连接/定时器 ⇒ 宿主重启后泄漏累积。**验收必须查「卸载后无残留」** |
| **D2.15** **失败不半注册**：`apply()` 里任何一步失败 ⇒ **不注册任何工具 / 不挂任何监听**，并报明确原因 | 评审 B3-2 的宿主裁决语义（「宿主裁决、失败不半注册」） | 装载失败时宿主看不到任何 Stratix 能力 ⇒ 诊断信息必须进宿主日志 |
| **D2.16** **能力探测**（`capability.ts`）：装载时探测宿主提供哪些面（`ctx.tools` 在否、`ctx.remote` 在否、cordis API 形状），**缺面则降级**（少注册几个工具），**不崩** | dsh 自述是 **dev preview，API 会变**（spike README「dsh 是 dev preview，API 会变」）⇒ 用**能力探测**代替版本探测 | 降级必须是**显式**的（宿主日志里能看到「降级成什么」）⇒ 静默降级会被误读成「Stratix 没能力」 |
| **D2.17** **双面包客户端半边（`exports["./client"]`）本期不做** | 冻结文档 §5.3.2 第④层已写「M3 不做」；dsh 侧形态见 `packages/client/ui-goal/package.json:16`（`exports`）与 `packages/client/ui-goal/package.json:40`（`"platform": "web"`） | B 面**没有** Stratix 的 UI ⇒ 宿主里看不到 Stratix 界面（OPEN-5） |

### 2.5 npm 分发形态

| 决策 | 理由 | 代价 |
|---|---|---|
| **D2.18** 包名 `@stratix/dsh-bridge`（沿用现 spike），**去 `private: true`**（现 `plugins/dsh-bridge/package.json:4` 是 `"private": true`） | 要分发就得能发布；现 spike 本来就是 `name: "@stratix/dsh-bridge"` | 发布需要 npm 凭证与版本策略（OPEN-10） |
| **D2.19** **兼容声明用 `engines.dsh`**（**不是** `engines.stratix`——后者是**项目契约**字段，两者是不同维度） | dsh 的安装期检查读 `engines.dsh`（`packages/boot/plugin-manager/README.md:56`：不兼容时给 `incompatible` 记录；`packages/boot/plugin-manager/README.md:83`：「An unmet DSH requirement rejects the operation before pnpm runs, so nothing is downloaded and no build script runs」） | `engines.dsh` 只在**安装期**检查；运行期不再查（中间件改用能力探测 D2.16） |
| **D2.20** **dsh 宿主包放 `peerDependencies`，不放 `dependencies`** | 宿主**已经提供** cordis / dsh-tools；放 `dependencies` 会装出**两份** cordis ⇒ 两套 `Context` 类型 ⇒ `ctx.tools` 类型不匹配 + 触发版本冲突 | 本地开发需自行满足 peer（npm 7+ 自动装 peer，但 **prerelease 不自动解析** ⇒ 需 `overrides` / `.npmrc`；见 OPEN-2） |
| **D2.21** 分发形态 = `dsh.profile.bundles` 有序列表 + `dsh.bundle.patch` 行；**不**用 `--patch` 覆盖层作为正式分发路径 | `--patch` 是**进程级**启动参数（`apps/cli/src/args.ts:170`：「extra patch-list overlay applied after the profile layer (repeatable)」），且**允许 `!!js` 表达式求值**（`packages/boot/app-boot/src/index.ts:266` `const userPatchesSchema = entryListSchema`；`packages/boot/app-boot/src/index.ts:576` `yaml.load(content, { schema: userPatchesSchema })` ⇒ 允许自定义 tag ⇒ `!!js` 在宿主进程里执行任意 JS） | `--patch` 仍可作为**本地调试**路径（spike README 的方式 A），但**不进分发面**、**不进 git 跟踪的契约** |
| **D2.22** `.stratix/` **仍然不进** dsh 的部署面 | 冻结文档 D1/D7 的裁决在 B 面**依然成立**——项目级契约 vs 部署级插件是正交的 | 项目差异只能走 **per-session 数据**（`.stratix` 读取 + 工具/Remote 参数），**不得**走 patch（评审 B7） |

---

## 3. 版本钉位策略

### 3.1 现状与冲突（实测）

| 事实 | 位置 |
|---|---|
| dsh rc.1 自带 cordis **`4.1.0`** | `vendor/cordis/package.json:4` |
| dsh rc.1 版本 = **`0.2.2-rc.1`** | `package.json:3` |
| 现 spike 钉 `@deepseek-ai/cordis: `**`~4.0.5`** | `plugins/dsh-bridge/package.json:22` |
| 现 spike 钉 `@deepseek-ai/dsh-tools: `**`0.2.1-rc.5`** | `plugins/dsh-bridge/package.json:23` |

⇒ **互斥**：`~4.0.5` = `>=4.0.5 <4.1.0`，**不匹配** `4.1.0`；`0.2.1-rc.5`（精确）**≠** `0.2.2-rc.1`。
⇒ 这正是冻结文档 `DESIGN-project-map.md` §5.3.1「前置阻塞」与 §5.3.3 风险表首行「rc.1 版本钉位互斥」。

### 3.2 决策

| 决策 | 理由 | 代价 |
|---|---|---|
| **D3.1** **rc 期间钉精确版本**：`@deepseek-ai/cordis: ` **`4.1.0`**、`@deepseek-ai/dsh-tools: ` **`0.2.2-rc.1`**（作为 `devDependencies` 供编译；`peerDependencies` 给宿主） | prerelease 的 `~` / `^` 语义在跨 minor 时不成立；精确钉位 = 「rc.1 上可复现」 | rc.2 / rc.3 出来要**再改一次**（但只改这一行 ⇒ 代价可控） |
| **D3.2** **正式版只动中间件的三个位置**：① `package.json` 的 dsh 依赖钉位；② `engines.dsh` 区间；③（若形状变了）适配器翻译层。**不动** Stratix core、**不动** `.stratix` 契约、**不动**工具名、**不动**事件载荷形状 | 用户 2026-11-06 07:47 拍板的核心诉求：「不管哪边变动都只改中间件一个包」 | 「只动三个位置」**只在变动是形状变化时成立**；语义变化要升档（§4 R2/R3） |
| **D3.3** **运行期不做版本探测，改做能力探测**（D2.16） | dsh 自述 dev preview、API 会变 ⇒ 版本号追不上 API 变化；且 `engines.dsh` 只在**安装期**查（`packages/boot/plugin-manager/README.md:77`：不满足的 DSH 要求在 pnpm 之前就拒绝安装） | 能力探测本身是一份**要维护的清单**（新增 dsh 能力时要同步） |
| **D3.4** **A 面运行时 CLI 版本与 B 面编译期版本必须同源**（同一个 manifest 字段派生），否则会出现「A 面跑正式版、B 面插件按 rc.1 编」的形状错配 | 两个消费方（运行时 `npx -y @deepseek-ai/dsh`、编译期 peer）必须指向**同一个** dsh 版本族 | 一个 manifest 要同时服务两种消费方 ⇒ 字段命名要显式（`dshRuntime` / `dshPeer`） |
| **D3.5** `engines.dsh` 区间在 rc 期取 **`>=0.2.2-rc.1 <0.3.0`**；正式版发布时同一行改成正式区间 | prerelease 的 semver 区间在 npm 下只有当 range **显式含同一 prerelease 标识**时才匹配（需实测 ⇒ OPEN-2） | 区间写窄了会拒掉可用的宿主版本；写宽了会在语义变更时静默通过 |
| **D3.6** **中间件不自己判断「dsh 版本是否兼容」**；兼容性判断权归宿主的 `engines.dsh` 检查 | 避免「宿主说兼容、中间件说不兼容」的双重否决（用户看不出到底哪一层拒了） | 中间件在**能力缺失**时只能降级（D2.16），不能拒绝 |

### 3.3 钉位矩阵（一次改版只动这一行组）

| 项 | rc.1（当前） | dsh 正式版（未来） | 谁改 |
|---|---|---|---|
| `@deepseek-ai/cordis`（peer / dev） | `4.1.0` | 待定 | **中间件包 manifest** |
| `@deepseek-ai/dsh-tools`（peer / dev） | `0.2.2-rc.1` | 待定 | **中间件包 manifest** |
| `engines.dsh` | `>=0.2.2-rc.1 <0.3.0` | 待定 | **中间件包 manifest** |
| A 面运行时 CLI（`npx -y @deepseek-ai/dsh@…`） | 与上同源 | 与上同源 | **中间件包 manifest**（D3.4） |
| 工具名 / 事件载荷 / `.stratix` 契约 / core 契约 | **不变** | **不变** | —（语义变化才动，见 §4） |

---

## 4. 变动吸收矩阵

### 4.1 两档判据

| 档位 | 判据（**可判定**） | 吸收层 | 允许改动的范围 |
|---|---|---|---|
| **形状变化** | dsh 侧 API 的**数据形状**变（字段增删 / 类型变 / 方法签名变），**语义不变** | 适配器**翻译层**（`translate/`）+ 该面的契约测试 | 中间件包内；**core 零改动** |
| **语义变化** | dsh 侧**含义**变（同一形状但含义不同 / 权威性变 / 失败判定变） | 中间件**内核**（能力面清单 + 准入映射 + 失败保真度分档）+ **可能**要显式记一条 core 适配点 | 中间件包 +（必要时）core 的**一处**适配点 |

### 4.2 矩阵

| # | 变动源 | 典型变动 | 档位 | 改哪层 | 波及 | 判据 |
|---|---|---|---|---|---|---|
| **V1** | dsh 插件 API | 工具 schema DSL（`defineTool` 的 `output`）改形状 | 形状 | `outbound/tool.ts` + `translate/` | 仅中间件包 | 工具名与语义不变 |
| **V2** | dsh 插件 API | 工具**可见性**判定变（如需显式授权才进模型上下文） | **语义** | 中间件内核（能力面清单）+ Stratix 权限基线需重述 | core 不动，**权限策略要重述** | 「模型能不能看见这个工具」的判定变了 |
| **V3** | dsh Remote / API Gateway | `@Remote` 签名或 `remoteAccess` 资源模型改形状 | 形状 | `outbound/remote.ts` | 仅中间件包 | 方法集合与准入语义不变 |
| **V4** | dsh Remote | 准入语义变（谁能调 `stratix/instance`） | **语义** | 中间件内核（准入映射表） | Stratix 的 `PermissionPolicy` 边界要重划 | 「谁能调」的判定变了 |
| **V5** | world-sync wire（**Stratix 自有协议**） | 加**可选**字段 | 形状 | `translate/world-state.ts` + wire 侧 | 中间件包 + wire | 可选字段 ⇒ 不升版本（R1-27/28） |
| **V6** | world-sync wire（**Stratix 自有协议**） | **新增消息型**（service→client 事件帧） | 形状 **且破坏性** | ⚠️ **中间件吸收不了** ⇒ 动 Stratix 侧协议 + 升版本 | world-sync 协议 2→3，老客户端按 `unsupported_version` **直接断开** | 破坏性变更判据（`docs/WORLD-SYNC.md` §7.4） |
| **V7** | dsh 隔离模型 | 进程级 → scope 级 | **语义** | **core**（推迟清单 P8）+ 中间件 façade 形状 | **core 契约最底层** | 权威状态的**归属**变了（不是字段变了） |
| **V8** | dsh CLI 事件流（NDJSON） | 事件类型增删 | 形状 | `src/app/services/cli-transport/adapters/dsh.ts`（A 面 inbound） | 仅 adapter | 既有降级语义仍在（未知类型跳过，不崩） |
| **V9** | dsh CLI 事件流 | `session/query` 路由语义变（`session/query` 是 rc.1 新增的「普通输入 vs 原生命令」路由器） | **语义** | A 面 adapter + Stratix 派活文案策略 | 派单文案 | 「同一条输入被路由到哪」的含义变了 |
| **V10** | dsh 版本 | rc → 正式版 | 形状（多半） | §3.3 钉位矩阵的**一行组** | 仅中间件包 | 若正式版同时改了语义 ⇒ **升档**到语义变化 |

### 4.3 三条硬规则

| 规则 | 内容 | 理由 | 代价 |
|---|---|---|---|
| **R1** | **形状变化只许改翻译层**（`translate/` + 两侧 adapter 边缘）；翻译层是纯函数 ⇒ 改动可单测覆盖 ⇒ **core 零改动** | 翻译层是唯一「贴住 dsh 形状」的地方；把它隔离出来，形状变化的爆炸半径 = 一个纯函数目录 | 翻译层会积累**方言**（同一语义的 dsh 两种写法）⇒ 需定期清理 |
| **R2** | **语义变化改中间件内核**（能力面清单 / 准入映射 / 失败保真度分档），**并显式记一条 core 侧的适配点**（若需要） | 语义变化不是「换字段」，是「换含义」⇒ 必须有一处显式登记，否则会被当成形状变化处理掉 | 内核的抽象要多付一层（能力面清单不是 dsh 的形状，是 Stratix 的形状） |
| **R3（逃逸阀）** | 若某变动**必须**改 Stratix core 或 Stratix **自有协议**（world-sync / `.stratix`）⇒ **不算「被中间件吸收」**，触发一次**显式跨层评审** | 用户的诉求是「只改中间件一个包」；诚实地说出**做不到的边界**比假装能做到更有用；改 `.stratix` = 改**项目契约面** = 影响所有项目 | 「只改一个包」这个承诺要打折 ⇒ 必须让用户看得见折在哪 |

> **给用户的口径**：中间件能把 **dsh 侧**的变动吸收掉（这是绝大多数情况）；但**Stratix 自有协议**（world-sync / `.stratix`）的变动**不在**中间件的能力范围内——那是 Stratix 自己的契约面，变了就是变了。

---

## 5. 与 M1 已落地实现的衔接点

M1 已落地（行号为实测）：

| M1 产出 | 位置 | 状态 |
|---|---|---|
| `InstanceLoaderPort`（`inspect` 同步 / `load`·`unload` 异步，失败返回 `PortResult`） | `src/core/types.ts:1375` | 已落地 |
| `ProjectArchivePort`（`archive`，失败返回 `ArchiveResult`） | `src/core/types.ts:1392` | 已落地 |
| `PortResult` / `PortFailureReason`（**冻结**分类枚举） | `src/core/types.ts:1324` / `:1302` | 已落地 |
| `WorldState.activeInstanceId?` | `src/core/types.ts:1517` | 已落地 |
| `project.changed`（载荷 `{ type, instanceId: ProjectInstanceId \| null }`） | `src/core/types.ts:2184` | 已落地 |
| `project.enter.failed` / `project.exit.failed`（带 `reason`） | `src/core/types.ts:2191` / `:2200` | 已落地 |
| `project.changed` 广播点（enter / exit 各一处） | `src/core/runtime.ts:482` / `:562` | 已落地 |
| `InstanceLoaderPort` 的 app 侧实现 | `src/app/services/persistence/instance-loader.ts` | 已落地 |
| world-sync 命令册含 `project.enter` / `project.exit` | `src/stratix-gateway/api/websocket/world-sync/protocol.ts:390` / `:393` | 已落地 |

### 衔接点 ①：远程面的 `enterInstance` **只发命令**，不碰端口

- **接线**：`ctx.remote.stratix.enterInstance(id)` → inbound 适配器翻译成 core 命令 `project.enter` → **core 裁决**（inspect → load → 写 `activeInstanceId` → 广播 `project.changed`，`src/core/runtime.ts:451` 四拍）→ core 调 `InstanceLoaderPort.load()` → 失败时 core **拒绝**（`activeInstanceId` 不变 + 广播 `project.enter.failed`）。
- **为什么**：铁律「裁决在 core」+ `InstanceLoaderPort` 实现方**不得反向调 core**（`src/core/types.ts:1367`）⇒ 中间件两头都不许越级。
- **中间件的义务**：只保证「命令被正确投递 + 失败按 D2.8 的保真度分档回报」；**不实现**任何装载逻辑。
- **代价**：远程调用是异步的，调用方拿不到同步终态 ⇒ 必须配事件面（D2.7）。

### 衔接点 ②：`project.changed` 是事件面的**载荷原型**，直接复用

- `src/core/types.ts:2180-2182` 的注释已明写：「它就是将来 `@Remote({mode:'stream'})` follow 流的**载荷原型**（baseline + increments），形状先定 ⇒ **M3 不用改协议**」。
- ⇒ 中间件的 `translate/world-event.ts` **不做任何形状变换**：B 面 follow 流的增量帧载荷 = `{ type: 'project.changed', instanceId }` **原样**；基线帧 = 当前 `WorldState` 的 `activeInstanceId`。
- ⇒ 中间件**零新增事件类型**。这是「不新造」原则最直接的兑现。

### 衔接点 ③：失败语义统一走 `PortFailureReason`，A 面保真度降级

- core 侧失败**一律返回失败结果**、**不抛异常**（`src/core/types.ts:1324` `PortResult`），且 `reason` 用**冻结的分类枚举**（`src/core/types.ts:1302`）。
- B 面（core 同进程）：事件带 `reason` ⇒ **原样透传**（高档）。
- A 面（跨进程 world-sync）：回执只有 `ack{ok:false, code:'rejected', message:'命令被 core 状态机拒绝：<自由文本>'}`（`src/stratix-gateway/api/websocket/world-sync/endpoint.ts:376-384`）⇒ **结构化 reason 丢失**（低档）。
- ⇒ 中间件的失败返回类型要能表达两档（D2.8）。**不要**试图从自由文本 `message` 里正则反解 `reason`（文案会漂移 ⇒ 静默错判）。

### 衔接点 ④：「本次调用属于哪个副本」的解析，**两侧各解各的，但产出同一个标识**

- M1 的隔离单位是**进程**（D11/D3）：A 面下「当前副本」= `WorldState.activeInstanceId`（进程内唯一）。
- B 面的隔离单位必须是**scope**（`packages/core/scope/src/index.ts:130-137` `createScope(ctx, key, options)`：「The scoped context inherits the minting plugin's dependency API and **owns every registration made through it**」）。
- ⇒ 中间件的两侧 inbound 适配器**各自**解析出 `ProjectInstanceId`（core 既有类型，`src/core/types.ts:1174`），**不新增端口**：
  - A 面：读进程的 `activeInstanceId`（唯一合法来源）。
  - B 面：读 scope 绑定的实例（P8 未落地前 ⇒ 退化为「全 scope 同一实例」，见 OPEN-1）。
- ⇒ **中间件内核的入口统一收 `instanceId` 入参**，`translate/` 里的任何函数**都不读全局 `activeInstanceId`**。这条纪律是「对 scope 友好」的具体落地方式，也是 P8 落地时**不需要**重写中间件的保证。

### 衔接点 ⑤：M1 的 `project.changed` 是**唯一权威信号**——中间件不得制造第二个

- `src/core/types.ts:2174`：「⚠️ **r1 修订（R1-08）：这是切换的唯一权威信号。**」且 world 层**只**监听 `project.changed` 切场景，收到 state 通道的 `activeInstanceId` 变化时**只做数据同步、绝不自行切换**（否则切两次）。
- ⇒ 中间件**不得**从 state 变化**自行合成**一个「切换事件」再广播给 dsh 侧。A 面的「状态推导」（D2.6）只能是 **A 面 transport 内部的实现细节**，其对外表现必须是「状态变了」，**不得**冒充 `project.changed` 的语义。
- ⇒ **代价**：A 面的推导式事件面**无法**表达「失败」（状态不变）⇒ 与 D2.6 的代价一致。

---

## 6. OPEN 项清单

> 不确定的地方**显式标 OPEN**，不编造。

| # | OPEN 项 | 为什么现在定不了 | 谁能拍板 | 何时回来 |
|---|---|---|---|---|
| **OPEN-1** | **B 面 scope → instance 的绑定契约** | M1 的 D11/D3 是**进程级**隔离；dsh 侧是 scope 级。绑定表（哪个 scope 对应哪个 instance、跨 scope 可见性）没有契约，且**依赖推迟清单 P8**（core 契约层返工） | 需先立项 P8 | P8 立项时 |
| **OPEN-2** | **prerelease 版本在 `peerDependencies` / `engines` 下的 npm 解析行为** | npm 的 semver 对 prerelease 只在 range **显式含同一 prerelease 标识**时才匹配；`~4.1.0` 是否匹配 `4.1.0`、peer 是否会自动装 `0.2.2-rc.1` **需要实测**（本单不跑 npm 实验） | 实现期实测 | 中间件建包时（实测后写回本文） |
| **OPEN-3** | **能力探测清单的具体条目** | 需要 dsh 侧真实 API 清单；dsh 是 dev preview、清单会漂移 | 中间件实现期 | 中间件实现期 |
| **OPEN-4** | **A 面是否新增 service→client 事件帧**（⇒ world-sync 协议 2→3，**老客户端直接断开**） | 破坏性变更，影响所有已发版的客户端；本单只给「不升版本」方案（D2.6）与其代价 | **用户拍板** | M3-01（A 面实施）前 |
| **OPEN-5** | **B 面是否做双面包客户端半边** | 冻结文档 §5.3.2 第④层写「M3 不做」；本单沿用（决策 D2.17），但「不做」是否长期如此需确认 | 产品决策 | B 面排期时 |
| **OPEN-6** | **Stratix 的派单是否映射到 `ctx.forge`** | 评审 B8 要求先回答。**本单初判「不映射」**：`ctx.forge` 的对象是**代码宿主**的 change request（provider-neutral ref + 状态轮询 + panel，`packages/experimental/forge/src/index.ts:16-31`），而 Stratix 派单的对象是**本地 agent**——两者语义不同族，映射过去会造出第二套「工作请求」语义 | 需在 B 面实现期对 dsh 的 `ForgeProvider` 接口再核一次 | B 面能力面落地前 |
| **OPEN-7** | **Stratix `PermissionPolicy 默认 deny` 与 dsh `danger-full-access` / approval 模型的边界划线** | 被嵌入后 Stratix 代码在 workspace sandbox **之外**执行（`packages/boot/plugin-manager/README.md:31`）；两套权限模型叠加时的裁决顺序未定义 | 安全评审 | B 面实现期 |
| **OPEN-8** | **中间件包的发布形态**（npm 公共 / 内网 registry / 只本地） | 决定要不要真去 `private: true`（D2.18）、要不要版本发布流程 | 产品/运维 | 中间件建包时 |
| **OPEN-9** | **`.stratix/dsh/profile.json` 的 `mcpServers`（Stratix 私有形状）到 dsh 行的翻译规则** | 属 A 面 M3 的工作范围（冻结文档 §5.3.1 / 评审 B4），不在 M3-00 | M3-01 | A 面实施时 |

---

## 7. 自检

| 验收项 | 结果 |
|---|---|
| 五节齐（①中间件包边界 ②B 面插件形态 ③版本钉位 ④变动吸收矩阵 ⑤M1 衔接） | ✅ §1 / §2 / §3 / §4 / §5 |
| 引用 dsh 源码处给 `path:line` | ✅ 全文 dsh 侧引用 **21 条 `path:line`**（§7.2 抽查表），**已机器核对：文件存在 + 行号在界内，0 条越界 / 0 条文件缺失**；Stratix 侧另有 **30 条 `path:line`**，同样 0 失败 |
| 决策每条带代价 | ✅ §1 的 B1–B5 共 5 条 + §2 的 D2.1–D2.22 共 22 条 + §3 的 D3.1–D3.6 共 6 条 = **33 条决策**，加 §4 的 R1–R3 共 3 条硬规则、10 条矩阵行、§5 的 5 个衔接点；**每条决策均含非空的「代价」列** |
| OPEN 项显式列出 | ✅ §6，9 条，每条含「谁能拍板 / 何时回来」 |
| 输出为决策表格式（决策 / 理由 / 代价） | ✅ 全部决策节用三列表 |
| 不写任何代码 | ✅ 本单只产出本文件 |
| 不改设计冻结文档（`DESIGN-workspace.md` / `DESIGN-project-map.md` 只读引用） | ✅ 未改动 |
| 不改 `HEARTBEAT.md` / `lra.md` / `.long-run-agent` | ✅ 未改动 |
| dsh 结论基于 pull 后的 HEAD | ✅ 文档头注明 commit `fcc0ad4621`；`git pull` 结果「已经是最新的」 |
| dsh 仓库只读 | ✅ 只 `git pull` / `sed` / `grep` / `wc` |

### 7.1 决策计数

| 节 | 决策数 |
|---|---|
| §1 中间件包边界 | 5（B1–B5） |
| §2 B 面插件形态 | 22（D2.1–D2.22） |
| §3 版本钉位 | 6（D3.1–D3.6） |
| §4 变动吸收矩阵 | 3 规则 + 10 矩阵行（V1–V10） |
| §5 M1 衔接 | 5 衔接点 |
| **合计** | **33 条决策（B1–B5 / D2.1–D2.22 / D3.1–D3.6）+ 3 条硬规则（R1–R3）+ 10 条矩阵行（V1–V10）+ 5 个衔接点** |

### 7.2 引用抽查（dsh `path:line` 实际存在，HEAD `fcc0ad4621`）

| # | 引用 | 抽查结果 |
|---|---|---|
| 1 | `packages/core/scope/src/index.ts:137` | ✅ `export function createScope(ctx: Context, key: ScopeKey, options?: CreateScopeOptions): Scope {` |
| 2 | `packages/core/tools/src/index.ts:99` / `packages/core/tools/src/index.ts:106` | ✅ `:99` = `export class ToolsService extends Service {`；`:106` = `private readonly layers = new ScopedLayers(...)` |
| 3 | `packages/typert/protocol/src/index.ts:282` | ✅ `export function Remote<This extends object, Args extends unknown[], Result>(` |
| 4 | `packages/host/webserver/src/index.ts:108` | ✅ `/** Listen port; zero requests an OS-assigned port. */`（B2 的 port 0 依据） |
| 5 | `packages/boot/plugin-manager/README.md:31` | ✅ 含「installed Host code executes in-process outside the workspace sandbox」 |
| 6 | `packages/boot/app-boot/src/index.ts:266` / `packages/boot/app-boot/src/index.ts:576` | ✅ `:266` = `const userPatchesSchema = entryListSchema`；`:576` = `parsed = yaml.load(content, { schema: userPatchesSchema })`（`!!js` 可执行面） |
| 7 | `packages/client/ui-goal/package.json:16` / `:40` | ✅ `:16` = `"exports": {`；`:40` = `"platform": "web"`（双面包形态） |
| 8 | `packages/experimental/forge/src/index.ts:16-18` | ✅ `:16` = `declare module '@deepseek-ai/cordis' {`；`:17` = `interface Context {`；`:18` = `forge: ForgeService`（B8 的 seam） |
| 9 | `packages/mcp/mcp-client/src/index.ts:4` | ✅ 「(`mcp__<serverName>__<rawName>`)」命名规则 |
| 10 | `apps/cli/src/args.ts:170` | ✅ `.option('--patch <path>', 'extra patch-list overlay applied after the profile layer (repeatable)', collect)` |
| 11 | `vendor/cordis/package.json:4` | ✅ `"version": "4.1.0"` |
| 12 | `package.json:3` | ✅ `"version": "0.2.2-rc.1"` |
| 13 | `packages/boot/plugin-manager/README.md:56` / `:77` | ✅ `:56` 含 `engines.dsh` 的不兼容记录；`:77` 含「An unmet DSH requirement rejects the operation before pnpm runs」 |

> **Stratix 侧引用**（同样为实测行号）：`src/core/types.ts:1174`（`ProjectInstanceId`）、`:1302`（`PortFailureReason`）、`:1324`（`PortResult`）、`:1375`（`InstanceLoaderPort`）、`:1392`（`ProjectArchivePort`）、`:1517`（`activeInstanceId`）、`:2184`（`project.changed`）、`:2191`/`:2200`（两个 failed 事件）；`src/core/runtime.ts:451`（四拍）、`:482`/`:562`（广播点）；`src/app/services/cli-transport/adapters/dsh.ts:51`（`DSH_PACKAGE_NAME`）；`src/stratix-gateway/api/websocket/world-sync/protocol.ts:13-15`（方向契约）、`:282`（`toWireState`）、`:390`/`:393`（命令册）；`src/stratix-gateway/api/websocket/world-sync/endpoint.ts:376-384`（拒绝回执）；`plugins/dsh-bridge/src/index.ts:26`/`:29`/`:64`；`plugins/dsh-bridge/package.json:4`/`:22`/`:23`。
