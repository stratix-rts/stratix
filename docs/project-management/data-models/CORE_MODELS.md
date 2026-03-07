# 核心数据模型

## 📋 概述

本文档定义项目管理和任务执行的核心数据结构，包括TypeScript接口定义和数据库Schema。

---

## 1. 核心实体模型

### 1.1 Project (项目)

```typescript
/**
 * 项目实体
 */
export interface Project {
  // 基础信息
  id: string;                        // 唯一标识符，格式: proj_xxx
  name: string;                      // 项目名称
  description?: string;              // 项目描述
  priority: number;                  // 优先级 (1-5)
  status: ProjectStatus;             // 项目状态
  
  // 配置信息
  config: ProjectConfig;             // 项目配置
  
  // 进度信息
  progress: number;                  // 进度百分比 (0-100)
  taskCount: number;                 // 任务总数
  completedTaskCount: number;        // 已完成任务数
  
  // 地图信息
  zoneConfig: ProjectZoneConfig;     // 项目区配置
  
  // 时间戳
  createdAt: Date;                   // 创建时间
  updatedAt: Date;                   // 更新时间
  startedAt?: Date;                  // 启动时间
  completedAt?: Date;                // 完成时间
}

/**
 * 项目状态
 */
export type ProjectStatus = 
  | 'pending'    // 待启动
  | 'active'     // 执行中
  | 'paused'     // 已暂停
  | 'completed'  // 已完成
  | 'failed';    // 失败

/**
 * 项目配置
 */
export interface ProjectConfig {
  // 存储配置
  localFolderPath: string;           // 本地文件夹路径（必填）
  
  // Git配置（可选）
  gitConfig?: GitConfig;
  
  // Agent配置
  agentMode: AgentMode;              // Agent模式
  
  // AI规划规则
  planningRule: PlanningRule;        // 拆分规则
  
  // 执行权限
  executionPermission: ExecutionPermission;
  
  // 需求文档
  requirement: ProjectRequirement;
  
  // 进度同步规则
  progressRule: ProgressRule;
}

/**
 * Git配置
 */
export interface GitConfig {
  enabled: boolean;                  // 是否启用
  remoteUrl?: string;                // 远程仓库地址
  branch?: string;                   // 分支名称
  commitMessage?: string;            // 提交信息模板
  credentials?: GitCredentials;      // 凭证信息
}

/**
 * Git凭证
 */
export interface GitCredentials {
  username?: string;
  token?: string;                    // 加密存储
}

/**
 * Agent模式
 */
export type AgentMode = 
  | 'openclaw'   // OpenClaw外部Agent
  | 'llm';       // LLM模式Agent

/**
 * 规划规则
 */
export type PlanningRule = 
  | 'sequential'     // 按流程顺序拆分
  | 'by_type'        // 按任务类型分类拆分
  | 'by_priority';   // 按优先级拆分

/**
 * 执行权限
 */
export type ExecutionPermission = 
  | 'auto'       // AI自主执行
  | 'confirm'    // 用户确认后执行
  | 'mark_only'; // 仅标记不执行

/**
 * 项目需求
 */
export interface ProjectRequirement {
  type: 'text' | 'markdown';         // 需求类型
  content: string;                   // 需求内容
  filePath?: string;                 // MD文档路径（如果上传了文件）
}

/**
 * 进度同步规则
 */
export type ProgressRule = 
  | 'average'        // 按任务区数量平均分配
  | 'all_complete';  // 所有任务区完成后项目才标记完成

/**
 * 项目区配置（地图可视化）
 */
export interface ProjectZoneConfig {
  x: number;                         // X坐标
  y: number;                         // Y坐标
  width: number;                     // 宽度
  height: number;                    // 高度
  color?: number;                    // 颜色（十六进制）
  opacity?: number;                  // 透明度 (0-1)
  visible?: boolean;                 // 是否可见
}
```

---

### 1.2 Task (任务)

