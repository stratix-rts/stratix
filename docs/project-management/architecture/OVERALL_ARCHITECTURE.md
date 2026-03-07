# 总体架构设计

## 🏗️ 架构概览

RTS指挥AI Agent的项目管理功能采用**分层架构 + 模块化设计**，确保系统可扩展、易维护。

```
┌─────────────────────────────────────────────────────────┐
│                    前端展示层 (Frontend)                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  RTS游戏界面  │  │  蓝图编辑器   │  │  配置面板    │ │
│  │  (Phaser 3)  │  │  (Canvas)    │  │  (Vue 3)    │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                         ↓ 事件总线 (EventBus)
┌─────────────────────────────────────────────────────────┐
│                    业务逻辑层 (Business Logic)           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 项目管理器    │  │ 任务拆分器    │  │ 任务执行器   │ │
│  │ProjectManager│  │TaskSplitter │  │TaskExecutor │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                         ↓ 接口调用
┌─────────────────────────────────────────────────────────┐
│                    服务层 (Services)                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  AI服务      │  │  Git服务     │  │  文件服务    │ │
│  │  AIService   │  │  GitService  │  │ FileService │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                         ↓ 数据持久化
┌─────────────────────────────────────────────────────────┐
│                    数据访问层 (Data Access)              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ 项目存储      │  │ 任务存储      │  │ 配置存储     │ │
│  │ProjectStore  │  │ TaskStore    │  │ ConfigStore │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└─────────────────────────────────────────────────────────┘
                         ↓
┌─────────────────────────────────────────────────────────┐
│                    底层存储 (Storage)                    │
│               lowdb (JSON文件存储)                      │
└─────────────────────────────────────────────────────────┘
```

---

## 🎯 核心设计原则

### 1. 项目为核心 (Project-Centric)
- 所有操作围绕项目展开
- 任务区作为项目的子执行单元
- 统一配置，继承机制

### 2. AI主导 (AI-Driven)
- AI自动拆分任务
- AI设置依赖关系
- AI分配优先级

### 3. 用户可管控 (User-Controlled)
- 用户可微调AI规划
- 用户可手动新增任务
- 用户可批量配置

### 4. 可扩展 (Extensible)
- 模块化设计
- 插件式AI服务
- 预留扩展接口

---

## 📦 核心模块划分

### 1. stratix-project (项目管理模块)
**职责**: 项目的创建、配置、管理

**核心类**:
- `ProjectZone`: 项目区可视化对象（继承Phaser.GameObjects.Container）
- `ProjectManager`: 项目管理器（CRUD操作）
- `ProjectConfig`: 项目配置类
- `TaskDependency`: 任务依赖关系管理

**位置**: `src/stratix-project/`

---

### 2. stratix-task (任务模块)
**职责**: 任务区的创建、配置、管理

**核心类**:
- `TaskZone`: 任务区可视化对象（重构现有类）
- `TaskManager`: 任务管理器
- `TaskTypeRegistry`: 任务类型注册表
- `TaskExecutor`: 任务执行器

**位置**: `src/stratix-task/`

---

### 3. stratix-ai-service (AI服务模块)
**职责**: AI服务的统一接口，支持多种LLM

**核心类**:
- `AIServiceProvider`: AI服务提供者接口
- `OpenAIProvider`: OpenAI实现
- `ClaudeProvider`: Anthropic Claude实现
- `OllamaProvider`: 本地LLM实现
- `RequirementParser`: 需求解析器
- `TaskSplitter`: 任务拆分器

**位置**: `src/stratix-ai-service/`

---

### 4. stratix-blueprint (蓝图编辑器模块)
**职责**: 项目蓝图的显示与编辑

**核心类**:
- `BlueprintCanvas`: 蓝图画布
- `TaskNode`: 任务节点
- `DependencyLine`: 依赖关系连线
- `BlueprintController`: 蓝图控制器

**位置**: `src/stratix-blueprint/`

---

### 5. stratix-task-executor (任务执行引擎)
**职责**: 任务的执行、进度跟踪、成果收集

**核心类**:
- `TaskExecutor`: 任务执行器
- `ProgressTracker`: 进度跟踪器
- `ResultCollector`: 成果收集器
- `ExecutionQueue`: 执行队列

**位置**: `src/stratix-task-executor/`

---

### 6. stratix-git-sync (Git协同模块，阶段4)
**职责**: Git操作的封装与管理

**核心类**:
- `GitManager`: Git管理器
- `CommitService`: 提交服务
- `BranchManager`: 分支管理
- `ConflictResolver`: 冲突解决（预留）

**位置**: `src/stratix-git-sync/`

---

### 7. stratix-config-panel (配置面板模块)
**职责**: 项目和任务区的配置界面

**核心类**:
- `ProjectConfigPanel`: 项目配置面板
- `TaskConfigPanel`: 任务配置面板
- `TaskTypePanel`: 任务类型配置面板
- `BatchConfigPanel`: 批量配置面板

