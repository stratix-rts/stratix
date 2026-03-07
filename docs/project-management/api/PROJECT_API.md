# API设计文档 - 项目管理

## 📋 概述

本文档定义项目管理和任务执行的核心API接口。

**基础路径**: `/api/v1`

**认证方式**: 预留JWT认证（当前阶段不需要）

---

## 1. 项目管理 API

### 1.1 创建项目

**接口**: `POST /projects`

**请求体**:
```json
{
  "name": "Python代码仓库开发项目",
  "description": "开发一个数据处理功能的Python代码仓库",
  "priority": 3,
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
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "proj_001",
    "name": "Python代码仓库开发项目",
    "status": "pending",
    "createdAt": "2026-03-02T10:00:00Z",
    "updatedAt": "2026-03-02T10:00:00Z"
  }
}
```

**状态码**:
- `201`: 创建成功
- `400`: 参数错误
- `500`: 服务器错误

---

### 1.2 获取项目列表

**接口**: `GET /projects`

**查询参数**:
- `status`: 按状态筛选 (pending, active, completed, paused)
- `priority`: 按优先级筛选 (1-5)
- `page`: 页码 (默认 1)
- `limit`: 每页数量 (默认 20)

**响应**:
```json
{
  "success": true,
  "data": {
    "projects": [
      {
        "id": "proj_001",
        "name": "Python代码仓库开发项目",
        "priority": 3,
        "status": "active",
        "progress": 33,
        "taskCount": 5,
        "completedTaskCount": 1,
        "createdAt": "2026-03-02T10:00:00Z"
      }
    ],
    "total": 10,
    "page": 1,
    "limit": 20
  }
}
```

---

### 1.3 获取项目详情

**接口**: `GET /projects/:id`

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "proj_001",
    "name": "Python代码仓库开发项目",
    "description": "开发一个数据处理功能的Python代码仓库",
    "priority": 3,
    "status": "active",
    "progress": 33,
    "config": {
      "localFolderPath": "/Users/kingj/projects/python-repo",
      "gitConfig": { ... },
      "agentMode": "openclaw",
      "planningRule": "sequential",
      "executionPermission": "auto",
      "requirement": { ... },
      "progressRule": "average"
    },
    "tasks": [
      {
        "id": "task_001",
        "name": "需求文档设计",
        "type": "writing",
        "status": "completed",
        "progress": 100
      }
    ],
    "createdAt": "2026-03-02T10:00:00Z",
    "updatedAt": "2026-03-02T11:00:00Z"
  }
}
```

---

### 1.4 更新项目配置

**接口**: `PUT /projects/:id`

**请求体**:
```json
{
  "name": "Python代码仓库开发项目 V2",
  "priority": 2,
  "executionPermission": "confirm"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "proj_001",
    "name": "Python代码仓库开发项目 V2",
    "priority": 2,
    "executionPermission": "confirm",
    "updatedAt": "2026-03-02T12:00:00Z"
  }
}
```

---

### 1.5 删除项目

**接口**: `DELETE /projects/:id`

**查询参数**:
- `deleteTasks`: 是否同时删除任务 (true/false, 默认 false)

**响应**:
```json
{
  "success": true,
  "message": "项目已删除"
}
```

---

### 1.6 启动项目

**接口**: `POST /projects/:id/start`

**响应**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj_001",
    "status": "active",
    "startedAt": "2026-03-02T10:00:00Z"
  }
}
```

---

### 1.7 暂停项目

**接口**: `POST /projects/:id/pause`

**响应**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj_001",
    "status": "paused",
    "pausedAt": "2026-03-02T10:00:00Z"
  }
}
```

---

### 1.8 恢复项目

**接口**: `POST /projects/:id/resume`

**响应**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj_001",
    "status": "active",
    "resumedAt": "2026-03-02T10:00:00Z"
  }
}
```

---

### 1.9 批量更新项目

**接口**: `POST /projects/batch-update`

