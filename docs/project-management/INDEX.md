# 文档索引

## 📚 完整文档列表

本索引列出了所有项目管理功能的文档，方便快速查找。

---

## 🎯 快速导航

### 我是产品经理/项目经理
- [项目总结](./SUMMARY.md) - 了解整体规划
- [快速开始指南](./QUICK_START.md) - 5分钟了解系统
- [阶段1-5 README](./phase1/README.md) - 了解每个阶段的价值

### 我是开发工程师
- [快速开始指南](./QUICK_START.md) - 开发流程
- [总体架构设计](./architecture/OVERALL_ARCHITECTURE.md) - 技术架构
- [模块设计](./architecture/MODULE_DESIGN.md) - 模块职责
- [阶段任务清单](./phase1/TASK_LIST.md) - 具体任务

### 我是测试工程师
- [核心数据模型](./data-models/CORE_MODELS.md) - 数据结构
- [API文档](./api/PROJECT_API.md) - 接口规范
- [阶段技术设计](./phase1/TECHNICAL_DESIGN.md) - 测试要点

### 我是运维工程师
- [总体架构](./architecture/OVERALL_ARCHITECTURE.md) - 部署架构
- [数据模型](./data-models/DATABASE_SCHEMA.md) - 数据存储
- [API文档](./api/PROJECT_API.md) - 服务接口

---

## 📖 文档分类

### 1. 总体文档

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **项目总README** | [README.md](./README.md) | 项目整体介绍 |
| **项目总结** | [SUMMARY.md](./SUMMARY.md) | 项目规划和总结 |
| **快速开始指南** | [QUICK_START.md](./QUICK_START.md) | 5分钟快速上手 |

---

### 2. 架构文档

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **总体架构设计** | [architecture/OVERALL_ARCHITECTURE.md](./architecture/OVERALL_ARCHITECTURE.md) | 整体技术架构 |
| **模块设计文档** | [architecture/MODULE_DESIGN.md](./architecture/MODULE_DESIGN.md) | 模块职责和接口 |
| **数据流向** | [architecture/DATA_FLOW.md](./architecture/DATA_FLOW.md) | 数据流转过程 |

---

### 3. API文档

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **项目管理API** | [api/PROJECT_API.md](./api/PROJECT_API.md) | 项目和任务API |
| **任务执行API** | [api/TASK_API.md](./api/TASK_API.md) | 执行引擎API |
| **AI服务API** | [api/AI_SERVICE_API.md](./api/AI_SERVICE_API.md) | AI服务接口 |

---

### 4. 数据模型文档

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **核心数据结构** | [data-models/CORE_MODELS.md](./data-models/CORE_MODELS.md) | TypeScript接口定义 |
| **数据库Schema** | [data-models/DATABASE_SCHEMA.md](./data-models/DATABASE_SCHEMA.md) | lowdb存储结构 |

---

### 5. 阶段1: 项目区基础架构

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **阶段README** | [phase1/README.md](./phase1/README.md) | 阶段目标概述 |
| **技术设计文档** | [phase1/TECHNICAL_DESIGN.md](./phase1/TECHNICAL_DESIGN.md) | 详细技术方案 |
| **任务清单** | [phase1/TASK_LIST.md](./phase1/TASK_LIST.md) | 20个具体任务 |
| **进度跟踪** | [phase1/PROGRESS.md](./phase1/PROGRESS.md) | 开发进度记录 |

---

### 6. 阶段2: AI任务拆分系统

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **阶段README** | [phase2/README.md](./phase2/README.md) | 阶段目标概述 |
| **任务清单** | [phase2/TASK_LIST.md](./phase2/TASK_LIST.md) | 25个具体任务 |
| **进度跟踪** | [phase2/PROGRESS.md](./phase2/PROGRESS.md) | 开发进度记录 |

---

### 7. 阶段3: 任务执行与进度管理

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **阶段README** | [phase3/README.md](./phase3/README.md) | 阶段目标概述 |
| **任务清单** | [phase3/TASK_LIST.md](./phase3/TASK_LIST.md) | 20个具体任务 |
| **进度跟踪** | [phase3/PROGRESS.md](./phase3/PROGRESS.md) | 开发进度记录 |

---

### 8. 阶段4: 5种任务类型差异化配置

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **阶段README** | [phase4/README.md](./phase4/README.md) | 阶段目标概述 |
| **任务清单** | [phase4/TASK_LIST.md](./phase4/TASK_LIST.md) | 30个具体任务 |
| **进度跟踪** | [phase4/PROGRESS.md](./phase4/PROGRESS.md) | 开发进度记录 |

---

### 9. 阶段5: 高级功能与优化

| 文档名称 | 路径 | 说明 |
|---------|------|------|
| **阶段README** | [phase5/README.md](./phase5/README.md) | 阶段目标概述 |
| **任务清单** | [phase5/TASK_LIST.md](./phase5/TASK_LIST.md) | 22个具体任务 |
| **进度跟踪** | [phase5/PROGRESS.md](./phase5/PROGRESS.md) | 开发进度记录 |

