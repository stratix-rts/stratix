# stratix-command-panel 模块代码审查

## 概览

**模块职责**: 负责展示 Agent 技能列表、编辑指令参数、提交标准化指令、以及指令执行日志管理。

**文件统计**: 9 个源文件 (3 个 TS 工具 + 6 个 Vue 组件)

| 文件 | 职责 |
|------|------|
| `index.ts` | 导出入口 |
| `utils/CommandBuilder.ts` | 命令构建工具 |
| `utils/ParamValidator.ts` | 参数校验工具 |
| `components/SkillList.vue` | 技能列表展示与选择 |
| `components/ParamForm.vue` | 参数表单编辑 |
| `components/ConfirmDialog.vue` | 执行确认弹窗 |
| `components/CommandLog.vue` | 指令日志列表 |
| `components/LogDetailModal.vue` | 日志详情弹窗 |
| `components/CancelConfirmDialog.vue` | 取消指令确认弹窗 |

---

## 代码质量

### 优点

- **命名规范**: 文件名、函数名、变量名均符合 TypeScript 命名约定
- **职责分离**: 工具类 (`CommandBuilder`, `ParamValidator`) 与 UI 组件职责清晰
- **TypeScript 类型安全**: 大量使用 `interface`、`type` 定义，泛型约束合理
- **组件结构**: Vue 组件结构完整，template/script/style 分离清晰

### 问题

#### 1. `CommandBuilder.ts` - 静态方法过多 (L13-L133)

`CommandBuilder` 全部使用静态方法，缺乏实例封装能力。虽适合工具类场景，但扩展性有限。若未来需要配置化（如自定义 ID 前缀），需要修改类本身。

**建议**: 可考虑将 `generateCommandId` 和 `generateRequestId` 的前缀提取为可配置参数。

#### 2. `CommandBuilder.ts:107` - 潜在 DoS 风险

```typescript
paramsPreview = Object.entries(command.params)
  .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
  .slice(0, 5) // Limit to 5 params to prevent DoS
```

注释提到 DoS 防护，但 `.slice(0, 5)` 仅限制显示参数数量，未限制 `JSON.stringify` 的输入大小。若 `value` 本身极大（如上传文件 base64），仍会造成性能问题。

**建议**: 增加单参数 value 长度限制，如 `value.toString().slice(0, 100)`。

#### 3. `ParamValidator.ts:52-56` - `isEmpty` 实现

```typescript
private static isEmpty(value: any): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string' && value.trim() === '') return true;
  return false;
}
```

对 `0`、`false` 等 falsy 值会误判为 empty（但后续有类型检查兜底，实际风险可控）。注释缺失。

#### 4. `SkillList.vue:96-104` - 硬编码颜色映射

```typescript
const getSkillColor = (skill: StratixSkillConfig): string => {
  const skillType = skill.skillId.split('-')[2];
  const colors: Record<string, string> = {
    writer: getToken('colors.info'),
    dev: '#9B59B6',
    analyst: '#E67E22',
    default: getToken('colors.text.muted')
  };
  return colors[skillType] || colors.default;
};
```

`skillId.split('-')[2]` 依赖特定格式，耦合了命名约定。若 `skillId` 格式变化，颜色映射会失效。

**建议**: 使用 `skill.category` 或 `skill.type` 等显式字段，或在 `StratixSkillConfig` 中增加 `color` 字段。

#### 5. `CommandLog.vue:166-207` - 日志数量硬编码

```typescript
const MAX_LOGS = 10;
const addLog = (log: CommandLogItem) => {
  logs.value.unshift(log);
  if (logs.value.length > MAX_LOGS) {
    logs.value.pop();
  }
};
```

日志上限硬编码为 10，不支持配置。若用户需要更多历史记录，需修改源码。

**建议**: 提取为组件 prop 或 design token 配置。

#### 6. `CommandLog.vue:284-290` - Agent 名称使用 agentId 代替

```typescript
agentName: command.agentId, // 实际使用 agentId，未做名称解析
```

此处 `agentName` 实际赋值为 `agentId`，显示时会出现 ID 而非可读名称。虽然问题在数据源（`command_execute` 事件 payload 未包含 agentName），但组件层面应做防御或标注。