**请求体**:
```json
{
  "projectIds": ["proj_001", "proj_002"],
  "updates": {
    "priority": 2,
    "executionPermission": "confirm"
  }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "updatedCount": 2,
    "updatedProjects": ["proj_001", "proj_002"]
  }
}
```

---

## 2. 任务管理 API

### 2.1 创建任务

**接口**: `POST /tasks`

**请求体**:
```json
{
  "projectId": "proj_001",
  "name": "需求文档设计",
  "type": "writing",
  "description": "编写项目需求文档",
  "priority": 3,
  "requirementText": "原创撰写一篇Python数据处理教程，语言通俗易懂，包含核心代码示例",
  "executionPermission": "auto",
  "dependencies": []
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "task_001",
    "name": "需求文档设计",
    "type": "writing",
    "status": "pending",
    "createdAt": "2026-03-02T10:00:00Z"
  }
}
```

---

### 2.2 获取任务列表

**接口**: `GET /tasks`

**查询参数**:
- `projectId`: 按项目筛选
- `type`: 按任务类型筛选
- `status`: 按状态筛选
- `page`: 页码
- `limit`: 每页数量

**响应**:
```json
{
  "success": true,
  "data": {
    "tasks": [
      {
        "id": "task_001",
        "name": "需求文档设计",
        "projectId": "proj_001",
        "type": "writing",
        "status": "completed",
        "progress": 100,
        "priority": 3,
        "dependencies": [],
        "createdAt": "2026-03-02T10:00:00Z"
      }
    ],
    "total": 5,
    "page": 1,
    "limit": 20
  }
}
```

---

### 2.3 获取任务详情

**接口**: `GET /tasks/:id`

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "task_001",
    "projectId": "proj_001",
    "name": "需求文档设计",
    "type": "writing",
    "description": "编写项目需求文档",
    "status": "completed",
    "progress": 100,
    "priority": 3,
    "requirementText": "原创撰写一篇Python数据处理教程...",
    "executionPermission": "auto",
    "dependencies": [],
    "result": {
      "status": "success",
      "outputFiles": [
        "/Users/kingj/projects/python-repo/需求文档.md"
      ],
      "completedAt": "2026-03-02T11:00:00Z"
    },
    "createdAt": "2026-03-02T10:00:00Z",
    "updatedAt": "2026-03-02T11:00:00Z"
  }
}
```

---

### 2.4 更新任务配置

**接口**: `PUT /tasks/:id`

**请求体**:
```json
{
  "name": "需求文档设计 V2",
  "requirementText": "更新后的需求描述",
  "priority": 2
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "id": "task_001",
    "name": "需求文档设计 V2",
    "requirementText": "更新后的需求描述",
    "priority": 2,
    "updatedAt": "2026-03-02T12:00:00Z"
  }
}
```

---

### 2.5 删除任务

**接口**: `DELETE /tasks/:id`

**响应**:
```json
{
  "success": true,
  "message": "任务已删除"
}
```

---

### 2.6 设置任务依赖

**接口**: `POST /tasks/:id/dependencies`

**请求体**:
```json
{
  "dependencies": ["task_001", "task_002"]
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "taskId": "task_003",
    "dependencies": ["task_001", "task_002"]
  }
}
```

---

### 2.7 手动触发任务执行

**接口**: `POST /tasks/:id/execute`

**响应**:
```json
{
  "success": true,
  "data": {
    "taskId": "task_001",
    "status": "running",
    "startedAt": "2026-03-02T10:00:00Z"
  }
}
```

---

### 2.8 取消任务执行

**接口**: `POST /tasks/:id/cancel`

**响应**:
```json
{
  "success": true,
  "data": {
    "taskId": "task_001",
    "status": "paused",
    "cancelledAt": "2026-03-02T10:00:00Z"
  }
}
```

---

### 2.9 获取任务执行日志

**接口**: `GET /tasks/:id/logs`

**响应**:
```json
{
  "success": true,
  "data": {
    "taskId": "task_001",
    "logs": [
      {
        "timestamp": "2026-03-02T10:00:00Z",
        "level": "info",
        "message": "任务开始执行"
      },
      {
        "timestamp": "2026-03-02T10:05:00Z",
        "level": "info",
        "message": "正在撰写文档..."
      },
      {
        "timestamp": "2026-03-02T11:00:00Z",
        "level": "success",
        "message": "任务完成"
      }
    ]
  }
}
```

---

## 3. AI服务 API

### 3.1 解析需求

**接口**: `POST /ai/parse-requirement`

**请求体**:
```json
{
  "projectId": "proj_001",
  "requirement": {
    "type": "text",
    "content": "开发一个实现数据处理功能的Python代码仓库"
  }
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj_001",
    "parsedRequirement": {
      "projectType": "coding",
      "objectives": [
        "实现数据处理功能",
        "构建Python代码仓库"
      ],
      "scope": [
        "数据读取",
        "数据清洗",
        "数据导出"
      ],
      "deliverables": [
        "可运行的Python代码",
        "使用文档"
      ],
      "suggestedTasks": [
        {
          "name": "需求文档设计",
          "type": "writing",
          "description": "编写项目需求文档",
          "priority": 3,
          "dependencies": []
        },
        {
          "name": "数据读取模块开发",
          "type": "coding",
          "description": "实现数据读取功能",
          "priority": 3,
          "dependencies": ["需求文档设计"]
        }
      ]
    }
  }
}
```

---

### 3.2 拆分任务

**接口**: `POST /ai/split-tasks`

**请求体**:
```json
{
  "projectId": "proj_001",
  "parsedRequirement": { ... },
  "planningRule": "sequential"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj_001",
    "tasks": [
      {
        "id": "task_001",
        "name": "需求文档设计",
        "type": "writing",
        "description": "编写项目需求文档",
        "priority": 3,
        "dependencies": []
      },
      {
        "id": "task_002",
        "name": "数据读取模块开发",
        "type": "coding",
        "description": "实现数据读取功能",
        "priority": 3,
        "dependencies": ["task_001"]
      }
    ],
    "dependencyGraph": {
      "task_001": [],
      "task_002": ["task_001"]
    }
  }
}
```

---

### 3.3 流式响应 (WebSocket)

**接口**: `WS /ws/ai-stream`

**连接示例**:
```javascript
const ws = new WebSocket('ws://localhost:8080/ws/ai-stream');

