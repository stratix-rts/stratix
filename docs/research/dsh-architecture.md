# DeepSeek Harness（dsh）插件架构调研报告

> 任务：task_157 调研 A。调研对象 `/Users/kingj/code/deepseek-harness`（HEAD `ce7073d5`）。
> 本报告为**只读调研**产物：dsh 仓库内未做任何写操作，Stratix 仓库内只新增本文件，未改 `src/`。
>
> **引用约定**：本文所有 `path:line` 均相对 `/Users/kingj/code/deepseek-harness`；带 `Stratix:` 前缀的相对 `/Users/kingj/code/Stratix-demo`。
> **证据分级**（全文遵守）：源码 > 包 README > Agent Note（`.agents/notes/`）> 教程/skill 散文 > 测试断言。测试断言只用来证明「某能力已被移除」这类否定事实。

---

## 0. TL;DR（先说结论，含一条重要更正）

1. **dsh 的插件模型是 Cordis `4.0.0-rc.11`（`vendor/README.md:19`），不是 Cordis v3。** 网上/旧文档里的 `Service.provide` / `[Service.provide]` 装饰器 / `ready|start|stop` 钩子 / `ctx.setConfig` / `ctx.cfg` / `ctx.service` 注册表 **在本代码库中都不存在**。按 v3 心智模型去读源码会全部落空。
2. **一句话心智模型**：写一个 dsh 插件 = 写一个「把自己的副作用挂到 `ctx` 上、并在卸载时自动撤销」的函数。`ctx` 不是 DI 容器实例，而是 **Proxy + 原型继承的作用域树**（`vendor/cordis/src/context.ts:71-84`）；插件不是「被调用的函数」，而是「拥有 fiber、effect 栈与依赖边界的运行时实例」（`vendor/cordis/src/fiber.ts:240`）。
3. **一切注册都是 effect**：服务（`vendor/cordis/src/reflect.ts:292`）、监听器（`vendor/cordis/src/events.ts:265`）、工具（`ctx.tools.register` 的 disposer 由注册层持有，见 `Stratix:plugins/dsh-bridge/src/index.ts:48-49` 实测记录）。卸载时逆序回收（`vendor/cordis/src/fiber.ts:437`）。
4. **组合发生在 YAML 里，行序无语义**（`packages/bundle/base/cordis.patch.yml:12-14`）；patch 是**整段替换 config**，不是深合并（`packages/bundle/base/cordis.patch.yml:6-8`）。
5. **108 个 `ctx.*` 接缝**（`docs/capability-seams.md:653-760`）：61 `core` / 36 `seam` / 10 `service` / 1 `bundle`。「seam」= Service Definition + Service Provider(s) + Consumer(s) 三件套（`docs/architecture.md:136`）。
6. **插件就是 npm 包**。组合包（bundle）是「配置行 + 代码」的分发格式，靠自己 `package.json` 的 `dsh` 字段声明：`dsh.bundle.patch` 与 `dsh.client` 见 `packages/experimental/creation-recommendations/src/generated-bundle.ts:18-21`，`dsh.profile.bundles` 见 `packages/boot/plugin-manager/README.md:40`。分发靠自建索引 JSON（`format: 1`，`.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md`），**不是** dsh 官方市场。
7. **⚠️ 重要更正（任务前提有误）**：任务描述里的「`cordis_inspect` 工具 → 组合包 → `plugin_manager` 安装」这条链路中，**运行时自改包（`cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine` / `cordis_inspect_self`）在 HEAD 已被退役**。模型现在只看到两个**只读**检查工具。证据：`.agents/notes/implemented/architecture/2026-09-16-creator-persistent-plugin-management.md:17`、`packages/extensions/tool-cordis/src/index.ts:22,41`（只注册 `cordis_inspect_list` / `cordis_inspect_query`）、`apps/cli/tests/web-agent-presets.e2e.ts:557`（断言这 5 个工具**不在**工具表里）。详见第 4 节。
8. **对 Stratix 最有价值的 Top10** 见第 6 节；最要紧的三条是：effect 化可逆注册、append-only 事件日志 + 投影、seam 三件套（Definition/Provider/Consumer）——这三条我们已经在 `docs/DSH-INTEGRATION-PLAN.md:33-40` 的「借逻辑 C」里写进 MCP-SPEC v2 设计章，本次调研**证实**了这三条的取法有 dsh 源码支撑。

---

## 1. Cordis 插件模型（vendor/ 源码级）

### 1.1 先对齐版本：这是 rc.11，不是 v3

`vendor/README.md:19` 的清单表列出 `cordis/` → `@deepseek-ai/cordis` → `cordis` → **`4.0.0-rc.11`**。该文件同时记录了 DSH 对 Cordis 的本地改动（V1–V25 条目，V6 为 fiber 生命周期加固）。

**这一节的所有结论都受这个版本约束。** 与 v3 的对照（`v3 概念` → `rc.11 实际`）：

| v3 常见写法 | rc.11 实际 | 源码位置 |
|---|---|---|
| `Service.provide` / `[Service.provide]` 装饰器 | **不存在**。等价物：`super(ctx, 'name')` 构造函数即注册 | `vendor/cordis/src/service.ts:42-59` |
| `Service.inject` / `[Service.inject]` | **不存在**。等价物：静态 `inject` 字段或 `@Inject()` 装饰器 | `vendor/cordis/src/registry.ts:71-88`、`vendor/cordis/src/registry.ts:37-60` |
| `ready` / `start` / `stop` 钩子 | **不存在**。等价物：`[Service.init]()`（可 async generator yield disposer）+ `ctx.effect()` 的 disposer | `vendor/cordis/src/service.ts:13`、`vendor/cordis/src/fiber.ts:251-269` |
| `ctx.setConfig` / `ctx.cfg` | **不存在**。等价物：`fiber.update()` / `fiber.effectiveConfig` / `fiber.resolveConfig()` | `vendor/cordis/src/fiber.ts:783-819`、`:664-666`、`:676-679` |
| `ctx.service`（服务注册表） | **不存在**。是 `ctx.reflect.store`（按隔离符号索引）、`ctx.reflect.props`（属性声明表）、`ctx.registry`（按 callback 索引的插件表） | `vendor/cordis/src/reflect.ts:222`、`:224`、`vendor/cordis/src/registry.ts:195` |
| `loader.load()` | **不存在**。是 `ctx.loader.create()` / `ctx.loader.entries()` / `ctx.loader.await()` | `vendor/loader/src/config/tree.ts:83`、`:28`、`:44` |

### 1.2 `ctx` 是什么：Proxy + 原型继承的作用域树

- 公开形状是 `interface Context`（`vendor/cordis/src/context.ts:16`），运行时类在 `vendor/cordis/src/context.ts:42`。
- 根上下文构造时 `const self = new Proxy<this>(this, ReflectService.handler)`（`vendor/cordis/src/context.ts:71-84`）。**`ctx` 是 Proxy，不是普通对象。**
- 属性读取被 `ReflectService.handler` 拦截（`vendor/cordis/src/reflect.ts:143-219`）。`get` trap 的核心（`vendor/cordis/src/reflect.ts:163-180`）：**沿 fiber 父链向上查找名为 `prop` 的服务实现**，并受 `symbols.isolate`（隔离域标签）约束；命中 `fiber.inject` 里的必需服务但当前上下文未激活时，抛 `cannot get required service "X" in inactive context`。
- `ctx.extend(meta)`（`vendor/cordis/src/context.ts:99-107`）用**原型继承**创建子作用域：`meta` 的 own property 遮蔽父上下文同名属性，父上下文不被改。
- 每个插件实例都拿到一个子 context：`this.ctx = this.context = parent.extend({ fiber: this })`（`vendor/cordis/src/fiber.ts:240`）。**这就是「插件的作用域」的物理实现。**
- `ctx.isolate(name, label?)`（`vendor/cordis/src/context.ts:121-125`）为服务名开一个独立实例域；`ctx.intercept(name, config)`（`vendor/cordis/src/context.ts:139-145`）给同名服务开一份独立配置域。

### 1.3 插件的三种形态与装载入口

三种形态在 `vendor/cordis/src/registry.ts:92-133` 定义：

1. 函数插件 `export function apply(ctx, config)`
2. 类插件 `export default class X extends Service`（`new (ctx, config)`）
3. 对象插件 `{ apply(ctx, config) }`

装载入口是 `ctx.plugin(plugin, config?)`（`vendor/cordis/src/registry.ts:316-336`，由 `vendor/cordis/src/reflect.ts:235` 混入到每个 ctx）。要点：

