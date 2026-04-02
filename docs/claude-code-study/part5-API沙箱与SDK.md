# Claude Code 源码拆解报告 Part 5：API沙箱与SDK

> 来源：`ClaudeCode逐模块拆解报告.docx` 第 18-22 章

---

## 18. services/api/claude.ts：模型请求、流式解析与降级重试的主循环

### 关键设计点
- **请求 Runtime 而非 SDK 封装**：不是简单调用 Anthropic SDK，而是把消息、system prompt、工具定义、缓存策略、流式事件、错误回退、遥测日志全部编织成可运行的模型请求主循环
- **分层架构**：参数准备 → message/content 规范化 → prompt cache 策略 → 流式/非流式调用 → 使用量累计 → TTFT/stall/timeout 观测 → 错误分类与上报
- **streaming/ non-streaming 双路径**：暴露两个入口，复用同一主逻辑，而非两套分裂实现
- **生产级流式状态机**：处理 `message_start`、`content_block_start`、`content_block_delta`、`content_block_stop`、usage 累计、tool_use/server_tool_use、advisor 特殊路径、stall 检测、idle watchdog、stream no events 检测
- **idle watchdog + stall telemetry**：两套成熟防护机制，区分"API 报错"和"流静默挂住/代理半死不活/200 成功但无事件"

### 核心源码模式
```typescript
// 两种用户体验路径，同一主逻辑
queryModelWithStreaming()    // 需要实时反馈
queryModelWithoutStreaming() // 需要一次性结果

// 流式 -> 非流式 fallback（工程成熟度最高证据之一）
executeNonStreamingRequest() + with Retry()
```

### 对 Stratix 的启发
Claude Code 的 `services/api/claude.ts` 把"调模型"从 SDK 调用做成了一条可观测、可降级、可回退、可跨 provider 的模型请求主循环。Stratix 在做 agent 执行层时，也应考虑构建统一的 Executor Runtime，把 streaming/fallback/usage/telemetry 收口在一处，而非散落在各 provider adapter 里。

---

## 19. entrypoints/sdk/controlSchemas.ts：SDK控制协议的正式定义层

### 关键设计点
- **协议宪法而非类型文件**：把 SDK/remote/bridge/direct connect 整条控制面正式定义成可校验、可演进、可跨语言实现的协议
- **控制面独立建模**：显式定义了 `control_request`、`control_response`、`control_cancel_request`、`keep_alive`，以及大量 request subtype（initialize、interrupt、can_use_tool、set_permission_mode、set_model、get_context_usage、reload_plugins、elicitation）
- **StdoutMessageSchema / StdinMessageSchema 流向定义**：不仅定义消息结构，还定义了消息流向——哪些可以从 CLI 输出，哪些可从外部输入

### 核心源码模式
```typescript
// 控制面独立于消息流
control_request / control_response / control_cancel_request / keep_alive

// 消息流向建模
StdoutMessageSchema   // CLI/runtime 输出
StdinMessageSchema    // 外部输入
```

### 对 Stratix 的启发
Claude Code 的 controlSchemas 把"控制权"显式化为正式协议。Stratix 在设计 Agent 控制系统时，也应把 initialize、interrupt、permission 等控制面操作写成正式 schema，而非散落在各模块的隐式约定里。核心是：**让协议可验证、可演进、跨实现复用**。

---

## 20. query/stopHooks.ts：停止Hook机制

### 关键设计点
- **turn 结束后后处理总线**：不是简单执行几个脚本，而是在把 hook 结果重新编回 Claude Code 的消息世界
- **hook 消息化**：消费 hook progress 消息、收集 blocking errors、决定是否 `preventContinuation`、生成 summary message、必要时插入 attachment
- **完整的后处理链**：Stop hooks、TaskCompleted hooks、TeammateIdle hooks、prompt suggestion、extract memories、auto dream、computer use cleanup
- **query 语义拆分**：让 token budget、stop hook、config、deps 在 query 语义层单独成立，避免 QueryEngine.ts 膨胀成巨石

