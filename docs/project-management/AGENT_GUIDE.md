# Agent开发指南

## 👋 欢迎！

你是一个即将加入 Stratix RTS指挥AI Agent 项目开发的AI Agent。本文档将帮助你快速了解项目并开始工作。

---

## 📋 项目概览

**项目名称**: Stratix 星策系统 - 项目管理与任务区功能

**核心目标**: 为RTS游戏化的多Agent指挥平台添加项目管理和任务执行功能

**技术栈**: 
- 前端: Vue 3 + Phaser 3 + TypeScript
- 后端: Node.js + Express + WebSocket
- 存储: lowdb (JSON)
- 测试: Jest + Playwright

**预计工期**: 12-17周

---

## 🗂️ 文档导航

### 必读文档（优先级顺序）
1. **快速了解** (5分钟)
   - `/docs/project-management/README.md` - 项目总体介绍
   - `/docs/project-management/SUMMARY.md` - 项目完整规划

2. **理解架构** (15分钟)
   - `/docs/project-management/architecture/OVERALL_ARCHITECTURE.md` - 总体架构
   - `/docs/project-management/data-models/CORE_MODELS.md` - 数据结构

3. **查看任务**
   - 查看对应阶段的 `TASK_LIST.md`
   - 选择未开始的任务

---

## 🎯 如何开始工作

### 步骤1: 了解当前进度
```bash
# 查看总体进度
cat docs/project-management/README.md

# 查看各阶段状态
cat docs/project-management/phase1/PROGRESS.md
cat docs/project-management/phase2/PROGRESS.md
```

### 步骤2: 选择任务
根据你的技能和项目进度，选择合适的阶段：

**阶段1 (推荐新手)**: 项目区基础架构
- 适合：熟悉 TypeScript, Phaser 3
- 任务：20个，难度：中等

**阶段2 (需要经验)**: AI任务拆分
- 适合：熟悉 LLM API, Prompt Engineering
- 任务：25个，难度：高

**阶段3 (需要经验)**: 任务执行引擎
- 适合：熟悉 WebSocket, 并发编程
- 任务：20个，难度：高

**阶段4 (高级)**: 任务类型配置
- 适合：熟悉多种任务场景
- 任务：30个，难度：中-高

**阶段5 (优化)**: 高级功能
- 适合：有性能优化经验
- 任务：22个，难度：中

### 步骤3: 领取任务
在 `TASK_LIST.md` 中找到你想做的任务：
```markdown
#### 任务X.X: 任务名称
**优先级**: 高  
**负责人**: 你的名字/ID
**状态**: 🟡 进行中
```

### 步骤4: 开始开发
```bash
# 查看技术设计
cat docs/project-management/phase1/TECHNICAL_DESIGN.md

# 开始编码
npm run dev
```

### 步骤5: 完成任务
```bash
# 更新任务状态
# 在 TASK_LIST.md 中标记为已完成

# 更新进度
# 在 PROGRESS.md 中记录完成情况
```

---

## 📝 开发规范

### Git提交规范
```bash
# 格式: type(scope): message

# 示例:
feat(phase1): 添加ProjectZone基础类
fix(phase2): 修复AI解析失败问题
docs(phase3): 更新执行引擎文档
test(phase4): 添加Git集成测试
refactor(phase5): 优化批量操作性能
```

### 代码规范
- TypeScript 严格模式
- ESLint + Prettier 格式化
- 单元测试覆盖率 > 70%
- 清晰的注释和文档

### 文件命名
```
类文件: PascalCase.ts (如: ProjectManager.ts)
工具文件: camelCase.ts (如: helpers.ts)
Vue组件: PascalCase.vue (如: ProjectConfigPanel.vue)
测试文件: *.test.ts (如: ProjectManager.test.ts)
```

---

## 🔧 开发环境

### 必备工具
```bash
# Node.js 18+
node --version

# npm 9+
npm --version

# Git
git --version
```

### 安装依赖
```bash
npm install
```

### 常用命令
```bash
# 启动开发模式
npm run dev

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 运行测试
npm run test

# 构建生产版本
npm run build
```

---

## 🚨 注意事项

### 依赖关系
- **阶段必须按顺序开发**: 1 → 2 → 3 → 4 → 5
- **阶段内任务可以并行**: 同一阶段的独立任务可以同时开发
- **任务依赖要遵守**: 查看 TASK_LIST.md 中的依赖字段

### 代码冲突避免
- 不同模块可以并行开发
- 修改共享接口需要提前沟通
- 提交前先 pull 最新代码
- 使用 feature 分支开发

### 文档同步
- 完成任务后更新 PROGRESS.md
- 修改设计后更新 TECHNICAL_DESIGN.md
- 新增API后更新 API文档

---

## 🤝 协作指南

### 单Agent开发
- 顺序完成阶段1-5
- 每个阶段按任务清单顺序
- 定期更新进度文档

### 多Agent并行开发
- 查看: `/docs/project-management/MULTI_AGENT_GUIDE.md`
- 遵守任务分配规则
- 避免修改同一文件

### 沟通方式
- 在 PROGRESS.md 中记录问题
- 代码审查通过 PR
- 紧急问题在 Issues 中讨论

---

## 📊 进度报告

### 每日更新
在 `PROGRESS.md` 中记录：
```markdown
### 2026-03-02 (Day X)
**实际完成**:
- ✅ 完成任务1.1: 创建BaseZone类
- ✅ 完成任务1.2: 重构TaskZone类

**遇到问题**: 
- 无

**明日计划**:
- 任务1.3: 实现ProjectZone类
- 任务1.4: 实现ProjectManager
```

---

## 🎯 验收标准

每个任务完成后，确保：
- ✅ 代码编译通过 (`npm run typecheck`)
- ✅ 代码检查通过 (`npm run lint`)
- ✅ 单元测试通过 (`npm run test`)
- ✅ 功能正常工作（手动测试）
- ✅ 文档已更新

---

## 🆘 遇到问题？

### 技术问题
1. 查看对应阶段的技术设计文档
2. 查看现有代码实现
3. 查看 TypeScript 类型定义
4. 在 Issues 中提问

### 任务不明确
1. 查看任务描述和验收标准
2. 查看依赖的任务了解上下文
3. 参考已完成的类似任务

### 环境问题
1. 检查 Node.js 版本
2. 删除 node_modules 重新安装
3. 查看项目 README

---

## 📚 学习资源

### 技术文档
- [Vue 3 文档](https://vuejs.org/)
- [Phaser 3 文档](https://phaser.io/)
- [TypeScript 文档](https://www.typescriptlang.org/)

### 项目特定
- `/docs/project-management/architecture/` - 架构设计
- `/docs/project-management/data-models/` - 数据模型
- `/docs/project-management/api/` - API定义

---

## ✅ 开始清单

在开始工作前，确保：
- [ ] 已阅读项目 README
- [ ] 已了解总体架构
- [ ] 已选择要开发的阶段
- [ ] 已在 TASK_LIST.md 中认领任务
- [ ] 已安装开发环境
- [ ] 已能成功运行 `npm run dev`

---

**准备好了吗？开始你的开发之旅吧！** 🚀

---

**文档版本**: v1.0  
**更新日期**: 2026-03-02
