# Part 6：预算配置与综合

---

## 24. query/tokenBudget.ts — Token 预算控制

### 关键设计点

- **预算阀而非计数器**：tokenBudget 不是简单计算已用 token，而是判断 agentic loop 是否继续推进的策略模块
- **diminishing returns 检测**：当继续产生收益递减时，主动输出 stop 决策
- **continuation 次数跟踪**：记录一轮 query 中模型连续生成的次数
- **continue/stop 双输出**：不仅判断是否继续，还输出对应的用户提示文本
- **收敛机制**：让 agentic loop 从"能跑"走向"会停"的关键控制阀

### 核心源码模式

```typescript
// 典型的预算判断逻辑模式
interface TokenBudget {
  continuationCount: number;
  tokenChange: number;      // 本轮 vs 上一轮 token 变化
  isDiminishingReturns: boolean;
  shouldContinue: boolean;
  continuePrompt?: string;   // 继续时的系统提示
}
```

### 对 Stratix 的启发

- **OKR 循环的退出条件**：Zone 内的 agent 任务循环需要类似的预算控制——当目标已达成或收益递减时应主动停止
- **RTS 场景的帧预算**：Phaser 游戏的 update loop 也可以引入类似的预算阀，控制每帧的 Agent 思考时间
- **多 Zone 并发控制**：当多个 Zone 同时运行 agent 时，需要统一的资源预算管理器

---

## 25. entrypoints/sdk/coreSchemas.ts — 核心 Schema

### 关键设计点

- **跨边界数据统一**：把 SDK、hook、permission、MCP、transcript 这些跨边界数据统一样成单一真源
- **TypeScript 类型生成**：用 Zod schema 约束后反向生成可复用 TypeScript 类型
- **SDK message 世界约束**：定义 Claude Code SDK 中 message 与 result 的结构边界
- **platform shared data layer**：为 control plane 和各宿主提供共同的数据底板
- **serializable schema**：所有跨进程、跨边界的数据交换必须有 schema 约束

### 核心源码模式

```typescript
// Schema First 的数据契约模式
const MessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  // ...
});

// 类型从 schema 反向生成
type Message = z.infer<typeof MessageSchema>;
```

### 对 Stratix 的启发

- **OpenClaw 协议**：Stratix 与 OpenClaw 之间的消息契约急需类似的 schema 统一定义
- **Zone 消息协议**：Zone 内的 agent 通信、WebSocket 事件、Webhook 数据交换都应有 schema 约束
- **跨模块数据流**：stratix-core 中定义的接口应全部迁移到 schema-first 模式

### 详细分析

**25.1 lazySchema 与 placeholder 的使用**

这个文件大量使用 lazySchema，还专门放了很多 placeholder：
- APIUserMessagePlaceholder
- APIAssistantMessagePlaceholder
- RawMessageStreamEventPlaceholder
- UUIDPlaceholder
- NonNullableUsagePlaceholder

这几个点很值得玩味。

第一，它说明 schema 之间存在相互引用或初始化顺序问题，所以作者没有把 Zod 当成"静态声明"，而是当成需要治理模块依赖的 runtime 构件。

第二，它说明 Claude Code 并没有强行把外部 SDK 类型整个拉进自己的核心协议里，而是承认有些东西：
- 来自第三方 SDK
- 或者不是纯可序列化原语
- 或者当前只需要占位语义

于是先留出协议插槽，再在边界层完成桥接。这是一种很成熟的边界意识：核心协议只保证自己真正能稳定拥有的那部分。

**25.2 权限、Hook、MCP 都被拉进同一数据世界**

看 src/entrypoints/sdk/coreSchemas.ts 中段，会发现几个以前分散在不同脑图里的世界，已经在这里被统一了：
- PermissionModeSchema / PermissionUpdateSchema / PermissionResultSchema / HOOK_EVENTS
- BaseHookInputSchema
- McpServerStatusSchema

这其实是在做一件非常大的事：把"控制权""扩展点""外部能力状态"全部纳入统一协议层。一旦这样做，Claude Code 后面的很多模块才能写得比较干净：
- controlSchemas.ts 可以专注控制面的 request / response
- RemoteSessionManager.ts 可以放心转发结构化消息
- bridgeMain.ts 可以把外部宿主也挂到同一消息世界上
- hook 系统可以不靠隐式 JSON 约定来演化

很多系统做着做着会出现：hook 是一套野生 JSON，permission callback 是另一套形状，SDK event 又是另一套，remote transport 自己再发明一套。Claude Code 明显在主动避免这种协议撕裂。

**25.3 SDKMessageSchema 才是它最核心的中枢**

这个文件里最有代表性的定义之一，是最后那组消息 schema：
- SDKAssistantMessageSchema / SDKUserMessageSchema / SDKResultMessageSchema / SDKSystemMessageSchema
- SDKPartialAssistantMessageSchema / SDKAPIRetryMessageSchema
- SDKTaskStartedMessageSchema / SDKTaskProgressMessageSchema / SDKToolUseSummaryMessageSchema
- SDKSessionStateChangedMessageSchema
- 最终被 SDKMessageSchema 总并

