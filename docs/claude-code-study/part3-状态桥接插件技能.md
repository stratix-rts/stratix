# Part 3：状态层、桥接层、Server层、插件与技能

---

## 8. state/AppStateStore.ts：运行时状态内核的总台账

### 关键设计点

- **不是普通 UI State，而是整个宿主运行时的共享控制面**：覆盖会话态、权限态、任务态、MCP 态、插件态、remote/bridge 态、teammate/team 态、通知与交互态、预测与建议态、终端外设态
- **按领域分仓的结构**：tasks、mcp、plugins、notifications、elicitation、workerSandboxPermissions、promptSuggestion、skillImprovement 等嵌套块，避免扁平铺开
- **tasks 被故意排除出 DeepImmutable**：承认任务对象里含 function types，是"状态纯度"和"工程现实"的理性取舍
- **getDefaultAppState() 定义的是"宿主零点状态"**：不是默认 UI，而是整个 runtime 启动时的初始姿态，把产品默认行为直接写进状态工厂
- **状态变化统一收口**：onChangeAppState.ts 是状态层与副作用层之间的桥，负责在状态变化后触发外部同步（权限模式变化通知、settings 持久化、auth cache 清空等）

### 核心源码模式

```typescript
// store.ts — 最小原语
getState() / setState(updater) / subscribe(listener)
createStore() 核心实现：存 state、存 listeners、setState 用函数式 updater、Object.is(next, prev) 避免无效通知

// AppState.tsx — React 是消费者，不是状态拥有者
createStore(...) 创建 store → AppStoreContext 提供出去
useSyncExternalStore(store.subscribe, get, get) 做选择性订阅
useAppState(selector) 明确鼓励 selector 模式，防止大范围重渲染
```

### 对 Stratix 的启发

- **中心化定义，去中心化消费**：AppState 一处定义系统状态面，React/非 React 代码/MCP/Agent/Bridge 都能围绕同一份状态总线工作
- **把 Zone 系统、Agent 状态、MCP 连接状态统一收敛到一处**，而不是散落在 hook、context、模块变量、单例对象里
- **状态边界公开化**：宁可把状态总表写重一点，也不把状态分散得找不到
- **onChangeAppState 模式值得借鉴**：把"状态变了之后要干什么"收进一个总 diff 点，避免每个 setState call site 都顺手写副作用

---

## 9. src/bridge/bridgeMain.ts：远端控制与桥接主循环

### 关键设计点

- **不是薄桥，而是"远端控制 runtime"**：有参数解析、模式决策、environment 注册、session spawn、poll/backoff/heartbeat、shutdown/cleanup、headless logger
- **spawnMode 是关键产品抽象**：single-session（传统 remote attach）、same-dir（多会话共享当前目录，追求轻量即时）、worktree（每个会话独立 git worktree，追求并发安全）对应三种不同的远端协作哲学
- **runBridgeLoop() 是真正的心脏**：组合 pollForWork()、heartbeatActiveWorkItems()、createCapacityWake()、getPollIntervalConfig()、connBackoff/generalBackoff，不是简单轮询，而是 poll + heartbeat + backoff + wake 的组合调度器
- **onSessionDone() 有完整的生命周期收口**：从 activeSessions/sessionWorkIds/sessionIngressTokens 删除、取消 timeout timer、取消 token refresh、capacityWake.wake()、stopWorkWithRetry、清理 worktree、archiveSession
- **双入口设计**：bridgeMain() 服务 CLI 交互模式，runBridgeHeadless() 服务 daemon worker，复用同一套桥核心逻辑
- **优雅关停语义严谨**：SIGINT/SIGTERM → controller abort → 给 child session 发送 SIGTERM → 超时后 SIGKILL → 等待 pending cleanups → 清理 worktree → stopWork → archive → deregister environment

### 核心源码模式

