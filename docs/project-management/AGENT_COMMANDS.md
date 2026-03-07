# Agent快速指令

## 🎯 给新Agent的完整指令

你可以直接复制下面的内容给新的AI Agent：

---

### 指令模板（中文版）

```
你现在是 Stratix RTS指挥AI Agent 项目的开发者。

【项目背景】
这是一个为RTS游戏化的多Agent指挥平台添加项目管理和任务执行功能的项目。
技术栈: Vue 3 + Phaser 3 + TypeScript + Node.js + lowdb

【你的任务】
1. 先阅读文档: /docs/project-management/AGENT_GUIDE.md
2. 了解架构: /docs/project-management/architecture/OVERALL_ARCHITECTURE.md  
3. 查看进度: /docs/project-management/phase*/PROGRESS.md
4. 选择任务: /docs/project-management/phase*/TASK_LIST.md
5. 开始开发！

【重要文件】
- 总体介绍: /docs/project-management/README.md
- 快速开始: /docs/project-management/QUICK_START.md
- Agent指南: /docs/project-management/AGENT_GUIDE.md
- 协作指南: /docs/project-management/MULTI_AGENT_GUIDE.md

【开发规范】
- Git提交: feat(phase1): 添加功能名称
- 代码规范: TypeScript严格模式 + ESLint
- 测试覆盖: 单元测试 > 70%
- 文档同步: 完成任务后更新PROGRESS.md

【第一步】
请先执行: cat /docs/project-management/AGENT_GUIDE.md
然后告诉我你想从哪个阶段开始。
```

---

### 指令模板（英文版）

```
You are now a developer for the Stratix RTS Command AI Agent project.

【Project Background】
This is a project to add project management and task execution capabilities to an RTS-gamified multi-Agent command platform.
Tech Stack: Vue 3 + Phaser 3 + TypeScript + Node.js + lowdb

【Your Tasks】
1. Read the guide: /docs/project-management/AGENT_GUIDE.md
2. Understand architecture: /docs/project-management/architecture/OVERALL_ARCHITECTURE.md
3. Check progress: /docs/project-management/phase*/PROGRESS.md
4. Select tasks: /docs/project-management/phase*/TASK_LIST.md
5. Start coding!

【Important Files】
- Overview: /docs/project-management/README.md
- Quick Start: /docs/project-management/QUICK_START.md
- Agent Guide: /docs/project-management/AGENT_GUIDE.md
- Collaboration Guide: /docs/project-management/MULTI_AGENT_GUIDE.md

【Development Standards】
- Git commits: feat(phase1): add feature name
- Code standards: TypeScript strict mode + ESLint
- Test coverage: Unit tests > 70%
- Documentation: Update PROGRESS.md after completing tasks

【First Step】
Please execute: cat /docs/project-management/AGENT_GUIDE.md
Then tell me which phase you want to start with.
```

---

## 🤖 多Agent分配示例

### 场景1: 2个Agent顺序开发

```
【Agent 1 - 前端架构师】
负责阶段: 1, 2
技能要求: Vue 3, Phaser 3, TypeScript
任务范围: 
  - 阶段1: 项目区基础架构 (20个任务)
  - 阶段2: AI任务拆分 - 蓝图可视化部分 (10个任务)
开始指令: 参考上面的模板，指定负责阶段1-2

【Agent 2 - 后端/AI工程师】
负责阶段: 2, 3, 4, 5
技能要求: Node.js, LLM API, WebSocket
任务范围:
  - 阶段2: AI服务集成 (15个任务)
  - 阶段3: 任务执行引擎 (20个任务)
  - 阶段4-5: 后续功能 (52个任务)
开始指令: 参考上面的模板，指定负责阶段2-5，但等待阶段1完成
```

---

### 场景2: 3个Agent并行开发

