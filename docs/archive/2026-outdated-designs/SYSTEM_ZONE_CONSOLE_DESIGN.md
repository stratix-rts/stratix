# System Zone 控制台 - 前端开发设计文档

> 创建时间：2026-04-05
> 状态：待开发
> 前置条件：System Zone 后端 API 已完成（Phase 1-4）

---

## 1. 概述

System Zone 控制台是一个独立的 Vue 页面，通过 Electron 新窗口打开，为用户提供项目自改进系统的完整操作界面。

### 设计原则

- **纯 Vue 实现**：不依赖 Phaser/RTS 渲染循环
- **独立窗口**：通过 Electron IPC 打开新 BrowserWindow
- **零耦合**：不 import 任何 RTS/Phaser 相关代码
- **单一入口**：左上角 logo 旁的图标按钮

---

## 2. 架构分层

```
┌─────────────────────────────────────────┐
│  Electron 主进程                          │
│  - IPC handler: open-system-zone         │
│  - 新 BrowserWindow 创建与管理            │
├─────────────────────────────────────────┤
│  Vue 路由层                               │
│  - /systemzone → SystemZoneConsole.vue   │
├─────────────────────────────────────────┤
│  Pinia Store                             │
│  - useSystemZoneStore (状态 + API 调用)   │
├─────────────────────────────────────────┤
│  Vue 组件层                               │
│  - SystemZoneConsole.vue (主页面)         │
│  - 按功能拆分的子组件（见第 5 节）          │
├─────────────────────────────────────────┤
│  API 层                                  │
│  - /api/systemzone/* (已有后端路由)        │
└─────────────────────────────────────────┘
```

---

## 3. 入口集成

### 3.1 MainLayout.vue 修改

在 logo 区域左侧添加 System Zone 图标按钮：

**位置**：`<div class="logo">` 内部，SVG icon 之前

```
[🔧] [⭐ Stratix 星策系统]  [英雄] [日志] [状态] ...
```

点击行为：通过 Electron IPC 通知主进程打开新窗口。

### 3.2 Electron IPC

**preload.js 添加**：
```typescript
openSystemZone: () => ipcRenderer.send('open-system-zone')
```

**main.ts 添加**：
```typescript
ipcMain.on('open-system-zone', () => {
  // 创建新 BrowserWindow，加载 /systemzone 路由
  // 复用同一个 Vite dev server URL
})
```

### 3.3 Vue Router 添加

```typescript
{ path: '/systemzone', component: () => import('.../SystemZoneConsole.vue') }
```

---

## 4. Pinia Store 设计

### 文件：`src/stores/systemzone.ts`

### 状态结构

```typescript
interface SystemZoneState {
  // 连接状态
  connected: boolean;
  loading: boolean;
  error: string | null;

  // 核心数据
  status: {
    observer: ObserverSummary;
    strategist: StrategistSummary;
    guardian: GuardianState;
  } | null;

  insights: Insight[];
  proposals: Proposal[];
  executions: ExecutionResult[];

  // Bootstrap
  bootstrapStatus: BootstrapStatus | null;
  bootstrapHistory: BootstrapHistoryEntry[];

  // 外部源
  sources: ExternalSource[];

  // 健康报告
  fitnessReport: FitnessReport | null;
}
```

### API 方法（与后端一一对应）

