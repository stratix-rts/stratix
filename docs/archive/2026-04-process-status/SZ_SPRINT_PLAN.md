# System Zone 智能化冲刺计划 v2

> **目标**: 让 System Zone 从"界面能看"变成"LLM 驱动的智能自改进系统"
> **时间**: 2026-04-06 00:00 → 10:00（10 小时）
> **驱动方式**: 心跳机制 + Claude Code 逐 Task 执行

---

## 开发规则

### 编码 Agent 工作流
1. 每次**只安排一个 Task** 给 Claude Code
2. Claude Code 完成后 → 另一个 Claude Code 实例做 **Code Review**
3. Review 通过 → commit
4. Review 不通过 → 修复后重新 review
5. **最小改动原则**，符合全局设计，遵循原有代码风格

### 派活 Prompt 模板（必遵）
```
## 任务
[做什么，一句话说清楚]

## 上下文
[文件路径、类型定义、API 端点、字段对照]
[已有设计约束和代码风格]

## 验收标准
- [ ] [具体可验证的条件]

## 禁止事项
- 禁止 mock 数据绕过功能
- 禁止假设未确认的结构
- 禁止顺便重构/加功能

## 验证方式
[具体命令/步骤]
```

### 编译规则
- 改后端代码：`npm run build:backend && npm run build:electron`
- 改前端代码：Vite 热更新自动生效
- 必须在 Task 完成后验证编译通过

---

## 第一阶段：LLM 智能化（Tasks 1-16）

### 1.1 Observer 深度分析 — Prompt 设计
- **文件**: `src/stratix-systemzone/observer/InsightExtractor.ts`
- **做什么**: 重写 `buildPrompt()` 方法，从简单提取 prompt 改为深度分析 prompt
- **验收标准**:
  - [ ] prompt 引导 LLM 输出结构化 JSON：summary、category、severity、details、suggestion、affectedFiles、confidence
  - [ ] prompt 包含角色设定（你是项目架构分析专家）
  - [ ] prompt 包含输出格式约束和示例
- **验证**: 检查 buildPrompt() 返回的字符串内容

### 1.2 Observer 深度分析 — 响应解析
- **文件**: `src/stratix-systemzone/observer/InsightExtractor.ts`
- **做什么**: 重写 `parseLLMResponse()` 方法，解析新的 JSON 结构
- **依赖**: Task 1.1
- **验收标准**:
  - [ ] 正确解析 LLM 返回的 JSON（summary/category/severity/details/suggestion/affectedFiles/confidence）
  - [ ] JSON 解析失败时降级为简单文本提取（不报错）
  - [ ] 返回类型与 Observer 的 Insight 类型兼容
- **验证**: 单元测试或手动构造 LLM 返回字符串测试解析

### 1.3 Observer 深度分析 — Insight 类型扩展
- **文件**: `src/stratix-systemzone/types.ts`
- **做什么**: 扩展 Insight 类型，新增 severity、category、suggestion、affectedFiles 字段
- **验收标准**:
  - [ ] Insight 类型新增字段，可选（向后兼容）
  - [ ] 不破坏现有使用 Insight 类型的代码
  - [ ] TypeScript 编译通过
- **验证**: `npm run build:backend`

### 1.4 Observer 深度分析 — 流程串联
- **文件**: `src/stratix-systemzone/observer/InsightExtractor.ts`
- **做什么**: 确保 extract() 方法使用新 prompt + 新解析 + 新类型
- **依赖**: Tasks 1.1, 1.2, 1.3
- **验收标准**:
  - [ ] extract() 调用新 buildPrompt() → LLM → 新 parseLLMResponse()
  - [ ] 返回增强后的 Insight 对象
  - [ ] LLM 不可用时降级为原有确定性逻辑（不报错）
- **验证**: TypeScript 编译通过

### 1.5 Observer — Observer.ts 支持 Insight 类型传递
- **文件**: `src/stratix-systemzone/observer/Observer.ts`
- **做什么**: 确保 Observer 的 pipeline 能传递扩展后的 Insight（含新字段）给 API 层
- **依赖**: Task 1.4
- **验收标准**:
  - [ ] processAll() 返回的 Insight 包含新字段
  - [ ] API 层 GET /insights 返回新字段数据
  - [ ] 向后兼容，旧字段不丢
