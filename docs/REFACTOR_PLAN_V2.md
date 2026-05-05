# Project → Zone 统一重构方案 v2

## 核心原则
- 每个 batch 改完必须 `npx tsc --noEmit` 通过
- 每个 batch 包含类型定义 + 所有引用方的同步改动
- 每个 batch 单独 commit
- Kimi 每个 batch 一个 Ralph Loop session

## Batch 拆分

### Batch 1: 类型统一 + Zone interface 增强
**目标**: Zone 成为主类型，Project 变成别名

**改动文件**:
1. `src/stratix-project/types.ts` — Zone 吸收 Project 字段，Project = Zone
2. `src/stratix-project/core/ProjectManager.ts` — new Date() → Date.now()
3. `src/stratix-project/core/ProjectZone.ts` — 适配新 Zone 类型
4. `src/stratix-project/ProjectClient.ts` — 适配新类型
5. `src/stratix-project/ProjectManagerIntegration.ts` — 适配新类型
6. `src/stratix-project/storage/ProjectStore.ts` — 适配新类型
7. `src/stratix-project/index.ts` — 更新导出

**关键设计决策**:
- Zone.name?: string (optional，因为 ZoneRepository 不提供 name)
- Zone.path?: string (optional)
- Zone.config?: any (兼容 ProjectConfig 和视觉 config)
- Zone.zoneConfig?: ZoneConfig (视觉配置)
- Zone.createdAt/updatedAt: number (统一为 number)
- Zone.members/files: optional
- type Project = Zone (别名)

**验收**: `npx tsc --noEmit` 通过

---

### Batch 2: 数据库层 — ZoneRepository 接管 + 删 ProjectRepository
**目标**: ZoneRepository 成为唯一数据源，ProjectRepository 删除

**改动文件**:
1. `src/stratix-database/StratixDatabase.ts` — schema 调整
2. `src/stratix-database/ZoneRepository.ts` — 接管 ProjectRepository 方法
3. `src/stratix-database/ProjectRepository.ts` — 删除
4. `src/stratix-database/index.ts` — 移除 ProjectRepository 导出
5. `src/stratix-database/migrate.ts` — 更新引用
6. `src/stratix-database/AgentCapabilityRepository.ts` — 更新引用
7. `src/stratix-database/AuditLogRepository.ts` — 更新引用
8. `src/stratix-database/TaskFlowRepository.ts` — 更新引用
9. `src/stratix-database/ZoneMemberRepository.ts` — 更新引用

**验收**: `npx tsc --noEmit` 通过

---

### Batch 3: 后端服务层 — ZoneService 统一 + 删 ProjectService
**目标**: ZoneService 成为唯一服务

**改动文件**:
1. `src/stratix-gateway/project/ZoneService.ts` — 合并 ProjectService 方法
2. `src/stratix-gateway/project/ProjectService.ts` — 删除
3. `src/stratix-gateway/project/ZoneFileService.ts` — 更新引用
4. `src/stratix-gateway/project/ZoneMemberService.ts` — 更新引用
5. `src/stratix-gateway/project/ZoneMessageService.ts` — 更新引用
6. `src/stratix-gateway/project/ZoneTaskService.ts` — 更新引用
7. `src/stratix-gateway/project/index.ts` — 移除 ProjectService 导出
8. `src/stratix-gateway/GatewayEventBus.ts` — 更新引用
9. `src/stratix-gateway/AgentOrchestrationService.ts` — 更新引用

**验收**: `npx tsc --noEmit` 通过

---

### Batch 4: API 路由层 — 统一到 /api/zones/*
**目标**: project 路由合并到 zone 路由

**改动文件**:
1. `src/stratix-gateway/api/routes/zone.ts` — 合并 project 路由
2. `src/stratix-gateway/api/routes/project.ts` — 删除
3. `src/stratix-gateway/api/types/api.ts` — 清理 Project API 类型
4. `src/stratix-gateway/index.ts` — 移除 project router 注册
5. `src/stratix-gateway/api/websocket/StatusSync.ts` — 更新引用
6. `src/stratix-gateway/agent/agents/LLMAgent.ts` — 更新引用
7. `src/stratix-gateway/agent/agents/OpenClawAgent.ts` — 更新引用

**验收**: `npx tsc --noEmit` 通过

---

### Batch 5: 前端模块重命名
**目标**: stratix-project 目录内文件重命名，去掉 Project 前缀

**改动文件**:
1. `src/stratix-project/core/ProjectManager.ts` → `ZoneManager.ts`
2. `src/stratix-project/core/ProjectZone.ts` → `GameZone.ts`
3. `src/stratix-project/ProjectClient.ts` → `ZoneClient.ts`
4. `src/stratix-project/ProjectManagerIntegration.ts` → `ZoneManagerIntegration.ts`
5. `src/stratix-project/storage/ProjectStore.ts` → `ZoneStore.ts`
6. `src/stratix-project/index.ts` — 更新所有导出
7. 所有引用这些文件的外部文件更新 import 路径

**验收**: `npx tsc --noEmit` 通过

---

### Batch 6: 前端组件 + Agent + RTS 层清理
**目标**: 清理所有残留 Project 引用

**改动文件**:
1. `src/components/ChatPanel.vue` — 更新引用
2. `src/stores/zone.ts` — 更新引用
3. `src/stratix-agent/core/ZoneAgent.ts` — 更新引用
4. `src/stratix-rts/StratixRTSGameScene.ts` — 更新引用
5. `src/stratix-rts/managers/AgentManager.ts` — 更新引用
6. `src/stratix-rts/managers/ZoneInteractionManager.ts` — 更新引用
7. `src/stratix-rts/zones/UnifiedZoneManager.ts` — 更新引用
8. `src/stratix-core/stratix-protocol.ts` — 更新引用（如有）

**验收**: `npx tsc --noEmit` 通过 + UI 测试通过

---

## Kimi Prompt 模板

每个 batch 的 Kimi prompt 结构：
```
## 任务
[具体做什么]

## 上下文
[改动文件列表、当前类型结构、依赖关系]

## 验收标准
- [ ] npx tsc --noEmit 通过
- [ ] [batch 特定条件]

## 终止条件
tsc 编译通过时输出 <choice>STOP</choice>

## 禁止事项
- 禁止 mock 数据
- 禁止修改本 batch 范围外的文件
- 禁止使用 as any 绕过类型检查（除非 config 字段已明确标注为 any）
- 删除文件用 git rm
```