这说明 Claude Code 的 transcript / stdout / SDK 流不是"输出字符串"，而是一个正式定义过的事件代数。只要这个代数成立，后面很多事都会顺：
- CLI 能渲染
- Desktop / IDE 能订阅
- Remote 能转发
- Bridge 能恢复
- SDK host 能做二次消费
- 测试也能按消息类型断言

这也解释了为什么 src/entrypoints/sdk/controlSchemas.ts 重要，但还不是最底层。controlSchemas.ts 更像"控制面定义"；coreSchemas.ts 才更接近"Claude Code 可序列化世界的物理定律"。

**25.4 它的代价：文件会很大，但这是对的"大"**

这个文件当然有代价：
- 很长
- 类型面极宽
- 读起来不像业务代码，像协议手册

但这种"大"不是坏味道，而是平台成熟后的必然。因为当系统开始跨：
- CLI / SDK / remote / bridge / plugins / hooks / MCP

这些边界时，你要么接受一个大的协议底板，要么接受一堆互不一致的小协议碎片。Claude Code 选的是前者。从长期演进角度看，这是更对的路线。

**25.5 这个模块最值得借鉴的地方**

如果只提炼一个结论，我会说：先把"哪些数据能跨边界流动"定义成正式 schema，再去做功能扩张。这会让系统从一开始就具备：
- 校验能力
- 类型生成能力
- 协议演进能力
- 多宿主复用能力

Claude Code 的 coreSchemas.ts，本质上就是它 SDK 世界的协议底盘。

---

## 26. query/config.ts — 查询配置

### 关键设计点

- **配置快照设计**：在 query() 入口一次性拍下不可变配置，后续执行全部基于快照进行
- **三种价值分离**：
  - QueryConfig：query 入口时一次性快照的不可变配置
  - State：每轮 step 里不断变化的状态
  - ToolUseContext：运行时工具可读写的宿主上下文
- **刻意不收 feature()**：feature() 是 tree-shaking boundary，必须保留在 guarded block 附近
- **buildQueryConfig() 价值**：统一在入口采样，避免执行过程中不断读取全局状态
- **为 reducer 化铺路**：纯 reducer 只吃 (state, event, config)，为未来 step 拆分创造条件

### 核心源码模式

```typescript
// 入口快照模式
function buildQueryConfig(): QueryConfig {
  return {
    sessionId: getSessionId(),
    gates: readStatsigGates(),
    envFlags: readEnvFlags(),
    // ... 所有只读前提的一次性采样
  };
}

// 三者分离后的 query 签名
async function query(config: QueryConfig, state: State, ctx: ToolUseContext) {
  // config 全程不变，state 内部流转，ctx 提供宿主能力
}
```

### 对 Stratix 的启发

- **query 子系统的分层方向**：stratix-gateway 的 command 执行逻辑可以借鉴三分法
- **Zone 执行上下文**：Zone 运行时需要区分配置（Zone 定义）、状态（当前进度）、上下文（工具能力）
- **重构方法论**：先抽不可变配置，再稳住状态机边界，最后才谈 reducer 化——这是 Claude Code 最值得借鉴的重构哲学

### 详细分析

**26.1 它不是小配置文件，而是 query runtime 的"只读前提集"**

src/query/config.ts 很短，但它的价值不能只看体量。因为它做的事情不是"把几个环境变量搬出去"，而是明确提出了一种分层：
- QueryConfig：query 入口时一次性快照的不可变配置
- State：每轮 step 里不断变化的状态
- ToolUseContext：运行时工具可读写的宿主上下文

这三者一旦分开，query.ts 才有机会从超重 orchestration 里继续往下拆。

**26.2 注释里其实已经把未来重构路线写出来了**

这个文件开头的注释非常值钱，大意是：
- immutable values 在 query() 入口一次性 snapshot
- 把这些值从 per-iteration state 和 mutable ToolUseContext 中拆开
- 这样未来抽 step() 才更可行
- 纯 reducer 可以只吃 (state, event, config)

这不是普通的"顺手整理一下"。这说明作者已经明确意识到，query 子系统内部要继续分层时，首先必须区分三种东西：
1. 真正的配置
2. 会变的运行状态
3. 带副作用的宿主能力

很多运行时系统后期难拆，就是因为这三样东西糊成一团。src/query/config.ts 虽然很小，但它是提前在修路。

**26.3 它刻意不收 feature()，这个边界意识很成熟**

这个文件最有意思的点之一，是注释里明确写了：
- 这里收 runtime gates
- 但故意不收 feature() gates
- 因为 feature() 是 tree-shaking boundary
- 必须保留在 guarded block 附近，方便 dead-code elimination

这句话很能体现 Claude Code 的工程成熟度。因为它不是单纯追求"代码整洁"，而是在兼顾架构分层、打包裁剪、初始化顺序、测试隔离。

也就是说，作者知道"把所有开关都抽进 config 文件"在表面上很漂亮，但实际会破坏 bundling 语义。于是它只抽那些适合抽的：
- streamingToolExecution
- emitToolUseSummaries
- isAnt
- fastModeEnabled

这是一种很克制的抽象方式。

**26.4 buildQueryConfig() 的价值，在于"入口统一采样"**

buildQueryConfig() 干的事情其实非常简单：
- 取 sessionId
- 读取 statsig gate
- 读取 env flag
- 返回一份 QueryConfig