- **验证**: curl 调用 observe 后查 insights

### 1.6 Strategist 智能提案 — Enrich Prompt 设计
- **文件**: `src/stratix-systemzone/strategist/StrategistLLMEnhancer.ts`
- **做什么**: 重写 `callEnrichLLM()` 的 prompt，让 LLM 基于源码上下文生成具体改进方案
- **验收标准**:
  - [ ] prompt 包含扫描结果 + 目标文件源码
  - [ ] 要求输出：title、description、codeSuggestion、riskLevel、effortEstimate
  - [ ] prompt 角色设定为代码审查专家
- **验证**: 检查 prompt 构造逻辑

### 1.7 Strategist 智能提案 — Architecture Prompt 设计
- **文件**: `src/stratix-systemzone/strategist/StrategistLLMEnhancer.ts`
- **做什么**: 重写 `callArchitectureLLM()` 的 prompt，让 LLM 做架构级分析
- **验收标准**:
  - [ ] prompt 引导 LLM 分析模块耦合、职责划分、架构问题
  - [ ] 输出结构：issues[] 每个 issue 含 title、severity、description、suggestion
  - [ ] 不依赖特定框架知识（通用软件架构视角）
- **验证**: 检查 prompt 构造逻辑

### 1.8 Strategist 智能提案 — 响应解析升级
- **文件**: `src/stratix-systemzone/strategist/StrategistLLMEnhancer.ts`
- **做什么**: 升级 JSON 解析逻辑，解析新的 enrich 和 architecture 输出结构
- **依赖**: Tasks 1.6, 1.7
- **验收标准**:
  - [ ] 正确解析 codeSuggestion、riskLevel、effortEstimate
  - [ ] 解析失败降级为原有确定性映射（不报错）
  - [ ] TypeScript 编译通过
- **验证**: `npm run build:backend`

### 1.9 Strategist — Proposal 类型扩展
- **文件**: `src/stratix-systemzone/types.ts`
- **做什么**: Proposal 类型新增 codeSuggestion、riskLevel、effortEstimate 字段
- **验收标准**:
  - [ ] 新字段可选，向后兼容
  - [ ] 不破坏现有代码
  - [ ] TypeScript 编译通过
- **验证**: `npm run build:backend`

### 1.10 Strategist — analyze() 串联 LLM 增强
- **文件**: `src/stratix-systemzone/strategist/Strategist.ts`
- **做什么**: 确保 analyze() 流程：扫描 → 确定性映射 → LLM 增强（enrich + architecture）
- **依赖**: Tasks 1.6-1.9
- **验收标准**:
  - [ ] analyze() 调用 LLM enhancer 并合并结果到 proposals
  - [ ] LLM 不可用时只返回确定性映射的 proposals
  - [ ] Proposal 包含新字段
- **验证**: TypeScript 编译通过

### 1.11 LLM 状态检测 API
- **文件**: `src/stratix-systemzone/api/routes/systemzone.ts`
- **做什么**: 新增 GET /llm-config/status，返回 LLM 是否已配置
- **验收标准**:
  - [ ] 返回 { configured: boolean, provider: string, model: string }
  - [ ] 检测 process.env.LLM_API_KEY 是否存在
  - [ ] TypeScript 编译通过
- **验证**: curl 调用验证返回格式

### 1.12 LLM 状态 — Store 集成
- **文件**: `src/stores/systemzone.ts`
- **做什么**: 新增 llmStatus state + fetchLLMStatus action，initialize 时加载
- **依赖**: Task 1.11
- **验收标准**:
  - [ ] llmStatus 响应式状态
  - [ ] fetchLLMStatus() 调用新 API
  - [ ] initialize() 包含 fetchLLMStatus()
- **验证**: TypeScript 编译通过