```typescript
/**
 * 任务实体
 */
export interface Task {
  // 基础信息
  id: string;                        // 唯一标识符，格式: task_xxx
  projectId: string;                 // 所属项目ID
  name: string;                      // 任务名称
  type: TaskType;                    // 任务类型
  description?: string;              // 任务描述
  priority: number;                  // 优先级 (1-5)
  status: TaskStatus;                // 任务状态
  
  // 配置信息
  config: TaskConfig;                // 任务配置
  
  // 依赖关系
  dependencies: string[];            // 依赖的任务ID列表
  
  // 进度信息
  progress: number;                  // 进度百分比 (0-100)
  
  // 执行结果
  result?: TaskResult;               // 执行结果
  
  // 地图信息
  zoneConfig: TaskZoneConfig;        // 任务区配置
  
  // 时间戳
  createdAt: Date;                   // 创建时间
  updatedAt: Date;                   // 更新时间
  startedAt?: Date;                  // 启动时间
  completedAt?: Date;                // 完成时间
}

/**
 * 任务类型
 */
export type TaskType = 
  | 'writing'    // 写作类
  | 'coding'     // 编程类
  | 'drawing'    // 画图类
  | 'video'      // 视频类
  | 'research';  // 研究类

/**
 * 任务状态
 */
export type TaskStatus = 
  | 'pending'      // 待配置
  | 'configured'   // 已配置未执行
  | 'waiting'      // 等待依赖
  | 'running'      // 执行中
  | 'completed'    // 已完成
  | 'paused'       // 已暂停
  | 'failed';      // 失败

/**
 * 任务配置
 */
export interface TaskConfig {
  // 专属配置文本框
  requirementText: string;           // 任务要求描述
  requirementFilePath?: string;      // MD文档路径
  
  // 通用配置
  executionPermission: ExecutionPermission;  // 执行权限
  
  // Agent配置（可覆盖项目配置）
  agentMode?: AgentMode;
  
  // 操作范围
  operationScope: OperationScope;    // 操作范围
  
  // 交付配置（可覆盖项目配置）
  customDeliveryPath?: string;       // 自定义交付路径
  
  // Git配置（编程类任务）
  gitConfig?: Partial<GitConfig>;
  
  // 类型专属配置
  typeSpecificConfig?: TypeSpecificConfig;
}

/**
 * 操作范围
 */
export type OperationScope = 
  | 'local'      // 本地操作
  | 'remote';    // 外部电脑操作（OpenClaw）

/**
 * 类型专属配置（联合类型）
 */
export type TypeSpecificConfig = 
  | WritingTaskConfig
  | CodingTaskConfig
  | DrawingTaskConfig
  | VideoTaskConfig
  | ResearchTaskConfig;

/**
 * 写作类任务专属配置
 */
export interface WritingTaskConfig {
  type: 'writing';
  materials?: string[];              // 关联的素材链接
  format?: 'markdown' | 'html' | 'plain';
}

/**
 * 编程类任务专属配置
 */
export interface CodingTaskConfig {
  type: 'coding';
  language?: string;                 // 编程语言
  framework?: string;                // 框架
  permissions?: {
    canExecute?: boolean;            // 是否允许执行代码
    canTest?: boolean;               // 是否允许运行测试
  };
}

/**
 * 画图类任务专属配置
 */
export interface DrawingTaskConfig {
  type: 'drawing';
  dimensions?: {
    width: number;
    height: number;
  };
  format?: 'png' | 'jpg' | 'svg';
  layers?: LayerConfig[];
}

export interface LayerConfig {
  name: string;
  description?: string;
}

/**
 * 视频类任务专属配置
 */
export interface VideoTaskConfig {
  type: 'video';
  duration?: number;                 // 时长（秒）
  resolution?: string;               // 分辨率
  format?: 'mp4' | 'mov' | 'avi';
  materials?: string[];              // 素材链接
}

/**
 * 研究类任务专属配置
 */
export interface ResearchTaskConfig {
  type: 'research';
  sources?: string[];                // 资料来源
  outputFormat?: 'summary' | 'report' | 'analysis';
  maxLength?: number;                // 最大长度（字数）
}

/**
 * 任务区配置（地图可视化）
 */
export interface TaskZoneConfig {
  x: number;                         // X坐标
  y: number;                         // Y坐标
  width: number;                     // 宽度
  height: number;                    // 高度
  color?: number;                    // 颜色（十六进制）
  opacity?: number;                  // 透明度 (0-1)
  visible?: boolean;                 // 是否可见
}

/**
 * 任务执行结果
 */
export interface TaskResult {
  status: 'success' | 'failed';
  outputFiles: string[];             // 输出文件路径列表
  outputData?: any;                  // 输出数据（JSON格式）
  error?: string;                    // 错误信息
  logs: TaskLog[];                   // 执行日志
  completedAt: Date;                 // 完成时间
  duration: number;                  // 执行时长（毫秒）
}

/**
 * 任务执行日志
 */
export interface TaskLog {
  timestamp: Date;
  level: 'info' | 'warning' | 'error' | 'success';
  message: string;
  details?: any;
}
```

---

### 1.3 AI相关模型

