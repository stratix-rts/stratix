# 模块设计文档

## 📦 模块职责划分

本文档详细定义每个模块的职责、接口、依赖关系。

---

## 1. stratix-project 模块

### 📋 模块职责
- 项目的生命周期管理（创建、读取、更新、删除）
- 项目区的可视化展示与交互
- 项目配置的管理
- 项目与任务区的关联关系

### 🎯 核心类设计

#### ProjectZone
```typescript
/**
 * 项目区可视化对象
 * 继承自 Phaser.GameObjects.Container
 */
export class ProjectZone extends Phaser.GameObjects.Container {
  // 核心属性
  private projectId: string;
  private projectName: string;
  private projectPriority: number;
  private projectStatus: ProjectStatus;
  
  // 视觉元素
  private borderGraphics: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private progressBar: Phaser.GameObjects.Graphics;
  
  // 配置
  private config: ProjectConfig;
  
  // 方法
  constructor(scene: Phaser.Scene, config: ProjectZoneConfig);
  
  // 更新方法
  updateProgress(progress: number): void;
  updateStatus(status: ProjectStatus): void;
  updateName(name: string): void;
  
  // 交互方法
  enableDrag(): void;
  enableResize(): void;
  showConfigPanel(): void;
  
  // 序列化
  toJSON(): ProjectZoneData;
  static fromJSON(data: ProjectZoneData): ProjectZone;
}
```

#### ProjectManager
```typescript
/**
 * 项目管理器
 * 负责项目的CRUD操作
 */
export class ProjectManager {
  private store: ProjectStore;
  private eventBus: EventEmitter;
  
  constructor(store: ProjectStore, eventBus: EventEmitter);
  
  // CRUD操作
  async createProject(config: ProjectConfig): Promise<Project>;
  async getProject(id: string): Promise<Project | null>;
  async updateProject(id: string, updates: Partial<Project>): Promise<Project>;
  async deleteProject(id: string): Promise<void>;
  
  // 查询操作
  async getAllProjects(): Promise<Project[]>;
  async getProjectsByStatus(status: ProjectStatus): Promise<Project[]>;
  async getProjectsByPriority(priority: number): Promise<Project[]>;
  
  // 业务操作
  async startProject(id: string): Promise<void>;
  async pauseProject(id: string): Promise<void>;
  async resumeProject(id: string): Promise<void>;
  async completeProject(id: string): Promise<void>;
  
  // 任务关联
  async addTaskToProject(projectId: string, taskId: string): Promise<void>;
  async removeTaskFromProject(projectId: string, taskId: string): Promise<void>;
}
```

#### ProjectConfig
```typescript
/**
 * 项目配置类
 */
export class ProjectConfig {
  // 基础信息
  name: string;
  description?: string;
  priority: number; // 1-5
  
  // 存储配置
  localFolderPath: string; // 本地文件夹路径（必填）
  
  // Git配置（可选）
  gitConfig?: {
    enabled: boolean;
    remoteUrl?: string;
    branch?: string;
    commitMessage?: string;
  };
  
  // Agent配置
  agentMode: 'openclaw' | 'llm';
  
  // AI规划规则
  planningRule: 'sequential' | 'by_type' | 'by_priority';
  
  // 执行权限
  executionPermission: 'auto' | 'confirm' | 'mark_only';
  
  // 需求文档
  requirement: {
    type: 'text' | 'markdown';
    content: string;
    filePath?: string; // MD文档路径
  };
  
  // 进度同步规则
  progressRule: 'average' | 'all_complete';
}
```

### 📡 事件定义
```typescript
// 项目事件
'project:created'     // { project: Project }
'project:updated'     // { project: Project, changes: Partial<Project> }
'project:deleted'     // { projectId: string }
'project:started'     // { project: Project }
'project:paused'      // { project: Project }
'project:resumed'     // { project: Project }
'project:completed'   // { project: Project }
```

### 🔗 模块依赖
- `stratix-data-store`: 数据持久化
- `mitt`: 事件总线
- `Phaser`: 游戏引擎

---

## 2. stratix-task 模块

### 📋 模块职责
- 任务区的可视化与交互
- 任务配置管理
- 任务状态管理
- 任务依赖关系

