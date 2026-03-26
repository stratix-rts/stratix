# Zone 编辑 UI 集成计划

## 背景

Zone 系统后端 CRUD 已完成，但前端没有编辑入口。已创建的 Zone 组件（ZoneList/ZoneDetail/ZoneEditor/ZoneFilePicker）未被使用。

## Zone 核心理念

**Zone = OKR 机制**
- Zone title = O（Objective，目标）
- Zone prompt = KR（Key Results，关键结果）
- Zone 内的 Agent 根据 Zone 的 O 和 KR 调整自身目标
- 文件只是参考资料

## 关键设计决策

| 决策 | 选择 |
|------|------|
| Agent 感知 Zone 变化 | **WebSocket 推送** |
| 面板分离 | **ProjectConfigPanel 和 ZoneDetail 保持分离** |

## 数据库现状

- `zones` 表（ORCHESTRATION）- 存储位置信息，zone_context_id FK 关联 zone_contexts
- `zone_contexts` 表 - 存储 OKR 数据（title=O, prompt=KR）

## WebSocket 推送设计

### 事件流

```
用户编辑 Zone title/prompt
        ↓
PUT /api/projects/:id/zones/:id
        ↓
ZoneService 更新数据库
        ↓
gatewayEventBus 发布 'zone:updated' 事件
        ↓
StatusSyncService 通过 WebSocket 推送给所有客户端
        ↓
Agent 订阅者收到通知，重新拉取 Zone 数据
```

### 新增事件

| 事件 | Payload | 说明 |
|------|----------|------|
| `zone:updated` | `{ zoneId, projectId, title, prompt }` | Zone 内容更新 |
| `zone:file_added` | `{ zoneId, file }` | 新增文件 |
| `zone:file_removed` | `{ zoneId, fileId }` | 删除文件 |
| `zone:member_joined` | `{ zoneId, agentId }` | Agent 进入 |
| `zone:member_left` | `{ zoneId, agentId }` | Agent 离开 |

## ZoneDetail UI 布局

```
┌─────────────────────────────────┐
│ Zone标题 (O) - 可编辑           │
├─────────────────────────────────┤
│ Zone说明 (KR) - 可编辑          │
│ "本周完成用户调研报告..."       │
├─────────────────────────────────┤
│ 上下文文件                      │
│ [+ 添加文件] [扫描文件夹]       │
│ - 竞品分析.pdf                  │
├─────────────────────────────────┤
│ 成员                            │
│ [agent_1 ×] [agent_2 ×]       │
└─────────────────────────────────┘
```

## App.vue 集成

```
App.vue
├── MainLayout
├── ProjectConfigPanel (保留 - 新建项目时)
├── CharacterCreatorModal (保留)
├── AgentChatModal (保留)
└── ZonePanel (新增 - 编辑 Zone 时)
    └── ZoneDetail
```

## 事件处理

| 事件 | 处理 |
|------|------|
| zone:double-click | 获取 Zone → 显示 ZonePanel |
| update-zone | PUT + WebSocket 推送 |
| delete-zone | DELETE → 关闭 Panel |
| add-file | POST + WebSocket 推送 |
| remove-file | DELETE + WebSocket 推送 |
| add-member | POST + WebSocket 推送 |
| remove-member | DELETE + WebSocket 推送 |

## Agent 进入 Zone 机制

### 方式一：用户操作

用户从 RTS 视图中拖拽 Agent 到 Zone：
- Agent 被拖入 Zone 边界
- 触发 `agent:enter_zone` 事件
- 调用 `POST /api/projects/:projectId/zones/:zoneId/members/:agentId`

### 方式二：Agent 自主决策

Agent 空闲时，系统提示词包含：
- 当前 Zone 列表（名称 + O/KR）
- 各 Zone 参与 Agent 数量
- Agent 自身状态

Agent 可调用 RTS 移动函数自主进入：
```
moveTo(x, y) → 进入目标 Zone
leaveCurrentZone() → 离开当前 Zone
```

### RTS 移动函数

```typescript
interface RTSMoveAPI {
  moveTo(zoneId: string): Promise<void>;  // 移动到 Zone
  leaveCurrentZone(): Promise<void>;        // 离开当前 Zone
  getCurrentZone(): string | null;          // 获取当前位置
  getZoneList(): ZoneInfo[];               // 获取 Zone 列表
}
```

## 涉及文件

| 文件 | 修改 |
|------|------|
| `src/stratix-gateway/project/ZoneService.ts` | CRUD + 事件发布 |
| `src/stratix-gateway/api/routes/zone.ts` | CRUD + 事件发布 |
| `src/stratix-gateway/api/websocket/StatusSync.ts` | Zone 事件推送 |
| `src/stratix-rts/StratixRTSGameScene.ts` | Agent 移动函数 |
| `src/stratix-core/*` | RTSMoveAPI 接口定义 |
| `src/App.vue` | ZonePanel + WebSocket 订阅 |
| `src/stratix-project/ui/ZoneDetail.vue` | 完善事件处理 |
| `src/stratix-project/ui/ZoneFilePicker.vue` | 实现文件浏览 |

## 废弃标记

- `zone:double-click` → TaskModal 逻辑 → `@deprecated`
- TaskModal 相关代码 → `@deprecated`

## 验证步骤

1. `npm run dev` 启动
2. 绘制 Zone → 项目配置 → 保存
3. 双击 Zone → ZoneDetail 打开
4. 编辑 O/KR → 验证 WebSocket 推送
5. Agent 空闲时 → 验证提示词包含 Zone 列表
6. Agent 调用 moveTo → 验证进入 Zone
