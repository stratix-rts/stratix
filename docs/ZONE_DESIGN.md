# Zone 设计文档

## 概述

Zone 是 Stratix 中的核心协作单元，代表一个项目区域，可以包含聊天、文件、任务和 Agent。Zone 通过标题、提示词和上下文文件来定义其功能，Agent 能够感知 Zone 的变化并自主调整工作策略。

## 核心概念

### Zone 作为动态上下文容器

```
Zone = 标题 + 提示词 + 上下文文件
```

- **标题**: Zone 的名称，如"需求调研区"、"代码开发区"
- **提示词**: Zone 的角色定义，指导 Agent 如何工作
- **上下文文件**: Zone 关联的文件，包括本地文件和互联网资源

### Zone 的动态性

Zone 不是固定的工作模式，而是可以根据项目演进动态调整：

```
调研区 → 研发区 → 运营区
   ↓        ↓         ↓
收集需求  基于需求   项目运营
         开发代码    发帖海报
```

用户可以通过修改标题和提示词来改变 Zone 的功能，Agent 会感知变化并调整工作策略。

## 数据结构

### Zone 接口

```typescript
interface Zone {
  id: string
  projectId: string
  title: string                    // Zone 标题
  prompt: string                  // Zone 提示词/角色定义
  files: ZoneFile[]              // 上下文文件列表
  members: string[]               // 当前在 Zone 内的 Agent ID 列表
  createdAt: number
  updatedAt: number
}
```

### ZoneFile 接口

```typescript
interface ZoneFile {
  id: string
  name: string                    // 显示名称: "需求文档.md"
  sourceType: 'local' | 'url'
  source: string                 // 本地路径或 URL
  content?: string               // 缓存的内容
  fileType?: FileType
  lastFetched?: number          // 最后抓取时间
  metadata?: {
    size?: number
    mimeType?: string
    [key: string]: any
  }
}

type FileType = 'md' | 'txt' | 'ts' | 'js' | 'fig' | 'image' | 'link' | 'folder' | 'other'
```

### Project 接口（更新）

```typescript
interface Project {
  id: string
  name: string
  description?: string
  status: ProjectStatus
  zones: Zone[]                  // 项目下的所有 Zone
  agents: string[]              // 项目下的所有 Agent
  createdAt: number
  updatedAt: number
}

type ProjectStatus = 'active' | 'completed' | 'archived'
```

## 文件处理

### 文件类型

| 类型 | sourceType | 说明 | 内容获取 |
|------|------------|------|----------|
| 本地文件 | local | 本地文件系统路径 | 直接读取 |
| 本地文件夹 | local | 目录路径 | 扫描索引 |
| HTTP URL | url | 网页链接 | HTTP 请求抓取 |
| Figma | url | Figma 文件链接 | Figma API |
| GitHub | url | GitHub 仓库/文件 | GitHub API |

### 文件内容同步策略

```typescript
interface FileSyncStrategy {
  // 本地文件：监控文件变化，实时同步
  watchLocalFiles: boolean

  // 互联网文件：定时抓取或按需抓取
  urlFetchInterval?: number     // 抓取间隔（毫秒）
  urlFetchOnAccess?: boolean    // 访问时抓取

  // 缓存策略
  cacheContent: boolean
  cacheExpiry?: number         // 缓存过期时间
}
```

### 文件操作

```typescript
// 添加文件到 Zone
interface AddFileRequest {
  zoneId: string
  file: Omit<ZoneFile, 'id'>
}

// 从 Zone 移除文件
interface RemoveFileRequest {
  zoneId: string
  fileId: string
}

// 更新文件内容（重新抓取）
interface RefreshFileRequest {
  zoneId: string
  fileId: string
}

// 扫描本地文件夹
interface ScanFolderRequest {
  folderPath: string
  recursive?: boolean
  extensions?: string[]         // 过滤扩展名
}
```

## API 设计

### Zone 管理

```
POST   /api/projects/:projectId/zones              创建 Zone
GET    /api/projects/:projectId/zones              获取所有 Zone
GET    /api/projects/:projectId/zones/:zoneId      获取单个 Zone
PUT    /api/projects/:projectId/zones/:zoneId      更新 Zone
DELETE /api/projects/:projectId/zones/:zoneId      删除 Zone
```

### Zone 文件管理

```
POST   /api/projects/:projectId/zones/:zoneId/files           添加文件
DELETE /api/projects/:projectId/zones/:zoneId/files/:fileId  移除文件
POST   /api/projects/:projectId/zones/:zoneId/files/:fileId/refresh  刷新文件内容
POST   /api/projects/:projectId/zones/:zoneId/files/scan-folder  扫描文件夹
```