### 🎯 核心类设计

#### TaskZone (重构)
```typescript
/**
 * 任务区可视化对象
 * 重构现有 TaskZone 类
 */
export class TaskZone extends Phaser.GameObjects.Container {
  // 核心属性
  private taskId: string;
  private taskName: string;
  private taskType: TaskType;
  private taskStatus: TaskStatus;
  private projectId: string; // 所属项目ID
  
  // 依赖关系
  private dependencies: string[]; // 依赖的任务ID列表
  
  // 配置
  private config: TaskConfig;
  
  // 专属配置文本框内容
  private requirementText: string;
  
  // 视觉元素
  private borderGraphics: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private statusIcon: Phaser.GameObjects.Text;
  private progressBar: Phaser.GameObjects.Graphics;
  
  // 方法
  constructor(scene: Phaser.Scene, config: TaskZoneConfig);
  
  // 状态更新
  updateStatus(status: TaskStatus): void;
  updateProgress(progress: number): void;
  
  // 配置
  setRequirement(text: string): void;
  getRequirement(): string;
  
  // 依赖管理
  addDependency(taskId: string): void;
  removeDependency(taskId: string): void;
  getDependencies(): string[];
  
  // 序列化
  toJSON(): TaskZoneData;
  static fromJSON(data: TaskZoneData): TaskZone;
}
```

#### TaskManager
```typescript
/**
 * 任务管理器
 */
export class TaskManager {
  private store: TaskStore;
  private eventBus: EventEmitter;
  
  constructor(store: TaskStore, eventBus: EventEmitter);
  
  // CRUD操作
  async createTask(config: TaskConfig): Promise<Task>;
  async getTask(id: string): Promise<Task | null>;
  async updateTask(id: string, updates: Partial<Task>): Promise<Task>;
  async deleteTask(id: string): Promise<void>;
  
  // 查询操作
  async getTasksByProject(projectId: string): Promise<Task[]>;
  async getTasksByStatus(status: TaskStatus): Promise<Task[]>;
  async getTasksByType(type: TaskType): Promise<Task[]>;
  
  // 依赖管理
  async setDependency(taskId: string, dependsOn: string[]): Promise<void>;
  async checkDependenciesMet(taskId: string): Promise<boolean>;
  async getDependentTasks(taskId: string): Promise<Task[]>;
  
  // 业务操作
  async startTask(id: string): Promise<void>;
  async pauseTask(id: string): Promise<void>;
  async completeTask(id: string, result: TaskResult): Promise<void>;
  async failTask(id: string, error: Error): Promise<void>;
}
```

#### TaskTypeRegistry
```typescript
/**
 * 任务类型注册表
 * 管理5种任务类型的配置模板
 */
export class TaskTypeRegistry {
  private static instance: TaskTypeRegistry;
  private types: Map<TaskType, TaskTypeDefinition>;
  
  private constructor();
  
  static getInstance(): TaskTypeRegistry;
  
  // 注册任务类型
  register(type: TaskType, definition: TaskTypeDefinition): void;
  
  // 获取任务类型定义
  getDefinition(type: TaskType): TaskTypeDefinition;
  
  // 获取所有类型
  getAllTypes(): TaskType[];
  
  // 验证配置
  validateConfig(type: TaskType, config: any): boolean;
}

// 任务类型定义
interface TaskTypeDefinition {
  type: TaskType;
  name: string;
  icon: string;
  color: number;
  defaultConfig: Partial<TaskConfig>;
  configSchema: any; // JSON Schema
}
```

### 📊 任务类型定义
```typescript
type TaskType = 
  | 'writing'    // 写作类
  | 'coding'     // 编程类
  | 'drawing'    // 画图类
  | 'video'      // 视频类
  | 'research';  // 研究类

type TaskStatus = 
  | 'pending'      // 待配置
  | 'configured'   // 已配置未执行
  | 'waiting'      // 等待依赖
  | 'running'      // 执行中
  | 'completed'    // 已完成
  | 'failed';      // 失败
```

### 📡 事件定义
```typescript
// 任务事件
'task:created'      // { task: Task }
'task:updated'      // { task: Task, changes: Partial<Task> }
'task:deleted'      // { taskId: string }
'task:started'      // { task: Task }
'task:progress'     // { task: Task, progress: number }
'task:completed'    // { task: Task, result: TaskResult }
'task:failed'       // { task: Task, error: Error }
```

