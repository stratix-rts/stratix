# Phase 2 设计决策总结

## ✅ 已确认的设计决策

### 1. AI API 密钥管理
**决策**: 使用环境变量
```bash
# .env
OPENAI_API_KEY=sk-xxx
ANTHROPIC_API_KEY=sk-xxx
OLLAMA_BASE_URL=http://localhost:11434
```

---

### 2. 任务区类型定义
**决策**: 固定类型 + 不同视觉样式

```typescript
enum TaskType {
  REQUIREMENT = 'requirement',   // 需求分析 - 蓝色
  DESIGN = 'design',             // 设计 - 紫色
  DEVELOPMENT = 'development',   // 开发 - 绿色
  TEST = 'test',                 // 测试 - 橙色
  DEPLOY = 'deploy',             // 部署 - 红色
  WRITING = 'writing',           // 写作 - 青色
  RESEARCH = 'research',         // 研究 - 黄色
  CUSTOM = 'custom'              // 自定义 - 灰色
}
```

**视觉样式**:
- 每种类型有不同的颜色
- 不同的图标
- 可能不同的形状

---

### 3. 蓝图与项目区的关系
**核心概念**: 🎮 **游戏副本模式**

**流程**:
1. 用户在项目配置时提交需求
2. AI 解析需求 → 生成蓝图预览
3. 用户微调蓝图
4. 确认蓝图 → 在项目区中生成任务区
5. 用户"进入"项目区 → 像进入游戏副本
6. AI Agent 精灵角色在任务区上工作

**布局方式**:
- 树状排列（类似组织架构图）
- 从上到下按依赖关系排列
- 用户可拖拽调整

---

### 4. 需求解析数据结构
**决策**: 采用建议结构

```typescript
interface ParsedRequirement {
  summary: string;
  tasks: Array<{
    id: string;
    name: string;
    type: TaskType;
    description: string;
    estimatedTime?: number;
    dependencies: string[];
    priority: number;
  }>;
  metadata?: {
    originalRequirement: string;
    parseTime: Date;
    model: string;
    provider: string;
  };
}
```

---

### 5. 任务拆分策略
**决策**: 用户可选择三种方式

1. **按流程顺序** (sequential)
   - 分析 → 设计 → 开发 → 测试 → 部署
   
2. **按任务类型** (by_type)
   - 前端任务、后端任务、数据库任务、测试任务等
   
3. **按优先级** (by_priority)
   - P1 核心功能、P2 重要功能、P3 优化功能

**配置**:
```typescript
interface SplitConfig {
  strategy: 'sequential' | 'by_type' | 'by_priority';
  maxTasks?: number;  // 最多拆分多少个任务
  minTaskDuration?: number;  // 最小任务时长（分钟）
}
```

---

### 6. MD 文档管理
**决策**: 本地存储 + 持久化关联

- **存储位置**: 本地文件系统（Electron）
- **格式支持**: .md, .txt
- **大小限制**: 无
- **持久化**: 文件路径关联到项目配置

```typescript
interface ProjectConfig {
  // ... 其他配置
  requirement: {
    type: 'text' | 'file';
    content?: string;  // 直接文本
    filePath?: string;  // 文件路径
    fileName?: string;
  };
}
```

---

### 7. AI 流式响应
**决策**: 需要实现

- 实时显示 AI 思考过程
- 更好的用户体验
- 显示解析进度

**实现**:
```typescript
interface AIStreamCallback {
  onToken: (token: string) => void;
  onComplete: (result: any) => void;
  onError: (error: Error) => void;
}
```

---

### 8. AI 调用失败处理
**决策**: 4级降级策略

```typescript
async function parseWithFallback(requirement: string): Promise<ParsedRequirement> {
  try {
    // 1. 尝试默认 Provider
    return await parse(requirement);
  } catch (error) {
    try {
      // 2. 重试 3 次
      return await retry(parse, 3);
    } catch (error) {
      try {
        // 3. 切换 Provider
        return await switchProvider(parse);
      } catch (error) {
        // 4. 提供手动模式
        return await manualMode(requirement);
      }
    }
  }
}
```

---

### 9. 蓝图微调功能
**支持的功能**:
- ✅ 拖拽节点调整位置
- ✅ 添加/删除任务
- ✅ 编辑任务名称和描述
- ✅ 修改依赖关系
- ✅ 调整任务优先级

**不支持**:
- ❌ 修改任务类型（需重新解析）
- ❌ 拆分/合并任务（复杂度高）

---