| Store 方法 | HTTP | 后端路由 |
|------------|------|----------|
| `addInput(content)` | POST | `/api/systemzone/inputs` |
| `addBatchInputs(inputs)` | POST | `/api/systemzone/inputs/batch` |
| `triggerObserve()` | POST | `/api/systemzone/observe` |
| `triggerAnalyze()` | POST | `/api/systemzone/analyze` |
| `fetchProposals(status?)` | GET | `/api/systemzone/proposals` |
| `approveProposal(id, action)` | POST | `/api/systemzone/proposals/:id/approve` |
| `executeProposal(id)` | POST | `/api/systemzone/proposals/:id/execute` |
| `fetchInsights()` | GET | `/api/systemzone/insights` |
| `fetchStatus()` | GET | `/api/systemzone/status` |
| `fetchExecutions()` | GET | `/api/systemzone/executions` |
| `fetchFitness()` | GET | `/api/systemzone/fitness` |
| `fetchSources()` | GET | `/api/systemzone/sources` |
| `addSource(source)` | POST | `/api/systemzone/sources` |
| `removeSource(id)` | DELETE | `/api/systemzone/sources/:id` |
| `fetchSource(id)` | GET | `/api/systemzone/sources/:id` |
| `fetchBootstrapStatus()` | GET | `/api/systemzone/bootstrap/status` |
| `startBootstrap()` | POST | `/api/systemzone/bootstrap/start` |
| `stopBootstrap()` | POST | `/api/systemzone/bootstrap/stop` |
| `triggerBootstrapCycle()` | POST | `/api/systemzone/bootstrap/cycle` |
| `setBootstrapMode(mode)` | PUT | `/api/systemzone/bootstrap/mode` |

### 自动刷新

```typescript
// 每 30s 轮询状态（仅在窗口激活时）
startAutoRefresh(intervalMs: number = 30000): void
stopAutoRefresh(): void
```

---

## 5. 组件拆分

### 5.1 主页面：SystemZoneConsole.vue

**职责**：布局容器 + Tab 切换 + 全局状态展示

**布局**：

```
┌──────────────────────────────────────────────────────┐
│ System Zone 控制台                          [×关闭]    │
├──────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────┐ │
│ │ 状态栏：Observer ● | Strategist ● | Guardian ●   │ │
│ └──────────────────────────────────────────────────┘ │
│                                                      │
│ [洞察] [提案] [执行] [外部源] [自举引擎] [健康]       │
│ ┌──────────────────────────────────────────────────┐ │
│ │                                                  │ │
│ │              当前 Tab 内容                        │ │
│ │                                                  │ │
│ └──────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────┘
```

**预估代码量**：~150 行

### 5.2 StatusHeader.vue

**职责**：顶部状态概览（Observer / Strategist / Guardian 运行状态）

- 三个状态指示器，绿色=正常，红色=异常，灰色=未启动
- Guardian 熔断器状态

**预估代码量**：~80 行

### 5.3 InsightsPanel.vue（洞察 Tab）

**职责**：展示 Observer 产出的洞察列表

- 输入框：添加新的输入内容
- 触发观察按钮
- 洞察列表（时间、类型、内容、置信度、实体）
- 归档/取消归档筛选

**预估代码量**：~200 行

### 5.4 ProposalsPanel.vue（提案 Tab）⚠️ 核心

**职责**：展示 Strategist 生成的改进提案，支持审批和执行

- 提案列表（状态筛选：pending/approved/rejected/executed）
- 提案卡片：标题、描述、目标文件、风险等级、类型标签
- 审批操作：批准 / 拒绝（带评论）
- 执行按钮：触发后在 Executor 面板查看进度
- 批量操作：批量批准/拒绝

**预估代码量**：~300 行

### 5.5 ProposalDetail.vue

**职责**：单个提案的详情视图

- 完整描述
- 目标文件列表
- 修改范围（selection）
- Guardian 验证结果
- 执行状态和历史

**预估代码量**：~150 行

### 5.6 ExecutionsPanel.vue（执行 Tab）

**职责**：展示执行历史和当前执行状态

- 执行历史列表
- 单条执行详情（修改内容、测试结果、commit hash）
- 回滚状态（rollbackHash）
- 取消执行按钮

**预估代码量**：~200 行

### 5.7 SourcesPanel.vue（外部源 Tab）

**职责**：管理外部信息源

- 源列表（名称、类型、状态、最后抓取时间）
- 添加源表单（name、type、url、config）
- 编辑/删除源
- 手动抓取按钮
- Webhook 配置展示
- 抓取到的原始输入列表

**预估代码量**：~250 行

### 5.8 BootstrapPanel.vue（自举引擎 Tab）

**职责**：控制自动发现-审批-执行循环

- 引擎状态（运行/停止）
- 启动/停止按钮
- 模式切换（manual / semi_auto / full_auto）
- 手动触发一次循环
- 历史记录列表
- 模式切换确认弹窗（full_auto 需要确认）

