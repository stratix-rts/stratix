# Claude Code 源码拆解报告 Part 2：AgentTool、权限系统和 MCP 总线

---

## 5. AgentTool.tsx：多 Agent 路由与执行形态（续）

### 关键设计点

- **teammate vs subagent 区分**：Claude Code 区分两类工作单元——subagent 作为当前会话内部工作单元，teammate 作为 team 上下文里的可命名成员
- **remote execution backend 抽象**：AgentTool 调度的不再是固定运行时，而是可本地、可远程的 Agent execution backend，通过 `teleportToRemote()` + `registerRemoteAgentTask()` 实现
- **shouldRunAsync 的多因素决策**：后台化不是单点功能，而是系统级策略，同时受 `run_in_background`、`background: true`、`coordinator mode`、`fork subagent`、`assistant mode`、`proactive mode`、全局禁用等因素影响
- **worker 工具池重新组装**：子 agent 不继承父 agent 全部工具快照，而是根据 worker 自己的 permission mode 重新组装工具池
- **worktree 隔离的工程化处理**：隔离目标不是"用完即删"，而是"既避免污染主工作区，也不丢失有效修改"
- **sync 路径支持"运行中转后台"**：sync agent 会先注册前台运行，在执行循环里监听 `backgroundSignal`，支持中途迁移生命周期
- **权限处理体现高风险意识**：auto mode 下 spawn subagent 被当成高风险入口，走更严格审批路径

### 核心源码模式

```typescript
// teammate 路径 - 团队模式下的可命名成员
if (team_name && name) {
  return spawnTeammate({ team_name, name, ... });
}

// remote 路径 - 可切换执行后端
if (effectiveIsolation === 'remote') {
  checkRemoteAgentEligibility();
  teleportToRemote();
  registerRemoteAgentTask();
  return { status: 'remote_launched' };
}

// shouldRunAsync 多因素计算
const shouldRunAsync =
  (userProvidedRunInBackground ?? agentDefinition.background) ||
  isCoordinatorMode ||
  isForkSubagentEnabled ||
  isAssistantMode ||
  isProactiveMode ||
  isBackgroundTasksGloballyDisabled;

// worker 工具池重新组装
const workerPermissionContext = ...;
const toolPool = assembleToolPool(workerPermissionContext, ...);

// worktree 清理策略
if (hasNoChanges) autoRemove;
else if (hasChanges) keepAndWriteMetadata;
else if (hookBased) leanKeep;

// sync 转后台的信号监听
registerAgentForeground();
on 'backgroundSignal' → convertToBackground();
```

### 对 Stratix 的启发

1. **Zone Agent 区分**：可将 Zone 内 agent 区分为"subagent"（临时工作单元）和"teammate"（长期驻留成员），支持不同的生命周期管理
2. **RTSMoveAPI 的远程化扩展**：Agent 的 moveTo/leaveCurrentZone 可以抽象为可本地/可远程的执行后端切换
3. **后台任务的系统级策略**：agent 是否后台运行应由调度器根据交互模式（用户观察 vs 自主执行）共同决定
4. **工具池隔离**：进入 Zone 的 agent 应根据 Zone 的 permission mode 重新组装工具池，而非继承全局配置
5. **执行中转后台**：用户拖拽 agent 到 Zone 时，可以设计为"先进前台观察，再自主后台执行"的模式

---

## 6. useCanUseTool.tsx：权限决策编排器

### 关键设计点

