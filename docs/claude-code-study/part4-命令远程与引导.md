# Claude Code 逐模块拆解报告 - Part 4

> 命令注册与分发、远端会话管理、引导与状态初始化

---

## 15. src/commands.ts： 整个命令世界的编排台

### 关键设计点

- **命令编排台而非注册表**：把 built-in commands、feature-gated commands、plugin commands、plugin skills、bundled skills、workflow commands、dynamic skills、MCP skills 统一整理成可被宿主、模型和 UI 同时消费的命令世界
- **延迟求值工厂**：`COMMANDS()` 使用 `memoize()` 包装，内含 `feature()` 条件命令、`require()` 延迟加载、auth/provider 分支，说明命令系统跟 feature flag、部署形态、用户身份、启动性能都相关
- **多来源装配分层**：
  - `getSkills()` 负责技能来源装配
  - `getPluginCommands()` 负责插件命令
  - `getWorkflowCommands()` 负责工作流命令
  - `COMMANDS()` 负责内建命令
  - `loadAllCommands()` 统一合并
  - `getCommands()` 做 availability/isEnabled/dynamic skills 插入
- **命令排序有语义**：动态技能不是 append 到尾部，而是插在"plugin skills 之后、built-in commands 之前"——命令顺序是认知排序空间，不是功能罗列
- **多视图消费**：同一个命令底层集被 `getSkillToolCommands()` 和 `getSlashCommandToolSkills()` 以不同过滤规则切片消费，commands.ts 同时是**命令视图工厂**
- **动态失效同步**：clearCommandMemoizationCaches() / clearCommandsCache() 与 dynamic skills loaded、plugin reload、skill cache clear 保持同步
- **可见性治理**：命令系统按 auth/provider 环境（claude-ai/console）判断可见性，某些命令的可见性由能力环境决定

### 核心源码模式

```typescript
// 延迟求值的内建命令工厂
const COMMANDS = memoize(() => [...]);

// 多来源装配
getSkills();                    // 技能来源装配
getPluginCommands();            // 插件命令
getWorkflowCommands();          // 工作流命令
COMMANDS();                     // 内建命令
loadAllCommands();              // 统一合并

// 动态技能插入位置有语义
baseCommands
  .concat(pluginSkills)
  .concat(dynamicSkills)        // 插在 plugin skills 之后、built-in commands 之前
  .concat(builtinCommands)
```

### 对 Stratix 的启发

- Stratix 目前 ZoneService/AgentService 的命令/能力分发较分散，没有统一的命令编排台概念。可以借鉴此设计，建立**跨来源能力的统一装配层**
- Stratix 的 skill/command 发现目前是静态的，可以参考**延迟求值 + feature flag 条件激活**的方式，让能力发现与用户上下文、许可状态挂钩
- 命令排序的"认知空间"思路对 Stratix 很有价值：Zone 面板内的能力列表、slash command 面板都应考虑**能力出现的上下文语义**，而非简单罗列

---

## 16. src/remote/RemoteSessionManager.ts： 远端会话在本地宿主里的托管控制器

### 关键设计点

- **会话托管定位**：负责将远端 CCR 会话在本地宿主接成可持续交互的会话端点，区别于 bridgeMain.ts 的桥接主循环
- **上下行分离架构**：收消息走 `SessionsWebSocket`，发消息走 `sendEventToRemoteSession()`，不是对称 socket 模型，而是**下行订阅流 + 上行事件提交**
- **完整控制面保留**：权限请求进入 `pendingPermissionRequests`，本地可 `respondToPermissionRequest()`；服务端取消时触发 `onPermissionCancelled()`
- **分层设计典范**：SessionsWebSocket.ts 负责传输层（建连、重连、ping/pong、认证），RemoteSessionManager.ts 负责会话语义（控制消息解释、pending 状态管理）

### 核心源码模式

```
SessionsWebSocket (transport)
    └── RemoteSessionManager (session semantics)
            ├── pendingPermissionRequests
            ├── sendMessage()
            ├── cancelSession()
            └── respondToPermissionRequest()
```

### 对 Stratix 的启发

- Stratix 的 Agent 远端控制面目前较薄，可参考此模式在 Gateway 层引入**结构化的控制消息类型**（control_request/control_response/control_cancel_request），而非仅传递 SDKMessage
- Stratix 的 WebSocket 消息目前较平坦，可借鉴**上下行分离 + 控制语义显式建模**的方式，让会话状态更可追踪

---

## 17. src/bootstrap/state.ts： 宿主启动期与会话期共享状态的总底座

### 关键设计点

- **全局内核文件，修改门槛极高**：文件开头写了 `DO NOT ADD MORE STATE HERE / THINK THRICE BEFORE MODIFYING`，作者清楚这不是普通 util，而是 Claude Code 的全局状态底座
- **两套 state 两个层次**：AppStateStore.ts 更像运行时共享控制面（UI/REPL/runtime 观察层），bootstrap/state.ts 是**宿主启动期与会话底层全局状态**（sessionId、cwd、projectRoot、inlinePlugins、registeredHooks、mainThreadAgentType、isRemoteMode、directConnectServerUrl、invokedSkills、prompt cache、各种 latch）
- **accessor 风格封装**：外部不直接访问大对象，而是通过 `getSessionId()` / `setInlinePlugins()` / `getIsRemoteMode()` / `registerHookCallbacks()` / `addInvokedSkill()` 等函数访问——既保留全局状态的可达性，又让语义集中在函数名里，给未来校验/副作用留口子
- **启动态与会话态贯通**：文件中同时存在 `allowedSettingSources`/`chromeFlagOverride`/`useCowPlugins`（启动态）和 `telemetry counters`/`lastAPIRequest`/`registered hooks`/`dynamic skill preservation`（会话态），说明 Claude Code 不是"启动即结束"的 CLI，而是**持续运行的进程宿主**
- **会话级内核变量表**：类似 OS 的 session kernel vars、runtime flags、telemetry accumulators、transient feature latches、hook registries

### 核心源码模式

```typescript
// 全局状态访问皆通过 accessor
getSessionId() → setInlinePlugins() → getIsRemoteMode() → registerHookCallbacks()

// 两类状态共存
// 启动态：allowedSettingSources, chromeFlagOverride, useCowPlugins, sessionBypassPermissionsMode
// 会话态：telemetry counters, lastAPIRequest, registered hooks, invokedSkills, remote/directConnect state
```

### 对 Stratix 的启发

- Stratix 目前缺乏一个清晰的**宿主全局状态层**，ZoneService/AgentService/RTS 场景之间的共享状态较零散。可以考虑在 stratix-core 层建立类似的 **bootstrap/state.ts**，统一管理会话级内核变量
- **Accessor 封装风格**比直接 export 变量更有价值：未来可以做读前校验、写前副作用、变更广播。Stratix 可以在 data-store 或 stratix-core 层实践这一风格
- Stratix 作为"启动即持续运行"的 Agent 宿主，启动态与会话态的贯通非常重要——参考此设计，可以让 settings、plugin 状态、session context 在同一个语义空间里管理
