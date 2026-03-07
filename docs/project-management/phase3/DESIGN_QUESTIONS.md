# Phase 3 设计问题清单

## 🔴 高优先级问题 (必须确认)

### 1. AI Agent 执行模式
**问题**: AI Agent 如何执行任务？
- [ ] 每个任务启动一个独立的 Agent？
- [ ] 一个 Agent 执行所有任务？
- [ ] 根据任务类型动态分配？

**影响**: 影响资源管理和并发控制

---

### 2. Agent 类型
**问题**: 使用哪种 Agent？
- [ ] OpenClaw (本地 Agent)
- [ ] LLM API (云端 Agent)
- [ ] 混合模式（根据任务选择）

**影响**: 影响技术选型和实现

---

### 3. 进度更新频率
**问题**: 多久更新一次进度？
- [ ] 实时（每次操作）
- [ ] 定时（如每秒）
- [ ] 里程碑（完成特定步骤）

**影响**: 影响性能和用户体验

---

### 4. 成果文件管理
**问题**: 成果文件如何存储和组织？
- [ ] 存储在项目根目录？
- [ ] 按任务分类存储？
- [ ] 时间戳命名？

**建议**: 
```
project-folder/
├── task-001-requirement/
│   ├── requirement.md
│   └── analysis.json
├── task-002-design/
│   ├── architecture.md
│   └── diagrams/
└── task-003-development/
    ├── src/
    └── tests/
```

---

## 🟡 中优先级问题 (建议确认)

### 5. 任务执行失败处理
**问题**: 任务执行失败时的处理策略？

**建议**:
1. 重试 3 次
2. 跳过并继续后续任务
3. 暂停整个项目
4. 请求用户介入

---

### 6. 并发执行
**问题**: 是否支持并发执行多个独立任务？

**建议**: 
- 支持，但限制最大并发数（如 3 个）
- 只执行依赖已满足的任务

---

### 7. WebSocket 实现
**问题**: WebSocket 服务的架构？

**建议**:
- 使用现有的 express + ws
- 端口: 3001 (与主服务分离)
- 支持房间概念（按项目ID分组）

---

### 8. Agent 输出流
**问题**: 如何实时显示 Agent 的输出？

**建议**:
- Agent 输出写入日志文件
- WebSocket 推送日志行
- 前端实时显示终端输出

---

## 🟢 低优先级问题 (可选)

### 9. 任务优先级调整
**问题**: 执行过程中能否动态调整优先级？

**建议**: 
- 暂不支持
- 作为未来优化项

---

### 10. 执行历史
**问题**: 是否需要保存执行历史？

**建议**:
- 保存日志文件
- 记录每个任务的执行时间
- 记录失败原因

---

## 💡 设计建议

### 1. TaskExecutor 架构
```typescript
class TaskExecutor {
  // 执行队列
  private queue: ExecutionQueue;
  
  // 当前执行的任务
  private currentTask: Task | null;
  
  // 进度跟踪器
  private progressTracker: ProgressTracker;
  
  // 执行任务
  async execute(task: Task): Promise<void>;
  
  // 暂停
  pause(): void;
  
  // 恢复
  resume(): void;
  
  // 取消
  cancel(): void;
}
```

### 2. 执行队列
```typescript
class ExecutionQueue {
  // 拓扑排序
  sort(tasks: Task[]): Task[];
  
  // 获取下一个可执行任务
  getNext(): Task | null;
  
  // 标记完成
  complete(taskId: string): void;
  
  // 检查依赖
  checkDependencies(task: Task): boolean;
}
```

### 3. 进度跟踪
```typescript
class ProgressTracker {
  // 更新进度
  update(taskId: string, progress: number): void;
  
  // 推送到前端
  push(taskId: string, status: TaskStatus): void;
  
  // 获取项目整体进度
  getProjectProgress(): number;
}
```

### 4. Agent 集成
```typescript
interface Agent {
  // 执行任务
  execute(task: Task): Promise<TaskResult>;
  
  // 停止执行
  stop(): void;
  
  // 获取输出流
  getOutputStream(): ReadableStream;
}
```

---

## 📝 需要补充的文档

1. **TASK_EXECUTOR_DESIGN.md** - TaskExecutor 详细设计
2. **AGENT_INTEGRATION_GUIDE.md** - Agent 集成指南
3. **WEBSOCKET_API.md** - WebSocket API 文档
4. **EXECUTION_FLOW.md** - 执行流程详解

---

**建议**: 先确认高优先级问题，中低优先级可以在开发过程中逐步明确