```
【Agent 1 - 前端核心】
负责模块: 项目区 + 蓝图 + UI
任务分配:
  阶段1: 任务1.1-1.2, 2.3, 3.1-3.3 (前端核心)
  阶段2: 任务3.1-3.5, 4.1 (蓝图模块)
  阶段3: 任务3.2 (进度UI)
  阶段4: 所有UI组件
编辑文件: 
  - src/stratix-rts/zones/*.ts
  - src/stratix-blueprint/**/*.ts
  - src/stratix-config-panel/**/*.vue

【Agent 2 - 后端核心】
负责模块: 存储 + 管理 + 执行
任务分配:
  阶段1: 任务1.4-1.5, 2.1-2.2, 3.4 (数据+管理)
  阶段2: 任务1.1-1.6 (AI服务基础)
  阶段3: 任务1.2-1.5, 2.1-2.5 (执行引擎)
  阶段5: 任务1.3, 2.3, 4.1 (批量+优化)
编辑文件:
  - src/stratix-project/storage/*.ts
  - src/stratix-project/core/ProjectManager.ts
  - src/stratix-ai-service/**/*.ts
  - src/stratix-task-executor/**/*.ts

【Agent 3 - AI/LLM专家】
负责模块: AI解析 + Git集成
任务分配:
  阶段2: 任务2.1-2.4 (需求解析+拆分)
  阶段4: 任务2.1-2.5 (Git协同)
  阶段5: 任务2.1-2.2 (Agent模式)
编辑文件:
  - src/stratix-ai-service/parsers/*.ts
  - src/stratix-git-sync/**/*.ts
```

---

### 场景3: 5个Agent高度并行

```
【Agent 1 - 架构师】
职责: 定义接口和架构
任务: 
  - 阶段1: 所有接口定义 (1.4)
  - 阶段1: 核心类 (1.1, 2.3)
  - 各阶段: 技术设计文档审核

【Agent 2 - 前端开发】
职责: UI组件和交互
任务:
  - 阶段1: 所有UI组件 (2.4, 2.5, 3.4)
  - 阶段2: 蓝图组件 (3.1-3.5, 4.1)
  - 阶段4: 所有配置面板

【Agent 3 - 后端开发】
职责: 数据和业务逻辑
任务:
  - 阶段1: 存储+管理 (1.5, 2.1, 2.2)
  - 阶段3: 执行引擎 (1.2-1.5)
  - 阶段5: 批量操作

【Agent 4 - AI工程师】
职责: AI服务
任务:
  - 阶段2: AI服务 (1.1-1.6)
  - 阶段2: 解析拆分 (2.1-2.4)
  - 阶段4: Git集成 (2.1-2.5)

【Agent 5 - 测试工程师】
职责: 测试和质量保证
任务:
  - 各阶段: 编写测试
  - 各阶段: 集成测试
  - 阶段5: 性能优化和Bug修复
```

---

## 📋 任务分配检查表

在分配任务给Agent前，确认：

- [ ] 已阅读 AGENT_GUIDE.md
- [ ] 已了解总体架构
- [ ] 已选择合适的阶段
- [ ] 任务之间无文件冲突
- [ ] 依赖任务已分配
- [ ] 在 TASK_LIST.md 中标记负责人
- [ ] Agent知道如何更新 PROGRESS.md

---

## 🔧 快速启动命令

### 查看项目状态
```bash
# 查看总体进度
cat docs/project-management/README.md

# 查看阶段1任务
cat docs/project-management/phase1/TASK_LIST.md | grep -E "^####|^**负责人|^**状态"

# 查看阶段1进度
cat docs/project-management/phase1/PROGRESS.md | head -50
```

### 分配任务
```bash
# 1. 找到未分配的任务
grep -n "状态.*未开始" docs/project-management/phase1/TASK_LIST.md

# 2. 编辑任务文件，添加负责人
# 3. 通知Agent开始工作
```

---

## 📊 进度监控

### 查看各Agent进度
```bash
# Agent 1
cat docs/project-management/phase1/PROGRESS.md | grep "实际完成"

# Agent 2
cat docs/project-management/phase2/PROGRESS.md | grep "实际完成"

# 汇总
find docs/project-management -name "PROGRESS.md" -exec echo "=== {} ===" \; -exec head -20 {} \;
```

---

## 🚨 紧急情况处理

### Agent卡住了
```
1. 查看该Agent的 PROGRESS.md
2. 查看"遇到问题"部分
3. 提供解决方案或重新分配任务
```

### 任务依赖阻塞
```
1. 查看依赖任务的状态
2. 协调加快依赖任务
3. 或使用 Mock 继续开发
```

### 文件冲突
```
1. 查看哪些Agent编辑同一文件
2. 协商修改方案
3. 或拆分为不同文件
```

---

## ✅ 最佳实践

### DO ✅
- 每个Agent先读文档再开始
- 任务开始前标记负责人
- 定期更新 PROGRESS.md
- 遇到问题及时沟通
- 代码提交前先 pull

### DON'T ❌
- 不要跳过阶段
- 不要同时编辑同一文件
- 不要忘记更新文档
- 不要忽略依赖关系
- 不要提交未测试的代码

---

**准备好开始了吗？复制上面的指令给你的Agent吧！** 🚀