```typescript
// runBridgeLoop 组合节奏控制
pollForWork(...)         // 拉取 work
heartbeatActiveWorkItems() // 保活现有 work item
createCapacityWake(...)  // 满载时唤醒
getPollIntervalConfig()  // 动态轮询间隔
connBackoff / generalBackoff // 错误退避

// spawnMode 三态
single-session  // 只恢复一个会话，生命周期强耦合
same-dir        // 多会话共享当前目录，追求轻量
worktree        // 每个会话独立 git worktree，追求并发安全
```

### 对 Stratix 的启发

- **把 session 当作受控生命周期对象**：会话结束不是事件，而是一组系统状态迁移
- **Remote Control 不是一次性 attach，而是长期运行中的 lease 管理问题**：认真对待 token refresh、resume、environment mismatch
- **worktree 支持说明 bridge 真的是把"多远端会话并发协作本地仓库"当成真实需求**：不是演示性质的 remote viewer
- **桥接核心逻辑和交互壳层拆开**：这样 CLI 交互模式能跑，daemon worker 能跑，supervisor 也能安全托管

---

## 10. src/server/createDirectConnectSession.ts：Direct Connect 会话握手入口

### 关键设计点

- **薄协议、厚下游的定位**：只做三件事——把输入压成 server 能理解的最小请求、把响应校验成内部能信任的结构、把错误包装成明确的 DirectConnectError
- **语义折叠**：外部协议世界（session_id、ws_url、work_dir）→ 内部 runtime 世界（DirectConnectConfig + WebSocket + 会话消息回调 + 权限请求回调）
- **dangerously_skip_permissions 字段名直接暴露危险性**：命名和权限系统风格一致，危险能力不靠注释提醒，而是直接进 API 命名，使用者必须显式承担语义成本
- **connectResponseSchema().safeParse() 校验**：承认这是跨进程/跨宿主/可能跨版本的协议边界，必须校验
- **DirectConnectError 主动建构错误语义**：网络失败、HTTP 失败、响应解析失败统一归类成产品语义错误
- **三层分层模型**：HTTP 握手层（createDirectConnectSession.ts）→ WebSocket 会话层（directConnectManager.ts）→ 上层 runtime/REPL/headless runner 集成层

### 核心源码模式

```typescript
// 握手层只负责"建联成功"
POST /sessions { cwd, dangerously_skip_permissions? }
connectResponseSchema().safeParse(...) 校验返回值
折叠为内部 DirectConnectConfig { serverUrl, sessionId, wsUrl, authToken, workDir }

// 错误语义主动建构
DirectConnectError 统一归类：网络失败 / HTTP 失败 / schema parse 失败
```

### 对 Stratix 的启发

- **anti-corruption layer 的标准写法**：把外部响应折叠成内部结构，上层代码不必继续知道 HTTP 细节
- **协议边界必须校验**：只要是跨进程/跨宿主边界，就必须 schema 校验，否则版本漂移会带半坏状态继续运行
- **错误包装的价值**：上层最终拿到的应该是可叙述、可处理、可呈现的错误，而不是原始异常
- **direct connect 不是文件，而是一组分层模型**：握手层 + 会话层 + 集成层拆清楚

---

## 11. src/utils/plugins/loadPluginCommands.ts：插件内容接入宿主命令协议的总适配层

### 关键设计点

- **协议适配层，不是文件系统工具**：把插件作者写的 Markdown 内容转换成 Claude Code 宿主内部统一可执行的 Command 协议对象
- **命令与技能在这里被部分统一**：getPluginCommands() 和 getPluginSkills() 同出一源，最终都被转成同一种 Command
- **多来源形态支持**：commands/ 目录、manifest 声明的额外 command 路径、单 .md 文件、目录递归扫描、SKILL.md 技能目录、manifest object mapping 形式的命令定义、内联 content
- **命名空间治理**：getCommandNameFromFile() 把插件命名空间显式带进 slash command，生成 pluginName:commandName 或 pluginName:namespace:commandName
- **多层变量替换链**：参数替换 → 插件变量替换 → 用户配置替换 → CLAUDE_SKILL_DIR/CLAUDE_SESSION_ID → shell 命令执行
- **executeShellCommandsInPrompt() 关键设计**：插件 prompt 里的 shell 执行不是后门，仍然通过 allowedTools 注入 toolPermissionContext.alwaysAllowRules.command 来约束权限
- **并行 + memoize + 防重**：enabled plugins 并行处理，每个插件内部多个 path 也并行处理，用 loadedPaths 防重