### 1.13 LLM 状态 — StatusHeader 指示灯
- **文件**: `src/stratix-systemzone/ui/StatusHeader.vue`
- **做什么**: 显示 LLM 状态指示（绿色=已配置，黄色=未配置/降级）
- **依赖**: Task 1.12
- **验收标准**:
  - [ ] 读取 store.llmStatus 显示状态灯
  - [ ] hover 显示 provider/model 信息
  - [ ] 暗色风格一致
- **验证**: 前端编译通过，页面显示正常

### 1.14 Observer API 返回增强字段
- **文件**: `src/stratix-systemzone/api/routes/systemzone.ts`
- **做什么**: observe 和 insights API 返回新增的 severity、category 等字段
- **依赖**: Task 1.5
- **验收标准**:
  - [ ] POST /observe 返回含新字段的 insights
  - [ ] GET /insights 返回含新字段
  - [ ] 向后兼容
- **验证**: curl 测试

### 1.15 Strategist API 返回增强字段
- **文件**: `src/stratix-systemzone/api/routes/systemzone.ts`
- **做什么**: analyze 和 proposals API 返回新增的 codeSuggestion、riskLevel 等字段
- **依赖**: Task 1.10
- **验收标准**:
  - [ ] POST /analyze 返回含新字段的 proposals
  - [ ] GET /proposals 返回含新字段
  - [ ] 向后兼容
- **验证**: curl 测试

### 1.16 第一阶段编译验证
- **做什么**: 全量编译 + 端到端 curl 验证
- **验收标准**:
  - [ ] `npm run build:backend && npm run build:electron` 通过
  - [ ] 重启 Electron 后 API 正常
  - [ ] observe + analyze 不报错（即使没有 inputs 也不崩）

---

## 第二阶段：端到端链路打通（Tasks 17-24）

### 2.1 ProjectScanner — tsc 扫描实现
- **文件**: `src/stratix-systemzone/strategist/ProjectScanner.ts`
- **做什么**: 实现 tsc --noEmit 扫描，解析输出为 ScanResult
- **验收标准**:
  - [ ] 执行 `npx tsc --noEmit --pretty false` 获取类型错误
  - [ ] 解析为结构化的错误列表（file、line、message、code）
  - [ ] tsc 不可用时返回空结果（不报错）
- **验证**: 手动调用 scan() 看输出

### 2.2 ProjectScanner — eslint 扫描实现
- **文件**: `src/stratix-systemzone/strategist/ProjectScanner.ts`
- **做什么**: 实现 eslint 扫描，解析 JSON 输出
- **验收标准**:
  - [ ] 执行 `npx eslint --format json` 获取 lint 问题
  - [ ] 解析为结构化的问题列表（file、rule、severity、message）
  - [ ] eslint 不可用时返回空结果
- **验证**: 手动调用看输出

### 2.3 ProjectScanner — 文件体积扫描
- **文件**: `src/stratix-systemzone/strategist/ProjectScanner.ts`
- **做什么**: 扫描文件行数，标记超过阈值的文件
- **验收标准**:
  - [ ] 遍历 src/ 目录统计行数
  - [ ] >500 行的文件标记为 needs-refactor
  - [ ] 排除 node_modules、dist、__tests__
- **验证**: 检查扫描结果合理性

### 2.4 ProjectScanner — scan() 整合
- **文件**: `src/stratix-systemzone/strategist/ProjectScanner.ts`
- **做什么**: 整合 tsc + eslint + 文件扫描为一个统一 ScanResult
- **依赖**: Tasks 2.1, 2.2, 2.3
- **验收标准**:
  - [ ] scan() 返回包含三部分结果的 ScanResult
  - [ ] 每部分独立，一个失败不影响其他
  - [ ] TypeScript 编译通过
- **验证**: `npm run build:backend`

### 2.5 端到端 — observe 跑通
- **做什么**: 确保 POST /observe 从扫描到洞察完整跑通
- **依赖**: Tasks 1.16, 2.4
- **验收标准**:
  - [ ] `curl -X POST /api/systemzone/observe` 返回 success
  - [ ] GET /insights 返回真实洞察数据（非空）
  - [ ] 洞察包含 severity/category 等新字段
  - [ ] 不报错