- **插件身份 = callback 身份**。`vendor/cordis/src/registry.ts:222-228` 的 `resolve()` 把三种形态统一成 callback。
- 返回值是 fiber 且 **thenable**：`await ctx.plugin(X)` 会等 `fiber.await()` settle，失败时抛配置/启动错误（`vendor/cordis/src/registry.ts:316-336`、`vendor/cordis/src/fiber.ts:754-760`）。
- 同一插件被多次 `ctx.plugin()` = 多个 fiber，共享一份 runtime（`vendor/cordis/src/registry.ts:136-145`）。

### 1.4 依赖声明与「依赖驱动的自动启停」

**两种声明方式**（`vendor/cordis/src/registry.ts:71-88` 解析）：

- 静态 `inject` 数组：`export const inject = ['tools']`（模块插件，`packages/experimental/webhook-github/src/index.ts:14`）或 `static inject = ['systemPrompt']`（类插件，`packages/core/tools/src/index.ts:99-100`）。数组形式 = 「仅要求该服务存在」；对象形式 = 「服务名 → 本插件对该服务的拦截配置」。
- `@Inject()` 装饰器（`vendor/cordis/src/registry.ts:37-60`）：类上 ⇒ 贡献到静态 `inject` 映射（**原型继承**，子类可增量追加）；方法上 ⇒ **延迟调用**——该方法要等声明的服务可用后才执行。

**核心机制（这是 Cordis 相对普通 DI 容器最不一样的地方）**：

- 依赖不全 ⇒ fiber 停在 `PENDING`，**不报错**（`vendor/cordis/src/fiber.ts:617-628`；教程表述 `docs/cordis-tutorial/03-services.md:72`）。
- 服务提供者被卸载 ⇒ 依赖它的 fiber 自动卸载（`vendor/cordis/src/reflect.ts:335-354` 的 `notify()` 遍历所有 runtime 的所有 fiber，重算依赖与 epoch）；服务重新出现 ⇒ 依赖者重新加载（`vendor/cordis/src/fiber.ts:630-646` 的 `_setEpoch`，`INACTIVE → 非 INACTIVE` 触发 `_reload()`，否则 `_unload()`）。

### 1.5 生命周期状态机与「没有 start/stop」的替代品

`vendor/cordis/src/fiber.ts:147-154`：

```ts
export const enum FiberState { PENDING, LOADING, ACTIVE, FAILED, DISPOSED, UNLOADING }
```

教程对照：`docs/cordis-tutorial/02-lifecycle-and-effects.md:72-80`（`PENDING → LOADING → ACTIVE → UNLOADING → DISPOSED`，失败分支 `↘ FAILED`）。

**等价物对照**：

| 你想做的 | rc.11 里的写法 | 位置 |
|---|---|---|
| 插件启动逻辑 | `[Service.init]()` 实例方法 | `vendor/cordis/src/service.ts:13`，调用点 `vendor/cordis/src/fiber.ts:251-269` |
| 清理逻辑 | `ctx.effect(() => disposer)` 或 `[Service.init]` 写成 `async*` 并 `yield disposer` | `vendor/cordis/src/fiber.ts:421-567` |
| 停掉插件 | `fiber.dispose()`（级联：插件的 dispose 是父 fiber 的一个 effect，`vendor/cordis/src/fiber.ts:271-303`） | — |
| 改配置 | `fiber.update(config)` → `internal/update` waterfall，监听器可决定是否重启/拒绝 | `vendor/cordis/src/fiber.ts:783-819` |

`[Service.init]` 的执行顺序（`vendor/cordis/src/fiber.ts:251-269`）：**构造类插件 → 跑 `@Inject` 装饰器累积的 initHooks → 调 `[Service.init]()` → 其返回值被当作 effect 收集**。仓库里同步 / async / generator 三种写法都有：`packages/preset/agent-preset/src/index.ts:27`（`async*`）、`packages/core/agent/src/index.ts:297`（`async`）、`vendor/include/src/index.ts:241`（`async*` + `yield () => this.stop()`）。

**卸载顺序**：先等所有依赖者卸完，再逆序跑 disposer（`vendor/cordis/src/fiber.ts:712-746`、`:437`）。

### 1.6 配置：Standard Schema + 拦截配置合并

- 插件导出 `Config`（Standard Schema 验证器），类型见 `vendor/cordis/src/registry.ts:100-111` 的 `Plugin.Base.Config`。**不是 Schemastery 专有类型**；Schemastery 通过 `vendor/schemastery/src/index.ts:290-307` 适配到 Standard Schema。
- 校验在插件回调执行前发生（`vendor/cordis/src/fiber.ts:50-62` 的 `resolveConfig`、`:254-256` 的调用点）。校验失败 ⇒ fiber 进入 `FAILED`（`vendor/cordis/src/fiber.ts:19-36`、`:697-700`），**失败是响亮的**，不会静默跑一个半配置的服务。
- 拦截配置合并语义在 `vendor/cordis/src/service.ts:86-102`：沿 context 原型链收集，**离根越近优先级越高**；服务自己声明 `Config.merge`（Schemastery schema）则深合并，否则浅 `Object.assign`。
- `internal/config` waterfall（`vendor/cordis/src/events.ts:156-159`）允许插件在校验前改写/规范化配置；Loader 监听同一事件做 `!!js` 插值（`vendor/loader/src/index.ts:104-110`）。

### 1.7 事件系统

- 五种派发模式：`'emit' | 'parallel' | 'serial' | 'bail' | 'waterfall'`（`vendor/cordis/src/events.ts:31`）。实现分别见 `vendor/cordis/src/events.ts:191-196` / `:203-206` / `:214-220` / `:228-234` / `:246-261`。教程对照表 `docs/cordis-tutorial/04-events.md:84-90`。
- waterfall 语义：`next()` 把控制权交给下一个监听器；`next()` 被调用两次会抛错（`vendor/cordis/src/events.ts:246-261`）。仓库强制规则见 dsh 自己的 `CLAUDE.md:136`（"Waterfall listeners MUST call `next()`"）。
- `ctx.on(...)` 的监听器注册**也是当前 fiber 的 effect**，卸载自动移除（`vendor/cordis/src/events.ts:263-270`）；`once` 是自毁式包装（`:317-323`）。
- **作用域事件**：派发时的过滤发生在 `vendor/cordis/src/events.ts:162-171`，靠 `thisArg` 上的 `Context.filter`（`vendor/cordis/src/context.ts:46`）决定哪些 listener 能收到；`options.global` 的 listener 无视 filter。DSH 的 scope 路由就建在这上面（`packages/core/scope/src/index.ts:167-180`）。
- 类型化事件靠声明合并：`declare module '@deepseek-ai/cordis' { interface Events { ... } }`（`vendor/cordis/src/events.ts:334-371`）。

### 1.8 Loader：插件怎么被装起来的

- `Loader extends EntryTree`（`vendor/loader/src/index.ts:77`），构造时把自己注册为 `loader` 服务（`vendor/loader/src/index.ts:96-102`）。
- 配置树：`EntryTree`（`vendor/loader/src/config/tree.ts:8`）→ `EntryGroup`（`vendor/loader/src/config/tree.ts:18`、`vendor/loader/src/config/group.ts:6`）→ `Entry`（一行插件，`vendor/loader/src/config/entry.ts:43`，options 结构 `vendor/loader/src/config/entry.ts:10-23`）。
- 装载一行的完整链路（`vendor/loader/src/config/entry.ts:225-238`）：`import(name)` → `unwrapExports`（`vendor/loader/src/index.ts:198-205`，兼容 ESM/CJS/default 三种导出形状）→ `ctx.registry.plugin(plugin, config)`。
- `import` 的名字约定（`vendor/loader/src/config/tree.ts:113-132`）：`cordis:<name>` ⇒ 内建插件（`vendor/loader/src/index.ts:87`；注册见 `packages/boot/app-boot/src/index.ts:746`、`:764`）；相对路径 ⇒ 以 `ctx.baseUrl` 为基准；裸包名 ⇒ 先用 `createResolve`（`vendor/loader/src/resolve.ts`）在配置项目自身的 package scope 里解析。
- 启动胶水：`packages/boot/app-boot/src/index.ts:1206-1237` 的 `boot()` —— `new Context()` → `ctx.plugin(Loader)` → `mountRootInclude(...)` → `await ctx.get('loader')?.await()`。
- **组合即 YAML**：`packages/bundle/base/cordis.patch.yml:12-14` 明写 "Row order carries no load semantics (activation is service-availability driven)"。**激活顺序由服务可用性决定，不由行序决定。**
- **patch 语义是整段替换**：`packages/bundle/base/cordis.patch.yml:6-8` 明写 "A patch replaces the targeted row's whole `config` rather than merging into it"。这是 Stratix 用 `--patch` 覆盖层时最容易被误解的一条。

