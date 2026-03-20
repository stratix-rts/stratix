# Agent 配置系统详细重构计划

> 基于 LangChain + LangGraph + Sequential Workflow Designer 的多 Agent 协作平台

## 一、技术选型

| 组件 | 选择 | 理由 |
|------|------|------|
| **LLM 框架** | LangChain | 与 LangGraph 无缝集成 |
| **Agent 编排** | LangGraph | 多 Agent 协作，状态管理 |
| **工作流 UI** | Sequential Workflow Designer | 0依赖、框架无关、TypeScript |
| **密钥存储** | safeStorage | 已实现，保持不变 |
| **Zone 编排** | 扩展现有 ZoneConnection | 复用已有架构 |

## 二、UI 框架对比

| 特性 | Sequential Workflow Designer | React Flow | 自研 (Phaser DOM) |
|------|------------------------------|------------|-------------------|
| 外部依赖 | 0 ✅ | React 生态 | 0 |
| 框架兼容 | 任意 ✅ | 仅 React | Phaser |
| 工作流专用 | ✅ | ❌ (需自己实现) | ❌ |
| 学习曲线 | 低 ✅ | 中 | 高 |
| MIT 许可证 | ✅ | ✅ | N/A |
| 集成复杂度 | 低 ✅ | 中 | 高 |

**选择**: Sequential Workflow Designer - 可直接嵌入 Phaser 的 DOM 元素