#### 7. 重复代码

- `formatTime` 在 `CommandLog.vue` 和 `LogDetailModal.vue` 中功能部分重叠（时间格式化）
- 多个组件使用 `StratixEventBus.getInstance()` 获取单例，可抽取 composable

---

## 安全

### 潜在风险

#### 1. `ParamValidator.ts` - `validateNumber` 精度问题 (L91)

```typescript
const numValue = typeof value === 'string' ? parseFloat(value) : value;
```

`parseFloat` 会截取字符串前面的数字部分（如 `"12abc"` 会解析为 `12`），导致隐式类型转换被静默接受。

**建议**: 增加类型严格校验：

```typescript
if (typeof value === 'string' && !/^-?\d+(\.\d+)?$/.test(value)) {
  return { isValid: false, errorMessage: `${param.name} 必须为有效数字` };
}
```

#### 2. `CommandLog.vue:48-51` - XSS 风险

```typescript
const copyToClipboard = () => {
  if (props.log?.commandId) {
    navigator.clipboard.writeText(props.log.commandId);
  }
};
```

此处 `commandId` 是内部生成的安全 ID，风险较低。但 `LogDetailModal.vue:102` 直接渲染 `{{ log.error }}` 可能存在风险——若 error 来自后端且包含恶意脚本，需确保后端已做 XSS 防护。

#### 3. 事件订阅清理 (良好实践)

所有组件在 `onUnmounted` 中正确清理了事件订阅，避免内存泄漏。

---

## 性能

### 优点

- **计算属性缓存**: `filteredSkills`、`filteredLogs` 使用 `computed`，减少不必要计算
- **日志数量上限**: `MAX_LOGS = 10` 防止无限增长
- **虚拟滚动准备**: `overflow-y: auto` 设置了滚动但未使用虚拟列表（当前数据量较小，影响有限）

### 问题

#### 1. `CommandLog.vue:203-208` - 日志更新触发完整重渲染

```typescript
const addLog = (log: CommandLogItem) => {
  logs.value.unshift(log);
  if (logs.value.length > MAX_LOGS) {
    logs.value.pop();
  }
};
```

使用 `unshift` 添加新日志，Vue 3 的响应式数组会触发视图更新。当前 `MAX_LOGS = 10`，影响有限。

#### 2. `SkillList.vue:112-124` - API 请求无分页/缓存

```typescript
const loadAgentSkills = async (agentIds: string[]) => {
  // ...
  const response = await axios.get('/api/stratix/config/agent/get', {
    params: { agentId: agentIds[0] }
  });
  skills.value = response.data.data.skills || [];
};
```

仅请求第一个 agent 的技能列表。若多 agent 场景下技能不同步，可能导致显示不完整。

#### 3. `ParamValidator.ts:40-46` - switch 缺少 break (实际无问题)

```typescript
switch (param.type) {
  case 'string':
    return ParamValidator.validateString(validatedParam, value);
  case 'number':
    return ParamValidator.validateNumber(validatedParam, value);
  // ...
}
```

每个 case 都有 return，不存在 fall-through 问题，代码正确。

---

## 架构

### 模块边界

```
stratix-command-panel
├── index.ts (导出入口)
├── utils/
│   ├── CommandBuilder.ts (命令构建)
│   └── ParamValidator.ts (参数校验)
└── components/
    ├── SkillList.vue
    ├── ParamForm.vue
    ├── ConfirmDialog.vue
    ├── CommandLog.vue
    ├── LogDetailModal.vue
    └── CancelConfirmDialog.vue
```

### 依赖方向

```
stratix-command-panel
├── 依赖: @/stratix-core/stratix-protocol (类型)
├── 依赖: @/components/ui (UI 组件库)
├── 依赖: @/design-system/config (设计 token)
└── 依赖: @/stratix-core/StratixEventBus (事件总线)
```

### 耦合分析

| 依赖项 | 耦合方式 | 合理性 |
|--------|----------|--------|
| `StratixEventBus` | 事件订阅/发布 | 合理，解耦组件通信 |
| `@/components/ui` | UI 组件库 | 合理，统一设计语言 |
| `@/stratix-core/stratix-protocol` | 类型定义 | 合理，依赖核心协议 |