### 1.9 「时空可组合性」在代码里到底指什么

这个术语在 dsh 仓库里**只出现 2 次**，都在 README，且明确指向外部论文：

- `README.md:7`：*"built on an everything-is-a-plugin architecture and powered by Cordis, whose design is described in A Programming Paradigm for Spatiotemporal Composability"*（arXiv:2608.25512）。
- `README.zh.md:7`：中文同句。

仓库内**没有**任何其他 `spatiotemporal` 命中。所以它不是 dsh 的自造术语，而是上游 Cordis 的框架性表述。下表是我把它**映射到 dsh 具体机制**的结果（映射是推论，机制本身可查证）：

| 论文维度 | dsh 里的具体机制 | 出处 |
|---|---|---|
| 空间（spatio）：同一份代码多处并存 | `ctx.isolate()` 开独立实例域；`reflect.store` 按隔离符号索引 ⇒ 同名服务可同时存在 N 份互不干扰的实现 | `vendor/cordis/src/context.ts:121-125`、`vendor/cordis/src/reflect.ts:222`、`:300-306` |
| 空间：Loader 层隔离 realm | `Realm`/`LocalRealm`/`GlobalRealm`，entry 级 `isolate:` 选项 | `vendor/loader/src/config/isolate.ts:26-46`、`:96-156` |
| 空间：DSH 自己的 scope 原语 | `createScope` 同时打空间标签（`extend({ [kScope]: key })`）与造 fiber（时间维度） | `packages/core/scope/src/index.ts:138-142`、`:163-180` |
| 时间（temporal）：挂载/卸载/热替换 | FiberState 六态机 + `_reload()` / `_unload()` + effect 逆序回收 | `vendor/cordis/src/fiber.ts:147-154`、`:630-646`、`:681-746`、`:437` |
| 时间：配置变更触发重启 | `fiber.update()` → `internal/update` waterfall | `vendor/cordis/src/fiber.ts:783-819` |

**给插件作者的三条推论**（均可由上表逐条验证）：

1. 插件不感知自己被挂在哪个「空间」——`ctx` 是原型继承的子 context，服务解析按当前作用域的 isolate 标签走。
2. 插件不感知自己何时被挂/卸——所有注册都是 effect，卸载自动回滚。
3. 组合不发生在代码里，发生在 YAML 里。

### 1.10 最小插件模板（我们已实测过的形状）

`Stratix:plugins/dsh-bridge/src/index.ts:26-83` 是我们自己在真实 dsh 实例里跑通的最小插件（task_089）：

```ts
export const name = 'stratix-dsh-bridge';   // 诊断标签
export const inject = ['tools'];             // 依赖的服务；cordis 等它就位再装载本插件
export const Config = z.object({ ... });     // 部署侧配置（profile patch 的 config: 段）
export function apply(ctx: Context, config: BridgeConfig): void {
  ctx.effect(() => () => { /* 卸载时清理 */ });
  ctx.tools.register(defineTool({ name: 'stratix_world_snapshot', ... }));
}
```

实测踩出来的三条（`Stratix:plugins/dsh-bridge/README.md:41-49`）：

- `ctx.tools` **不是** `ctx.get('tools')`：它是服务属性投影，声明 `inject: ['tools']` 后自动出现。
- 工具必须声明 `output: { schema, render }`，缺 `render` 会在注册时被 `TypeError` 拒掉。
- **模型看到的是 `output.render()` 的产物，不是规范值本身**。只 render 一句汇总结论，模型会以为数据是编的。

---

## 2. capability seams 全景（108 个接缝中挑 15 个）

### 2.1 全景事实

- `docs/capability-seams.md` 是**生成文档**（首行 "Generated by scripts/gen-doc-graphs.ts - do not edit by hand"，`docs/capability-seams.md:1-2`）。
- 表体在 `docs/capability-seams.md:653-760`，共 **108** 行接缝，角色分布：**61 `core` / 36 `seam` / 10 `service` / 1 `bundle`**（按表第 3 列统计得出；生成器在 `docs/capability-seams.md:762` 声明角色由 `scripts/gen-doc-graphs.ts` 分类并带完整性守卫）。
- **seam 的定义**（`docs/architecture.md:136`）：*"A **seam** is a swappable capability with three roles: a **Service Definition** declaring the interface, a **Service Provider** implementing it, and a **Consumer** using it, commonly a model-facing tool. A package may combine roles, but one role alone is not a seam; adding a capability means designing all three."*
- 接缝的价值（`docs/architecture.md:138`）：*"Filesystem and subprocess providers share one execution world, so pointing them at a remote sandbox moves Bash, PTY, and LSP with them, with no provider forks."*

### 2.2 挑选准则

按任务要求「与宿主 UI / 外部编排 / 工具提供最相关」，我按三类各取：

- **工具提供面**（模型能调什么）——5 个
- **宿主 UI / 人机交互面**——4 个
- **外部编排 / 分发面**——6 个

### 2.3 选出的 15 个

| # | ctx key | 角色 | 一句话用途 | 所在包 |
|---|---|---|---|---|
| 1 | `ctx.tools` | core | 模型可见工具的**作用域化注册表**与受管执行管线；任何新工具都挂这里，其 schema 自动进入 prompt 组装 | `packages/core/tools`（`docs/architecture.md:59`） |
| 2 | `ctx.systemPrompt` | core | prompt 段与工具 schema 的组装点，决定模型「看得见什么」 | `packages/core/system-prompt`（`docs/architecture.md:58`） |
| 3 | `ctx.skills` | seam | 可按需加载的 Markdown 指令文档的注册表（Definition + Provider + Consumer 三件套齐全） | `packages/skill/skill`；Provider：`packages/skill/skill-filesystem`、`skill-office`、`skill-badge`；Consumer：`packages/skill/tool-skill`（`docs/capability-seams.md` 对应行；`docs/subsystems/skills.md:13`） |
| 4 | `ctx.subagents` | seam | 委派子 agent 并收集受管结果；Provider 可换（本地 spawn/fork、ACP、Codex、Claude Code、DSH SDK） | `packages/subagent/subagent`；Provider：`packages/subagent/subagent-{spawn,fork}-in-process`、`subagent-acp`、`subagent-codex`、`subagent-claude-code`、`subagent-dsh-sdk`；Consumer：`packages/subagent/tool-subagent`、`tool-subagent-control`（`packages/subagent/subagent/README.md:12`） |
| 5 | `ctx.workflowEngine` | seam | 让模型写一段编排脚本（`agent()`/`parallel()`/`pipeline()`/`phase()`）去 fan out 子 agent | `packages/workflow/workflow`；实现 `packages/workflow/workflow-ptc`；Consumer `packages/workflow/tool-workflow`（`docs/subsystems/workflow.md:5`） |
| 6 | `ctx.typertGateway` | core | Host ↔ 客户端 RPC 网关：宿主 UI 与插件/Agent 之间的双向类型化通道 | `packages/api/gateway`（`docs/capability-seams.md` 对应行） |
| 7 | `ctx.userQuestions` | seam | 向用户提问并等待回答的接缝（模型工具 `tool-ask-user` 的后端） | `packages/interaction/user-questions`（`docs/capability-seams.md` 对应行） |
| 8 | `ctx.commands` | core | 注册人类命令（`/` 斜杠命令）；**不经模型回合直接派发** | `packages/interaction/commands`（`docs/architecture.md:153`） |
| 9 | `ctx.approval` | seam | 工具/外部动作的人工批准通道，`ask`/`never` 两档；`ctx.tools` 的执行管线依赖它 | `packages/interaction/user-approval`（`docs/capability-seams.md` 对应行；`packages/boot/plugin-manager/README.md:31`） |
| 10 | `ctx.agents` | core | 活的 Agent 句柄 + create/resume 工厂缝 + 发起者传播 | `packages/core/agent`（`docs/architecture.md:60`） |
| 11 | `ctx.agentLoop` | bundle | **唯一的具体 loop 插件**；扩展包应依赖 dsh-agent 的事件与服务，而不是依赖这个包 | `packages/core/agent-loop`（`docs/capability-seams.md` 该行 Note 字段原文） |
| 12 | `ctx.agentPresets` | core | 急切挂载 YAML 声明的 preset 修订版，把 Agent 与冷读者绑定到作用域化贡献，退休修订版直到最后一个使用者释放 | `packages/preset/agent-preset-registry`（`docs/capability-seams.md` 该行 Note 字段原文） |
| 13 | `ctx.sessions` | core | append-only 的 `SessionEvent` 日志与内存 store；LLM 消息历史是它的**投影**，不是另存一份 | `packages/core/session`（`docs/subsystems/session.md:5`） |
| 14 | `ctx.pluginManager` | core | 管理当前 profile 的插件/组合包：装、卸、启用、禁用、版本豁免 | `packages/boot/plugin-manager`（`packages/boot/plugin-manager/README.md:31`） |
| 15 | `ctx.pluginMarket` | core | 读取用户配置的插件索引，标注安装状态与 DSH 兼容性；**只读**，`plugin_market` 工具同源 | `packages/boot/plugin-market`（`packages/boot/plugin-market/README.md:12`） |