**位置**: `src/stratix-config-panel/`

---

## 🔄 数据流向

### 1. 项目创建流程
```
用户画框 → ProjectZone创建 → 弹出配置面板 → 
用户配置 → 保存到ProjectStore → 更新UI
```

### 2. AI任务拆分流程
```
用户提交需求 → RequirementParser解析 → 
TaskSplitter拆分 → 生成TaskZone列表 → 
设置依赖关系 → 展示蓝图预览 → 用户确认
```

### 3. 任务执行流程
```
项目启动 → ExecutionQueue排序 → 
TaskExecutor执行 → ProgressTracker跟踪 → 
ResultCollector收集 → 更新UI → 完成
```

---

## 🔌 模块间通信

### 事件总线 (EventBus)
使用 `mitt` 库实现全局事件总线

**核心事件**:
```typescript
// 项目事件
'project:created'      // 项目创建
'project:updated'      // 项目更新
'project:deleted'      // 项目删除
'project:started'      // 项目启动

// 任务事件
'task:created'         // 任务创建
'task:started'         // 任务开始
'task:progress'        // 任务进度
'task:completed'       // 任务完成
'task:failed'          // 任务失败

// AI事件
'ai:parse:start'       // AI解析开始
'ai:parse:complete'    // AI解析完成
'ai:split:start'       // AI拆分开始
'ai:split:complete'    // AI拆分完成
```

### WebSocket通信（与后端）
用于实时进度同步和Agent通信

---

## 🎨 UI层架构

### Phaser 3场景划分

#### 1. StratixRTSGameScene (主场景)
- 地图显示
- 项目区渲染
- 任务区渲染
- 拖拽交互

#### 2. StratixRTSUIScene (UI场景)
- 配置面板
- 按钮控件
- 提示信息

#### 3. BlueprintScene (蓝图场景，新增)
- 蓝图画布
- 任务节点
- 依赖连线
- 微调交互

---

## 💾 数据持久化

### lowdb数据结构
```json
{
  "projects": [
    {
      "id": "proj_001",
      "name": "Python代码仓库开发",
      "priority": 3,
      "status": "active",
      "config": { ... },
      "tasks": [ ... ],
      "createdAt": "2026-03-02T10:00:00Z",
      "updatedAt": "2026-03-02T11:00:00Z"
    }
  ],
  "tasks": [ ... ],
  "config": { ... }
}
```

### 文件组织
```
stratix-data/
├── projects.json       # 项目数据
├── tasks.json         # 任务数据
├── config.json        # 系统配置
└── backups/           # 备份目录
    ├── projects_20260302.json
    └── tasks_20260302.json
```

---

## 🔐 权限与安全

### 本地文件访问
- 仅允许访问用户指定的文件夹
- 路径验证，防止目录穿越
- 敏感操作需要用户确认

### Git操作权限
- 读取仓库信息需要确认
- 提交代码需要用户审核
- 推送到远程需要明确授权

---

## 📊 性能优化

### 渲染优化
- 项目区/任务区使用对象池（ObjectPool）
- 视口裁剪（Viewport Culling）
- LOD (Level of Detail)

### 数据优化
- 分页加载（项目数量多时）
- 虚拟滚动（任务列表）
- 增量更新（WebSocket）

---

## 🧪 测试策略

### 单元测试
- 核心逻辑单元测试覆盖率 > 70%
- Jest + TypeScript

### 集成测试
- Playwright E2E测试
- 覆盖核心用户流程

### 性能测试
- 100个项目 + 500个任务的性能基准
- 内存占用监控

---

## 🚀 部署架构

### 开发环境
```
前端 (Vite Dev Server)  →  后端 (Express + WebSocket)  →  lowdb
     :3000                     :8080
```

### 生产环境
```
前端 (静态文件)  →  CDN
                  ↓
             Nginx反向代理
                  ↓
         后端 (Node.js Cluster)  →  lowdb (持久化存储)
```

---

## 📚 技术栈总结

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| **前端框架** | Vue 3 | 组件化UI |
| **游戏引擎** | Phaser 3 | RTS可视化 |
| **构建工具** | Vite | 快速开发 |
| **编程语言** | TypeScript | 类型安全 |
| **状态管理** | mitt (EventBus) | 事件驱动 |
| **数据存储** | lowdb | JSON文件 |
| **实时通信** | WebSocket | 进度同步 |
| **后端框架** | Express | API服务 |
| **测试框架** | Jest + Playwright | 单元+E2E |
| **代码规范** | ESLint + Prettier | 代码质量 |

---

## 🔄 后续扩展

### 微服务化（未来）
- 项目服务
- 任务服务
- AI服务
- 执行服务

### 数据库迁移（未来）
- SQLite → PostgreSQL
- 支持集群部署

### 云原生（未来）
- Docker容器化
- Kubernetes编排
- 水平扩展

---

**文档版本**: v1.0  
**更新日期**: 2026-03-02