- **不是权限规则引擎，而是权限决策编排器**：统一处理多种权限来源（本地规则、classifier、hook、UI 点击、bridge 回复、swarm leader 回复）
- **返回完整的 PermissionDecision，而非布尔值**：至少三态（allow/deny/ask），还包含 updatedInput、decisionReason、acceptFeedback、contentBlocks
- **异步决策竞赛**：整个过程包在 `new Promise(resolve => ...)` 里，承接多个异步来源的最终赢家
- **PermissionContext 是真正的地基**：封装 logDecision()、logCancelled()、persistPermissions()、resolveIfAborted()、cancelAndAbort()、tryClassifier()、runHooks() 等能力
- **deny 不是终点**：deny 分支还服务 UI 通知和记忆纠偏（addNotification、withMemoryCorrectionHint）
- **ask 分支统一四条审批路径**：coordinator automated checks、swarm worker 转发 leader 审批、speculative bash classifier 自动放行、本地交互式对话框
- **abort/cancel 统一收口**：通过 resolveIfAborted()、cancelAndAbort()、catch/finally 把流程统一收成稳定的权限结果语义

### 核心源码模式

```typescript
// useCanUseTool 本体 - 异步决策竞赛
const decisionPromise = new Promise<PermissionDecision<Input>>(resolve => {
  const ctx = createPermissionContext();

  // 多种审批来源竞争
  const sources = [
    hasPermissionsToUseTool(),      // 本地规则
    tryClassifier(),                 // classifier
    runHooks(),                     // hooks
    waitForUserDialog(),            // UI 点击
    waitForBridgeReply(),           // bridge 回复
    waitForSwarmLeaderReply(),      // swarm leader 回复
  ];

  // createResolveOnce() 保证只 resolve 一次
  const resolveOnce = createResolveOnce(resolve);

  for (const source of sources) {
    source.then(result => {
      if (!resolveOnce.isResolved()) {
        resolveOnce.resolve(mapToPermissionDecision(result));
      }
    });
  }
});

// 三态返回值
type PermissionDecision<Input> =
  | { type: 'allow'; input: Input; ... }
  | { type: 'deny'; reason: string; ... }
  | { type: 'ask'; dialog: DialogConfig; ... };

// coordinator handler - 先自动化，再惊动用户
async function handleCoordinatorPermission(ctx): Promise<PermissionDecision> {
  // 1. 先跑 permission hooks
  const hookResult = await ctx.runHooks();
  if (hookResult.resolved) return hookResult;

  // 2. 再跑 classifier
  const classifierResult = await ctx.tryClassifier();
  if (classifierResult.confident) return classifierResult;

  // 3. 两者都无法决策时，回落到 dialog
  return ctx.showDialog();
}

// speculative bash classifier 2秒宽限
const speculativeCheck = await trySpeculativeBashClassifier(input);
const timeout = 2000; // 2秒
const result = await Promise.race([
  speculativeCheck,
  sleep(timeout).then(() => ({ confident: false }))
]);
if (result.confident) autoApprove();
else showDialog();
```

### 对 Stratix 的启发

1. **Zone Permission Context**：为每个 Zone 操作创建独立的 PermissionContext，统一处理 allow/deny/ask 三态
2. **多来源权限网络**：Zone 的权限决策可来自——用户手动审批、Agent 自主请求、Zone 配置规则、Project 级别策略
3. **工具池权限重组**：agent 进入 Zone 时，根据 Zone 的 permission mode 重新组装工具池（可执行哪些工具、哪些需要审批）
4. **deny 的体验设计**：拒绝不只是给程序状态，也要给模型纠偏提示（"这个 Zone 不允许操作 X"）
5. **abort/cancel 统一收口**：用户取消操作时，应收口成稳定的语义，而非零散异常
6. **speculative auto-approve**：对于低风险操作（如读取文件），可以设计"先等 2 秒 classifier，结果置信则自动放行"

---

## 7. services/mcp/client.ts：外部能力总线接入工厂

### 关键设计点

