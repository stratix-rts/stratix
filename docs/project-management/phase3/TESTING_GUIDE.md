# Phase 3 集成测试指南

## 📋 测试概述

本测试套件用于验证 Phase 3 任务执行集成功能的完整性。

---

## 🚀 快速开始

### 运行集成测试

```bash
# 方法1: 使用 ts-node
npx ts-node src/stratix-project/tests/IntegrationTest.ts

# 方法2: 编译后运行
npm run build
node dist/stratix-project/tests/IntegrationTest.js
```

### 运行示例代码

```bash
# 任务执行示例
npx ts-node src/stratix-project/examples/TaskExecutionExample.ts
```

---

## 🧪 测试用例

### 1. 项目创建测试
验证项目管理器能够正确创建项目并存储。

### 2. 任务加载测试
验证任务能够正确加载到项目中，并更新任务计数。

### 3. 任务执行测试
验证任务执行器能够按顺序执行任务，并正确更新项目状态。

### 4. 进度更新测试
验证项目进度能够正确更新并持久化。

### 5. 暂停/恢复测试
验证项目执行能够正确暂停和恢复。

### 6. 多任务依赖测试
验证任务依赖关系能够正确处理，任务按依赖顺序执行。

### 7. 事件系统测试
验证事件系统能够正确触发和传播。

---

## 📊 预期输出

```
🧪 Phase 3 集成测试

测试目录: /tmp/stratix-test-1234567890

✅ 项目创建 (45ms)
✅ 任务加载 (32ms)
✅ 任务执行 (1234ms)
  ▶ 任务已启动
✅ 进度更新 (28ms)
✅ 暂停/恢复 (156ms)
✅ 多任务依赖 (2345ms)
✅ 事件系统 (67ms)

==================================================
测试结果汇总

总计: 7 个测试
✅ 通过: 7
❌ 失败: 0
⏱  总耗时: 3907ms
📊 通过率: 100.0%
==================================================

🧹 测试环境已清理
```

---

## 🎯 示例代码说明

### TaskExecutionExample.ts

完整演示如何使用 ProjectManager 执行任务：

1. **初始化** - 创建 ProjectManager 和 ProjectStore
2. **创建项目** - 配置项目参数
3. **加载任务** - 定义任务及其依赖关系
4. **监听事件** - 设置进度和完成事件监听器
5. **启动执行** - 开始任务执行
6. **观察进度** - 实时查看任务进度更新

---

## 🔍 调试技巧

### 启用详细日志

```typescript
// 在测试文件中
process.env.DEBUG = 'stratix:*';
```

### 查看测试目录

```bash
# 测试运行时不会自动删除测试目录（调试模式）
ls /tmp/stratix-test-*
```

### 单独运行某个测试

```typescript
// 注释掉其他测试
await this.test('任务执行', () => this.testTaskExecution());
// await this.test('进度更新', () => this.testProgressUpdate());
// ...
```

---

## ⚠️ 常见问题

### Q: 测试超时怎么办？
A: 增加超时时间：
```typescript
const timeout = setTimeout(() => reject(new Error('执行超时')), 10000); // 10秒
```

### Q: 如何测试真实 Agent？
A: 修改 AgentConfig：
```typescript
const executor = new TaskExecutor(projectId, projectPath, {
  type: 'real', // 使用真实 Agent
  apiKey: 'your-api-key'
});
```

### Q: 如何验证文件系统操作？
A: 检查测试目录：
```bash
ls -R /tmp/stratix-test-*/
```

---

## 📈 性能基准

| 操作 | 预期时间 | 备注 |
|------|---------|------|
| 项目创建 | < 50ms | 数据库写入 |
| 任务加载 | < 30ms | 内存操作 |
| 单任务执行 | 1-3s | Mock Agent |
| 进度更新 | < 10ms | 数据库更新 |
| 暂停/恢复 | < 100ms | 状态切换 |

---

## 🎓 扩展测试

### 添加新测试

```typescript
private async testYourFeature(): Promise<void> {
  // 1. 准备测试数据
  const project = await this.createTestProject();
  
  // 2. 执行操作
  await this.projectManager.yourMethod(project.id);
  
  // 3. 验证结果
  const updated = await this.projectManager.getProject(project.id);
  if (!updated) throw new Error('项目不存在');
  if (updated.yourField !== expectedValue) {
    throw new Error('验证失败');
  }
}

// 在 runAllTests 中添加
await this.test('你的功能', () => this.testYourFeature());
```

---

## 📝 测试清单

- [x] 项目 CRUD 操作
- [x] 任务加载和执行
- [x] 进度跟踪和更新
- [x] 暂停/恢复功能
- [x] 依赖关系处理
- [x] 事件系统集成
- [ ] 并发执行测试
- [ ] 错误恢复测试
- [ ] 性能压力测试
- [ ] 真实 Agent 集成测试

---

**最后更新**: 2026-03-03  
**维护者**: AI Agent