## 三、架构设计

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Stratix Application                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────┐   ┌─────────────────────────────────┐  │
│  │    CharacterCreatorScene        │   │      StratixRTSGameScene        │  │
│  │    (角色创建界面)                │   │      (RTS 任务区界面)            │  │
│  │                                 │   │                                 │  │
│  │  ┌───────────────────────────┐  │   │  ┌───────────────────────────┐  │  │
│  │  │ Sequential Workflow       │  │   │  │     TaskZone Grid         │  │  │
│  │  │ Designer                  │  │   │  │     (可视化 Zone 编排)     │  │  │
│  │  │ (单 Agent 工作流配置)      │  │   │  │                           │  │  │
│  │  └───────────────────────────┘  │   │  └───────────────────────────┘  │  │
│  └─────────────────────────────────┘   └─────────────────────────────────┘  │
│                    │                                    │                    │
│                    ▼                                    ▼                    │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        Agent Platform Layer                              ││
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────────┐││
│  │  │ Provider      │  │ Workflow      │  │ LangGraph                     │││
│  │  │ Registry      │  │ Store         │  │ Orchestrator                  │││
│  │  │ (LangChain)   │  │ (JSON)        │  │ (多 Agent 协作)               │││
│  │  └───────────────┘  └───────────────┘  └───────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
│                                       │                                      │
│                                       ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────────┐│
│  │                        Electron IPC Layer                                ││
│  │  ┌───────────────┐  ┌───────────────┐  ┌───────────────────────────────┐││
│  │  │ API Key       │  │ Provider      │  │ Workflow                      │││
│  │  │ (safeStorage) │  │ Config        │  │ Execution                     │││
│  │  └───────────────┘  └───────────────┘  └───────────────────────────────┘││
│  └─────────────────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────────────────┘
```

## 四、目录结构

```
src/
├── agent-platform/                          # 新建：Agent 平台核心
│   ├── index.ts                             # 统一导出
│   │
│   ├── providers/                           # Provider 适配层
│   │   ├── index.ts
│   │   ├── types.ts                         # Provider 类型定义
│   │   ├── registry.ts                      # Provider 注册表
│   │   ├── adapters/                        # LangChain 适配器
│   │   │   ├── base.ts                      # 基础适配器
│   │   │   ├── openai.ts                    # OpenAI
│   │   │   ├── anthropic.ts                 # Anthropic
│   │   │   ├── google.ts                    # Google Gemini
│   │   │   ├── deepseek.ts                  # DeepSeek
│   │   │   ├── qwen.ts                      # 通义千问
│   │   │   ├── moonshot.ts                  # Moonshot
│   │   │   ├── stepfun.ts                   # StepFun
│   │   │   ├── ollama.ts                    # Ollama (本地)
│   │   │   └── custom.ts                    # 自定义 Provider
│   │   └── config-loader.ts                 # 配置加载器
│   │
│   ├── workflow/                            # 工作流系统
│   │   ├── index.ts
│   │   ├── types.ts                         # 工作流类型定义
│   │   ├── store.ts                         # 工作流存储
│   │   ├── presets/                         # 预设工作流模板
│   │   │   ├── index.ts
│   │   │   ├── single-agent.ts              # 单 Agent 模式
│   │   │   ├── multi-agent-chat.ts          # 多 Agent 聊天
│   │   │   ├── code-review.ts               # 代码审查
│   │   │   └── research-write.ts            # 研究-撰写
│   │   └── converter.ts                     # SWD <-> LangGraph 转换
│   │
│   ├── orchestration/                       # LangGraph 编排层
│   │   ├── index.ts
│   │   ├── graph-builder.ts                 # Graph 构建器
│   │   ├── state.ts                         # 状态定义
│   │   ├── nodes/                           # 节点类型
│   │   │   ├── index.ts
│   │   │   ├── llm-node.ts                  # LLM 调用节点
│   │   │   ├── tool-node.ts                 # 工具节点
│   │   │   ├── router-node.ts               # 路由节点
│   │   │   ├── human-node.ts                # 人工介入
│   │   │   └── parallel-node.ts             # 并行执行
│   │   └── executor.ts                      # 工作流执行器
│   │
│   └── ipc/                                 # Electron IPC
│       ├── index.ts
│       ├── providers.ts                     # Provider IPC
│       ├── workflow.ts                      # Workflow IPC
│       └── execution.ts                     # 执行 IPC
│
├── stratix-character-creator/               # 修改：角色创建
│   ├── ui/
│   │   ├── workflow-editor/                 # 新建：工作流编辑器
│   │   │   ├── index.ts
│   │   │   ├── WorkflowEditorPanel.ts       # 主编辑器面板
│   │   │   ├── ProviderConfigPanel.ts       # Provider 配置
│   │   │   ├── NodePalettePanel.ts          # 节点面板
│   │   │   └── PresetSelectorPanel.ts       # 预设选择器
│   │   └── BackendSelector.ts               # 修改：集成工作流编辑器
│   └── ...
│
├── stratix-rts/                             # 修改：RTS 任务区
│   ├── zones/
│   │   ├── TaskZone.ts                      # 修改：集成 LangGraph
│   │   ├── ZoneConnection.ts                # 修改：支持工作流连接
│   │   └── ZoneWorkflowManager.ts           # 新建：Zone 工作流管理
│   └── ...
│
├── config/
│   ├── providers.config.json                # 修改：增加 langchain 字段
│   └── custom-providers.config.json         # 保持
│
└── electron/
    ├── main.ts                              # 修改：添加新 IPC
    └── preload.ts                           # 修改：暴露新 API
```

## 五、详细实施计划

### Phase 1: 基础设施 (Day 1-2)

#### Day 1: 依赖安装与目录搭建

**任务**：
1. 安装依赖包
2. 创建目录结构
3. 定义核心类型

**依赖安装**：
```bash
npm install @langchain/core @langchain/openai @langchain/anthropic @langchain/community @langchain/google-genai @langchain/langgraph
npm install sequential-workflow-designer
```

**核心类型定义** (`src/agent-platform/providers/types.ts`):
```typescript
export interface ProviderConfig {
  id: string;
  name: string;
  icon: string;
  requiresApiKey: boolean;
  defaultEndpoint: string;
  models: string[];
  langchainClass: string;     // LangChain 类名
  envKey: string | null;
  isCustom?: boolean;
}

export interface ProviderInstance {
  config: ProviderConfig;
  llm: BaseChatModel;         // LangChain 实例
}