### Zone 成员管理

```
POST   /api/projects/:projectId/zones/:zoneId/members/:agentId  Agent 进入 Zone
DELETE /api/projects/:projectId/zones/:zoneId/members/:agentId  Agent 离开 Zone
```

### 请求/响应示例

```typescript
// 创建 Zone
POST /api/projects/proj-123/zones
Request: {
  title: "需求调研区",
  prompt: "这里是需求调研区域，收集整理用户需求、市场分析和竞品信息。"
}
Response: {
  success: true,
  zone: Zone
}

// 添加文件
POST /api/projects/proj-123/zones/zone-456/files
Request: {
  name: "需求文档.md",
  sourceType: "local",
  source: "/Users/xxx/project/docs/需求.md"
}
Response: {
  success: true,
  file: ZoneFile
}

// 扫描文件夹
POST /api/projects/proj-123/zones/zone-456/files/scan-folder
Request: {
  folderPath: "/Users/xxx/project/src",
  recursive: true,
  extensions: [".ts", ".tsx", ".md"]
}
Response: {
  success: true,
  files: ZoneFile[]
}
```

## Agent 与 Zone 的交互

### Agent 感知 Zone 变化

```typescript
interface ZoneContext {
  zone: Zone
  availableFiles: ZoneFile[]   // Agent 可读取的文件
  otherAgents: string[]       // 同一 Zone 的其他 Agent
}

// Agent 进入 Zone 时获取上下文
interface JoinZoneResponse {
  context: ZoneContext
  recentMessages: ChatMessage[]  // 最近的消息
  tasks: Task[]                  //  Zone 的任务（如果有）
}
```

### Agent 的自主决策

Agent 读取 Zone 的提示词和文件后，自主决定：

1. **是否需要补充资料** → 文件不足时主动收集
2. **当前工作方向** → 根据提示词理解 Zone 角色
3. **产出目标** → 将结果写入 Zone 的文件

### Agent 进入/离开 Zone 的触发

```typescript
// 主动进入
Agent空闲时浏览 Zone 列表 → 选择感兴趣的 Zone → 进入

// 被动进入
用户拖拽 Agent 到 Zone → Agent 收到通知 → 进入

// 主动离开
Agent 任务完成 → 询问下一步方向 → 决定是否留在当前 Zone

// 被动离开
用户拖拽 Agent 离开 Zone → Agent 收到通知 → 离开
```

## 数据库设计

### SQLite Schema

```sql
-- Zones 表
CREATE TABLE zones (
  zone_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  title TEXT NOT NULL,
  prompt TEXT,
  members TEXT DEFAULT '[]',      -- JSON array of agent IDs
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(project_id) ON DELETE CASCADE
);

-- Zone Files 表
CREATE TABLE zone_files (
  file_id TEXT PRIMARY KEY,
  zone_id TEXT NOT NULL,
  name TEXT NOT NULL,
  source_type TEXT NOT NULL CHECK (source_type IN ('local', 'url')),
  source TEXT NOT NULL,
  content TEXT,
  file_type TEXT,
  last_fetched INTEGER,
  metadata TEXT,                  -- JSON
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (zone_id) REFERENCES zones(zone_id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX idx_zones_project_id ON zones(project_id);
CREATE INDEX idx_zone_files_zone_id ON zone_files(zone_id);
```

## 前端组件

### Zone 列表组件

显示项目中所有 Zone，支持：
- 创建新 Zone
- 显示 Zone 成员数量
- 显示 Zone 类型/状态
- 点击进入 Zone 详情

### Zone 详情组件

显示单个 Zone 的完整信息：
- Zone 标题和提示词（可编辑）
- 文件列表（添加/移除/刷新）
- 成员列表（显示/管理）
- Zone 内的聊天记录（如果有）

### Zone 文件选择器

支持添加文件到 Zone：
- 本地文件：文件树选择器
- 本地文件夹：目录选择器
- URL：链接输入框

### Zone 编辑器

编辑 Zone 基本信息：
- 标题输入
- 提示词编辑器（支持多行）
- 预览 Agent 将看到的上下文

## 实现优先级

### Phase 1: 核心功能
1. Zone CRUD API
2. Zone 数据库存储
3. Zone 文件管理（本地文件）
4. 基本 UI 组件

### Phase 2: 扩展功能
1. URL 文件抓取
2. Agent 进入/离开 Zone
3. Zone 成员管理 UI