```typescript
/**
 * 解析后的需求
 */
export interface ParsedRequirement {
  projectId: string;
  projectType: TaskType;             // 项目类型
  objectives: string[];              // 项目目标
  scope: string[];                   // 项目范围
  deliverables: string[];            // 交付要求
  constraints: string[];             // 约束条件
  suggestedTasks: SuggestedTask[];   // AI建议的任务列表
}

/**
 * AI建议的任务
 */
export interface SuggestedTask {
  name: string;
  type: TaskType;
  description: string;
  priority: number;
  dependencies: string[];            // 依赖的任务名称（非ID）
  estimatedDuration?: number;        // 预估时长（分钟）
}

/**
 * AI服务配置
 */
export interface AIConfig {
  provider: AIProvider;
  apiKey?: string;                   // 加密存储
  baseUrl?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  timeout?: number;
}

export type AIProvider = 
  | 'openai'
  | 'claude'
  | 'ollama'
  | 'custom';

/**
 * AI聊天消息
 */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: Date;
}
```

---

### 1.4 蓝图相关模型

```typescript
/**
 * 蓝图数据
 */
export interface BlueprintData {
  projectId: string;
  nodes: BlueprintNode[];
  edges: BlueprintEdge[];
  viewport: ViewportConfig;
  metadata: BlueprintMetadata;
}

/**
 * 蓝图节点
 */
export interface BlueprintNode {
  id: string;                        // 任务ID
  taskId: string;
  position: {
    x: number;
    y: number;
  };
  size: {
    width: number;
    height: number;
  };
  style?: NodeStyle;
}

/**
 * 节点样式
 */
export interface NodeStyle {
  backgroundColor?: string;
  borderColor?: string;
  textColor?: string;
  icon?: string;
}

/**
 * 蓝图连线
 */
export interface BlueprintEdge {
  id: string;
  from: string;                      // 源任务ID
  to: string;                        // 目标任务ID
  type: 'dependency';                // 连线类型
  style?: EdgeStyle;
}

/**
 * 连线样式
 */
export interface EdgeStyle {
  color?: string;
  width?: number;
  lineStyle?: 'solid' | 'dashed';
  arrow?: boolean;
}

/**
 * 视口配置
 */
export interface ViewportConfig {
  x: number;
  y: number;
  zoom: number;
}

/**
 * 蓝图元数据
 */
export interface BlueprintMetadata {
  createdAt: Date;
  updatedAt: Date;
  version: string;
}
```

---

## 2. 数据库Schema (lowdb)

### 2.1 projects.json

```json
{
  "projects": [
    {
      "id": "proj_001",
      "name": "Python代码仓库开发项目",
      "description": "开发一个实现数据处理功能的Python代码仓库",
      "priority": 3,
      "status": "active",
      "config": {
        "localFolderPath": "/Users/kingj/projects/python-repo",
        "gitConfig": {
          "enabled": true,
          "remoteUrl": "https://github.com/username/repo.git",
          "branch": "main",
          "commitMessage": "Auto commit by Stratix"
        },
        "agentMode": "openclaw",
        "planningRule": "sequential",
        "executionPermission": "auto",
        "requirement": {
          "type": "text",
          "content": "开发一个实现数据处理功能的Python代码仓库"
        },
        "progressRule": "average"
      },
      "progress": 33,
      "taskCount": 5,
      "completedTaskCount": 1,
      "zoneConfig": {
        "x": 100,
        "y": 100,
        "width": 800,
        "height": 600,
        "color": 15790320,
        "opacity": 0.3,
        "visible": true
      },
      "createdAt": "2026-03-02T10:00:00Z",
      "updatedAt": "2026-03-02T11:00:00Z",
      "startedAt": "2026-03-02T10:30:00Z"
    }
  ]
}
```

### 2.2 tasks.json

```json
{
  "tasks": [
    {
      "id": "task_001",
      "projectId": "proj_001",
      "name": "需求文档设计",
      "type": "writing",
      "description": "编写项目需求文档",
      "priority": 3,
      "status": "completed",
      "config": {
        "requirementText": "原创撰写一篇Python数据处理教程，语言通俗易懂，包含核心代码示例",
        "executionPermission": "auto",
        "operationScope": "local",
        "typeSpecificConfig": {
          "type": "writing",
          "format": "markdown"
        }
      },
      "dependencies": [],
      "progress": 100,
      "result": {
        "status": "success",
        "outputFiles": [
          "/Users/kingj/projects/python-repo/需求文档.md"
        ],
        "logs": [],
        "completedAt": "2026-03-02T11:00:00Z",
        "duration": 1800000
      },
      "zoneConfig": {
        "x": 120,
        "y": 120,
        "width": 300,
        "height": 200,
        "color": 4900978,
        "opacity": 0.5,
        "visible": true
      },
      "createdAt": "2026-03-02T10:00:00Z",
      "updatedAt": "2026-03-02T11:00:00Z",
      "startedAt": "2026-03-02T10:30:00Z",
      "completedAt": "2026-03-02T11:00:00Z"
    }
  ]
}
```

### 2.3 config.json (系统配置)