- **MCP 是外部能力总线**：承担三层职责——连接不同类型 MCP server、把 MCP 能力转译成 Claude Code 自己的 Tool/Command/Resource、把 MCP 返回结果加工成模型可消费内容
- **transport 多样性是一等事实**：从一开始接受 MCP 不是一种部署形态，而是一套协议外壳（sse/ws/http/stdio/in-process/IDE proxy/claude.ai proxy）
- **connectToServer() 是连接工厂**：构造 transport → 注入认证 → 包装 timeout → 建立 Client → 注册 handler → 检查 capabilities → 挂载 error/close handler → 返回语义化状态
- **auth 是 MCP 生命周期的部分**：401/needs-auth 不是简单失败，而是独立状态，进入 15 分钟缓存避免反复探测，claude.ai proxy 的 bearer token 在 401 后尝试刷新再重试
- **连接稳定性处理很成熟**：超时保护、stderr 捕获、repeated terminal errors 计数、session expired 双信号识别（HTTP 404 + JSON-RPC -32001）、client.onclose 主动清缓存
- **MCP 能力转译为宿主工具**：fetchToolsForClient → 映射为 Claude Tool，自动获得权限系统、进度事件、自动分类器输入、UI collapse 行为、user-facing name
- **大结果防爆处理**：文本转 text block、图片缩放压缩后转 image block、二进制 blob 落盘后只返回路径、结构化内容生成 compact schema、结果过大时走截断或落盘
- **Url Elicitation 处理**：MCP tool 调用过程中要求用户完成 URL 交互时，识别 -32032 错误，先跑 elicitation hooks，完成后重试 tool call

### 核心源码模式

```typescript
// connectToServer() - 连接工厂生命周期
async function connectToServer(serverRef): Promise<MCPServerConnection> {
  // 1. 按 transport 类型分流
  const transport = buildTransport(serverRef.type, serverRef.config);

  // 2. 注入认证与 header
  const authTransport = wrapWithAuth(transport, serverRef.auth);

  // 3. 包装 timeout
  const transportWithTimeout = withTimeout(authTransport, CONNECT_TIMEOUT);

  // 4. 建立 Client
  const client = new Client({ transport: transportWithTimeout, ... });

  // 5. 注册 request handler
  client.setRequestHandler(listToolsRequest, () => ...);

  // 6. 检查 capabilities / version / instructions
  await validateServerCapabilities(client);

  // 7. 挂载 error / close handler
  client.onerror = handleConnectionError;
  client.onclose = cleanupAndReconnect;

  // 8. 返回语义化状态
  return {
    status: 'connected',
    connection,
    auth: needsAuth ? 'partial' : 'full'
  };
}

// fetchToolsForClient() - 协议映射层
async function fetchToolsForClient(client): Promise<Tool[]> {
  const { tools } = await client.request(listToolsRequest);

  return tools.map(tool => ({
    name: buildMcpToolName(client.name, tool.name),
    description: tool.description(),
    inputSchema: tool.inputSchema,

    // 自动获得 Claude Code 宿主能力
    checkPermissions: (input) => checkPermissions(tool, input),
    call: (input) => callMCPTool(client, tool, input),
    isConcurrencySafe: tool.isConcurrencySafe?.() ?? false,
    isReadOnly: tool.isReadOnly?.() ?? false,

    // MCP 特定信息
    mcpInfo: { server: client.name, tool: tool.name },
    userFacingName: tool.userFacingName?.() ?? tool.name,
  }));
}

// transformMCPResult() - 大结果防爆处理
function transformMCPResult(result: MCPResult): ResultContent[] {
  const contents: ResultContent[] = [];

  for (const item of result.contents) {
    if (isText(item)) {
      contents.push({ type: 'text', text: item.text });
    } else if (isImage(item)) {
      // 图片缩放压缩
      const scaled = scaleImage(item.data, { maxDimension: 1024 });
      contents.push({ type: 'image', ...scaled });
    } else if (isBlob(item)) {
      // 二进制落盘，只返回路径
      const path = persistBlobToFile(item);
      contents.push({ type: 'text', text: `[Binary data at ${path}]` });
    } else if (isLarge(item)) {
      // 过大结果走截断或落盘
      if (shouldTruncate(item)) {
        contents.push({ type: 'text', text: truncate(item, MAX_SIZE) });
      } else {
        const path = persistLargeResult(item);
        contents.push({ type: 'text', text: `[Result truncated. Full data at ${path}]` });
      }
    }
  }

  return contents;
}

// callMCPToolWithUrlElicitationRetry() - 交互式工具处理
async function callMCPToolWithUrlElicitationRetry(
  client: Client,
  tool: Tool,
  input: Input
): Promise<ResultContent[]> {
  try {
    return await callMCPTool(client, tool, input);
  } catch (error) {
    if (error.code === -32042) {
      // Url ElicitationRequired - 要求用户完成 URL 交互
      const elicitation = parseElicitation(error);

      // 先跑 elicitation hooks
      await runElicitationHooks(elicitation);

      // 不行再走 handleElicitation 或 REPL queue
      await handleElicitation(elicitation);

      // 完成后重试 tool call
      return callMCPToolWithUrlElicitationRetry(client, tool, input);
    }
    throw error;
  }
}
```