### Phase 3: 增强功能
1. 文件夹扫描
2. 文件内容缓存
3. 文件变化监控

## 注意事项

1. **文件路径安全**: 本地文件路径需要验证在允许范围内
2. **URL 抓取限制**: 需要限制抓取的域名/类型，防止 SSRF
3. **大文件处理**: 大文件需要分块读取或流式处理
4. **缓存策略**: 合理缓存避免重复抓取
5. **离线支持**: 本地文件支持离线访问

---

# Zone 系统无限优化路线图

## 核心优化原则

1. **数据驱动**: 每个优化都有指标衡量效果
2. **Agent First**: 优先增强 Agent 自主性，而非堆砌 UI 功能
3. **渐进式**: 先跑通核心流程，再逐步完善

---

## 第一层：Agent 自主性增强

**当前状态**: Agent 被动响应，需要用户拖拽或调用 API

**优化方向**:
- **自主 Zone 进入**: 在 Agent System Prompt 中注入 Zone 列表，Agent 可根据自身目标自主选择进入/离开 Zone
- **OKR 感知**: Agent 能理解 Zone 的 O/KR，自动调整自身任务优先级
- **Task 自动分解**: Agent 收到 Zone 任务后，自动分解为子任务并创建
- **跨 Zone 协作**: Agent 之间可以跨 Zone 发送消息、委托任务

---

## 第二层：Zone 软硬件联动

**优化方向**:
- **RTS 物理反馈**: Agent 进入 Zone 后在 RTS 中有移动动画、视觉变化
- **Agent 状态同步**: Agent 在 Zone 内工作时，RTS 显示忙碌状态
- **热力图**: 统计 Zone 内 Agent 活跃度，生成工作分布图

---

## 第三层：数据持久化与恢复

**优化方向**:
- **Zone 版本历史**: 每次编辑生成快照，支持回滚
- **软删除回收站**: 已删除 Zone 可恢复
- **Zone 模板**: 将 Zone 导出为模板，快速创建相似 Zone
- **数据资产沉淀**: Zone 删除后，文件/消息/任务作为历史存档保留

---

## 第四层：实时协作增强

**优化方向**:
- **多人同时编辑 Zone**: CRDT 算法支持多人协作
- **实时 cursors**: 显示其他用户在 Zone 面板的位置
- **评论/标注**: 在 Zone 内容上添加评论
- **变更历史**: 谁、何时、改了什么的完整日志

---

## 第五层：性能优化

**优化方向**:
- **Zone 懒加载**: 大型项目中 Zone 数量多时，按视口加载
- **WebSocket 批量推送**: 高频事件合并推送，减少网络开销
- **本地缓存**: ZoneDetail 面板数据本地缓存，离线可读
- **数据库索引优化**: zone_contexts 的 project_id、deleted_at 索引

---

## 第六层：UI/UX 打磨

**优化方向**:
- **Zone 面板抽屉**: 右侧抽屉式面板，不遮挡 RTS 视图
- **拖拽排序 Task**: 任务可拖拽调整优先级
- **Zone 概览 Dashboard**: 所有 Zone 的 OKR 进度一览
- **快捷键**: ⌘+1/2/3 快速打开指定 Zone
- **空白状态**: 新建 Zone 时的引导流程

---

## 第七层：生态扩展

**优化方向**:
- **Zone 插件市场**: 分享/导入社区创建的 Zone 模板
- **与外部工具集成**: Zapier/Make 连接外部 API
- **API 开放**: 提供公开 API 供外部系统调用 Zone 功能
- **Webhook**: Zone 事件触发外部 webhook

---

## Zone 演进路线图

```
Level 1: 工具 → Zone 是存储空间
Level 2: 组织 → Zone 是协作场所
Level 3: 社区 → Zone 是社会网络
Level 4: 经济 → Zone 是市场
Level 5: 文明 → Zone 是文化载体
Level 6: 生命 → Zone 是意识体
Level 7: 宇宙 → Zone 是世界
```

---

## 近期优化优先级

| 优先级 | 优化项 | 状态 |
|--------|--------|------|
| P0 | 软删除 + RTS 刷新同步 | ✅ 已完成 |
| P1 | API 补全（批量操作、分页）| ⏳ 进行中 |
| P1 | StatusSync 事件推送 | ⏳ 进行中 |
| P2 | UI 打磨（Task 拖拽、Message 时间轴）| 待开始 |
| P2 | 回收站 UI | 待开始 |
| P3 | 数据库索引优化 | 待开始 |