ws.onopen = () => {
  ws.send(JSON.stringify({
    type: 'parse_requirement',
    projectId: 'proj_001',
    requirement: { ... }
  }));
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('AI响应:', data.chunk);
};
```

**消息格式**:
```json
{
  "type": "chunk",
  "projectId": "proj_001",
  "chunk": "正在解析需求..."
}
```

---

## 4. 文件管理 API

### 4.1 上传文件

**接口**: `POST /files/upload`

**请求体**: `multipart/form-data`

**字段**:
- `file`: 文件
- `projectId`: 项目ID (可选)
- `taskId`: 任务ID (可选)

**响应**:
```json
{
  "success": true,
  "data": {
    "fileId": "file_001",
    "fileName": "需求文档.md",
    "filePath": "/uploads/proj_001/需求文档.md",
    "fileSize": 1024,
    "uploadedAt": "2026-03-02T10:00:00Z"
  }
}
```

---

### 4.2 下载文件

**接口**: `GET /files/:id/download`

**响应**: 文件流

---

### 4.3 获取项目成果清单

**接口**: `GET /projects/:id/results`

**响应**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj_001",
    "totalTasks": 5,
    "completedTasks": 5,
    "results": [
      {
        "taskId": "task_001",
        "taskName": "需求文档设计",
        "outputFiles": [
          "/Users/kingj/projects/python-repo/需求文档.md"
        ],
        "completedAt": "2026-03-02T11:00:00Z"
      }
    ],
    "manifestPath": "/Users/kingj/projects/python-repo/成果汇总清单.md"
  }
}
```

---

## 5. Git操作 API (阶段4)

### 5.1 初始化仓库

**接口**: `POST /git/init`