### 2.4 差一点入选的（供后续查阅，均有出处）

- `ctx.jobs`（`packages/jobs/jobs`）：后台作业注册表，`JobStatus = 'running'|'stopping'|'completed'|'killed'|'failed'`（`docs/subsystems/jobs.md:21`）。
- `ctx.planMode`（`packages/plan/plan-mode`）：**软指导**，不是强制；sandbox 与 approval 各自独立强制（`docs/subsystems/plan.md:5`）。
- `ctx.sessionPersistence`（`packages/session/session-persistence`）：会话落盘缝，JSONL 后端在 `packages/session/session-persistence-jsonl`。
- `ctx.goals`（`packages/goal/goal`）、`ctx.schedule`（`packages/schedule/schedule`）：目标轮次与定时。
- `ctx.fs` / `ctx.shell` / `ctx.subprocess` / `ctx.sandbox`：执行世界四个缝，换 provider 就能整体搬到远端（`docs/architecture.md:138`）。

---

## 3. 插件打包 / 分发 / 安装

### 3.1 插件是什么形态：**npm 包**（这是结论，不是比喻）

- 安装走 **pnpm**，不是 npm（`packages/boot/plugin-manager/README.md:31`：*"Package installation/removal requires pnpm on `PATH` or an explicit `pnpmCommand`"*）。
- 安装目标是**四种 spec**：npm 名、Git URL、tarball、本地路径（`.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md` Problem 段：*"DSH installs third-party bundles only from a spec the user already knows: an npm name, a Git URL, a tarball, or a local path."*）。
- Git spec 精确到 commit：`git+<url>.git#<commit>`，子目录用 `&path:/<path>`（`packages/boot/plugin-market/README.md:100`）。
- 插件在**宿主进程内**执行，跑在 workspace 沙箱**之外**（`packages/boot/plugin-manager/README.md:31`：*"installed Host code executes in-process outside the workspace sandbox"*）。

### 3.2 组合包（bundle）：插件的分发单位

定义（`docs/architecture.md:19`）：*"A **bundle** is a distribution format for Cordis config rows and the code they mount, so whatever it inserts stays patchable by the layers above it."*

一个 bundle 包靠 `package.json` 的 `dsh` 字段声明自己（`docs/architecture.md:21`）：

| 字段 | 含义 | 佐证 |
|---|---|---|
| `dsh.bundle.patch` | 指向本包的 patch 文件（通常 `./cordis.patch.yml`） | `packages/experimental/creation-recommendations/src/generated-bundle.ts:18-21` 强制 `dsh: { bundle: { patch: './cordis.patch.yml' } }`；`packages/experimental/personalized-recommendations/tests/bundle.spec.ts:57` 断言 |
| `dsh.profile.bundles` | profile 的**有序**组合包列表；开关组合包 = 改这个列表 | `packages/boot/plugin-manager/README.md:40`；`packages/experimental/terminal-bundle/README.md:28` |
| `dsh.client` | 声明本包有客户端模块（`exports["./client"]` 入口） | `packages/experimental/creation-recommendations/src/generated-bundle.ts:42-45`；`packages/experimental/client-ui-*` 系列 |

**profile / bundle / patch 的分层顺序**（`docs/architecture.md:25`）："Layers apply to an empty entry list: the profile's ordered bundles, its `cordis.patch.yml`, the home patch, then `--patch` overlays." 即 **bundle 层 → profile patch → home patch → 命令行 `--patch`**。`docs/architecture.md:27` 说明 base 层启用 config-only 的 `dsh-hmr`，headless/SDK/ACP 禁用 HMR。

**profile 在哪**：`$DSH_HOME/profiles/<name>/`，内含 `package.json`（带 `dsh.profile.bundles`）、`cordis.patch.yml`（用户自己的 patch）、`node_modules`（只装 profile 内的 bundle）、`compatibility.json`（版本豁免）（`packages/experimental/terminal-bundle/README.md:28`、`packages/boot/plugin-manager/README.md:79`）。

### 3.3 Plugin Manager：8 个动作的完整语义

工具 schema（`docs/tool-catalog.md:58-128`），8 个 action（`docs/tool-catalog.md:66-77`）：

`list_plugins` / `list_bundles` / `set_plugin` / `set_bundle` / `install_bundle` / `remove_bundle` / `list_version_exemptions` / `set_version_exemption`

关键语义（全部出自 `packages/boot/plugin-manager/README.md`）：

- **开关插件**只改 profile `cordis.patch.yml` 里最后一条匹配 override 的 `disabled`；若 bundle 层与剩余 patch 已经给出该状态，则**删掉**那条 override —— *"so the profile patch records only departures from the bundles"*（`:40`）。
- **开关组合包**改 `package.json` 的有序 `dsh.profile.bundles`；禁用保留依赖，启用追加到**末尾**（会改变配置优先级）；安装默认启用新组合包（`:40`）。
- **安装失败会回滚** manifest 与 lockfile；安装成功但激活失败则可能保留依赖与选择（`:54`）。
- **HMR 与否决定「保存」与「生效」是否分离**：无 HMR 时保存变更返回 `restart-required` + `no-hmr`，需重启才生效（`:31`、`:126`）。
- **卸载顺序**：从 `dsh.profile.bundles` 移除 → 卸载其运行时贡献 → `pnpm remove` → 发布运行时解析；某步失败则后续步不执行（`:195`）。
- **每次工具动作都需要 `danger-full-access` 或单次批准**；`ask` 会请求批准，`never`/拒绝/取消/无可用批准通道则阻止执行；批准**不改变**会话权限模式（`:31`）。
- **官方按需安装走同一个 `installBundle`**；registry target 用 `saveExact: true`，开发 target 保留 `link:` 依赖（`:54`）。

### 3.4 Plugin Market：**没有官方市场**，只有自建索引

- DSH 不带任何索引源：*"DSH ships no index source."*（`docs/user/guide/plugin-market.md:26`）
- 索引格式 `format: 1`，一个 UTF-8 JSON 文件，最大 128 MiB，2xx 且不重定向（`docs/user/guide/plugin-market.md:44`；格式规范 `.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md`）。
- 索引里每个 plugin 有 `name`/`title`/`description`/`icon`/`author`/`homepage`/`repository`/`dist-tags`/`versions[]`，每个 version 有 `version`/`publishTimestamp`/`source`（`npm` 或 `git`）/`engines.dsh`（`.agents/notes/implemented/feature/2026-10-02-plugin-market-index-format.md` Plugin fields 表）。
- **索引是第三方内容，DSH 只校验格式，不校验声明**（`docs/user/guide/plugin-market.md:44`；`packages/boot/plugin-market/README.md:126` *"Unsigned indexes — index content ... is the index's claim; the installed manifest decides what is installed."*）。
- 搜索用 MiniSearch 全文索引，500 个插件/事件循环 turn（`packages/boot/plugin-market/README.md:94`）。
- 参考生成器：`apps/plugin-market-generator`，输入「一行一个 npm 包名或 https Git 仓库 URL」的纯文本，输出索引 JSON；**只下载和读文件，从不安装包、从不执行其代码**（`docs/user/guide/plugin-market.md:70-84`）。npm 包只有在**声明了 `dsh.bundle`** 时才会被列进索引（`docs/user/guide/plugin-market.md:82`）。
- 安装状态由 `pluginManager.listBundles()` 推导，五个取值 `not-installed` / `installed` / `update-available` / `different-version` / `provided`（`packages/boot/plugin-market/README.md:96`）。
- **不支持升级**：有新版只报 `update-available`，升级 = 先卸后装（`packages/boot/plugin-market/README.md:125`）。

### 3.5 「dsh-plugin GitHub topic」——**仓库内没有这个机制**

我把这一点查到底了，结论必须写清楚：