### 对 Stratix 的启发

1. **MCP 作为 Zone 的外部能力总线**：Zone 里的 agent 可以通过 MCP 协议接入外部工具/服务，Stratix 负责转译、装配和安全管控
2. **RTSMoveAPI 的协议映射**：把 MCP tool 接入 Stratix 时，应映射为 Stratix 自己的 Tool 契约，自动获得权限系统、进度事件等宿主能力
3. **工具池的渐进装配**：与其在 Zone 激活时等待所有 MCP 连接完成，不如边连接、边发现、边汇总，逐步把可用工具开放给 agent
4. **大结果防爆机制**：MCP 返回的代码执行结果、设计稿等大内容应做防爆处理（图片压缩、大文件落盘、结果截断）
5. **交互式工具支持**：某些 MCP 工具可能需要用户授权 URL（如 OAuth），需要设计 elicitation 流程（弹窗 → 用户确认 → 重试）
6. **连接稳定性设计**：长时间运行的 Zone session 需要处理断线重连、session 过期检测、错误计数阈值等
7. **auth 作为生命周期**：认证失败不是简单报错，而是进入"需要 auth"状态，提供 `createMcpAuthTool()` 让用户完成认证后重试

---

## 总结：Part 2 核心架构模式

### 分流（Dispatching）

AgentTool 把不同执行形态（teammate/remote/sync/async）统一放进一个入口，通过 `effectiveIsolation` + `shouldRunAsync` + `team_name` 等条件做分流。**对 Stratix 的意义**：Zone 的 agent 调度也应收敛到统一入口，支持本地执行、远程迁移、后台运行等多种形态。

### 隔离（Isolation）

- worker 工具池根据 permission mode 重新组装
- worktree 提供工程级隔离，保留有效修改
- 子 agent 有自己独立的工具视角和权限视角

**对 Stratix 的意义**：每个 Zone 应是独立的工具域和权限域，agent 进入 Zone 时重新组装工具池。

### 压平（Flattening）

- `mapToolResultToToolResultBlockParam()` 把多种运行形态重新压平
- `transformMCPResult()` 把异构返回值驯化成模型可承受的格式
- `useCanUseTool()` 把多来源权限决策统一成 PermissionDecision 语义

**对 Stratix 的意义**：Zone 系统的上层接口应简洁一致，底层复杂性（多 agent 形态、多权限来源、多 MCP 协议）在内部消化。

### 协作协议（Collaboration Protocol）

权限系统不再是门禁，而是跨角色、跨终端、跨执行主体的协作协议：
- agent 需要权限时，向 coordinator/swarm leader 请求
- 权限决策可以在本地用户、自动规则、远端桥接之间流动
- deny 状态不只是给程序，还给用户通知、给模型纠偏提示

**对 Stratix 的意义**：Zone 里的 agent 操作应设计权限请求协议，支持用户审批、Zone 配置规则、Agent 自主请求等多种来源。