### 🔗 模块依赖
- `stratix-data-store`: 数据持久化
- `mitt`: 事件总线
- `Phaser`: 游戏引擎

---

## 3. stratix-ai-service 模块

### 📋 模块职责
- 统一的AI服务接口
- 多种LLM的适配器实现
- 需求解析
- 任务拆分

### 🎯 核心类设计

#### AIServiceProvider (接口)
```typescript
/**
 * AI服务提供者接口
 * 所有LLM实现都必须实现此接口
 */
export interface AIServiceProvider {
  // 初始化
  initialize(config: AIConfig): Promise<void>;
  
  // 核心方法
  async chat(messages: ChatMessage[]): Promise<string>;
  async complete(prompt: string): Promise<string>;
  
  // 流式响应（可选）
  async *streamChat(messages: ChatMessage[]): AsyncGenerator<string>;
  
  // 健康检查
  async healthCheck(): Promise<boolean>;
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface AIConfig {
  provider: 'openai' | 'claude' | 'ollama' | 'custom';
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
}
```

#### OpenAIProvider
```typescript
/**
 * OpenAI GPT实现
 */
export class OpenAIProvider implements AIServiceProvider {
  private client: OpenAI;
  private config: AIConfig;
  
  async initialize(config: AIConfig): Promise<void>;
  async chat(messages: ChatMessage[]): Promise<string>;
  async complete(prompt: string): Promise<string>;
  async *streamChat(messages: ChatMessage[]): AsyncGenerator<string>;
  async healthCheck(): Promise<boolean>;
}
```

#### RequirementParser
```typescript
/**
 * 需求解析器
 * 将用户提交的需求（文本/MD文档）解析为结构化数据
 */
export class RequirementParser {
  private aiService: AIServiceProvider;
  
  constructor(aiService: AIServiceProvider);
  
  /**
   * 解析需求
   * @param requirement 需求内容（文本或MD）
   * @returns 结构化的需求信息
   */
  async parse(requirement: ProjectRequirement): Promise<ParsedRequirement>;
}

interface ProjectRequirement {
  type: 'text' | 'markdown';
  content: string;
  filePath?: string;
}

interface ParsedRequirement {
  projectType: TaskType;
  objectives: string[];           // 项目目标
  scope: string[];                // 项目范围
  deliverables: string[];         // 交付要求
  constraints: string[];          // 约束条件
  suggestedTasks: SuggestedTask[]; // AI建议的任务列表
}

interface SuggestedTask {
  name: string;
  type: TaskType;
  description: string;
  priority: number;
  dependencies: string[]; // 依赖的任务名称
}
```

#### TaskSplitter
```typescript
/**
 * 任务拆分器
 * 基于解析后的需求，生成具体的任务列表
 */
export class TaskSplitter {
  private aiService: AIServiceProvider;
  private taskRegistry: TaskTypeRegistry;
  
  constructor(aiService: AIServiceProvider, taskRegistry: TaskTypeRegistry);
  
  /**
   * 拆分任务
   * @param parsedRequirement 解析后的需求
   * @param planningRule 拆分规则
   * @returns 任务列表
   */
  async split(
    parsedRequirement: ParsedRequirement, 
    planningRule: PlanningRule
  ): Promise<TaskConfig[]>;
}

type PlanningRule = 
  | 'sequential'     // 按流程顺序拆分
  | 'by_type'        // 按任务类型分类拆分
  | 'by_priority';   // 按优先级拆分
```

### 📡 事件定义
```typescript
// AI事件
'ai:parse:start'       // { projectId: string }
'ai:parse:complete'    // { projectId: string, result: ParsedRequirement }
'ai:split:start'       // { projectId: string }
'ai:split:complete'    // { projectId: string, tasks: TaskConfig[] }
'ai:error'             // { projectId: string, error: Error }
```

### 🔗 模块依赖
- `axios`: HTTP客户端
- `mitt`: 事件总线

---

## 4. stratix-blueprint 模块

### 📋 模块职责
- 项目蓝图的显示
- 任务节点与依赖连线
- 蓝图编辑与微调
- 拖拽交互