- dsh 仓库里出现的 `dsh-plugin` 只是**命名示例**（`docs/user/guide/plugin-market.md:56-57` 的 `"https://github.com/jane/dsh-plugin-foo"`、`:71` 的 `"dsh-plugin-foo"`、索引格式笔记 `:48` 的 `"dsh-plugins"`）。**没有任何代码读取 GitHub topic。**
- 曾经有过一个 `.dsh-plugin` 编写格式和 `@deepseek-ai/dsh-repository-plugin` 包，**已在 2026-08-09 被移除**（`.agents/notes/archived/simplification/2026-08-09-remove-repository-plugin.md:18`：移除该包、`.dsh-plugin` 编写格式、`dsh-plugin-prepare` 可执行文件、生成的包装层、不可变 repository 缓存、base 里的 `repository-plugins` 配置项）。
- 所以：**「dsh-plugin topic」是社区约定俗成的仓库命名/发现标签，不是 dsh 的分发机制。**真正的分发机制是「自建索引 JSON + `plugin_manager install_bundle`」。Stratix 若要进生态，得自己出索引，而不是靠 topic。

### 3.6 版本与兼容：dev preview 的破坏性变更怎么兑现

**这是本节最值得抄的一条。** 兼容检查有两级：

1. **`engines.dsh`**：插件自己声明支持的 DSH SemVer 范围。例：`"engines": { "dsh": ">=0.2.0-rc.2" }`（`docs/user/guide/plugin-market.md:66`）。
2. **DSH peer 依赖**：没有 `engines.dsh` 时回落到 DSH peerDeps（`docs/tool-catalog.md:60`：*"Unmet DSH version requirements (engines.dsh, else DSH peer dependencies) block installation and activation."*）。

**不兼容时的兜底 = 版本豁免（version exemption）**：

- 豁免写在 **profile 自己的 `compatibility.json`**（与 `package.json`、`cordis.patch.yml` 并列），键是精确的 `package-name@version`，值是精确的 DSH 运行时版本列表（`packages/boot/plugin-manager/README.md:79`）。
- 授予豁免**必须** `acceptRisk: true`，且必须先警告用户「不兼容插件可能导致崩溃或数据丢失」并获得对该具体组合的明确许可；*"The service checks the acknowledgement and versions, not conversation history."*（`packages/boot/plugin-manager/README.md:79`）
- 授予**不改变**任何依赖、组合包选择或 patch 层（`:79`）；插件升级与 DSH 升级**都不继承**许可（`:79`）。
- 拒绝时返回 `incompatible-version`，带每个被拒包的 `name`/`version`/`runtimeVersion`/`unmet requirements`，并键明是 `engines.dsh` 还是某个 DSH peer 包（`:83`）。CLI 直接打印 `allow-version` 命令原文。

**兑现承诺的机制总结**：破坏性变更不是靠「不破坏」，而是靠 **① 插件自己声明 `engines.dsh` 范围 → ② 主机侧强制检查并拒绝安装/激活 → ③ 给出带风险确认的显式豁免通道 → ④ 拒绝时给出可复制的修复命令**。整条链路的每一步都有具体错误码和可查证出处。

---

## 4. 创造模式（重点）：只读检查 → 组合包 → `plugin_manager` 安装

### 4.1 先说更正：运行时自改包已被退役

任务描述里假设的「extensions 运行时自改包 → 组合包」链路，**在 HEAD 上模型侧已经走不通**。

| 事实 | 出处 |
|---|---|
| 决策记录原文：*"The model sees two read-only Cordis inspection tools. Generated-code define/run/stop/undefine and dynamic self-inspection tool APIs are absent."* | `.agents/notes/implemented/architecture/2026-09-16-creator-persistent-plugin-management.md:17` |
| `tool-cordis` 源码只注册两个工具：`cordis_inspect_list`（`packages/extensions/tool-cordis/src/index.ts:22-23`）与 `cordis_inspect_query`（`:41-42`） | 同上 |
| 端到端断言这 5 个工具**不在** Creator preset 的工具表里 | `apps/cli/tests/web-agent-presets.e2e.ts:557`、`:631`；`apps/cli/tests/profiles/web/tests/creator-plugin-manager.expected.e2e.ts:76` |
| host-runner README 自述：*"定义在重启后消失。Agent 通过 `tool-cordis` 发现 API，通过 Plugin Manager 安装持久化 bundle；没有模型工具创建动态定义。"* | `packages/extensions/cordis-host-runner/README.zh.md:12` |
| 历史会话仍可回放：退休工具的调用数据作为不可变回放输入保留，卡片照常渲染 | `.agents/notes/implemented/architecture/2026-09-16-creator-persistent-plugin-management.md:23` |

**那 extensions 剩下的是什么？** 三个包（`packages/extensions/`：`cordis-host-runner`、`cordis-client-runner`、`tool-cordis`、`ui-cordis`）：

- `cordis-host-runner` 提供 `ctx.cordisInspect` 与 `ctx.dynamicCordisRunner`（`docs/capability-seams.md` 对应行；`packages/extensions/cordis-host-runner/README.zh.md:12`）。
- Host 半在 `node:vm` 里跑；浏览器半用 Client runner + 审批 UI（`README.zh.md:12`）。
- **信任立场**原文：*"沙箱隔离全局变量，但不是安全边界：Node 全局变量不存在，或重定向到 Cordis 服务（`ctx.fs`、`ctx.web`、`ctx.bash` 与定时器 helper），host 半收到的是不含框架内部机制的 façade，但它声明的服务仍会触达存活运行时。对待动态包要像对待 bash 访问一样。"*（`packages/extensions/cordis-host-runner/README.zh.md:62`）
- 事件：`cordis/dynamic-package`、`cordis/dynamic-retract`、`cordis/inspect-query`、`cordis/request-run`（`docs/subsystems/extensions.zh.md`；`packages/extensions/cordis-host-runner/README.zh.md:92`）。

**结论**：extensions 现在是**程序化/浏览器消费者**的通道（`README.zh.md:12` 的"为程序调用方和浏览器控件保留"），不是模型的工具面。这与任务前提不一致，我按源码事实写。

### 4.2 现在的完整工作流（模型视角，逐步可查证）

**Step 1 — 发现 API（只读）**

模型调用 `cordis_inspect_list` 拿到可检查的对象目录（Service / Event / Config / Tool / Slots / Theme），再用 `cordis_inspect_query` 按精确 Provider ID 提问（`packages/extensions/tool-cordis/src/index.ts:22-56`；工具目录 `docs/tool-catalog.md:829-880`）。技能文档给了知识源优先级：**① 检查 → ② 包文档（`Config.listConfigs` 找 `packageDir` 再读 README）→ ③ 源码**（`packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md:28-32`）。

**Step 2 — 在工作区里写出一个包 + 一个 patch**

技能规定的 5 步流程（`packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md:20-26`），第 2 步明确 *"Discover only the APIs needed for that version"*，第 3 步 *"Read and copy the matching template files into one workspace directory"*。

模板是最小可复制的两份（`packages/preset/agent-preset/skills/cordis-plugin-development/templates/decoration/` 与 `templates/mcp/`，各含 `package.json` + `cordis.patch.yml`；清单见 `packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md:46-47`）。

**Step 3 — 用 `plugin_manager` 安装**

> *"For implementation, use ordinary workspace files to author a bundle, then `plugin_manager` with `action: install_bundle` and the absolute package directory as `target` to install it in the current profile."*
> —— `packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md:8`

工具侧的实现：`install_bundle` 分支只做一件事——把 `target` 透传给 `manager.installBundle(target, { enabled, approvedBuilds, registry })`（`packages/boot/plugin-manager/src/tools.ts:147-153`）。

**Step 4 — 读安装结果，而不是读日志**

`packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md:25` 明确：*"`application` and `warnings` decide whether the change is live, not logs, process lists, or the page's boot payload."* 并要求用**免批准的** `cordis_inspect_query` 确认新行，而不是 `list_plugins`。

`install_bundle` 的返回语义（`packages/preset/agent-preset/skills/cordis-plugin-development/references/host-plugin.md:83`）：

- `failed` 需要诊断；`overridden` 表示更高优先级层赢了；`restart-required` 表示**改动没生效**。
- *"Installing a new bundle can activate through HMR; replacing an installed package requires restart to load a fresh JavaScript module generation."*

### 4.3 另一条路：卡片驱动的「AI 生成插件」

除了 agent 自主写包，dsh 还有一条更结构化的路径（`packages/experimental/creation-recommendations`）：

1. 用户在 UI 上填一张**卡片**（brief、位置、是否带初始内容）。
2. 宿主起一个 **spawn 子 agent**，用 `agentPreset: 'cordis'`，prompt 里带**精确的打包约束**（`packages/experimental/creation-recommendations/src/index.ts:262-282`，打包约束原文在 `:275`）：
   > *"Write a package.json with the exact reserved name, version, and `dsh.bundle.patch="./cordis.patch.yml"`. Write cordis.patch.yml as a plain YAML or JSON array containing only `{insert:[...]}` operations. Do not use groups, aliases, custom tags or includes. Every inserted id must start with the package name plus a colon, and each module name must be this package or one of its exports. ... Symlinks must be relative and remain inside this package; the installed copy must work without the source directory."*