```json
{
  "system": {
    "version": "1.0.0",
    "dataPath": "./stratix-data",
    "backupPath": "./stratix-data/backups",
    "backupInterval": 3600000
  },
  "ai": {
    "defaultProvider": "openai",
    "providers": {
      "openai": {
        "apiKey": "sk-...",
        "model": "gpt-4",
        "temperature": 0.7,
        "maxTokens": 4000,
        "timeout": 60000
      },
      "claude": {
        "apiKey": "sk-...",
        "model": "claude-3-opus-20240229",
        "temperature": 0.7,
        "maxTokens": 4000,
        "timeout": 60000
      },
      "ollama": {
        "baseUrl": "http://localhost:11434",
        "model": "llama2",
        "temperature": 0.7,
        "maxTokens": 4000,
        "timeout": 120000
      }
    }
  },
  "agent": {
    "openclaw": {
      "instances": [
        {
          "name": "local",
          "type": "local",
          "path": "/path/to/openclaw"
        }
      ]
    }
  },
  "ui": {
    "theme": "dark",
    "language": "zh-CN",
    "autoSave": true,
    "autoSaveInterval": 60000
  }
}
```

---

## 3. 工具类型与辅助函数

### 3.1 ID生成器

```typescript
/**
 * 生成唯一ID
 */
export function generateId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 9);
  return `${prefix}_${timestamp}_${random}`;
}

// 使用示例
const projectId = generateId('proj'); // proj_m1a2b3c_x9y8z7
const taskId = generateId('task');    // task_n4o5p6q_r8s9t0
```

---

### 3.2 日期工具

```typescript
/**
 * 格式化日期为ISO字符串
 */
export function formatDate(date: Date): string {
  return date.toISOString();
}

/**
 * 解析ISO字符串为Date对象
 */
export function parseDate(dateString: string): Date {
  return new Date(dateString);
}

/**
 * 获取当前时间戳（ISO格式）
 */
export function now(): string {
  return new Date().toISOString();
}
```

---

### 3.3 深拷贝工具

```typescript
/**
 * 深拷贝对象
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}
```

---

### 3.4 验证工具

```typescript
/**
 * 验证优先级
 */
export function validatePriority(priority: number): boolean {
  return Number.isInteger(priority) && priority >= 1 && priority <= 5;
}

/**
 * 验证进度
 */
export function validateProgress(progress: number): boolean {
  return Number.isFinite(progress) && progress >= 0 && progress <= 100;
}

/**
 * 验证项目状态
 */
export function validateProjectStatus(status: string): status is ProjectStatus {
  return ['pending', 'active', 'paused', 'completed', 'failed'].includes(status);
}

/**
 * 验证任务状态
 */
export function validateTaskStatus(status: string): status is TaskStatus {
  return ['pending', 'configured', 'waiting', 'running', 'completed', 'paused', 'failed'].includes(status);
}
```

---

## 4. 数据迁移与版本控制

### 4.1 版本标记

```typescript
/**
 * 数据版本
 */
export interface DataVersion {
  version: string;
  migratedAt: Date;
  changes: string[];
}

/**
 * 当前数据版本
 */
export const CURRENT_DATA_VERSION = '1.0.0';
```

### 4.2 迁移函数

```typescript
/**
 * 数据迁移函数类型
 */
export type MigrationFunction = (data: any) => any;

/**
 * 迁移注册表
 */
export const migrations: Map<string, MigrationFunction> = new Map([
  ['0.9.0_to_1.0.0', migrate_0_9_0_to_1_0_0]
]);

/**
 * 执行数据迁移
 */
export async function migrateData(
  data: any, 
  fromVersion: string, 
  toVersion: string
): Promise<any> {
  // 实现迁移逻辑
}
```

---

## 5. 备份与恢复

### 5.1 备份格式

```typescript
/**
 * 备份数据
 */
export interface BackupData {
  version: string;
  timestamp: Date;
  data: {
    projects: Project[];
    tasks: Task[];
    config: any;
  };
  checksum: string; // MD5校验和
}
```

### 5.2 备份函数

```typescript
/**
 * 创建备份
 */
export async function createBackup(
  dataPath: string
): Promise<string> {
  // 实现备份逻辑
}

/**
 * 恢复备份
 */
export async function restoreBackup(
  backupPath: string
): Promise<void> {
  // 实现恢复逻辑
}
```

---

## 6. 数据关系图

```
Project (1) -----> (N) Task
   |                    |
   |                    |
   v                    v
ProjectConfig      TaskConfig
   |                    |
   |                    |
   v                    v
GitConfig          TypeSpecificConfig
ProjectRequirement    |- WritingTaskConfig
ProgressRule          |- CodingTaskConfig
                      |- DrawingTaskConfig
                      |- VideoTaskConfig
                      |- ResearchTaskConfig
```

---

**文档版本**: v1.0  
**更新日期**: 2026-03-02