- **验证**: curl 调用

### 2.6 端到端 — analyze 跑通
- **做什么**: 确保 POST /analyze 从扫描到提案完整跑通
- **依赖**: Task 2.5
- **验收标准**:
  - [ ] `curl -X POST /api/systemzone/analyze` 返回 success
  - [ ] GET /proposals 返回真实提案数据（非空）
  - [ ] 提案包含 codeSuggestion/riskLevel 等新字段
  - [ ] 不报错
- **验证**: curl 调用

### 2.7 端到端 — 前端数据展示验证
- **做什么**: 确认 InsightsPanel 和 ProposalsPanel 展示真实数据
- **依赖**: Tasks 2.5, 2.6
- **验收标准**:
  - [ ] InsightsPanel 展示真实洞察（不再是空列表）
  - [ ] ProposalsPanel 展示真实提案
  - [ ] 不报 JavaScript 错误
- **验证**: 打开 System Zone 控制台查看

### 2.8 第二阶段编译验证 + 重启
- **做什么**: 全量编译 + 重启 Electron + 端到端验证
- **验收标准**:
  - [ ] 编译通过
  - [ ] Electron 启动正常
  - [ ] observe → analyze → insights/proposals 全通

---

## 第三阶段：前端体验打磨（Tasks 25-32）

### 3.1 InsightsPanel — severity 分色
- **文件**: `src/stratix-systemzone/ui/InsightsPanel.vue`
- **做什么**: 洞察卡片按 severity 着色（critical=红, warning=黄, info=蓝）
- **依赖**: Task 2.7
- **验收标准**:
  - [ ] 卡片左边框/背景按 severity 分色
  - [ ] 无 severity 的卡片默认灰色
  - [ ] 暗色风格协调
- **验证**: 前端页面查看

### 3.2 InsightsPanel — category 筛选
- **文件**: `src/stratix-systemzone/ui/InsightsPanel.vue`
- **做什么**: 顶部加 category 筛选按钮组
- **依赖**: Task 3.1
- **验收标准**:
  - [ ] 筛选按钮组：All / Architecture / Security / Performance / Quality / Dependency
  - [ ] 点击筛选，列表实时过滤
  - [ ] 暗色风格一致
- **验证**: 前端页面操作

### 3.3 InsightsPanel — 详情展开
- **文件**: `src/stratix-systemzone/ui/InsightsPanel.vue`
- **做什么**: 点击卡片展开详情（details + suggestion + affectedFiles）
- **依赖**: Task 3.2
- **验收标准**:
  - [ ] 点击展开/收起，有过渡动画
  - [ ] 展示 details（详细分析）、suggestion（建议）、affectedFiles（文件列表）
  - [ ] 不影响其他卡片布局
- **验证**: 前端页面操作

### 3.4 ProposalsPanel — 增强卡片信息
- **文件**: `src/stratix-systemzone/ui/ProposalsPanel.vue`
- **做什么**: 提案卡片展示 riskLevel、effortEstimate、description
- **依赖**: Task 2.7
- **验收标准**:
  - [ ] 卡片展示：标题 + 类型 + 风险等级标签 + 工作量估计
  - [ ] riskLevel 用颜色区分（高=红，中=黄，低=绿）
  - [ ] 暗色风格一致
- **验证**: 前端页面查看

### 3.5 ProposalsPanel — 展开代码建议
- **文件**: `src/stratix-systemzone/ui/ProposalsPanel.vue`
- **做什么**: 点击展开显示 codeSuggestion（代码块）和完整 description
- **依赖**: Task 3.4
- **验收标准**:
  - [ ] 展开显示代码建议（等宽字体代码块）
  - [ ] 没有 codeSuggestion 时隐藏代码区域
  - [ ] 展开/收起有过渡动画
- **验证**: 前端页面操作