3. 子 agent **只生成并构建，不安装**（*"Generate and build the package only; the caller validates and installs it. Do not install, enable, remove, or edit any existing plugin or profile configuration."*，`packages/experimental/creation-recommendations/src/index.ts:267`）。
4. 宿主做**准入校验** `validateGeneratedBundle`（`packages/experimental/creation-recommendations/src/generated-bundle.ts:16-50`）：校验包名/版本、patch 必须是纯 YAML 且只含 `insert`、每个 id 必须以包名为前缀、每个 name 必须是本包或其导出、运行时入口必须**已构建存在**、声明 `dsh.client` 的包必须已构建 `./client` 入口、符号链接必须可移植。**该函数只读文件，不执行代码**（注释 `packages/experimental/creation-recommendations/src/generated-bundle.ts:11-15`）。
5. 校验两次（源目录一次 `:307`、拷贝到 profile 目录后一次 `:313`），再 `installProfileCopy`（`:315`，实现 `:358`）。
6. 保留名冲突时报 `CREATION_EXISTS`（`packages/experimental/creation-recommendations/src/index.ts:309`）；子 agent 未完成报 `CREATION_INCOMPLETE`（`packages/experimental/creation-recommendations/src/index.ts:301`）。

**这条路径的心智价值**：把「模型写代码」关进一个**声明式、可静态校验的产物形状**里（bundle patch 只能是 `{insert:[...]}`），并把「验证」与「安装」分成两个不同角色（子 agent 产出，宿主裁决）。

### 4.4 为什么这套机制能带来「生态自增殖」——以及它其实**不**是自增殖

诚实的分析（这是本节最有价值的部分）：

**它做到的事**：

1. **模型写代码，但写进的是受限形状**（`{insert:[...]}` + 必须已构建 + id 必须带包名前缀），由宿主做静态校验而不是靠模型自觉。
2. **产物落在工作区文件里**，可 review、可 diff、可版本控制——不是「运行时内存里的动态定义」。
3. **安装走的是普通包管理路径**（pnpm + profile `node_modules` + `dsh.profile.bundles`），因此**跨会话、跨重启存活**（`.agents/notes/implemented/architecture/2026-09-16-creator-persistent-plugin-management.md:31`：*"Selected bundles affect all sessions in the profile and survive restart."*）。
4. **副作用归插件生命周期**：样式表清理这类副作用由插件自己管（`:35`）。

**它没做到的事（不要误读）**：

1. **不是运行时自改包**。退休掉的 `cordis_define/run/stop/undefine` 那套才是运行时自改；现在换成了「写文件 + 装包」。
2. **没有自举闭环**：插件装上之后，并不会自动获得「写下一个插件」的能力——那需要一个显式的 `plugin_manager` 授权（每次动作都要批准 / `danger-full-access`，`packages/boot/plugin-manager/README.md:31`）。**自增殖的天花板是权限模型，不是技术。**
3. **自改包与普通包是两条生命周期**——这正是退休决策记录里说的反对理由：*"Generated-code tools create a second plugin lifecycle alongside ordinary installed bundles."*（`.agents/notes/implemented/architecture/2026-09-16-creator-persistent-plugin-management.md:9`）

### 4.5 对 Stratix「agent 开发 Stratix」自指路线的借鉴

| dsh 的做法 | Stratix 怎么用 |
|---|---|
| **只读检查工具先行**：`cordis_inspect_list` / `cordis_inspect_query`，模型先查再用 | 我们已有对应的自指面：`src/core/types.ts` 的契约 + `src/app/services/cli-transport/adapters/` 的既有 CLI agent 适配器（`Stratix:src/app/services/cli-transport/adapters/{claude,codex,kimi,openclaw,opencode,custom,dsh}.ts`）。应给 Stratix 自己的 agent 一组**只读**契约查询工具（mission/task/角色当前态 + 可用命令目录），而不是让它直接改状态。 |
| **产物落在工作区文件，形状受限**（bundle patch 只能 `{insert:[...]}`） | 自指产物应是「一个 Stratix 插件包」：有 `package.json` + 一份受限的 manifest/patch，而不是让模型自由改 `src/`。这直接满足我们「不修改 src/」的纪律。 |
| **宿主做静态准入校验**（`validateGeneratedBundle`） | Stratix 侧应有一个等价的 `validateGeneratedStratixPlugin`：校验 id 前缀、入口已构建、符号链接可移植、patch 是纯声明式。 |
| **生成与安装分角色**（子 agent 只产，宿主裁决并装） | Stratix 自指 agent 只负责产出候选包；「要不要装、装到哪」由 Stratix 的 host 决定——正好对齐我们的 mission/task 审批流。 |
| **版本兼容走 `engines.dsh` + 显式风险豁免** | Stratix 插件应声明 `engines.stratix`（core 契约版本），不兼容时给「带风险确认的显式豁免」而不是硬崩。我们已有 `compatibility.json` 式的 profile 级豁免可抄。 |
| **不装第二套生命周期** | 自指产物必须落进 Stratix 现有的插件/注册表路径，而不是另起一套「动态定义」运行时——这正是 dsh 退休 `cordis_define` 的理由。 |

---

## 5. session / preset / skill / subagent / workflow 速览 + Stratix 映射

> 术语说明：dsh 的 `docs/glossary.md` **只定义域词汇**（scope、scope key、setup window、lineage、shadowing、turn、step、round、goal round、Ralph loop 等，`docs/glossary.md:5`、`:13-21`、`:37-44`），**不**定义 session/preset/skill/subagent/workflow。这五个子系统的权威定义在各自包 README 与 `docs/subsystems/*.md`。

### 5.1 Session

**一段话**：Session 是**append-only 的 typed event log**，是 agent 全部交互史的**唯一真相源**；LLM 消息历史是这份 log 的**投影**，从不另存（`docs/subsystems/session.md:5`）。只有 `system/message`、`user/message`、`assistant/message`、`tool/result` 四类事件带 `surfaceOp`（进入模型历史），其余是 log-only（`packages/core/session/src/types.ts:448-452`）。格式版本是代码里唯一手写的数字 `SESSION_FORMAT_VERSION = 4`（`packages/core/session/src/types.ts:90`；`docs/session-format-status.md:20`）。未知事件类型若不带 `ignorable` 标记，读方**必须拒绝重建会话**（`packages/core/session/src/types.ts:511-515`）。落盘是独立缝（`ctx.sessionPersistence`），JSONL 后端按会话一个 append-only log（`packages/session/session-persistence-jsonl/README.md:63-70`）。分支：`session.fork(source, boundary?, childSessionId?)`（`packages/core/session/src/index.ts:1403`）。

**与 Stratix 的映射**：

- **差异**：Stratix 的 mission 是**纯内存状态机**（`Stratix:src/core/types.ts:281` 的 `MissionPhase = 'draft'|'pending'|'confirmed'|'running'|'done'|'cancelled'`；`:315` 的 `MissionView`），任务落 SQLite（`Stratix:src/core/` 下 `task` 与 `app/services/persistence`）。dsh 则把**整个交互史**做成可回放事件流。
- **可借**：Stratix 现在只有「状态快照」，没有「状态变更史」。`mission` 的每次 phase 迁移若也走 append-only 事件 + 投影，就能白拿三样东西：可回放的调试、fork（从某个边界复制一条 mission）、以及「重放 = 重投影」的一致性保证。这正是 `docs/DSH-INTEGRATION-PLAN.md:38` 已经写进 MCP-SPEC v2 的第 3 条模式。
- **对齐点**：dsh 的 `turn`/`step`（`docs/glossary.md:37-38`）正好对应 Stratix 的「一次任务推进 = 一回合模型 + 若干工具步」。我们目前没有这个显式分层，mission 的 `running` 态里混着多轮。

### 5.2 Preset

**一段话**：Preset 是**一组具名的、声明式的子 Cordis 插件行**，一次性组合出一个 agent 的**全部能力面**（工具、prompt 段、persona、skills、限制），按 session 选择（`packages/preset/README.md:12`；定义接口 `packages/preset/agent-preset-registry/src/definition.ts:5-11`）。它**不是**一个插件，而是一串插件行挂进 registry 拥有的 scope，形成一棵常驻 composition（`PresetMount`，`packages/preset/agent-preset-registry/src/mount.ts:27`）。改声明会**退休**旧修订版；已有 agent 保持原 composition，新建的用新修订版（`packages/preset/agent-preset-registry/README.md:60-61`）。挂载时若**全局泄漏服务**则拒绝挂载（`:65-68`）。会话开始后不允许换 preset（`agent-preset/locked`，`packages/preset/agent-preset-registry/src/index.ts:364-383`）。