**模块独立性**: 良好。该模块是自包含的 UI 功能模块，不直接依赖 backend 服务，通过事件总线与外部通信。

---

## 测试

### 现有覆盖

从 `coverage/` 目录看，存在部分覆盖率报告，但无法确定测试文件位置。

### 缺失测试

1. **ParamValidator** - 缺少单元测试
   - `isEmpty` 边界用例（0, false, ''）
   - `validateNumber` 精度问题
   - `validateBoolean` 多种输入格式

2. **CommandBuilder** - 缺少单元测试
   - `buildCommands` 多 agent 场景
   - `validateCommandParams` 必填参数校验
   - `formatCommandPreview` HTML 转义

3. **Vue 组件** - 缺少组件测试
   - SkillList 搜索过滤逻辑
   - CommandLog 状态筛选逻辑
   - 表单校验联动

### Mock 使用

未发现测试文件，无法评估 mock 策略。

---

## 横向联动

### 依赖该模块的模块

| 模块 | 调用方式 |
|------|----------|
| `stratix-project` | 导入 SkillList, ParamForm, CommandLog 等组件 |
| `stratix-core` | 类型定义（StratixSkillConfig 等）|
| Event Bus | 事件类型 stratix:command_* |

### 事件流

```
Agent Selection → stratix:agent_select → SkillList.loadAgentSkills
                                      → SkillList.selectSkill → stratix:skill_selected
                                      → ParamForm.handleSkillSelected
                                      → User fills params
                                      → ConfirmDialog → executeCommands
                                      → stratix:command_execute → CommandLog.handleCommandExecute
                                      → stratix:command_status_update → CommandLog.updateLogStatus
```

---

## 改进建议

### P0 (关键)

1. **ParamValidator.validateNumber 增加类型严格校验**
   - 文件: `src/stratix-command-panel/utils/ParamValidator.ts:90-98`
   - 原因: `parseFloat("12abc")` 静默成功，导致错误数据通过校验
   - 方案: 增加正则校验 `^-?\d+(\.\d+)?$`

2. **CommandBuilder.formatCommandPreview 限制单参数长度**
   - 文件: `src/stratix-command-panel/utils/CommandBuilder.ts:105-108`
   - 原因: `.slice(0, 5)` 仅限制数量，未限制单个 value 大小
   - 方案: 增加 `value.toString().slice(0, 200)` 限制

### P1 (重要)

3. **CommandLog.MAX_LOGS 提取为可配置**
   - 文件: `src/stratix-command-panel/components/CommandLog.vue:166`
   - 原因: 硬编码 10，不支持业务定制
   - 方案: 提取为 `defineProps` 的 `maxLogs` 属性

4. **SkillList.getSkillColor 解除 skillId 格式耦合**
   - 文件: `src/stratix-command-panel/components/SkillList.vue:95-104`
   - 原因: 依赖 `skillId.split('-')[2]` 格式，脆弱
   - 方案: 使用显式 `skill.category` 或在类型中增加 `color` 字段

5. **CommandLog.handleCommandExecute 使用正确的 agentName**
   - 文件: `src/stratix-command-panel/components/CommandLog.vue:284`
   - 原因: `agentName: command.agentId` 显示 ID 而非名称
   - 方案: 从事件 payload 中获取真实 agentName，或在后端事件中补充

### P2 (优化)

6. **抽取 StratixEventBus 为 composable**
   - 原因: 避免重复调用 `getInstance()`
   - 方案: 创建 `useEventBus.ts` 返回单例

7. **增加 ParamValidator 单元测试**
   - 覆盖: 边界值、类型校验、错误消息

---

## 总结

该模块代码质量良好，架构清晰，安全意识基本到位。主要改进方向：

1. **安全加固**: 参数校验类型严格性
2. **可配置性**: 硬编码值（MAX_LOGS、颜色映射）
3. **完整性**: 补充 ParamValidator 和 CommandBuilder 的单元测试

该模块适合作为 stratix-project 的 UI 功能模块使用，独立性好，可维护性较高。