export interface CreateProviderOptions {
  providerId: string;
  model: string;
  apiKey?: string;
  endpoint?: string;
  temperature?: number;
  maxTokens?: number;
}
```

#### Day 2: Provider 注册表与适配器

**任务**：
1. 实现基础适配器接口
2. 实现各厂商适配器
3. 实现 Provider 注册表
4. 集成 API Key Store

**适配器示例** (`src/agent-platform/providers/adapters/openai.ts`):
```typescript
import { ChatOpenAI } from '@langchain/openai';
import { LLMAdapter, CreateProviderOptions } from './base';

export class OpenAIAdapter extends LLMAdapter {
  createModel(options: CreateProviderOptions): ChatOpenAI {
    return new ChatOpenAI({
      modelName: options.model,
      openAIApiKey: options.apiKey,
      configuration: options.endpoint ? {
        baseURL: options.endpoint,
      } : undefined,
      temperature: options.temperature ?? 0.7,
      maxTokens: options.maxTokens ?? 4096,
    });
  }
  
  getModels(): string[] {
    return ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', ...];
  }
}
```

---

### Phase 2: 工作流系统 (Day 3-5)

#### Day 3: Sequential Workflow Designer 集成

**任务**：
1. 创建 WorkflowEditorPanel 组件
2. 定义自定义节点类型
3. 集成到 Phaser DOM

**节点类型定义**：
```typescript
export interface AgentWorkflowStep {
  id: string;
  componentType: 'task' | 'decision' | 'parallel' | 'loop' | 'human';
  type: string;              // 具体类型
  name: string;
  properties: {
    providerId?: string;
    model?: string;
    systemPrompt?: string;
    tools?: string[];
    condition?: string;
    // ...
  };
}
```

**UI 集成** (`WorkflowEditorPanel.ts`):
```typescript
import { Designer } from 'sequential-workflow-designer';
import 'sequential-workflow-designer/css/designer.css';
import 'sequential-workflow-designer/css/designer-dark.css';

export class WorkflowEditorPanel {
  private designer: Designer | null = null;
  
  async create(parent: HTMLElement): Promise<void> {
    const definition = this.createInitialDefinition();
    const configuration = this.createConfiguration();
    
    this.designer = Designer.create(parent, definition, configuration);
    this.designer.onDefinitionChanged.subscribe(this.onDefinitionChanged);
  }
  
  private createConfiguration(): Configuration {
    return {
      theme: 'dark',
      toolbox: {
        groups: [
          { name: 'LLM Nodes', steps: this.getLLMNodeTemplates() },
          { name: 'Control Flow', steps: this.getControlFlowTemplates() },
          { name: 'Human', steps: this.getHumanNodeTemplates() },
        ],
      },
      editors: {
        stepEditorProvider: this.createStepEditor.bind(this),
      },
    };
  }
}
```

#### Day 4: 预设工作流模板

**任务**：
1. 创建单 Agent 模板
2. 创建多 Agent 协作模板
3. 创建行业场景模板

**模板示例**：
```typescript
// src/agent-platform/workflow/presets/multi-agent-chat.ts
export const multiAgentChatPreset: WorkflowPreset = {
  id: 'multi-agent-chat',
  name: '多 Agent 协作讨论',
  description: '多个专业 Agent 讨论并汇总结果',
  definition: {
    properties: { name: '多 Agent 讨论' },
    sequence: [
      {
        id: 'coordinator',
        componentType: 'task',
        type: 'llm',
        name: '协调者',
        properties: {
          role: 'coordinator',
          systemPrompt: '你是一个协调者，负责分配任务...',
        },
      },
      {
        id: 'parallel-experts',
        componentType: 'parallel',
        type: 'parallel',
        name: '专家并行处理',
        properties: {},
        sequences: [
          [{ id: 'researcher', componentType: 'task', type: 'llm', ... }],
          [{ id: 'analyst', componentType: 'task', type: 'llm', ... }],
          [{ id: 'writer', componentType: 'task', type: 'llm', ... }],
        ],
      },
      {
        id: 'summarizer',
        componentType: 'task',
        type: 'llm',
        name: '汇总者',
        properties: { role: 'summarizer' },
      },
    ],
  },
};
```

#### Day 5: 工作流存储与转换

**任务**：
1. 实现工作流 JSON 存储
2. 实现 SWD -> LangGraph 转换器
3. 实现工作流版本管理

---

### Phase 3: LangGraph 编排层 (Day 6-8)

#### Day 6: Graph 构建器

**任务**：
1. 定义 Agent 状态
2. 实现 Graph 构建器
3. 实现节点执行器

**状态定义** (`src/agent-platform/orchestration/state.ts`):
```typescript
import { Annotation } from '@langchain/langgraph';

