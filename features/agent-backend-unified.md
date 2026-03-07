# Feature: Agent Backend 统一架构

## 目标
实现 Agent 的多后端支持，统一 OpenClaw 和直连 LLM 两种模式。

---

## Feature 1: 数据结构重构 

### 目标
更新 stratix-protocol.ts，支持多后端类型。

### Todo
- [x] 添加 `AgentBackendType` 类型
- [x] 更新 `StratixAgentConfig` 结构
  - [x] 添加 `backendType` 字段
  - [x] 添加 `directConfig` 接口
  - [x] 调整 `openClawConfig` 为可选
  - [x] 添加 `rules` 字段
- [x] 更新 `StratixConfigValidator` 适配新结构
- [x] 更新现有模板 (writer/dev/analyst) 使用 direct 模式

### 文件
- `src/stratix-core/stratix-protocol.ts`
- `src/stratix-core/utils/StratixConfigValidator.ts`
- `src/stratix-designer/templates/*.ts`

---

## Feature 2: DirectLLM 服务层 

### 目标
实现直连 LLM 的服务层，支持多 Provider。

### Todo
- [x] 创建 `DirectLLMService` 类
  - [x] 支持 OpenAI API
  - [x] 支持 Anthropic API
  - [x] 支持 Ollama (本地)
  - [x] 支持自定义 endpoint
- [x] 实现 `generateResponse` 方法
  - [x] 构建 prompt (soul + skills + rules + memory)
  - [x] 调用 LLM API
  - [x] 解析响应
- [x] 实现流式响应支持
- [x] 添加错误处理和重试逻辑

### 文件
- `src/stratix-core/services/DirectLLMService.ts`
- `src/stratix-core/services/types.ts`

---

## Feature 3: Agent 执行器统一接口 

### 目标
创建统一的 Agent 执行接口，屏蔽后端差异。

### Todo
- [x] 创建 `AgentExecutor` 接口
- [x] 实现 `OpenClawExecutor`
- [x] 实现 `DirectLLMExecutor`
- [x] 创建 `ExecutorFactory`
- [x] 更新 command 执行逻辑使用 executor

### 文件
- `src/stratix-core/executor/AgentExecutor.ts`
- `src/stratix-core/executor/OpenClawExecutor.ts`
- `src/stratix-core/executor/DirectLLMExecutor.ts`
- `src/stratix-core/executor/ExecutorFactory.ts`
- `src/stratix-core/executor/index.ts`
- `src/stratix-gateway/command-transformer/CommandTransformer.ts` (updated)

---

## Feature 4: 技能树配置 UI

### 目标
在 Character Creator 中添加技能树配置界面。

### Todo
- [ ] 创建 `SkillTreeEditor` 组件
  - [ ] 显示技能节点
  - [ ] 支持选择/解锁节点
  - [ ] 实时预览属性变化
- [ ] 创建 `RulesEditor` 组件
  - [ ] 添加/编辑/删除规则
  - [ ] 规则模板库
- [ ] 创建 `SoulEditor` 组件
  - [ ] 编辑身份描述
  - [ ] 编辑目标
  - [ ] 编辑性格
- [ ] 集成到 Character Creator Step 2

### 文件
- `src/stratix-character-creator/ui/SkillTreeEditor.ts`
- `src/stratix-character-creator/ui/RulesEditor.ts`
- `src/stratix-character-creator/ui/SoulEditor.ts`
- `src/stratix-character-creator/CharacterCreatorScene.ts`

---

## Feature 5: 后端选择 UI

### 目标
在 Character Creator 中添加后端类型选择。

### Todo
- [ ] 创建 `BackendSelector` 组件
  - [ ] OpenClaw / Direct LLM 选择
  - [ ] Provider 选择 (Direct 模式)
  - [ ] Model 选择
  - [ ] API Key 输入
- [ ] 更新 Step 2 根据选择显示不同配置
- [ ] 添加连接测试功能

### 文件
- `src/stratix-character-creator/ui/BackendSelector.ts`
- `src/stratix-character-creator/CharacterCreatorScene.ts`

---

## Feature 6: agentStore 更新

### 目标
更新 agentStore 支持新数据结构和流程。

### Todo
- [x] 更新 `createCustomAgent` 支持 backendType
- [x] 添加 `createDirectAgent` 方法
- [x] 添加 `testBackendConnection` 方法
- [x] 更新 `updateCustomAgent` 适配新结构
- [x] 添加 `updateAgentConfig` 方法

### 文件
- `src/stores/agentStore.ts`

---

## Feature 7: 后端 API 更新 

### 目标
更新后端 API 支持新数据结构。

### Todo
- [x] 更新 agent routes 支持新字段
- [x] 添加 `/api/stratix/agent/test-connection` 接口
- [x] 添加 `/api/stratix/config/agent/update` 接口
- [x] 注册新路由 `/api/stratix/agent`

### 文件
- `src/stratix-gateway/api/routes/agent.ts`
- `src/stratix-gateway/index.ts`

---

## Feature 8: 模板英雄迁移

### 目标
将模板英雄 (writer/dev/analyst) 迁移到 Direct LLM 模式。

### Todo
- [ ] 设计 writer 模板的 soul/skills/rules
- [ ] 设计 dev 模板的 soul/skills/rules
- [ ] 设计 analyst 模板的 soul/skills/rules
- [ ] 更新模板配置
- [ ] 测试模板功能

### 文件
- `src/stratix-designer/templates/WriterHeroTemplate.ts`
- `src/stratix-designer/templates/DevHeroTemplate.ts`
- `src/stratix-designer/templates/AnalystHeroTemplate.ts`
- `src/stratix-designer/templates/skills/*.ts`

---

## 执行顺序

1. **Feature 1** - 数据结构重构 (基础) 
2. **Feature 2** - DirectLLM 服务层 (核心) 
3. **Feature 3** - Agent 执行器统一接口 (核心) 
4. **Feature 6** - agentStore 更新 (前端状态) 
5. **Feature 7** - 后端 API 更新 (后端支持) 
6. **Feature 5** - 后端选择 UI (用户界面)
7. **Feature 4** - 技能树配置 UI (用户界面)
8. **Feature 8** - 模板英雄迁移 (完善)