**请求体**:
```json
{
  "projectId": "proj_001",
  "repoPath": "/Users/kingj/projects/python-repo"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj_001",
    "repoPath": "/Users/kingj/projects/python-repo",
    "initialized": true
  }
}
```

---

### 5.2 提交代码

**接口**: `POST /git/commit`

**请求体**:
```json
{
  "projectId": "proj_001",
  "taskId": "task_001",
  "files": [
    "需求文档.md",
    "README.md"
  ],
  "message": "完成需求文档编写"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "commitHash": "a1b2c3d4e5f6",
    "projectId": "proj_001",
    "taskId": "task_001",
    "committedFiles": 2,
    "committedAt": "2026-03-02T11:00:00Z"
  }
}
```

---

### 5.3 推送到远程

**接口**: `POST /git/push`

**请求体**:
```json
{
  "projectId": "proj_001",
  "branch": "main"
}
```

**响应**:
```json
{
  "success": true,
  "data": {
    "projectId": "proj_001",
    "branch": "main",
    "pushedCommits": 3,
    "pushedAt": "2026-03-02T11:00:00Z"
  }
}
```

---

## 6. WebSocket实时通信

### 6.1 连接

**接口**: `WS /ws`

**心跳**: 每30秒发送 `ping` 消息

### 6.2 订阅项目更新

**发送**:
```json
{
  "type": "subscribe",
  "channel": "project:proj_001"
}
```

**接收**:
```json
{
  "type": "project:updated",
  "data": {
    "id": "proj_001",
    "progress": 50,
    "updatedAt": "2026-03-02T10:00:00Z"
  }
}
```

### 6.3 订阅任务进度

**发送**:
```json
{
  "type": "subscribe",
  "channel": "task:task_001"
}
```

**接收**:
```json
{
  "type": "task:progress",
  "data": {
    "id": "task_001",
    "progress": 75,
    "message": "正在撰写文档..."
  }
}
```

---

## 7. 错误处理

### 统一错误格式

```json
{
  "success": false,
  "error": {
    "code": "PROJECT_NOT_FOUND",
    "message": "项目不存在",
    "details": {
      "projectId": "proj_999"
    }
  }
}
```

### 错误代码表

| 错误代码 | 说明 | HTTP状态码 |
|---------|------|----------|
| `PROJECT_NOT_FOUND` | 项目不存在 | 404 |
| `TASK_NOT_FOUND` | 任务不存在 | 404 |
| `INVALID_PARAMETER` | 参数错误 | 400 |
| `DEPENDENCY_NOT_MET` | 依赖未满足 | 400 |
| `AI_SERVICE_ERROR` | AI服务错误 | 500 |
| `FILE_UPLOAD_FAILED` | 文件上传失败 | 500 |
| `GIT_OPERATION_FAILED` | Git操作失败 | 500 |

---

## 8. API版本控制

**当前版本**: `v1`

**版本策略**:
- URL路径版本控制: `/api/v1/...`
- 向后兼容的小版本更新不改变URL
- 破坏性更新发布新版本 `/api/v2/...`

---

## 9. 性能优化

### 缓存策略
- 项目列表: 缓存5分钟
- 项目详情: 缓存1分钟
- 任务列表: 不缓存

### 分页
- 默认每页20条
- 最大每页100条

### 批量操作
- 批量更新项目: 最多50个项目
- 批量创建任务: 最多50个任务

---

## 10. 安全性

### CORS配置
```javascript
{
  "origin": ["http://localhost:3000"],
  "methods": ["GET", "POST", "PUT", "DELETE"],
  "allowedHeaders": ["Content-Type", "Authorization"]
}
```

### 输入验证
- 所有输入使用 `class-validator` 进行验证
- 防止SQL注入
- 防止XSS攻击

### 文件上传限制
- 最大文件大小: 10MB
- 允许的文件类型: `.md`, `.txt`, `.json`, `.py`, `.js`, `.ts`, etc.

---

**文档版本**: v1.0  
**更新日期**: 2026-03-02