export const AgentState = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    default: () => [],
    reducer: (x, y) => x.concat(y),
  }),
  currentTask: Annotation<string>,
  results: Annotation<Record<string, any>>({
    default: () => ({}),
  }),
  nextAgent: Annotation<string | null>,
  humanInput: Annotation<string | null>,
});
```

**Graph 构建器** (`graph-builder.ts`):
```typescript
import { StateGraph, END } from '@langchain/langgraph';

export class AgentGraphBuilder {
  buildFromDefinition(definition: WorkflowDefinition): CompiledStateGraph {
    const graph = new StateGraph(AgentState);
    
    // 添加节点
    for (const step of definition.sequence) {
      const executor = this.createExecutor(step);
      graph.addNode(step.id, executor);
    }
    
    // 添加边
    this.addEdges(graph, definition.sequence);
    
    graph.setEntryPoint(definition.sequence[0].id);
    return graph.compile();
  }
}
```

#### Day 7: 多 Agent 协作节点

**任务**：
1. 实现 LLM 调用节点
2. 实现并行执行节点
3. 实现条件路由节点
4. 实现人工介入节点

#### Day 8: 工作流执行器

**任务**：
1. 实现执行上下文
2. 实现流式输出
3. 实现执行监控
4. 实现错误处理

---

### Phase 4: UI 集成 (Day 9-10)

#### Day 9: 角色创建界面集成

**任务**：
1. 修改 BackendSelector 集成工作流编辑器
2. 实现 Provider 配置面板
3. 实现预设选择器

**界面布局**：
```
┌─────────────────────────────────────────────────────────────┐
│  角色配置                                                    │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐   │
│  │  [模板选择 ▼] [单 Agent] [多 Agent 协作] [代码审查]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                                                       │   │
│  │        Sequential Workflow Designer Canvas           │   │
│  │                                                       │   │
│  │   ┌───────┐      ┌───────┐      ┌───────┐           │   │
│  │   │ 协调者 │ ───▶ │ 专家1 │ ───▶ │ 汇总者 │           │   │
│  │   │ (LLM) │      │ (LLM) │      │ (LLM) │           │   │
│  │   └───────┘      └───────┘      └───────┘           │   │
│  │                                                       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  节点配置面板 (点击节点时显示)                        │   │
│  │  Provider: [OpenAI ▼]  Model: [gpt-4o ▼]            │   │
│  │  System Prompt: [________________________________]  │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [保存配置]                          [测试运行]            │
└─────────────────────────────────────────────────────────────┘
```

#### Day 10: TaskZone 集成

**任务**：
1. 修改 TaskZone 支持工作流
2. 实现 ZoneWorkflowManager
3. 实现 Zone 间工作流传递

**TaskZone 扩展**：
```typescript
export class TaskZone extends BaseZone {
  private workflowId: string | null = null;
  private workflowExecutor: WorkflowExecutor | null = null;
  
  setWorkflow(workflowId: string): void {
    this.workflowId = workflowId;
    // 更新 UI 显示
  }
  
  async startExecution(input: any): Promise<void> {
    if (!this.workflowId) return;
    this.workflowExecutor = await createExecutor(this.workflowId);
    
    // 流式执行并更新状态
    for await (const event of this.workflowExecutor.stream(input)) {
      this.updateProgress(event);
    }
  }
}
```

---

### Phase 5: IPC 与测试 (Day 11-12)

#### Day 11: Electron IPC 完善

**新增 IPC 处理器**：
```typescript
// src/electron/main.ts

