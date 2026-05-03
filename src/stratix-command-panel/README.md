# Stratix Command Panel - 指令面板模块

## 模块概述
Stratix Command Panel 是 Stratix 星策系统的指令编辑与提交模块，负责展示 Agent 技能、编辑指令参数、提交标准化指令。本模块采用高度模块化设计，通过事件总线与其他模块通信，确保低耦合、高内聚。

## 核心职责
1. **指令展示**：接收 RTS 界面选中的 Agent 信息，展示该 Agent（英雄）可执行的所有技能（指令）
2. **指令参数编辑**：针对选中的技能，展示对应的参数表单，支持用户输入/选择参数
3. **指令提交**：将用户编辑的指令参数，与 Agent 信息结合，生成 Stratix 标准化指令（StratixCommandData），发射给事件总线
4. **指令日志展示**：展示当前 Agent 最近执行的指令记录（状态、结果、时间）
5. **指令取消**：支持用户取消正在执行的指令，发射指令取消事件

## 技术栈
- **前端框架**：Vue 3 + TypeScript
- **游戏引擎**：Phaser 3（用于与 RTS 界面集成）
- **UI 组件**：Element Plus / Ant Design（可选）
- **事件总线**：mitt / 自定义 StratixEventBus
- **状态管理**：Vue 3 Composition API

## 项目结构
```
src/stratix-command-panel/
├── init.md                      # 模块初始化文档
├── README.md                    # 本文档
├── FEATURE_002_PROMPT.md        # Feature 002 开发提示
├── index.ts                     # 模块入口（barrel 导出）
├── components/
│   ├── SkillList.vue            # 技能列表组件
│   ├── ParamForm.vue            # 参数表单组件
│   ├── CommandLog.vue           # 指令日志组件
│   ├── ConfirmDialog.vue        # 执行确认对话框
│   ├── LogDetailModal.vue       # 日志详情弹窗
│   └── CancelConfirmDialog.vue  # 取消确认对话框
└── utils/
    ├── CommandBuilder.ts        # 指令构建工具
    └── ParamValidator.ts        # 参数校验工具
```

## Feature 拆分

### P0 优先级（核心功能）
1. **Feature 001: 技能列表展示**
   - 文档：[.long-run-agent/specs/feature_001.md](./.long-run-agent/specs/feature_001.md)
   - 职责：展示 Agent 可执行的所有技能，支持技能选择和搜索
   - 预估工时：3 天

2. **Feature 002: 参数表单编辑**
   - 文档：[.long-run-agent/specs/feature_002.md](./.long-run-agent/specs/feature_002.md)
   - 职责：动态生成参数表单，支持参数校验和实时反馈
   - 预估工时：4 天

3. **Feature 003: 指令构建与提交**
   - 文档：[.long-run-agent/specs/feature_003.md](./.long-run-agent/specs/feature_003.md)
   - 职责：构建标准化指令，通过事件总线发射指令事件
   - 预估工时：3 天

### P1 优先级（增强功能）
4. **Feature 004: 指令日志展示**
   - 文档：[.long-run-agent/specs/feature_004.md](./.long-run-agent/specs/feature_004.md)
   - 职责：展示指令执行历史，实时更新指令状态
   - 预估工时：3 天

5. **Feature 005: 指令取消功能**
   - 文档：[.long-run-agent/specs/feature_005.md](./.long-run-agent/specs/feature_005.md)
   - 职责：支持取消正在执行的指令，发射取消事件
   - 预估工时：3 天

## 开发指南

### 前置依赖
1. **核心协议层**：需要 `stratix-protocol.ts` 提供数据类型定义
2. **事件总线**：需要 `StratixEventBus` 提供事件通信机制
3. **Vue 3**：前端框架
4. **Phaser 3**：游戏引擎（用于与 RTS 界面集成）

### 安装依赖
```bash
# 安装 Vue 3
npm install vue@next

# 安装 TypeScript
npm install -D typescript

# 安装 Phaser 3
npm install phaser

# 安装事件总线（mitt）
npm install mitt

# 安装 UI 组件库（可选）
npm install element-plus
# 或
npm install ant-design-vue
```

### 开发流程
1. **阅读文档**：阅读 init.md 和各 feature 文档，理解模块职责和接口定义
2. **环境搭建**：安装依赖，配置 TypeScript 和 Vue 环境
3. **按优先级开发**：从 P0 优先级的 feature 开始，依次实现
4. **单元测试**：为每个 feature 编写单元测试，确保功能正确
5. **集成测试**：与其他模块（RTS 界面、事件总线）集成测试
6. **代码审查**：提交代码前进行代码审查，确保代码质量

### 核心接口

#### 1. 事件订阅（接收）
```typescript
// 订阅 Agent 选择事件
StratixEventBus.subscribe(
  'stratix:agent_select',
  (event: StratixFrontendOperationEvent) => {
    // 加载 Agent 技能列表
  }
);

// 订阅指令状态更新事件
StratixEventBus.subscribe(
  'stratix:command_status_update',
  (event: StratixStateSyncEvent) => {
    // 更新指令日志状态
  }
);
```