### 10. 任务区布局算法
**决策**: 依赖关系 + 可拖拽

```typescript
// 布局算法
function layoutTaskZones(tasks: Task[]): LayoutResult {
  // 1. 按依赖关系构建 DAG
  const dag = buildDAG(tasks);
  
  // 2. 层次布局（拓扑排序）
  const layers = topologicalSort(dag);
  
  // 3. 计算每个任务的位置
  const positions = calculatePositions(layers);
  
  return positions;
}
```

**特点**:
- 自动按依赖关系排列
- 从上到下树状结构
- 用户可拖拽微调
- 保存用户调整后的位置

---

## 🎯 核心架构设计

### 模块结构
```
src/
├── stratix-ai-service/          # AI 服务层
│   ├── core/
│   │   ├── AIServiceProvider.ts
│   │   ├── OpenAIProvider.ts
│   │   ├── ClaudeProvider.ts
│   │   ├── OllamaProvider.ts
│   │   └── AIServiceFactory.ts
│   ├── parsers/
│   │   ├── RequirementParser.ts
│   │   └── TaskSplitter.ts
│   └── prompts/
│       ├── requirement-parsing.ts
│       └── task-splitting.ts
│
├── stratix-blueprint/           # 蓝图层
│   ├── core/
│   │   ├── BlueprintCanvas.ts
│   │   ├── TaskNode.ts
│   │   ├── DependencyLine.ts
│   │   └── LayoutEngine.ts
│   └── ui/
│       └── BlueprintPreview.vue
│
└── stratix-project/             # 项目层（已有）
    └── core/
        ├── ProjectManager.ts    # 增强：支持 AI 拆分
        └── ProjectZone.ts       # 增强：支持任务区
```

---

## 🔄 工作流程

### 完整流程
```
1. 用户创建项目
   ↓
2. 提交需求（文本 or 文件）
   ↓
3. 选择拆分策略
   ↓
4. AI 解析需求（流式显示）
   ↓
5. 生成蓝图预览
   ↓
6. 用户微调蓝图
   ├─ 添加/删除任务
   ├─ 调整依赖关系
   └─ 拖拽位置
   ↓
7. 确认蓝图
   ↓
8. 在项目区中生成任务区（树状布局）
   ↓
9. 用户"进入"项目区
   ↓
10. AI Agent 在任务区上工作
```

---

## 📊 数据流

```
用户输入
  ↓
RequirementParser
  ↓
ParsedRequirement
  ↓
TaskSplitter
  ↓
Task[] (带依赖关系)
  ↓
BlueprintCanvas
  ↓
用户微调
  ↓
LayoutEngine
  ↓
TaskZone[] (带位置)
  ↓
ProjectManager
  ↓
保存到数据库
```

---

## 🎨 UI 设计要点

### 任务区颜色方案
```typescript
const TASK_TYPE_COLORS = {
  requirement: 0x4A90E2,  // 蓝色
  design: 0x9B59B6,       // 紫色
  development: 0x2ECC71,  // 绿色
  test: 0xE67E22,         // 橙色
  deploy: 0xE74C3C,       // 红色
  writing: 0x1ABC9C,      // 青色
  research: 0xF1C40F,     // 黄色
  custom: 0x95A5A6        // 灰色
};
```

### 蓝图预览界面
- 左侧：任务列表（可折叠）
- 中间：画布（可缩放、平移）
- 右侧：任务详情面板
- 底部：操作按钮（确认、微调、取消）

---

## 📝 需要创建的配置文件

### 1. AI 配置
`config/ai.config.json`
```json
{
  "defaultProvider": "openai",
  "providers": {
    "openai": {
      "apiKey": "${OPENAI_API_KEY}",
      "model": "gpt-4",
      "temperature": 0.7
    },
    "claude": {
      "apiKey": "${ANTHROPIC_API_KEY}",
      "model": "claude-3-opus-20240229",
      "temperature": 0.7
    },
    "ollama": {
      "baseUrl": "${OLLAMA_BASE_URL}",
      "model": "llama2"
    }
  },
  "retryAttempts": 3,
  "timeout": 60000
}
```

### 2. 任务类型配置
`config/task-types.config.json`
```json
{
  "types": [
    {
      "id": "requirement",
      "name": "需求分析",
      "color": "#4A90E2",
      "icon": "📋"
    },
    {
      "id": "design",
      "name": "设计",
      "color": "#9B59B6",
      "icon": "🎨"
    }
  ]
}
```

---

**设计确认日期**: 2026-03-02  
**准备状态**: ✅ 可以开始开发