但这恰恰是它重要的地方。因为一旦 query 在开始执行后还不断去四处读全局状态、环境变量、feature gate，那它的行为就会越来越难预测，也越来越难测试。

而这里的思路是：在 query() 入口先把这一轮真正需要的只读前提拍一张快照。后面整个执行过程都基于这张快照往下走。这会极大提高可推理性、可测试性、可重放性。

**26.5 这个模块为什么小而重要**

如果只看产出，它就是一个 QueryConfig 类型和一个 buildQueryConfig() 函数。

但如果从架构演化角度看，它是一个非常强的信号：Claude Code 的 query 子系统正在从"大函数编排"走向"配置 / 状态 / 副作用上下文"三分。这意味着后面如果继续瘦身 src/QueryEngine.ts 和 query.ts，不是没路，而是已经开始铺设中间层了。

**26.6 这个模块最值得借鉴的地方**

最值得借鉴的，不是它写了什么逻辑，而是它体现出的重构方法论：
- 先抽不可变配置
- 再稳住状态机边界
- 最后才谈 reducer 化与 step 拆分

这比一上来"把大文件拆成几个 util"高级得多，也稳得多。

---

## 27. services/api/withRetry.ts — 重试机制

### 关键设计点

- **不是 retry helper，而是 API 故障策略引擎**：处理的是一次模型调用在复杂线上环境里可能经历的完整故障路径图
- **故障分型处理**：
  - 普通 retry / exponential backoff
  - 429 / 529 的差异化处理
  - foreground / background / unattended 三种来源语义
  - fast mode cooldown 与回退
  - persistent unattended retry
  - stale keep-alive connection 失效
  - OAuth / AWS / GCP 认证缓存刷新
  - max_tokens 上下文溢出的自动调参
  - fallback model 触发
- **AsyncGenerator<SystemAPIErrorMessage, T> 设计**：重试等待期间持续向外产出 api_retry 事件，让宿主可观测、可呈现、可中断
- **结构化失败语义**：CannotRetryError 和 FallbackTriggeredError 让上层能区分"彻底不能重试"和"需要切换模型"
- **策略集中治理**：把复杂容错集中在一处，而不是让每条请求路径各自发明半套 retry 规则

### 核心源码模式

```typescript
// 故障分型 + 策略集中
async function* withRetry(
  request: APIRequest
): AsyncGenerator<SystemAPIErrorMessage, T> {
  // 前台来源 529 → 可重试
  // 后台来源 529 → 尽快失败
  // 无人值守会话 → 持久重试

  // 故障链：fast mode → fallback → 认证刷新 → maxTokens 调参
}

// 结构化失败
class CannotRetryError extends Error {
  constructor(
    public readonly reason: 'fatal' | 'context_overflow' | 'auth_revoked',
    public readonly context: RetryContext
  ) {}
}
```

### 对 Stratix 的启发

- **LLM 请求的容错策略**：Stratix 的 stratix-gateway 所有 LLM 调用应统一走 withRetry 策略
- **OpenClaw 连接恢复**：agent 与 OpenClaw 实例的 WebSocket 连接重连应借鉴类似的三级重试语义
- **fast mode 设计**：高频轮询场景（agent 状态同步）可借鉴 fast mode cooldown 避免 cache thrashing
- **fallback 模型链**：当 primary model 不可用时，应有 fallback 策略（direct → openclaw → stratix）

### 详细分析

**27.1 它不是 retry helper，而是 API 故障策略引擎**

src/services/api/withRetry.ts 名字看起来很普通，但读完会发现它一点都不普通。它不是：
- "失败了就 sleep 一下再试"
- "指数退避封一下"

它真正做的是：把 Claude Code 在模型请求上的容错哲学，集中实现成一个正式策略层。这里面同时处理了：
- 普通 retry / exponential backoff
- 429 / 529 的差异化处理
- foreground / background source 的区别
- fast mode 的 cooldown 与回退
- persistent unattended retry
- stale keep-alive connection 失效
- OAuth / AWS / GCP 认证缓存刷新
- max_tokens 上下文溢出的自动调参
- fallback model 触发

这已经不是"重试工具函数"，而是一个小型故障编排器。

**27.2 这个文件最成熟的点，是它不把所有失败都当成同一种失败**

这里有几段判断特别能说明问题。

第一，FOREGROUND_529_RETRY_SOURCES 明确区分了：
- 用户正在等结果的前台请求
- 用户根本感知不到的后台请求

只有前者才值得在容量雪崩时继续重试。后者要尽快失败，避免放大网关压力。

第二，isPersistentRetryEnabled() 又引入了"无人值守会话"的第三种世界：
- 普通前台会话
- 普通后台会话
- unattended 长驻会话

于是重试策略不再只是技术逻辑，而是产品语义：
- 人在等，就可以多扛一下
- 人看不见，就尽量别放大故障
- 人不在，但任务必须跑完，就进入持久重试

这是很强的系统设计意识。

**27.3 fast mode、fallback、认证恢复被收进同一条故障链，非常像线上系统**

