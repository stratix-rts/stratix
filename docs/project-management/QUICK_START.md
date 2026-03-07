# 快速开始指南

## 🚀 5分钟快速了解

本文档帮助你快速理解整个项目管理系统的架构和开发流程。

---

## 📂 文档导航

### 新手入门
1. **从这里开始**: [总体README](../README.md)
2. **了解架构**: [总体架构设计](../architecture/OVERALL_ARCHITECTURE.md)
3. **查看数据模型**: [核心数据结构](../data-models/CORE_MODELS.md)

### 开发指南
1. **阶段1**: [项目区基础架构](../phase1/README.md) - [任务清单](../phase1/TASK_LIST.md)
2. **阶段2**: [AI任务拆分](../phase2/README.md) - [任务清单](../phase2/TASK_LIST.md)
3. **阶段3**: [任务执行管理](../phase3/README.md) - [任务清单](../phase3/TASK_LIST.md)
4. **阶段4**: [任务类型配置](../phase4/README.md) - [任务清单](../phase4/TASK_LIST.md)
5. **阶段5**: [高级功能](../phase5/README.md) - [任务清单](../phase5/TASK_LIST.md)

### API参考
- [项目管理API](../api/PROJECT_API.md)
- [AI服务API](../api/AI_SERVICE_API.md)

---

## 🎯 开发流程

### 场景1: 从零开始开发

```
第1步: 阅读总体架构
  ↓
第2步: 查看阶段1任务清单
  ↓
第3步: 按顺序完成任务
  ↓
第4步: 更新进度跟踪
  ↓
第5步: 进入下一阶段
```

### 场景2: 中途接手项目

```
第1步: 查看总体README了解进度
  ↓
第2步: 查看对应阶段的PROGRESS.md
  ↓
第3步: 继续未完成的任务
  ↓
第4步: 定期更新进度
```

### 场景3: 修复Bug或优化

```
第1步: 定位问题所在阶段
  ↓
第2步: 查看该阶段技术设计
  ↓
第3步: 修改代码
  ↓
第4步: 更新文档
```

---

## 🗂️ 核心概念

### 项目 (Project)
- 用户画框创建的可视化区域
- 包含多个任务区
- 统一配置和管理

### 任务区 (Task Zone)
- 项目的子执行单元
- 5种类型: 写作、编程、画图、视频、研究
- 可配置依赖关系

### AI服务 (AI Service)
- 支持多种LLM: OpenAI, Claude, Ollama
- 统一接口设计
- 可扩展架构

### 蓝图 (Blueprint)
- 可视化任务节点和依赖关系
- 支持拖拽编辑
- AI自动规划

---

## 📊 技术栈速览

| 技术 | 用途 | 文档 |
|------|------|------|
| Vue 3 | 前端UI | [官方文档](https://vuejs.org/) |
| Phaser 3 | 游戏引擎 | [官方文档](https://photonstorm.github.io/phaser3-docs/) |
| TypeScript | 类型安全 | [官方文档](https://www.typescriptlang.org/) |
| lowdb | 数据存储 | [GitHub](https://github.com/typicode/lowdb) |
| WebSocket | 实时通信 | [MDN文档](https://developer.mozilla.org/en-US/docs/Web/API/WebSocket) |

---

## 🔧 常用命令

### 开发
```bash
# 启动开发模式
npm run dev

# 类型检查
npm run typecheck

# 代码检查
npm run lint

# 运行测试
npm run test
```

### 构建
```bash
# 构建生产版本
npm run build

# 启动生产服务器
npm run start
```

---

## 📝 开发规范

### Git提交
```
feat(phase1): 添加项目区绘制功能
fix(phase2): 修复AI解析失败问题
docs(phase3): 更新执行引擎文档
test(phase4): 添加Git集成测试
```

### 代码风格
- TypeScript严格模式
- ESLint + Prettier
- 单元测试覆盖率 > 70%

### 文档更新
- 完成任务后更新PROGRESS.md
- 修改设计后更新TECHNICAL_DESIGN.md
- 新增功能后更新API文档

---

## 🆘 常见问题

### Q1: 如何选择从哪个阶段开始？
**A**: 按顺序从阶段1开始。每个阶段都依赖前一阶段完成。

### Q2: 阶段可以并行开发吗？
**A**: 不建议。阶段之间有严格的依赖关系，必须顺序完成。

### Q3: 如何处理技术选型变更？
**A**: 
1. 更新技术设计文档
2. 评估影响范围
3. 修改相关代码
4. 更新测试用例

### Q4: 文档和代码不同步怎么办？
**A**: 以代码为准，及时更新文档。定期进行文档审查。

### Q5: 遇到技术难题怎么办？
**A**:
1. 查看技术设计文档
2. 搜索相关技术文档
3. 在Issues中提问
4. 记录解决方案到文档

---

## 📈 进度查看

### 查看总体进度
```bash
cat docs/project-management/README.md
```

### 查看阶段进度
```bash
cat docs/project-management/phase1/PROGRESS.md
cat docs/project-management/phase2/PROGRESS.md
# ... 其他阶段
```

### 查看任务完成情况
```bash
cat docs/project-management/phase1/TASK_LIST.md | grep "已完成"
```

---

## 🎓 学习路径

### 初级开发者
1. 熟悉Vue 3和TypeScript
2. 了解Phaser 3基础
3. 完成阶段1的简单任务
4. 逐步参与复杂任务

### 中级开发者
1. 理解整体架构
2. 完成核心模块开发
3. 参与代码审查
4. 优化性能

### 高级开发者
1. 设计新功能
2. 解决技术难题
3. 指导团队开发
4. 规划后续迭代

---

## 🔗 外部资源

### 官方文档
- [Vue 3](https://vuejs.org/)
- [Phaser 3](https://phaser.io/)
- [TypeScript](https://www.typescriptlang.org/)

### 教程
- [RTS游戏开发](https://phaser.io/tutorials/)
- [Vue 3组合式API](https://vuejs.org/guide/extras/composition-api-faq.html)
- [WebSocket实时通信](https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API)

### 社区
- [GitHub Issues](https://github.com/your-repo/issues)
- [Discord社区](https://discord.gg/your-invite)

---

## ✅ 下一步行动

### 如果你是第一次接触这个项目
1. ✅ 阅读总体README
2. ✅ 查看阶段1任务清单
3. ⬜ 开始第一个任务

### 如果你准备开始开发
1. ✅ 确认开发环境
2. ✅ 查看对应阶段文档
3. ⬜ 开始编码

### 如果你遇到问题
1. ✅ 查看本文档的常见问题
2. ✅ 查看技术设计文档
3. ⬜ 在Issues中提问

---

**祝开发顺利！** 🎉

**文档版本**: v1.0  
**更新日期**: 2026-03-02