### 核心源码模式
```typescript
handleStopHooks(...) {
  // 消费 hook progress 消息
  // 收集 blocking errors
  // 决定 preventContinuation
  // 生成 summary message
  // teammate 场景继续跑后续 hook
}
```

### 对 Stratix 的启发
Stratix 的 Zone/OKR 系统里，"一轮 agent 结束后该做什么"也需要类似的后处理编排（如 OKR 进度更新、文件归档、状态同步）。应该把这类逻辑从主执行流拆出来，做成正式的"停点编排器"。

---

## 21. utils/sandbox/sandbox-adapter.ts：沙箱适配器

### 关键设计点
- **权限规则语义和 sandbox 语义认真区分**：没有把所有路径规则混成一种解释，明确区分 permission rule 里的路径约定和 `sandbox.filesystem.*` 里的标准路径语义
- **convertToSandboxRuntimeConfig() 桥接核心**：把 permissions.allow/deny、WebFetch domain 规则、sandbox.network/sandbox.filesystem、`--add-dir`、settings 文件保护、`.claude/skills` 保护全部折叠成外部 sandbox runtime 能执行的 config
- **安全工程味浓**：永远拒绝写 settings 文件、额外保护 .claude/skills、防 bare repo 植入、allowManagedDomainsOnly、policy 锁定 sandbox 设置
- **动态刷新**：不是一次性初始化完就结束，而是订阅 `settingsChangeDetector`，动态调用 `refreshConfig()` 和 `reset()`

### 核心源码模式
```typescript
resolvePathPatternForSandbox(...)    // permission rule -> sandbox 路径
resolveSandboxFilesystemPath(...)    // sandbox 路径标准化

convertToSandboxRuntimeConfig(...)  // 上层语义 -> runtime config
```

### 对 Stratix 的启发
Stratix 在接入 OpenClaw 或做 agent 执行环境隔离时，也需要类似的安全 adapter。关键是把"规则字符串"（路径/权限）和"OS 级隔离执行"认真区分，中间加一层翻译器，而不是混在一起处理。

---

## 22. services/api/client.ts：API客户端

### 关键设计点
- **provider adapter 而非薄封装**：统一折成 `getAnthropicClient(...)` 接口，同时内部适配多种后端（Anthropic API、Bedrock、Foundry、Vertex）
- **认证/headers/proxy/region 差异全收口**：OAuth token refresh、API key headers、Bearer token for Bedrock、Azure AD for Foundry、GoogleAuth for Vertex、custom headers、proxy fetch、region 选择、remote/container/session headers
- **与 claude.ts 分层清晰**：client.ts 负责连到谁，claude.ts 负责怎么发、怎么流、怎么 fallback

### 核心源码模式
```typescript
// client.ts：provider 适配层
getAnthropicClient(...) {
  // 适配：Anthropic / Bedrock / Foundry / Vertex
  // 统一接口输出
}

// claude.ts：请求 runtime 层
queryModelWithStreaming(...) {
  getAnthropicClient(...)  // 调用 client
  // streaming 状态机
}
```

### 对 Stratix 的启发
Stratix 的 ExecutorFactory（direct/openclaw/stratix）已经有了 provider 适配的意识，但可以进一步收口：把 provider 差异（认证、网络、region）全收进 ExecutorFactory，暴露统一的"模型请求能力"给上层 runtime 调用。

---

## 小结

| 模块 | 核心价值 | 对 Stratix 的关键启发 |
|------|---------|----------------------|
| claude.ts | 模型请求 runtime + 流式状态机 + fallback 韧性 | 统一 Executor 层，streaming/fallback 收口 |
| controlSchemas.ts | 控制面协议显式化 + Zod 校验 + 流向定义 | Agent 控制协议可验证、可演进 |
| stopHooks.ts | turn 后处理编排器 + hook 消息化 | Zone 退出后处理链独立化 |
| sandbox-adapter.ts | 权限语义翻译 + OS 级隔离 + 动态刷新 | OpenClaw 执行环境安全隔离 |
| client.ts | 多 provider 统一适配 + 认证收口 | ExecutorFactory provider 差异全收口 |