// Provider 相关
ipcMain.handle('provider:list', handleProviderList);
ipcMain.handle('provider:test', handleProviderTest);
ipcMain.handle('provider:create-model', handleProviderCreateModel);

// Workflow 相关
ipcMain.handle('workflow:list', handleWorkflowList);
ipcMain.handle('workflow:save', handleWorkflowSave);
ipcMain.handle('workflow:load', handleWorkflowLoad);
ipcMain.handle('workflow:delete', handleWorkflowDelete);

// Execution 相关
ipcMain.handle('execution:start', handleExecutionStart);
ipcMain.handle('execution:stop', handleExecutionStop);
ipcMain.handle('execution:status', handleExecutionStatus);
```

#### Day 12: 测试与文档

**测试计划**：
1. Provider 适配器单元测试
2. 工作流转换器单元测试
3. Graph 构建器集成测试
4. E2E 流程测试

---

## 六、迁移清单

| 原文件 | 迁移策略 | 新位置/处理 |
|--------|----------|-------------|
| `providers.config.json` | 扩展 | 增加 `langchainClass` 字段 |
| `providerConfig.ts` | 迁移 | → `agent-platform/providers/registry.ts` |
| `apiKeyStore.ts` | 保持 | 无需修改 |
| `DirectLLMConfigPanel.ts` | 废弃 | → `WorkflowEditorPanel.ts` |
| `StratixAgentConfigPanel.ts` | 废弃 | → `WorkflowEditorPanel.ts` |
| `BackendSelector.ts` | 修改 | 集成工作流编辑器 |
| `ZoneConnection.ts` | 扩展 | 支持工作流引用 |

---

## 七、配置文件更新

**providers.config.json 扩展**：
```json
{
  "providers": {
    "openai": {
      "name": "OpenAI",
      "icon": "🤖",
      "requiresApiKey": true,
      "defaultEndpoint": "https://api.openai.com/v1",
      "models": ["gpt-4o", "gpt-4o-mini"],
      "langchainClass": "ChatOpenAI",
      "langchainModule": "@langchain/openai",
      "envKey": "OPENAI_API_KEY"
    },
    "anthropic": {
      "langchainClass": "ChatAnthropic",
      "langchainModule": "@langchain/anthropic"
    }
  }
}
```

---

## 八、时间线总结

| Phase | 天数 | 交付物 |
|-------|------|--------|
| **Phase 1: 基础设施** | Day 1-2 | 依赖、目录、类型、Provider 注册表 |
| **Phase 2: 工作流系统** | Day 3-5 | SWD 集成、预设模板、存储转换 |
| **Phase 3: LangGraph 编排** | Day 6-8 | Graph 构建、节点执行、执行器 |
| **Phase 4: UI 集成** | Day 9-10 | 角色创建集成、TaskZone 集成 |
| **Phase 5: IPC 与测试** | Day 11-12 | IPC 完善、测试、文档 |

---

## 九、风险与缓解

| 风险 | 概率 | 缓解措施 |
|------|------|----------|
| LangGraph 学习曲线 | 中 | 先实现简单场景，参考官方示例 |
| SWD 与 Phaser DOM 兼容 | 低 | SWD 是纯 DOM + SVG，可直接嵌入 |
| 多 Agent 调试复杂 | 高 | 实现可视化执行追踪 |
| 向后兼容 | 低 | 保留原 BackendSelector 结构 |

---

## 十、待确认问题

1. **工作流存储位置**：存在 `userData/workflows/` 还是 SQLite？
2. **执行历史**：是否需要保存执行日志？
3. **并发执行**：一个 Zone 是否可以同时执行多个工作流实例？
4. **权限控制**：是否需要工作流级别的权限管理？

---

## 附录：参考资源

- [LangChain 文档](https://python.langchain.com/docs/)
- [LangGraph 文档](https://langchain-ai.github.io/langgraph/)
- [Sequential Workflow Designer](https://github.com/nocode-js/sequential-workflow-designer)
- [LangChain JS](https://js.langchain.com/docs/)