### 3.6 ProposalsPanel — 批准/拒绝交互优化
- **文件**: `src/stratix-systemzone/ui/ProposalsPanel.vue`
- **做什么**: 批准/拒绝按钮交互优化（确认弹窗、状态切换动画）
- **依赖**: Task 3.5
- **验收标准**:
  - [ ] 点击批准需二次确认
  - [ ] 批准后卡片状态变为 approved（视觉变化）
  - [ ] 拒绝同理
  - [ ] 不报错
- **验证**: 前端页面操作

### 3.7 StatusHeader — 增强 Observer/Strategist 状态
- **文件**: `src/stratix-systemzone/ui/StatusHeader.vue`
- **做什么**: 显示 Observer 和 Strategist 的实时状态和最近活动
- **依赖**: Task 1.13
- **验收标准**:
  - [ ] 显示 Observer 状态（idle/processing）
  - [ ] 显示 Strategist 状态（idle/scanning/analyzing）
  - [ ] 显示最近一次操作时间
- **验证**: 前端页面查看

### 3.8 第三阶段前端验证
- **做什么**: 所有面板交互验证 + 无 JS 错误
- **验收标准**:
  - [ ] 所有 tab 切换正常
  - [ ] 筛选/展开/操作无报错
  - [ ] 暗色风格统一
  - [ ] 响应式布局正常

---

## 第四阶段：收尾（Tasks 33-38）

### 4.1 FitnessPanel — 接入扫描数据
- **文件**: `src/stratix-systemzone/ui/FitnessPanel.vue` + 后端 fitness 相关路由
- **做什么**: 从 ProjectScanner 的扫描结果计算 fitness score
- **验收标准**:
  - [ ] 类型安全分 = (总文件数 - tsc 错误数) / 总文件数 × 100
  - [ ] Lint 分 = (总文件数 - eslint 问题文件数) / 总文件数 × 100
  - [ ] 代码量分 = 1 - (大文件数 / 总文件数)
  - [ ] 综合分 = 加权平均
- **验证**: GET /fitness 返回真实分数

### 4.2 FitnessPanel — 分数可视化
- **文件**: `src/stratix-systemzone/ui/FitnessPanel.vue`
- **做什么**: 用环形进度条或数字展示各维度分数
- **依赖**: Task 4.1
- **验收标准**:
  - [ ] 总分大数字展示
  - [ ] 各维度（类型安全/Lint/代码量）独立展示
  - [ ] 颜色反映分数（绿/黄/红）
- **验证**: 前端页面查看

### 4.3 BootstrapPanel — 一键 cycle
- **文件**: `src/stratix-systemzone/ui/BootstrapPanel.vue` + 后端 cycle 路由
- **做什么**: 手动触发完整 cycle（observe → analyze → propose），展示进度
- **验收标准**:
  - [ ] 按钮触发 cycle
  - [ ] 展示各阶段状态（observing → analyzing → proposing → done）
  - [ ] cycle 完成后自动刷新 insights 和 proposals
- **验证**: 点击按钮跑一轮

### 4.4 BootstrapPanel — 耗时统计
- **文件**: `src/stratix-systemzone/ui/BootstrapPanel.vue`
- **做什么**: 展示每轮 cycle 的总耗时和各阶段耗时
- **依赖**: Task 4.3
- **验收标准**:
  - [ ] cycle 完成后展示总耗时
  - [ ] 展示 observe/analyze/propose 各阶段耗时
  - [ ] 历史记录中保存耗时数据
- **验证**: 跑一轮 cycle 查看

### 4.5 SourcesPanel — placeholder 清理
- **文件**: `src/stratix-systemzone/ui/SourcesPanel.vue`
- **做什么**: 清理已有的 placeholder/mock 内容，确保面板可正常使用
- **验收标准**:
  - [ ] 无 mock 数据
  - [ ] 添加/删除 source 功能正常
  - [ ] 不报错
- **验证**: 前端操作

### 4.6 整体验收
- **做什么**: 跑一轮完整 cycle，记录并修复所有 bug
- **验收标准**:
  - [ ] 完整 cycle 无报错
  - [ ] 所有 tab 数据正常展示
  - [ ] LLM 降级模式正常工作
  - [ ] 编译通过
  - [ ] 无 TypeScript 错误
  - [ ] 无前端 JS 错误