这个文件最"线上"的地方，是它没有把错误处理拆成很多互相不知道彼此存在的小 util，而是把真实故障链条收在了一起。比如：
- fast mode 遇到短 retry-after，直接短等后保留 cache 继续
- fast mode 遇到长等待，进入 cooldown，切回标准速度，避免 cache thrashing
- 连续 529 达阈值时，可能触发 fallbackModel
- 遇到 ECONNRESET / EPIPE 这种 stale connection，会禁用 keep-alive
- Bedrock / Vertex 的认证错误，会清掉各自云凭证缓存
- 401 / OAuth revoked 会强制刷新令牌

这意味着 src/services/api/withRetry.ts 处理的其实不是"重试次数"，而是一次模型调用在复杂线上环境里可能经历的故障路径图。所以它会显得很重，但这正是因为它吸收了真实世界的复杂度。

**27.4 它用 AsyncGenerator 往外吐系统消息，这一点非常漂亮**

withRetry() 最值得夸的设计之一，是它不是简单返回一个 Promise<T>，而是：AsyncGenerator<SystemAPIErrorMessage, T>

这意味着在等待重试期间，它可以持续向外产出：
- api_retry
- keep-alive 风格的 retry 提示

于是上层 runtime 不会只知道"还没返回"，而是能把这段等待重新编进 Claude Code 的消息流。

这件事非常关键，因为 Claude Code 是产品，不是库。当一次请求卡在重试期时，宿主需要的是：可观测、可呈现、可中断，而不是"内部默默 sleep 30 秒"。

所以这个模块跟 src/services/api/claude.ts 的关系也很清楚：
- claude.ts 负责请求主循环
- withRetry.ts 负责失败路径的正式治理

**27.5 CannotRetryError 和 FallbackTriggeredError 让失败也有结构**

这里还做了两个很重要的错误对象：CannotRetryError 和 FallbackTriggeredError。

这说明作者不满足于"抛一个 Error 字符串出去"，而是希望上层能够知道：
- 这是彻底不能再试了，还是需要切模型
- 当前 retry context 是什么

这种结构化失败语义，会让上层更容易判断 UI 呈现、更容易做 telemetry、更容易在不同 provider / mode 下复用容错策略。这就是典型的平台化写法。

**27.6 它的代价：文件会越来越像事故手册**

这个文件当然也有代价。随着 provider、mode、retry 语义、认证方式越来越多，它会不断吸入特例、条件分支、环境判断、header 语义、mode 语义。所以它天然会越来越像"线上故障经验总表"。

但我反而觉得这类复杂度不该被假装不存在。Claude Code 至少做对了一件事：把复杂容错集中在一处治理，而不是让每条请求路径各自发明半套 retry 规则。

**27.7 这个模块最值得借鉴的地方**

如果让我总结 src/services/api/withRetry.ts 最值得学的地方，我会给四个词：
1. 故障分型
2. 策略集中
3. 重试可见
4. 失败结构化

它真正厉害的地方，是把"请求失败怎么办"这件事，从零散经验，提升成了 Claude Code 的正式 runtime policy。

---

## 28. 二十七个模块拼起来 — 整体设计理念总结

### Claude Code 的真正主线

真正的主线不是"用户 → 模型 → 工具 → 返回"，而是：

```
宿主启动 → 会话运行 → 状态总线 → 工具契约 → 权限编排 → MCP 接入
→ 插件命令折叠 → 技能装配 → Agent 分流 → 任务协同 → 桥接托管
→ Direct Connect 握手 → Direct Connect 流控 → 插件装载治理
→ 命令世界编排 → 远端会话托管 → 启动态内核状态 → 模型请求主循环
→ SDK 数据骨架 → 控制协议定义 → Query 配置快照 → 停点后处理
→ 沙箱执行边界 → provider 适配 → 重试与退避策略 → remote transport
→ token 预算控制 → 结构化回流
```

这二十七层结构一旦成立，Agent 才会像产品；否则再强的模型，也只是一个会说话的命令执行器。

### 二十七个模块完整解析

**28.1 main.tsx**
负责把整个宿主环境启动起来：配置、模式、权限、插件、技能、MCP、REPL / server / remote

**28.2 Tool.ts**
定义模型能调用哪些能力，以及这些能力怎样被验证、授权、调用、呈现、追踪

**28.3 QueryEngine.ts**
把一次次用户消息组织成一个长期会话，把消息流、system prompt、memory、usage、transcript、query loop 统进一个 session runtime

**28.4 AppStateStore.ts**
当整个系统需要共享一份运行时状态面时，它负责定义状态形状、定义默认宿主状态、提供统一 store 原语，让 UI 与 runtime 共用同一总线

**28.5 useCanUseTool.tsx**
当系统准备真正落地一次工具调用时，它负责决定权限能否直接放行、先跑自动检查还是先弹窗、是否交给 bridge / channel / swarm leader、用户拒绝后怎样把结果反馈给模型

**28.6 client.ts**
当系统需要接入外部能力源时，它负责建立 MCP 连接、将 MCP server 转译成 Tool / Command / Resource、处理认证、掉线、重连与结果裁剪，把外部协议行为折叠进宿主运行时

**28.7 AgentTool.tsx**
当模型决定把某段工作交给别的 agent 时，它负责判断起哪个 agent、用什么执行形态、是否后台化、是否远程化、是否 worktree 隔离、结果如何重新编码回主线程