### 🎯 核心类设计

#### BlueprintCanvas
```typescript
/**
 * 蓝图画布
 */
export class BlueprintCanvas extends Phaser.GameObjects.Container {
  private project: Project;
  private tasks: Map<string, TaskNode>;
  private dependencyLines: DependencyLine[];
  
  // 视口控制
  private camera: Phaser.Cameras.Scene2D.Camera;
  private zoomLevel: number;
  
  constructor(scene: Phaser.Scene, project: Project);
  
  // 渲染方法
  render(): void;
  updateLayout(): void;
  
  // 交互方法
  enableDrag(): void;
  enableZoom(): void;
  enableSelection(): void;
  
  // 编辑方法
  addTaskNode(task: Task, position: Point): void;
  removeTaskNode(taskId: string): void;
  addDependency(from: string, to: string): void;
  removeDependency(from: string, to: string): void;
  
  // 导出
  exportAsImage(): string; // base64
  exportAsJSON(): BlueprintData;
}
```

#### TaskNode
```typescript
/**
 * 任务节点
 */
export class TaskNode extends Phaser.GameObjects.Container {
  private task: Task;
  private background: Phaser.GameObjects.Graphics;
  private nameText: Phaser.GameObjects.Text;
  private typeIcon: Phaser.GameObjects.Text;
  private statusIndicator: Phaser.GameObjects.Graphics;
  
  // 连接点
  private inputConnectors: Phaser.GameObjects.Arc[];
  private outputConnectors: Phaser.GameObjects.Arc[];
  
  constructor(scene: Phaser.Scene, task: Task, position: Point);
  
  // 交互
  enableDrag(): void;
  highlight(): void;
  unhighlight(): void;
  
  // 连接点管理
  getInputConnector(index: number): Point;
  getOutputConnector(index: number): Point;
}
```

#### DependencyLine
```typescript
/**
 * 依赖关系连线
 */
export class DependencyLine extends Phaser.GameObjects.Graphics {
  private fromTask: string;
  private toTask: string;
  private fromNode: TaskNode;
  private toNode: TaskNode;
  
  constructor(
    scene: Phaser.Scene, 
    from: TaskNode, 
    to: TaskNode
  );
  
  // 渲染
  draw(): void;
  
  // 交互
  highlight(): void;
  unhighlight(): void;
  
  // 更新
  updatePosition(): void;
}
```

### 🔗 模块依赖
- `Phaser`: 游戏引擎
- `mitt`: 事件总线

---

## 5. stratix-task-executor 模块

### 📋 模块职责
- 任务执行调度
- 进度跟踪
- 成果收集
- 执行队列管理

### 🎯 核心类设计

#### TaskExecutor
```typescript
/**
 * 任务执行器
 */
export class TaskExecutor {
  private taskManager: TaskManager;
  private projectManager: ProjectManager;
  private eventBus: EventEmitter;
  private executionQueue: ExecutionQueue;
  
  constructor(
    taskManager: TaskManager,
    projectManager: ProjectManager,
    eventBus: EventEmitter
  );
  
  // 执行控制
  async startProject(projectId: string): Promise<void>;
  async pauseProject(projectId: string): Promise<void>;
  async resumeProject(projectId: string): Promise<void>;
  
  // 任务执行
  async executeTask(taskId: string): Promise<TaskResult>;
  
  // 批量执行
  async executeTasks(taskIds: string[]): Promise<Map<string, TaskResult>>;
}
```

#### ProgressTracker
```typescript
/**
 * 进度跟踪器
 */
export class ProgressTracker {
  private eventBus: EventEmitter;
  private taskProgress: Map<string, number>;
  
  constructor(eventBus: EventEmitter);
  
  // 进度更新
  updateTaskProgress(taskId: string, progress: number): void;
  getTaskProgress(taskId: string): number;
  
  // 项目进度
  calculateProjectProgress(projectId: string): number;
  
  // 事件发射
  private emitProgress(taskId: string, progress: number): void;
}
```

