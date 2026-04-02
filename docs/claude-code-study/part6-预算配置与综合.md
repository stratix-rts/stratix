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

---

## 29. 模块级评价亮点

### 最值得关注的 Top 10 模块

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