**28.8 LocalAgentTask.tsx**
当系统最终决定把工作外包给子 agent 时，它把这件事变成一个可并发、可跟踪、可通知、可取消的任务对象

**28.9 bridgeMain.ts**
当 Claude Code 需要被远端控制、恢复和持续托管时，它负责注册 bridge environment、轮询 work queue、孵化本地 session、管理 heartbeat、resume、shutdown 与 worktree cleanup

**28.10 createDirectConnectSession.ts**
当 Claude Code 需要把一个外部 direct-connect server 会话接进来时，它负责发起 /sessions 握手、传递工作目录与权限初始化语义、用 schema 校验 server 返回、折叠成内部 DirectConnectConfig，把后续 WebSocket 会话交给连接层继续托管

**28.11 loadPluginCommands.ts**
当 Claude Code 需要把插件里的 Markdown 命令、技能目录、manifest metadata 接进主宿主时，它负责发现并整理插件 command / skill 内容、处理命令命名空间与去重、解析 frontmatter/模型/工具权限/参数与 shell 配置、做变量替换与用户配置注入、折叠成宿主统一 Command 协议并并入命令总表

**28.12 loadSkillsDir.ts**
当 Claude Code 需要把本地、托管、项目、动态发现、条件激活这些技能统一接进来时，它负责解析 skill frontmatter、折叠成统一 Command、去重与条件分流、动态发现并激活相关技能，把技能系统接入宿主命令世界

**28.13 directConnectManager.ts**
当 Claude Code 需要维持一条 direct connect 远端会话时，它负责建立 WebSocket 会话、分流内容消息与控制消息、转交权限请求、回写控制响应与 interrupt，把远端托管会话变成宿主可消费的流式 runtime

**28.14 pluginLoader.ts**
当 Claude Code 需要把多个来源的插件资源整理成统一插件结果时，它负责发现 marketplace / session / builtin 插件、解析 manifest 与目录组件、合并 marketplace entry 与 plugin.json、处理 cache-only 与 full-load 两条启动路径、结构化收集错误并生成 PluginLoadResult

**28.15 commands.ts**
当 Claude Code 需要把内建命令、插件命令、技能、工作流和动态能力并成一个命令世界时，它负责组织多来源命令装配、处理 availability / isEnabled 筛选、插入 dynamic skills、生成 SkillTool / slash skill 等不同视图、维护命令缓存与失效机制

**28.16 RemoteSessionManager.ts**
当 Claude Code 需要把一个远端 CCR 会话接进本地宿主时，它负责托管订阅连接、转交 SDK 消息、管理权限请求与取消、通过 HTTP 发送用户事件，把远端 session 折成宿主可控的交互会话

**28.17 bootstrap/state.ts**
当 Claude Code 需要在整个宿主生命周期里维持一批全局底层状态时，它负责存放 session / cwd / projectRoot 等核心宿主变量、保存插件/hook/skill/telemetry/cache latch 等底层状态、提供统一 accessor 读写入口，让启动期和会话期共享同一套内核变量表

**28.18 services/api/claude.ts**
当 Claude Code 需要真正把一次会话请求发给模型并稳定拿回结果时，它负责组织消息、system prompt、工具与缓存参数、驱动流式请求、解析流式事件并累计 usage、监控 stall / idle timeout、在需要时回退到 non-streaming + retry 路径

**28.19 controlSchemas.ts**
当 Claude Code 需要把 SDK、remote、bridge、direct connect 这些控制交互正式协议化时，它负责定义 control request / response / cancel / keep_alive、定义 initialize/permission/interrupt/reloadPlugins 等 request subtype、用 Zod 做协议校验、区分 stdin / stdout 两个消息方向

**28.20 query/stopHooks.ts**
当 Claude Code 需要在一次 turn 结束后继续运行 hooks、后台任务和 continuation 判定时，它负责执行 Stop / TaskCompleted / TeammateIdle hooks、汇总 hook 结果与错误、决定是否阻断继续运行、把停点后处理重新编回消息流

**28.21 sandbox-adapter.ts**
当 Claude Code 需要把自己的权限规则真正落成操作系统级沙箱约束时，它负责翻译 permission rules 与 sandbox settings、生成 sandbox runtime config、做平台/依赖/策略锁定与安全保护、包装实际命令执行并支持动态刷新

**28.22 services/api/client.ts**
当 Claude Code 需要把不同 provider 的模型接入统一成同一客户端入口时，它负责处理 OAuth / API key / cloud auth、适配 Anthropic / Bedrock / Foundry / Vertex、统— headers / proxy / region / timeout 等网络参数、为上层请求 runtime 提供统一 client

**28.23 SessionsWebSocket.ts**
当 Claude Code 需要维持 remote mode 最底层的长连接 transport 时，它负责建立并认证 WebSocket、处理 ping / pong、管理 close code 与重连预算、提供 control request / response 发送原语

**28.24 query/tokenBudget.ts**
当 Claude Code 需要决定 agentic loop 是否继续推进时，它负责跟踪 continuation 次数与 token 变化、判断是否接近预算上限、判断是否进入 diminishing returns、输出 continue / stop 决策与对应提示