### 核心源码模式

```typescript
// 协议折叠
createPluginCommand(markdown, frontmatter) → PromptCommand
// 支持多种输入形态
commands/ 目录 / manifest 声明 / 单 .md / 目录递归 / SKILL.md / object mapping / inline content

// 变量替换链路
substituteArguments(...) → substitutePluginVariables(...) → substituteUserConfigInContent(...) → executeShellCommandsInPrompt(...)

// 命名策略
普通文件：取文件名去掉 .md
skill：取 SKILL.md 所在目录名
相对路径折成 namespace → pluginName:commandName / pluginName:namespace:commandName
```

### 对 Stratix 的启发

- **把插件内容强行折回现有命令协议**：不发明新命令系统，避免插件体系撕裂宿主 slash command 体系
- **技能和命令尽量复用同一套抽象**：用户体验层可以区分，但运行时协议层尽量合一
- **插件 prompt 里的 shell 执行必须受权限上下文约束**：不能做成后门
- **条件激活减少技能列表膨胀**：只向模型展现在正确上下文相关的技能

---

## 12. src/skills/loadSkillsDir.ts：技能系统真正成立的总装层

### 关键设计点

- **技能最终被压回 Command**：createSkillCommand(...) 返回的仍然是 Command，只是额外带上 hooks/skillRoot/context/agent/paths/loadedFrom，说明产品概念是 skill，但运行时协议尽量复用 command
- **parseSkillFrontmatterFields() 系统化解析**：description、allowed-tools、argument-hint、arguments、when_to_use、version、model、disable-model-invocation、user-invocable、hooks、context、agent、effort、shell——技能是轻量声明式能力规格，不是孤立 prompt
- **历史兼容双轨**：新式 /skills/ 目录 + 旧式 /commands/ 目录里的技能写法同时兼容
- **多来源装配**：managed skills、user skills、project skills、--add-dir 带来的 additional dirs、legacy commands-as-skills，统一 Command 进入宿主命令世界
- **文件身份去重**：getFileIdentity(filePath) 走 realpath() 处理 symlink 和重叠父目录，避免不同路径指向同一文件导致重复加载
- **条件技能设计**：paths frontmatter 支持使技能先进入 conditionalSkills，只有当文件路径匹配时才激活——在正确时机显露正确能力
- **动态技能发现**：discoverSkillDirsForPaths() 随着会话中文件操作发生，向上遍历文件路径，发现新的 .claude/skills 动态加载并发信号通知外层清 cache
- **信任分层**：MCP skills 禁止执行 markdown body 里的 shell，承认本地技能和远端技能的信任边界不同

### 核心源码模式

```typescript
// 技能折叠回 Command
createSkillCommand(skillInfo) → Command + { hooks, skillRoot, context, agent, paths, loadedFrom }

// 多来源装配
getSkillDirCommands(cwd) → 合并 managed/user/project/additional/legacy 技能
→ 去重 + 条件技能分离 + cache + 激活跟踪

// 条件激活
paths frontmatter → conditionalSkills → activateConditionalSkillsForPaths(paths)
→ 动态发现
discoverSkillDirsForPaths(...) → addSkillDirectories(...) → signals / dynamicSkills

// 信任分层
本地技能：允许 shell 执行，allowedTools 注入权限上下文
MCP 远端技能：禁止执行 markdown body 里的 shell
```

### 对 Stratix 的启发

- **把 Zone/Agent 能力做成立式运行时能力**：可声明、可发现、可去重、可动态激活、可回收到统一命令协议
- **条件激活减少认知负担**：不是能力越多越好，而是在正确上下文才显露正确能力
- **动态发现让技能系统和真实工作流绑定**：技能不是安装后静态列表，而是随工作上下文展开的能力面
- **信任分层要清醒**：本地内容和远端内容不能一视同仁