**预估代码量**：~200 行

### 5.9 FitnessPanel.vue（健康 Tab）

**职责**：展示项目健康报告

- 健康评分仪表盘
- 各维度分数（测试覆盖率、代码复杂度、依赖健康度等）
- 违规项列表
- Executor 可用性检查

**预估代码量**：~150 行

### 5.10 通用组件

| 组件 | 用途 | 预估行数 |
|------|------|----------|
| `StatusBadge.vue` | 状态标签（pending/approved/...） | ~30 |
| `ConfidenceBar.vue` | 置信度进度条 | ~20 |
| `RiskTag.vue` | 风险等级标签（低/中/高） | ~20 |

---

## 6. 开发顺序

按依赖关系和重要性排序：

### Phase A：骨架（必选）

| Step | 内容 | 预估时间 |
|------|------|----------|
| A1 | Electron IPC + 新窗口 + Vue Router | 30 min |
| A2 | Pinia Store（API 调用 + 状态管理） | 45 min |
| A3 | SystemZoneConsole.vue（布局 + Tab） | 30 min |
| A4 | StatusHeader.vue | 15 min |
| A5 | MainLayout.vue 入口按钮 | 15 min |

### Phase B：核心功能

| Step | 内容 | 预估时间 |
|------|------|----------|
| B1 | InsightsPanel（洞察） | 30 min |
| B2 | ProposalsPanel + ProposalDetail（提案） | 45 min |
| B3 | ExecutionsPanel（执行） | 30 min |

### Phase C：扩展功能

| Step | 内容 | 预估时间 |
|------|------|----------|
| C1 | SourcesPanel（外部源） | 30 min |
| C2 | BootstrapPanel（自举引擎） | 30 min |
| C3 | FitnessPanel（健康报告） | 20 min |

### Phase D：打磨

| Step | 内容 | 预估时间 |
|------|------|----------|
| D1 | 样式统一 + 响应式 | 30 min |
| D2 | 错误处理 + Loading 状态 | 20 min |
| D3 | 自动刷新 + 实时更新 | 20 min |

**总预估代码量**：~1,700 行
**总预估时间**：~5.5 小时（可并行压缩到 ~3 小时）

---

## 7. 文件清单

```
src/
├── stores/
│   └── systemzone.ts                    # Pinia Store
├── components/
│   └── MainLayout.vue                   # 修改：添加入口按钮
├── stratix-systemzone/
│   └── ui/
│       ├── SystemZoneConsole.vue        # 主页面
│       ├── StatusHeader.vue             # 状态栏
│       ├── InsightsPanel.vue            # 洞察
│       ├── ProposalsPanel.vue           # 提案
│       ├── ProposalDetail.vue           # 提案详情
│       ├── ExecutionsPanel.vue          # 执行
│       ├── SourcesPanel.vue             # 外部源
│       ├── BootstrapPanel.vue           # 自举引擎
│       ├── FitnessPanel.vue             # 健康报告
│       └── components/
│           ├── StatusBadge.vue          # 状态标签
│           ├── ConfidenceBar.vue        # 置信度条
│           └── RiskTag.vue              # 风险标签
├── electron/
│   ├── main.ts                          # 修改：添加 IPC handler
│   └── preload.js                       # 修改：暴露 openSystemZone
└── router/
    └── index.ts                         # 修改：添加 /systemzone 路由
```

---

## 8. 设计系统复用

使用项目已有的 design-system tokens（`@/design-system/config`）：

- **颜色**：`getToken('colors.status.success')` 等
- **字体**：`getToken('typography.fontFamily.sans')`
- **间距**：`getToken('spacing.md')`
- **按钮**：复用 `StratixButton` 组件
- **面板**：复用 `StratixPanel` 组件
- **确认弹窗**：复用 `StratixConfirmDialog`

---

## 9. 性能约束

遵循 `docs/PERFORMANCE_GUIDELINES.md`：

- 提案列表虚拟滚动（超过 50 条时）
- API 请求超时 10s
- 自动刷新间隔 30s，窗口不可见时暂停
- 单次加载最多 50 条数据（后端已做分页）
- 组件销毁时清理定时器