**28.25 coreSchemas.ts**
当 Claude Code 需要把 SDK、hook、permission、MCP、transcript 这些跨边界数据统一成单一真源时，它负责定义 serializable schema、生成可复用 TypeScript 类型、约束 SDK message 与 result 世界、为 control plane 和各宿主提供共同数据底板

**28.26 query/config.ts**
当 Claude Code 需要让 query runtime 朝着可拆的状态机继续演进时，它负责在 query() 入口快照不可变配置、分离 config/state/ToolUseContext、收纳 env / statsig runtime gates、为 step 提纯和 reducer 化预留结构

**28.27 withRetry.ts**
当 Claude Code 需要把模型请求失败后的重试、退避、fallback 与持久等待正式化时，它负责区分前台 / 后台 / 无人值守重试语义、处理 429 / 529/认证恢复/stale connection、处理 fast mode cooldown 与 fallbackModel、在等待时向宿主持续产出 api_retry 事件

---

## 29. 模块级评价亮点

### 完整排名（27个模块）

| 排名 | 模块 | 评价 |
|------|------|------|
| 1 | Tool.ts | 平台契约层，把 Tool 做成了完整运行时组件 |
| 2 | QueryEngine.ts | 会话控制器，证明作者理解 Agent 的本质是 session runtime |
| 3 | bridgeMain.ts | 远端控制主循环，把 Remote Control 做成了真正可持续运行的 session 托管层 |
| 4 | AppStateStore.ts | 运行时状态骨架，决定了复杂能力最后是否能收敛到统一控制面 |
| 5 | client.ts | provider 客户端适配层，吸收不同云厂商和认证体系的复杂性 |
| 6 | AgentTool.tsx | 多 Agent 路由与调度层，把"生成子 agent"提升成分流决策 |
| 7 | useCanUseTool.tsx | 权限编排层，把自动检查、人工审批、远端审批统一进可竞争的决策流程 |
| 8 | createDirectConnectSession.ts | 服务端会话握手层，边界切得很好 |
| 9 | loadPluginCommands.ts | 插件命令协议适配层，使插件系统没有撕裂宿主命令体系 |
| 10 | withRetry.ts | 容错策略引擎，把 retry、backoff、fallback 统一收口 |
| 11 | loadSkillsDir.ts | 技能系统总装层，产品感和运行时感都非常强 |
| 12 | commands.ts | 命令世界编排台，系统级价值被严重低估 |
| 13 | services/api/claude.ts | 模型请求 runtime，重量级核心模块 |
| 14 | coreSchemas.ts | SDK 数据契约底板，平台意味很强 |
| 15 | sandbox-adapter.ts | 沙箱桥接层，安全价值极高 |
| 16 | controlSchemas.ts | 控制协议定义层，重要性非常高 |
| 17 | directConnectManager.ts | Direct Connect 流式会话控制器，协议价值很高 |
| 18 | RemoteSessionManager.ts | 远端会话托管层，产品上非常关键 |
| 19 | pluginLoader.ts | 插件装载工厂，是整个插件生态的基础设施中枢 |
| 20 | bootstrap/state.ts | 宿主内核状态底座，工程地位非常高 |
| 21 | query/stopHooks.ts | query 子系统里的停点编排层，位置很关键 |
| 22 | query/config.ts | 小而关键的分层信号 |
| 23 | services/api/client.ts | provider 客户端适配层，基础但非常关键 |
| 24 | SessionsWebSocket.ts | remote transport 层，可靠性价值很高 |
| 25 | query/tokenBudget.ts | 小而准的策略模块 |
| 26 | LocalAgentTask.tsx | 多 agent 产品化能力的核心证据 |
| 27 | main.tsx | 系统总装层，工程能力强，复杂度也最重 |

### 各模块详细评价

**src/main.tsx**
评价：系统总装层，工程能力强，复杂度也最重。优点是启动、模式、入口、初始化全都统一。风险是后续继续膨胀会变成超级巨石。

**src/Tool.ts**
评价：平台契约层，非常成熟。它把 Tool 做成了完整运行时组件，而不只是函数。

**src/QueryEngine.ts**
评价：会话控制器，方向完全正确。它证明作者理解 Agent 的本质是 session runtime。问题主要是体量大，不是抽象错。

**src/tasks/LocalAgentTask/LocalAgentTask.tsx**
评价：多 agent 产品化能力的核心证据。它说明 Claude Code 做的是任务调度式多 agent，而不是递归式多 agent。

**src/tools/AgentTool/AgentTool.tsx**
评价：多 Agent 路由与调度层，非常关键。它把"生成子 agent"从一个普通工具动作提升成了运行时分流决策。如果没有这一层，LocalAgentTask 再强，也只是任务容器，而不是完整的多 Agent 入口。

**src/hooks/useCanUseTool.tsx**
评价：权限编排层，产品味非常浓。它最厉害的地方不是安全规则本身，而是把自动检查、人工审批、远端审批、swarm 授权统一进一套可竞争的决策流程。这说明 Claude Code 的权限系统不是附属功能，而是运行时的一部分。

**src/services/mcp/client.ts**
评价：外部能力总线适配层，工程成熟度很高。它把连接、认证、转译、容错、结果压平全都收在一起，体量很重，但方向是对的。如果没有这一层，Claude Code 的 MCP 只能算"外挂能力"；有了这一层，它才真正变成宿主的一部分。

