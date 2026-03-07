# RTS指挥AI Agent - 项目管理与任务区功能

## 📋 项目概览

**项目目标**: 为 Stratix 星策系统构建"项目为核心、任务区为执行单元、AI为主导、用户可管控"的全流程管理体系。

**技术栈**: Vue 3 + Phaser 3 + TypeScript + lowdb + WebSocket

**开发模式**: 分5个阶段，每个阶段独立可交付

---

## 🎯 核心价值

1. **项目为核心**: 用户画框即创建项目，所有操作围绕项目展开
2. **AI自主规划**: 提交需求后AI自动拆分任务区、设置依赖、分配优先级
3. **差异化配置**: 5种任务类型（写作、编程、画图、视频、研究）专属配置
4. **双模式兼容**: OpenClaw外部Agent + LLM模式Agent
5. **可视化蓝图**: 项目进度、任务关联直观可见，支持灵活微调

---

## 📊 阶段划分

### 阶段1: 项目区基础架构 (2-3周)
- **目标**: 实现画框创建项目功能
- **文档**: [phase1/README.md](./phase1/README.md)
- **状态**: 🟢 待开始

### 阶段2: AI任务拆分系统 (3-4周)
- **目标**: AI自动解析需求、拆分任务区
- **文档**: [phase2/README.md](./phase2/README.md)
- **状态**: 🟢 待开始

### 阶段3: 任务执行与进度管理 (2-3周)
- **目标**: 任务执行、进度同步、成果交付
- **文档**: [phase3/README.md](./phase3/README.md)
- **状态**: 🟢 待开始

### 阶段4: 5种任务类型差异化配置 (3-4周)
- **目标**: 实现不同任务类型的专属配置
- **文档**: [phase4/README.md](./phase4/README.md)
- **状态**: 🟢 待开始

### 阶段5: 高级功能与优化 (2-3周)
- **目标**: 批量操作、Agent模式切换、扩展功能
- **文档**: [phase5/README.md](./phase5/README.md)
- **状态**: 🟢 待开始

---

## 🏗️ 技术架构

### 核心模块
- **stratix-project**: 项目管理核心模块
- **stratix-task-executor**: 任务执行引擎
- **stratix-git-sync**: Git协同模块（阶段4）
- **stratix-ai-service**: AI服务接口（支持多LLM）

### 架构文档
- [总体架构设计](./architecture/OVERALL_ARCHITECTURE.md)
- [模块划分与职责](./architecture/MODULE_DESIGN.md)
- [数据流向](./architecture/DATA_FLOW.md)

### API设计
- [项目管理API](./api/PROJECT_API.md)
- [任务执行API](./api/TASK_API.md)
- [AI服务API](./api/AI_SERVICE_API.md)

### 数据模型
- [核心数据结构](./data-models/CORE_MODELS.md)
- [数据库Schema](./data-models/DATABASE_SCHEMA.md)

---

## 🔑 关键决策

### 1. AI服务选择
**决策**: 用户自己配置（支持多种LLM）
- OpenAI GPT-4
- Anthropic Claude
- 本地LLM（Ollama）
- 自定义API

**实现**: 统一AI服务接口，用户在配置文件中设置

### 2. 数据存储方式
**决策**: 继续使用 lowdb
- 保持技术栈一致
- JSON文件存储
- 简单可靠

**存储位置**: `stratix-data/projects.json`

### 3. Git协同优先级
**决策**: 阶段4再实现
- MVP阶段聚焦核心流程
- 降低初期复杂度
- 为编程类任务预留扩展

### 4. TaskZone处理
**决策**: 重构现有 TaskZone
- 彻底改造为项目管理系统
- 保留核心绘制逻辑
- 重新设计数据结构

---

## 📝 开发规范

### Git分支策略
```
main                 # 生产分支
  ├── develop        # 开发分支
  │   ├── feature/phase1-project-zone    # 阶段1特性分支
  │   ├── feature/phase2-ai-splitter     # 阶段2特性分支
  │   ├── feature/phase3-executor        # 阶段3特性分支
  │   ├── feature/phase4-task-types      # 阶段4特性分支
  │   └── feature/phase5-advanced        # 阶段5特性分支
```

### 提交规范
```
feat(phase1): 添加项目区绘制功能
feat(phase1): 实现项目配置面板
fix(phase2): 修复AI解析失败问题
docs(phase1): 更新项目区技术文档
test(phase3): 添加任务执行单元测试
```

### 代码规范
- TypeScript严格模式
- ESLint + Prettier
- 单元测试覆盖率 > 70%
- 集成测试覆盖核心流程

---

## 🚀 快速开始

### 查看阶段1任务
```bash
cat docs/project-management/phase1/TASK_LIST.md
```

### 查看总体架构
```bash
cat docs/project-management/architecture/OVERALL_ARCHITECTURE.md
```

### 查看API设计
```bash
cat docs/project-management/api/PROJECT_API.md
```

---

## 📂 文档目录结构

```
docs/project-management/
├── README.md                           # 本文档
├── architecture/                       # 架构设计
│   ├── OVERALL_ARCHITECTURE.md         # 总体架构
│   ├── MODULE_DESIGN.md                # 模块设计
│   └── DATA_FLOW.md                    # 数据流向
├── api/                                # API设计
│   ├── PROJECT_API.md                  # 项目管理API
│   ├── TASK_API.md                     # 任务执行API
│   └── AI_SERVICE_API.md               # AI服务API
├── data-models/                        # 数据模型
│   ├── CORE_MODELS.md                  # 核心数据结构
│   └── DATABASE_SCHEMA.md              # 数据库Schema
├── phase1/                             # 阶段1文档
│   ├── README.md                       # 阶段1概述
│   ├── TECHNICAL_DESIGN.md             # 技术设计
│   ├── TASK_LIST.md                    # 任务清单
│   └── PROGRESS.md                     # 进度跟踪
├── phase2/                             # 阶段2文档
│   ├── README.md
│   ├── TECHNICAL_DESIGN.md
│   ├── TASK_LIST.md
│   └── PROGRESS.md
├── phase3/                             # 阶段3文档
│   ├── README.md
│   ├── TECHNICAL_DESIGN.md
│   ├── TASK_LIST.md
│   └── PROGRESS.md
├── phase4/                             # 阶段4文档
│   ├── README.md
│   ├── TECHNICAL_DESIGN.md
│   ├── TASK_LIST.md
│   └── PROGRESS.md
└── phase5/                             # 阶段5文档
    ├── README.md
    ├── TECHNICAL_DESIGN.md
    ├── TASK_LIST.md
    └── PROGRESS.md
```

---

## 🔄 如何从文档继续开发

### 场景1: 开始新阶段
1. 查看对应阶段的 `README.md` 了解目标
2. 阅读 `TECHNICAL_DESIGN.md` 理解技术方案
3. 按 `TASK_LIST.md` 的顺序执行任务
4. 完成任务后更新 `PROGRESS.md`

### 场景2: 中途恢复
1. 查看 `PROGRESS.md` 找到上次完成的位置
2. 继续执行 `TASK_LIST.md` 中的下一个任务
3. 定期更新 `PROGRESS.md`

### 场景3: 技术方案调整
1. 修改对应阶段的 `TECHNICAL_DESIGN.md`
2. 同步更新 `TASK_LIST.md`
3. 在 `PROGRESS.md` 记录调整原因

---

## 📞 联系与反馈

- **文档维护者**: Stratix Team
- **更新日期**: 2026-03-02
- **版本**: v1.0

如有问题或建议，请在项目 Issues 中反馈。