**与 Stratix 的映射**：

- **Stratix 的对应物**：agent **角色**（`Stratix:src/core/types.ts:832` 的 `CharacterView`）+ 角色任务（`:461` 的 `CharacterTask`）+ `docs/DEMO-PLAN.md` 里的角色职责。但 Stratix 的角色是**数据**（数据库里的行），dsh 的 preset 是**配置树**（YAML 行 + scope 挂载）。
- **关键差异**：dsh 的 preset 决定「这个 session 的工具集和 prompt」，而且这个决定被**写进 session header**（`packages/core/session/src/types.ts:129-135` 的 `agentPreset?`），理由是*"a resume that restored a different composition would replay history the model can no longer act on"*。**Stratix 现在如果换角色再 resume，同一段历史里的工具语义就变了**——这是一个真实存在的、可被借来修的洞。
- **可借**：把 Stratix 的「角色」重构成「声明式能力组合」——一个角色 = 一组工具 + 一组命令 + 一段系统提示，而不是一个名字 + 一个 prompt 串。

### 5.3 Skill

**一段话**：Skill 是**可选、按需加载的指令文档**——`SKILL.md`（YAML frontmatter：`name`、`description`、可选调用标志）+ 可选资源；模型按名发现、按需全文载入（`docs/subsystems/skills.md:5`）。名字必须 kebab-case（`packages/skill/skill/src/index.ts:35`）。frontmatter 缺失或非法只是**警告后忽略**，绝不致命（`packages/skill/skill-filesystem/src/index.ts:828-840`）。发现是「host + per-scope 分层注册表」，六档优先级 `project-dsh(100) / project-agents(200) / custom(300) / user-dsh(400) / user-agents(500) / bundled(600)`（`docs/subsystems/skills.md:13`、`:68-76`）。注入模型的机制很克制：首次 `agent/pre-step` 只注入 **name + description** 的目录（不含正文、路径、来源），模型再通过 `skill` 工具按需取全文（`packages/skill/tool-skill/src/index.ts:36`、`:84-86`；`docs/subsystems/skills.md:229-233`）。正文改动因此**不重写历史工具结果**（`:233`）。

**与 Stratix 的映射**：

- **Stratix 没有 skill 概念**。最接近的是 HUD 命令目录（`Stratix:src/hud/panels/command-catalog.ts`）与 MCP 工具（`Stratix:src/stratix-gateway/mcp/tools/`），但它们是**可调用**，不是**可读入上下文的知识**。
- **可借（高价值）**：Stratix 现在把角色 prompt、命令目录、工具描述全量塞进上下文。skill 的「目录 + 按需全文」两级模型能显著省 token，并且天然支持「用户自带技能目录」（`.dsh/skills` 那种项目级目录）。这与 Stratix 的 mission 简报场景高度吻合：**mission brief 应该是一份按需加载的 skill，不是常驻 prompt。**

### 5.4 Subagent

**一段话**：Subagent 是**在委派父 agent 下管理的子 agent 执行**，走具名 provider 后端，有持久 session 身份、取消/准入契约和终态结果对象（`packages/subagent/subagent/README.md:12`）。Provider 接口 `SubagentProvider`（`packages/subagent/subagent/src/types.ts:313`）的**方法是否存在**决定执行语义：有 `start` 的 provider 一次性执行、不接受后续消息（`:345-347`）。容量默认 8（`packages/subagent/subagent/src/index.ts:197`）。子 agent 通过版本化的、模型不可见的 `subagent/descriptor` session event 变得**可发现、可续接**（`packages/subagent/subagent/src/descriptor.ts:38`，`SUBAGENT_DESCRIPTOR_VERSION = 3`，`:48`）。

**与 Stratix 的映射**：

- **Stratix 的对应物**：CLI agent（`Stratix:src/app/services/cli-transport/adapters/`）跑一次 one-shot 任务。dsh 的 `subagent-acp` / `subagent-codex` / `subagent-claude-code` / `subagent-dsh-sdk` 就是「把外部 CLI agent 接进来」的**标准 provider**。
- **差异**：Stratix 的 CLI agent 是**平级的 worker**（桥 A，adapters 与 claude/kimi 平级）；dsh 的 subagent 是**有父子关系、有 lineage、有深度上限（`maxDepth`）、有持久身份**的委派。
- **可借**：`SubagentStartRequest` 里的 `parent` / `signal` / `maxDepth` / `outputSchema`（`packages/subagent/subagent/src/types.ts:136`）这套契约，比 Stratix 现在的「起一个 CLI 进程」要完备得多；特别是 `outputSchema`（结构化输出）能直接治「agent 交回来的东西没法机器消费」。

### 5.5 Workflow / Plan / Jobs / Todo（四个正交缝）

> 任务只问了 workflow，但把 workflow 单独讲会失真——它和 plan/jobs/todo 是**四个独立的缝**，在 session log 与 agent scope 两点汇合。

**一段话**（workflow）：Workflow 让 agent 跑一段**模型自己写的编排脚本**（普通 JavaScript，调用 `agent()` / `parallel()` / `pipeline()` / `phase()` / `log()`），脚本 fan out 出子 agent 并返回最终 JSON 值（`packages/workflow/workflow/README.md:12`、`:36-47`）。它**不是 agent loop 的一部分**，是「一个可选能力」；**每个 context 只允许一个引擎实现**（`docs/subsystems/workflow.md:5`）。Service Definition 是 `ctx.workflowEngine`（`packages/workflow/workflow/src/index.ts:157-168`），唯一实现是 `workflow-ptc`（在共享 Node PTC 进程里跑，受调用 session 的文件策略约束），Consumer 是 `tool-workflow`。后台运行时它会**注册成一个 owned `workflow` job**（`packages/workflow/tool-workflow/README.md:33`）。

**与 Stratix 的映射**：

- **Stratix 的对应物**：mission 的推进（一个 mission 拆多个 character task，角色并行干活）。今天这条链是 Stratix 自己的状态机 + WS 广播实现的。
- **差异**：Stratix 的 mission 编排是**宿主写死的**（core 状态机驱动）；dsh 的 workflow 是**模型运行时写的一段脚本**。前者确定性强、可测；后者灵活、但把编排的正确性交给模型。
- **可借（要克制）**：dsh 的 `pipeline()` / `phase()` / `parallel()` 语义（`packages/workflow/workflow/README.md:36-47`）可以借成 Stratix 的**mission 模板**，但要**保留 Stratix core 做真相源**（`docs/SERVICE-SPLIT-PLAN.md` 铁律 1，`docs/DSH-INTEGRATION-PLAN.md:5`）。也就是：借**词汇与形状**，不借**执行权**。
- **`ctx.jobs` 更值得直接借**：Job 是「有身份、有访问控制、有生命周期状态、有输出环」的运行时（`docs/subsystems/jobs.md:69`），`JobStatus = 'running'|'stopping'|'completed'|'killed'|'failed'`（`:21`），`JobId` 形如 `<kind>-<short-uuid>`（`:9`），且有 `job/registered` / `job/settled` 两个 durable session event（`packages/jobs/jobs/src/types.ts:24`、`:40`）。Stratix 现在**没有任何「长任务运行中」的一等表示**——CLI worker 跑起来之后，Stratix 只有一个「它在跑」的模糊感觉。这是可直接补的洞。

### 5.6 五个概念与 Stratix 的一览映射表

| dsh 概念 | 一句话 | Stratix 现状 | 差异本质 |
|---|---|---|---|
| session | append-only 事件 log，消息历史是投影 | mission/task 落库，**无事件流** | 快照 vs 历史 |
| preset | 声明式能力组合（工具+prompt+skills），写进 session header | 角色（`CharacterView`）是数据行 | 配置树 vs 数据行 |
| skill | 按需加载的 Markdown 指令，两级注入（目录→全文） | 无 | 无此概念 |
| subagent | 有父子/lineage/深度上限/持久身份的委派 | CLI agent（平级 worker） | 委派 vs 并列 |
| workflow | 模型写的编排脚本，一个 context 一个引擎 | mission 推进（宿主状态机） | 运行时生成 vs 预写 |
| （附）jobs | 有身份的受管长任务 + 输出环 | 无 | 缺一等表示 |

---

## 6. 对我们最有借鉴价值的机制 Top10

> 每条注明**来源路径** + 一句话**「Stratix 怎么用」**。排序按「借鉴价值 × 实施成本」。