**src/state/AppStateStore.ts**
评价：运行时状态骨架，重要性被低估。它不是最耀眼的模块，但它决定了前面那些复杂能力最后是否能收敛到一个统一控制面里。如果没有这一层，Claude Code 会很快退化成一堆局部状态和隐式耦合。

**src/bridge/bridgeMain.ts**
评价：远端控制主循环，工程味非常重。它把 Remote Control 做成了真正可持续运行的 session 托管层，而不是"把本地界面投到远端"。这也是 Claude Code 能从本地工具走向跨设备连续体验的关键模块。

**src/server/createDirectConnectSession.ts**
评价：服务端会话握手层，文件很薄，但边界切得很好。它真正的价值不在"做了多少逻辑"，而在于把 HTTP 建连、schema 校验、错误语义、内部 config 折叠收成了一个稳定入口。

**src/utils/plugins/loadPluginCommands.ts**
评价：插件命令协议适配层，生态意味非常重。它把 Markdown、frontmatter、manifest metadata、插件变量、用户配置和 shell 求值都收束成统一 Command 对象，这使插件系统没有撕裂宿主命令体系。复杂度确实高，但这是"生态接入复杂度"，不是随意堆逻辑。

**src/skills/loadSkillsDir.ts**
评价：技能系统总装层，产品感和运行时感都非常强。它把 skill 从"目录里的 Markdown"提升成了可去重、可条件激活、可动态发现、可统一回收到命令协议中的正式能力层。

**src/server/directConnectManager.ts**
评价：Direct Connect 流式会话控制器，虽然文件不长，但协议价值很高。它把内容流、权限流、中断流三类交互统一在一条 WebSocket 控制面里，让远端托管会话仍然服从 Claude Code 的本地宿主治理。

**src/utils/plugins/pluginLoader.ts**
评价：插件装载工厂，是整个插件生态的基础设施中枢。它真正解决的不是"插件目录怎么读"，而是插件来源优先级、manifest 冲突、cache 路径、组件发现、错误收集这些平台级问题。体量很大，但大得有道理。

**src/commands.ts**
评价：命令世界编排台，系统级价值被严重低估。它把内建命令、插件命令、技能、工作流、动态能力和不同可见性规则统一装配成一个活的命令表。如果没有这一层，Claude Code 的命令系统会迅速退化成多个互不一致的注册表。

**src/remote/RemoteSessionManager.ts**
评价：远端会话托管层，产品上非常关键。它把远端会话的订阅流、发送流、权限回路和取消回路统一进一个本地 manager。如果没有这一层，remote mode 只能做成被动观看，而很难做成真正可协作会话。

**src/bootstrap/state.ts**
评价：宿主内核状态底座，工程地位非常高。它承担了整个进程级宿主变量表的职责，并且尽量通过 accessor 把全局状态收在可命名、可控的边界里。这类模块不耀眼，却直接决定系统能否稳定演进。

**src/services/api/claude.ts**
评价：模型请求 runtime，重量级核心模块。它把流式调用、fallback、usage 累积、缓存策略、工具 schema、错误处理和遥测日志全都编进一条 API 主循环里，明显是踩过大量真实线上问题后长出来的代码。

**src/entrypoints/sdk/controlSchemas.ts**
评价：控制协议定义层，重要性非常高。它让 Claude Code 的 control plane 不再停留在隐式约定，而是被正式编码成可校验、可跨语言消费、可持续演进的一套 schema。这种模块平时不显眼，但它决定了整个 SDK / remote / bridge 生态能不能稳。

**src/query/stopHooks.ts**
评价：query 子系统里的停点编排层，位置很关键。它说明 QueryEngine 之外已经开始长出更细的 turn 生命周期子模块，而且这些子模块处理的是 continuation、hook 总结、后台后处理这类真正复杂的回合语义。这是 QueryEngine 后续能否继续瘦身的好信号。

**src/utils/sandbox/sandbox-adapter.ts**
评价：沙箱桥接层，安全价值极高。它把 Claude Code 自己的权限与设置语言认真翻译成 sandbox-runtime 可执行的 OS 级限制，并额外补上 settings、skills、git bare repo 等 Claude 特有攻击面保护。这是少数明显带着安全工程气质的核心模块。

**src/services/api/client.ts**
评价：provider 客户端适配层，基础但非常关键。它把不同云厂商和认证体系的复杂性吸收在一处，使上层的 claude.ts 可以专注于请求 runtime，而不是到处散落 provider 分支。这类模块做不好，整个多 provider 支持会立刻变脆。

**src/remote/SessionsWebSocket.ts**
评价：remote transport 层，可靠性价值很高。它对 close code、保活、重连预算、临时 session-not-found 窗口的处理都很像线上系统，而不是普通 ws helper。如果没有这一层，remote 会话的稳定性会明显下降。

**src/query/tokenBudget.ts**
评价：小而准的策略模块。它把 agentic loop 什么时候继续、什么时候停，从经验判断做成了正式的预算控制阀。这类文件不大，却往往是系统从"能跑"走向"会收敛"的关键。