#### ResultCollector
```typescript
/**
 * 成果收集器
 */
export class ResultCollector {
  private fileService: FileService;
  
  constructor(fileService: FileService);
  
  // 收集成果
  async collectTaskResult(
    taskId: string, 
    result: TaskResult
  ): Promise<string>; // 返回文件路径
  
  // 汇总项目成果
  async collectProjectResults(
    projectId: string
  ): Promise<ProjectResultSummary>;
  
  // 生成清单
  async generateResultManifest(
    projectId: string
  ): Promise<string>; // 返回清单文件路径
}

interface TaskResult {
  taskId: string;
  status: 'success' | 'failed';
  outputFiles: string[];
  outputData?: any;
  error?: string;
  completedAt: Date;
}

interface ProjectResultSummary {
  projectId: string;
  totalTasks: number;
  completedTasks: number;
  failedTasks: number;
  results: TaskResult[];
  manifestPath: string;
}
```

#### ExecutionQueue
```typescript
/**
 * 执行队列
 * 按依赖关系和优先级排序任务
 */
export class ExecutionQueue {
  private tasks: Task[];
  private dependencyGraph: Map<string, string[]>;
  
  constructor(tasks: Task[]);
  
  // 排序
  sort(): Task[]; // 拓扑排序 + 优先级排序
  
  // 获取下一个可执行任务
  getNext(): Task | null;
  
  // 标记任务完成
  markCompleted(taskId: string): void;
  
  // 检查依赖是否满足
  checkDependencies(taskId: string): boolean;
}
```

### 🔗 模块依赖
- `stratix-project`: 项目管理
- `stratix-task`: 任务管理
- `mitt`: 事件总线

---

## 6. stratix-git-sync 模块 (阶段4)

### 📋 模块职责
- Git操作封装
- 代码提交
- 分支管理
- 冲突处理（预留）

### 🎯 核心类设计

#### GitManager
```typescript
/**
 * Git管理器
 */
export class GitManager {
  private repoPath: string;
  
  constructor(repoPath: string);
  
  // 仓库操作
  async init(): Promise<void>;
  async clone(url: string): Promise<void>;
  async status(): Promise<GitStatus>;
  
  // 分支操作
  async createBranch(name: string): Promise<void>;
  async checkoutBranch(name: string): Promise<void>;
  async getCurrentBranch(): Promise<string>;
  
  // 提交操作
  async add(files: string[]): Promise<void>;
  async commit(message: string): Promise<string>; // 返回commit hash
  async push(branch?: string): Promise<void>;
  async pull(branch?: string): Promise<void>;
  
  // 日志
  async log(options?: LogOptions): Promise<CommitLog[]>;
}

interface GitStatus {
  currentBranch: string;
  staged: string[];
  modified: string[];
  untracked: string[];
}

interface CommitLog {
  hash: string;
  message: string;
  author: string;
  date: Date;
}
```

#### CommitService
```typescript
/**
 * 提交服务
 * 自动提交代码到Git仓库
 */
export class CommitService {
  private gitManager: GitManager;
  private eventBus: EventEmitter;
  
  constructor(gitManager: GitManager, eventBus: EventEmitter);
  
  // 自动提交任务成果
  async commitTaskResult(
    taskId: string,
    files: string[],
    message?: string
  ): Promise<string>; // 返回commit hash
  
  // 批量提交项目成果
  async commitProjectResults(
    projectId: string,
    results: TaskResult[]
  ): Promise<string[]>;
}
```

### 🔗 模块依赖
- `simple-git`: Git操作库
- `mitt`: 事件总线

---

## 7. stratix-config-panel 模块

### 📋 模块职责
- 项目配置面板
- 任务配置面板
- 任务类型配置面板
- 批量配置面板

### 🎯 核心组件设计（Vue 3）

#### ProjectConfigPanel.vue
```vue
<template>
  <div class="project-config-panel">
    <!-- 基础信息 -->
    <div class="section">
      <input v-model="config.name" placeholder="项目名称" />
      <select v-model="config.priority">
        <option v-for="i in 5" :value="i">{{ i }}级</option>
      </select>
    </div>
    
    <!-- 本地文件夹 -->
    <div class="section">
      <input v-model="config.localFolderPath" placeholder="本地文件夹路径" />
      <button @click="browseFolder">浏览</button>
    </div>
    
    <!-- Git配置 -->
    <div class="section" v-if="showGitConfig">
      <input v-model="config.gitConfig.remoteUrl" placeholder="远程仓库地址" />
      <input v-model="config.gitConfig.branch" placeholder="分支名称" />
    </div>
    
    <!-- 需求提交 -->
    <div class="section">
      <textarea v-model="config.requirement.content" placeholder="项目需求描述" />
      <button @click="uploadMarkdown">上传MD文档</button>
    </div>
    
    <!-- 保存按钮 -->
    <button @click="save">保存配置</button>
  </div>
</template>

<script setup lang="ts">
// Vue 3 Composition API
</script>
```