| # | 机制 | 来源路径 | Stratix 怎么用 |
|---|---|---|---|
| 1 | **一切注册都是 effect，卸载自动逆序回收** | `vendor/cordis/src/reflect.ts:292`（服务）、`vendor/cordis/src/events.ts:265`（监听器）、`vendor/cordis/src/fiber.ts:421-567`、`:437`（逆序 disposer） | 把 Stratix 的一切「挂上去的东西」（HUD 面板、WS 监听、MCP 工具、world-sync 订阅）统一到一条 `register → disposer` 契约上：拔掉插件不留孤儿连接。这条我们已经踩过（`Stratix:plugins/dsh-bridge/src/index.ts:73-76` 的 `ctx.effect`），要推广到全仓。 |
| 2 | **append-only 事件日志 + 投影（消息历史是投影，不是副本）** | `docs/subsystems/session.md:5`；`packages/core/session/src/types.ts:448-452`、`:511-515` | 把 mission 的状态变更改成事件流再投影成 `MissionView`；顺带白拿 fork（`packages/core/session/src/index.ts:1403`）与「重放=重投影」的一致性。对齐 `docs/DSH-INTEGRATION-PLAN.md:38` 已写的第 3 条模式。 |
| 3 | **capability seam 三件套（Definition / Provider / Consumer）** | `docs/architecture.md:136`；`docs/capability-seams.md:653-760`（108 接缝的现成目录） | 给 Stratix 的 `store / dispatch / 工具` 注入端口规范化成三角色命名（已在 `docs/DSH-INTEGRATION-PLAN.md:37` 承诺）；并用 `docs/capability-seams.md` 当现成模板照抄一份 Stratix 接缝表。 |
| 4 | **插件 = 「挂副作用并能自动撤销」的函数；组合发生在 YAML，不在代码** | `packages/bundle/base/cordis.patch.yml:12-14`（行序无语义）；`docs/architecture.md:11`（*"no privileged core to patch"*） | Stratix 也要有「一张声明式清单决定本会话挂什么」的能力，而不是在 `src/` 里写死 import 顺序。对应 `docs/DSH-INTEGRATION-PLAN.md:39` 的第 4 条（可逆注册）。 |
| 5 | **能力可用性驱动的激活（依赖缺失 = PENDING，不报错；依赖回来 = 自动重载）** | `vendor/cordis/src/fiber.ts:617-628`；`vendor/cordis/src/reflect.ts:335-354` | Stratix 的 mission/task 依赖解析应「缺依赖先挂着，不炸」，等依赖满足再自动推进；这直接对应我们「依赖查不到 = 已满足」的现有语义，可以收紧成显式的「已满足/待满足/被阻塞」三态。 |
| 6 | **模型可见上下文的两级注入（目录在前，全文按需）** | `docs/subsystems/skills.md:229-233`；`packages/skill/tool-skill/src/index.ts:36`、`:84-86` | Stratix 的 mission brief、角色细则、命令用法改成「先给目录，模型要哪份再给哪份」；顺带支持项目级技能目录（`docs/subsystems/skills.md:68-76` 的六档优先级可照抄）。 |
| 7 | **版本兼容 = 声明范围 + 主机强制 + 显式风险豁免** | `packages/boot/plugin-manager/README.md:79`、`:83`；`docs/tool-catalog.md:60` | Stratix 插件声明 `engines.stratix`；不兼容时给「带风险确认的显式豁免」而不是硬崩；拒绝时给出可复制的修复命令。 |
| 8 | **只读检查工具先行（发现 API → 写码 → 装 → 读安装结果）** | `packages/extensions/tool-cordis/src/index.ts:22-56`；`packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md:20-26`；`docs/tool-catalog.md:829-880` | 给 Stratix 自己的 agent 一组只读契约查询工具（mission/task/角色/命令目录），并把「读安装结果」而不是「读日志」作为验收动作。 |
| 9 | **产物形状受限 + 宿主静态准入校验（生成与安装分角色）** | `packages/experimental/creation-recommendations/src/generated-bundle.ts:16-50`；`packages/experimental/creation-recommendations/src/index.ts:262-282`、`:307-315` | Stratix 自指 agent 只能产出受限形状的插件包（声明式 manifest + 已构建入口 + id 前缀约定），由 Stratix host 做静态校验后再决定装不装。这条直接落在「不修改 src/」的纪律上。 |
| 10 | **长任务作为一等对象（身份 + 状态机 + 输出环 + durable 事件）** | `docs/subsystems/jobs.md:69`、`:21`、`:9`；`packages/jobs/jobs/src/types.ts:24`、`:40`、`:139`、`:179` | Stratix 现在跑起来的 CLI worker 没有一等表示。补一个 job 概念（`running/stopping/completed/killed/failed` + 输出环 + `job/registered`/`job/settled` 事件），mission 的角色任务就能真正「可查进度、可停、可恢复」。 |

**未进 Top10 但值得记一笔**：

- `ctx.userQuestions` + `ctx.commands` 分离（模型提问 vs 人类命令不经模型回合）：`docs/architecture.md:155`。Stratix 的 HUD 命令目前都要过模型，这块可以省。
- `ctx.sessionPersistence` 与 `ctx.sessions` 分离（事件语义 vs 存储后端）：`packages/session/session-persistence/README.md`。Stratix 的 persistence 同理该拆。
- `SubagentStartRequest.outputSchema`（结构化输出契约）：`packages/subagent/subagent/src/types.ts:136`。治「agent 交回来的东西没法机器消费」。

---

## 附录 A：调研过程中的三处事实更正（避免后续误引）

1. **Cordis 版本**：`4.0.0-rc.11`（`vendor/README.md:19`），不是 v3。v3 的 `Service.provide`/`ready|start|stop`/`ctx.setConfig`/`ctx.service`/`loader.load()` 在本仓库**都不存在**。
2. **运行时自改包已退役**：模型侧只有 `cordis_inspect_list` / `cordis_inspect_query` 两个只读工具（`packages/extensions/tool-cordis/src/index.ts:22`、`:41`；`apps/cli/tests/web-agent-presets.e2e.ts:557`）。extensions 包仍作为程序化/浏览器消费者通道存在（`packages/extensions/cordis-host-runner/README.zh.md:12`）。
3. **「dsh-plugin GitHub topic」不是 dsh 的机制**：仓库内只有命名示例；旧的 `.dsh-plugin` 格式与 `dsh-repository-plugin` 包已在 2026-08-09 移除（`.agents/notes/archived/simplification/2026-08-09-remove-repository-plugin.md:18`）。真正的分发机制是自建索引 JSON + `plugin_manager install_bundle`。

## 附录 B：未尽事项（本次调研没做完的）

1. **`packages/experimental/forge*` 未展开**：它是 GitHub/GitLab PR 的「code forge」，与插件创建无关（`docs/capability-seams.md` 的 `ctx.forge` / `ctx.forgeSession` / `ctx.forgePanel` 三行）。若后续要研究 dsh 的「人机共创代码」路径再单独读。
2. **`ctx.typert` / `ctx.typertGateway` 的 Remote 方法全集未逐条读**：本次只确认了它们是 Host↔Client 的类型化 RPC 面（`packages/api/gateway`、`packages/typert/registry`）。若要做 Stratix↔dsh 双向 UI（桥 B 的进阶形态），需要读 `packages/typert/registry` 与 `packages/api/gateway` 的方法清单。
3. **UI 插件（Client 半）的完整生命周期未验证**：本报告只确认了 `dsh.client` 字段 + `exports["./client"]` 入口的存在与校验规则（`packages/experimental/creation-recommendations/src/generated-bundle.ts:42-45`）。Client 半的 slot 注册、卸载清理、HMR 行为需要实机验证——`packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md:38` 已警告 Desktop 的 `app.asar` 内目录只有 Host 进程自己的文件读能打开，shell/ripgrep/node/pnpm 全部失败。
4. **未做实机验证**：本报告全部结论来自源码与文档阅读。按 `packages/preset/agent-preset/skills/cordis-plugin-development/SKILL.md:25` 的标准（"installation and slot registration alone do not establish what the user sees"），**只读源码不足以断言运行期行为**；第 4 节的链路若有条件应做一次端到端实跑（起 dsh → 装一个最小 bundle → 观察 `application` 字段）。
5. **`plugins/experimental/webworker-packer` 与 Native/Worker 平台**：与 Stratix 的 Electron 打包无直接关系，未读。
6. **会话/agent 内部实现（`packages/core/agent-loop`、`packages/core/agent`）未逐行读**：本报告只用了它们的公开契约与事件名。若要做「Stratix mission 接管 dsh agent loop」级别的方案，需要再深读。