**src/entrypoints/sdk/coreSchemas.ts**
评价：SDK 数据契约底板，平台意味很强。它把 message、permission、hook、MCP status、session metadata 这些跨边界数据统一成可执行 schema，再向类型系统反向生成。如果没有这一层，Claude Code 的 SDK 世界很容易碎成多套隐式 JSON 约定。

**src/query/config.ts**
评价：小而关键的分层信号。它说明 query 子系统已经开始认真区分 config、state 和 side-effect context，这对后续瘦身 query.ts 非常重要。虽然文件很短，但它代表的是一条正确的重构路线。

**src/services/api/withRetry.ts**
评价：容错策略引擎，成熟度很高。它把 retry、backoff、fallback、fast mode cooldown、持久重试、认证恢复这些失败路径统一收口，并且让重试过程对宿主可见。这类模块往往最能体现一套系统到底有没有线上经验。

---

## 30. Claude Code 的整体设计理念

### 核心理念：Agent Runtime 而非调模型程序

Claude Code 最厉害的地方，是它把"模型能力"放进了二十七层结构里。这不是过度工程，而是真实线上经验沉淀出的分层架构。

### 五大设计哲学

**1. 配置 / 状态 / 副作用上下文三分法**

在 query 子系统中率先区分：
- 真正的配置（入口快照，全程不变）
- 会变的运行状态（内部 reducer 流转）
- 带副作用的宿主能力（工具上下文）

这是让运行时系统可持续拆分的提前修路。

**2. 故障即策略，而非异常即错误**

withRetry.ts 把所有故障路径集中治理：
- 不把错误当成意外，而是当成可预期的线上状态
- 重试语义与产品语义绑定（人在等 vs 人看不见 vs 人不在）
- 让失败对宿主可见，而不是内部默默 sleep

**3. 工具即平台契约，而非函数调用**

Tool.ts 把每一次工具调用做成了完整运行时组件：
- 验证 / 授权 / 调用 / 呈现 / 追踪 五位一体
- 权限审批可竞争、可组合、可中断

**4. 会话即状态机，而非请求-响应**

QueryEngine.ts 证明 Agent 的本质是 session runtime：
- 消息流、system prompt、memory、usage、transcript 全部统进 session
- 支持 mid-turn interrupt 和 continuation 判定

**5. 生态即接入层，而非功能堆叠**

pluginLoader.ts、loadPluginCommands.ts、loadSkillsDir.ts 合在一起，说明：
- 插件和技能不是功能列表，而是宿主能力的一部分
- 接入复杂度被认真对待，而不是被绕过

### 对 Stratix 的终极启发

Claude Code 证明了：**Agent 产品 = 模型能力 + 宿主运行时 + 协议契约 + 状态管理 + 故障策略 + 接入生态**。

对于 Stratix，这意味着：

1. **Zone 系统需要完整的运行时**：Zone 不只是数据容器，还需要 ZoneService + ZoneRepository + RTS 物理反馈 + WebSocket 状态同步 + Agent 自主进入/退出机制
2. **OpenClaw 适配层需要升级**：从"连接器"升级为"外部能力总线"，包含认证、重连、容错、结果压平
3. **命令系统需要统一编排**：内建命令、OpenClaw 技能、Zone 工作流、插件命令需要收敛到同一命令总表
4. **会话状态需要持久化**：RTS 场景状态、Zone 成员状态、Agent 执行状态需要统一状态总线
5. **故障处理需要策略层**：LLM 请求、OpenClaw 连接、Zone 协作通信需要集中治理的容错策略

**一句话总结：Stratix 的目标应该是成为 Phaser RTS 界面上的 Agent Runtime，而不只是调模型的终端程序。**

### 最后的判断

如果用一句话总结这篇模块级拆解，会说：

Claude Code 这套系统最厉害的地方，是它把"模型能力"放进了宿主、会话、状态、协议、权限、接入、插件折叠、技能装配、调度、任务、桥接、握手、流控、装载治理、命令编排、远端托管、内核状态、模型请求、SDK 数据骨架、控制协议、Query 配置快照、停点编排、沙箱边界、provider 适配、重试与退避策略、remote transport、token 预算二十七层结构里。

这二十七层一旦成立，Agent 才会像产品。否则再强的模型，也只是一个会说话的命令执行器。

从模块成熟度来看，目前最欣赏的排序是：

1. Tool.ts
2. QueryEngine.ts
3. bridgeMain.ts
4. AppStateStore.ts
5. client.ts
6. AgentTool.tsx
7. useCanUseTool.tsx
8. createDirectConnectSession.ts
9. loadPluginCommands.ts
10. withRetry.ts
11. loadSkillsDir.ts
12. commands.ts
13. services/api/claude.ts
14. coreSchemas.ts
15. sandbox-adapter.ts
16. controlSchemas.ts
17. directConnectManager.ts
18. RemoteSessionManager.ts
19. pluginLoader.ts
20. bootstrap/state.ts
21. query/stopHooks.ts
22. query/config.ts
23. services/api/client.ts
24. SessionsWebSocket.ts
25. query/tokenBudget.ts
26. LocalAgentTask.tsx
27. main.tsx

原因不是 main.tsx 不重要，而是它更像复杂度集散地；而前面二十六个文件更像 Claude Code 真正的架构内核。