---

## 📂 目录结构

```
docs/project-management/
│
├── README.md                      # 总README
├── SUMMARY.md                     # 项目总结
├── QUICK_START.md                 # 快速开始
├── INDEX.md                       # 本文档
│
├── architecture/                  # 架构文档
│   ├── OVERALL_ARCHITECTURE.md
│   ├── MODULE_DESIGN.md
│   └── DATA_FLOW.md
│
├── api/                          # API文档
│   ├── PROJECT_API.md
│   ├── TASK_API.md
│   └── AI_SERVICE_API.md
│
├── data-models/                  # 数据模型
│   ├── CORE_MODELS.md
│   └── DATABASE_SCHEMA.md
│
├── phase1/                       # 阶段1
│   ├── README.md
│   ├── TECHNICAL_DESIGN.md
│   ├── TASK_LIST.md
│   └── PROGRESS.md
│
├── phase2/                       # 阶段2
│   ├── README.md
│   ├── TECHNICAL_DESIGN.md
│   ├── TASK_LIST.md
│   └── PROGRESS.md
│
├── phase3/                       # 阶段3
│   ├── README.md
│   ├── TECHNICAL_DESIGN.md
│   ├── TASK_LIST.md
│   └── PROGRESS.md
│
├── phase4/                       # 阶段4
│   ├── README.md
│   ├── TECHNICAL_DESIGN.md
│   ├── TASK_LIST.md
│   └── PROGRESS.md
│
└── phase5/                       # 阶段5
    ├── README.md
    ├── TECHNICAL_DESIGN.md
    ├── TASK_LIST.md
    └── PROGRESS.md
```

---

## 🔍 按关键词查找

### A
- **Agent模式**: [阶段5 README](./phase5/README.md)
- **API**: [API文档目录](./api/)
- **AI服务**: [阶段2 README](./phase2/README.md)

### B
- **Blueprint**: [阶段2 README](./phase2/README.md)
- **批量操作**: [阶段5 README](./phase5/README.md)

### C
**测试**: 各阶段 TASK_LIST.md

### D
- **数据模型**: [CORE_MODELS.md](./data-models/CORE_MODELS.md)
- **依赖关系**: [阶段2 README](./phase2/README.md)

### G
- **Git协同**: [阶段4 README](./phase4/README.md)

### J
- **架构设计**: [OVERALL_ARCHITECTURE.md](./architecture/OVERALL_ARCHITECTURE.md)
- **进度跟踪**: 各阶段 PROGRESS.md

### K
- **快捷键**: [阶段5 README](./phase5/README.md)
- **快速开始**: [QUICK_START.md](./QUICK_START.md)

### M
- **模块设计**: [MODULE_DESIGN.md](./architecture/MODULE_DESIGN.md)

### P
- **ProjectZone**: [阶段1 TECHNICAL_DESIGN.md](./phase1/TECHNICAL_DESIGN.md)
- **配置面板**: [阶段1 README](./phase1/README.md)

### R
- **任务拆分**: [阶段2 README](./phase2/README.md)
- **任务清单**: 各阶段 TASK_LIST.md
- **任务类型**: [阶段4 README](./phase4/README.md)

### S
- **数据存储**: [DATABASE_SCHEMA.md](./data-models/DATABASE_SCHEMA.md)

### T
- **TaskZone**: [阶段1 TECHNICAL_DESIGN.md](./phase1/TECHNICAL_DESIGN.md)
- **WebSocket**: [阶段3 README](./phase3/README.md)

### X
- **项目总结**: [SUMMARY.md](./SUMMARY.md)
- **需求解析**: [阶段2 README](./phase2/README.md)

### Y
- **异常处理**: [API文档](./api/PROJECT_API.md)

### Z
- **执行引擎**: [阶段3 README](./phase3/README.md)

---

## 📊 文档统计

- **总文档数**: 28个
- **架构文档**: 3个
- **API文档**: 3个
- **数据模型**: 2个
- **阶段文档**: 20个

---

## 🆘 获取帮助

### 文档问题
如果你发现文档有误或不清楚，请：
1. 在项目 Issues 中反馈
2. 提交 Pull Request 改进文档
3. 联系文档维护者

### 开发问题
如果你在开发中遇到问题：
1. 查看 [快速开始指南](./QUICK_START.md) 的常见问题
2. 查看对应阶段的技术设计文档
3. 在 Issues 中提问

---

## 📝 文档更新

### 更新频率
- **任务清单**: 任务完成时立即更新
- **进度跟踪**: 每日更新
- **技术设计**: 重大变更时更新
- **API文档**: 接口变更时更新

### 版本控制
所有文档都在Git版本控制中，可以查看历史版本。

---

**文档维护者**: Stratix Team  
**更新日期**: 2026-03-02  
**版本**: v1.0