#### TaskConfigPanel.vue
```vue
<template>
  <div class="task-config-panel">
    <!-- 任务类型选择 -->
    <select v-model="config.taskType">
      <option value="writing">写作类</option>
      <option value="coding">编程类</option>
      <option value="drawing">画图类</option>
      <option value="video">视频类</option>
      <option value="research">研究类</option>
    </select>
    
    <!-- 专属配置文本框 -->
    <div class="requirement-textbox">
      <textarea 
        v-model="config.requirementText" 
        placeholder="任务要求描述"
      />
      <button @click="uploadMarkdown">上传MD文档</button>
    </div>
    
    <!-- 通用配置 -->
    <div class="common-config">
      <select v-model="config.priority">
        <option v-for="i in 5" :value="i">{{ i }}级</option>
      </select>
      <select v-model="config.executionPermission">
        <option value="auto">AI自主执行</option>
        <option value="confirm">用户确认后执行</option>
        <option value="mark_only">仅标记不执行</option>
      </select>
    </div>
    
    <button @click="save">保存配置</button>
  </div>
</template>

<script setup lang="ts">
// Vue 3 Composition API
</script>
```

### 🔗 模块依赖
- `Vue 3`: 组件框架
- `mitt`: 事件总线

---

## 📊 模块依赖关系图

```
┌─────────────────────────────────────────────┐
│             stratix-config-panel            │
│         (项目/任务配置面板 - Vue组件)         │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│          stratix-blueprint (蓝图编辑器)      │
└─────────────────────────────────────────────┘
                    ↓
    ┌───────────────┴───────────────┐
    ↓                               ↓
┌─────────────┐             ┌─────────────────┐
│stratix-task │             │ stratix-project │
│  (任务管理)  │             │   (项目管理)    │
└─────────────┘             └─────────────────┘
    ↓                               ↓
    └───────────────┬───────────────┘
                    ↓
        ┌───────────────────────┐
        │  stratix-ai-service   │
        │    (AI服务模块)        │
        └───────────────────────┘
                    ↓
        ┌───────────────────────┐
        │stratix-task-executor  │
        │    (任务执行引擎)      │
        └───────────────────────┘
                    ↓
        ┌───────────────────────┐
        │  stratix-git-sync     │
        │   (Git协同，阶段4)     │
        └───────────────────────┘
                    ↓
        ┌───────────────────────┐
        │  stratix-data-store   │
        │    (数据持久化)        │
        └───────────────────────┘
```

---

## 🔄 模块间通信流程

### 示例1: 用户创建项目并AI拆分
```
1. 用户画框 → ProjectZone创建
2. ProjectZone → ProjectManager.createProject()
3. ProjectManager → ProjectStore.save()
4. ProjectManager → EventBus.emit('project:created')
5. ProjectConfigPanel 显示
6. 用户提交需求 → RequirementParser.parse()
7. RequirementParser → AIService.chat()
8. RequirementParser → TaskSplitter.split()
9. TaskSplitter → EventBus.emit('ai:split:complete')
10. BlueprintCanvas 渲染任务节点
```

### 示例2: 任务执行与进度同步
```
1. 用户启动项目 → TaskExecutor.startProject()
2. TaskExecutor → ExecutionQueue.sort()
3. TaskExecutor → 执行第一个任务
4. TaskExecutor → EventBus.emit('task:started')
5. ProgressTracker → EventBus.emit('task:progress')
6. ResultCollector → 收集成果
7. TaskExecutor → EventBus.emit('task:completed')
8. ProjectManager → 更新项目进度
```

---

**文档版本**: v1.0  
**更新日期**: 2026-03-02