#### 2. 事件发射（发送）
```typescript
// 发射指令执行事件
StratixEventBus.emit({
  eventType: 'stratix:command_execute',
  payload: {
    agentIds: ['stratix-xxx'],
    command: {
      commandId: 'stratix-cmd-xxx',
      skillId: 'stratix-skill-xxx',
      agentId: 'stratix-xxx',
      params: { ... },
      executeAt: Date.now()
    }
  },
  timestamp: Date.now(),
  requestId: 'stratix-req-xxx'
});

// 发射指令取消事件
StratixEventBus.emit({
  eventType: 'stratix:command_cancel',
  payload: { commandId: 'stratix-cmd-xxx' },
  timestamp: Date.now(),
  requestId: 'stratix-req-xxx'
});
```

#### 3. API 调用（与中间件通信）
```typescript
// 获取 Agent 配置（包含技能列表）
GET /api/stratix/config/agent/get?agentId=xxx

// 保存 Agent 配置（可选）
POST /api/stratix/config/agent/save
```

### 开发边界
- **不处理**：指令转换、OpenClaw 对接、状态同步（由中间件处理）
- **仅负责**：指令展示、参数编辑、标准化指令生成、提交、日志展示
- **严格遵循**：Stratix 统一协议，不修改数据格式

### 代码规范
1. **命名规范**：
   - 文件名：小驼峰（camelCase）
   - 组件名：大驼峰（PascalCase）
   - 变量名：小驼峰（camelCase）
   - 常量名：全大写下划线（UPPER_SNAKE_CASE）
2. **TypeScript 严格模式**：启用 strict 模式，确保类型安全
3. **注释规范**：使用 JSDoc 注释，清晰描述函数和参数
4. **代码风格**：遵循 ESLint 和 Prettier 规范

### 测试策略
1. **单元测试**：使用 Vitest 或 Jest，测试每个组件和工具函数
2. **集成测试**：测试事件总线和 API 调用
3. **E2E 测试**：使用 Cypress 或 Playwright，测试完整用户流程
4. **测试覆盖率**：目标覆盖率 > 80%

## Git 分支管理
当前分支：`feature/stratix-command-panel`

### 提交规范
```bash
# 功能开发
git commit -m "feat(command-panel): 实现技能列表展示功能"

# Bug 修复
git commit -m "fix(command-panel): 修复参数校验错误"

# 文档更新
git commit -m "docs(command-panel): 更新 README 文档"

# 代码重构
git commit -m "refactor(command-panel): 优化指令构建逻辑"
```

### 分支策略
- `master`：主分支，稳定版本
- `feature/stratix-command-panel`：当前开发分支
- `hotfix/*`：紧急修复分支
- `release/*`：发布分支

## 开发周期
- **总预估工时**：16 天
  - Feature 001: 3 天
  - Feature 002: 4 天
  - Feature 003: 3 天
  - Feature 004: 3 天
  - Feature 005: 3 天
- **缓冲时间**：2 天（处理意外问题和优化）
- **总计**：18 天（约 3.5 周）

## 注意事项
1. **指令 ID 格式**：必须为 `stratix-cmd-{timestamp}-{random}`
2. **参数校验**：必须与技能配置的 parameters 定义一致
3. **指令日志**：最多保留 10 条
4. **批量执行**：让用户确认是否对所有选中 Agent 执行指令
5. **事件数据格式**：严格遵循 Stratix 统一协议
6. **低耦合**：仅通过事件总线与其他模块通信

## 常见问题

### Q1: 如何获取 Agent 的技能列表？
A: 通过 API 调用 `GET /api/stratix/config/agent/get?agentId=xxx`，从返回的 `StratixAgentConfig` 中获取 `skills` 数组。

### Q2: 如何处理多个 Agent 同时执行指令？
A: 生成多个指令，每个指令对应一个 Agent，分别发射指令事件。或者生成一个批量指令（需中间件支持）。

### Q3: 指令执行失败后如何重试？
A: MVP 版本不支持自动重试，用户需要重新提交指令。后续版本可在指令日志中添加"重试"按钮。

### Q4: 如何确保指令 ID 唯一性？
A: 使用时间戳（毫秒级）+ 随机字符串（6 位），保证在同一毫秒内生成的 ID 不重复。

### Q5: 如何与 RTS 界面集成？
A: 通过 Phaser Scene 系统，RTS 界面调用 `this.scene.launch('StratixCommandPanel', { agentIds })` 启动指令面板。

## 联系方式
- **项目负责人**：stratix-team
- **文档维护**：AI Assistant
- **问题反馈**：通过 LRA 工具记录或直接联系团队成员

## 更新日志
- **2026-02-22**：创建项目，完成 feature 拆分和文档编写
- **待更新**：功能开发完成后更新

---

**最后更新时间**：2026-02-22  
**文档版本**：v1.0.0
