# Project → Zone 统一重构方案

## 目标
消除 Project 概念，统一为 Zone。所有 `Project`/`ProjectZone`/`ProjectManager`/`ProjectClient`/`ProjectStore`/`ProjectService` 命名全部改为 Zone 体系。

## 核心变更
1. **数据库**：`projects` 表废弃，`zone_contexts` 成为主表（清空历史数据，不做迁移）
2. **类型**：`Project` interface 废弃，统一用 `Zone`（已有定义在 types.ts）
3. **前端 RTS**：`ProjectZone` → 直接用 `BaseZone` 子类或重命名
4. **后端**：`ProjectService` 废弃，`ZoneService` 为唯一服务
5. **API 路由**：`/api/projects/*` → `/api/zones/*`

## 依赖顺序（从底层到上层）

### Batch 1: 类型层 — 统一 Zone 类型定义
**文件**: `src/stratix-project/types.ts`
**改动**:
- `Project` interface 中有用的字段合并到 `Zone` interface
- `ProjectZoneConfig` 合并进已有的 Zone config
- `ProjectConfig`、`ProjectStatus`、`ProjectRequirement` 等 Project 专属类型评估是否保留
- 导出统一后的类型

**验收**: `npx tsc --noEmit` 通过

### Batch 2: 数据库层 — ZoneRepository 接管所有数据
**文件**: 
- `src/stratix-database/StratixDatabase.ts`（schema 改动）
- `src/stratix-database/ZoneRepository.ts`（接管 ProjectRepository 的功能）
- `src/stratix-database/ProjectRepository.ts`（删除或清空为 re-export）
- `src/stratix-database/index.ts`
- `src/stratix-database/migrate.ts`

**改动**:
- `zone_contexts` 表增加原来 `projects` 表的必要字段（config、path、present_agent_ids）
- `ZoneRepository` 新增从 `ProjectRepository` 迁移过来的方法
- 删除 `ProjectRepository`，从 index 移除导出
- 清空历史数据（DELETE FROM projects; DELETE FROM zones）

**验收**: `npx tsc --noEmit` 通过

### Batch 3: 后端服务层 — ZoneService 统一
**文件**:
- `src/stratix-gateway/project/ProjectService.ts`（删除）
- `src/stratix-gateway/project/ZoneService.ts`（合并 ProjectService 功能）
- `src/stratix-gateway/project/ZoneMemberService.ts`
- `src/stratix-gateway/project/ZoneFileService.ts`
- `src/stratix-gateway/project/ZoneTaskService.ts`
- `src/stratix-gateway/project/ZoneMessageService.ts`
- `src/stratix-gateway/project/index.ts`

**改动**:
- ZoneService 中所有 `projectId` 参数改为 `zoneId`
- 移除对 `ProjectRepository` 的引用，全部走 `ZoneRepository`
- 删除 ProjectService
- 更新 index.ts 导出

**验收**: `npx tsc --noEmit` 通过

### Batch 4: 后端 API 层 — 路由统一
**文件**:
- `src/stratix-gateway/api/routes/project.ts`（删除）
- `src/stratix-gateway/api/routes/zone.ts`（合并 project 路由）
- `src/stratix-gateway/api/types/api.ts`
- `src/stratix-gateway/index.ts`（路由注册）
- `src/stratix-gateway/GatewayEventBus.ts`
- `src/stratix-gateway/agent/AgentOrchestrationService.ts`
- `src/stratix-gateway/api/websocket/StatusSync.ts`
- `src/stratix-gateway/agent/agents/LLMAgent.ts`
- `src/stratix-gateway/agent/agents/OpenClawAgent.ts`

**改动**:
- `/api/projects/*` 的有效路由合并到 `/api/zones/*`
- Gateway index 中移除 project router 注册
- 所有 `projectId` 引用改为 `zoneId`
- 清理 API types 中的 Project 相关定义

**验收**: `npx tsc --noEmit` 通过

### Batch 5: 前端 RTS 层 — ProjectZone → Zone
**文件**:
- `src/stratix-project/core/ProjectZone.ts`（重命名为 `GameZone.ts` 或合并到 `BaseZone`）
- `src/stratix-project/core/ProjectManager.ts`（重命名/重构为 `ZoneManager.ts`）
- `src/stratix-project/ProjectManagerIntegration.ts`（重构）
- `src/stratix-project/ProjectClient.ts`（重命名/重构为 `ZoneClient.ts`）
- `src/stratix-project/storage/ProjectStore.ts`（重命名/重构）
- `src/stratix-rts/zones/UnifiedZoneManager.ts`（移除 ProjectZone 引用）
- `src/stratix-rts/StratixRTSGameScene.ts`
- `src/stratix-rts/managers/AgentManager.ts`
- `src/stratix-rts/managers/ZoneInteractionManager.ts`
- `src/stratix-rts/utils/InputHandler.ts`
- `src/components/ChatPanel.vue`

**改动**:
- `ProjectZone` 类重命名（去掉 Project 前缀）
- `ProjectClient` → `ZoneClient`
- `ProjectManager` → `ZoneManager`
- `ProjectStore` → `ZoneStore`
- 所有 import 路径和类名引用更新

**验收**: `npx tsc --noEmit` 通过

### Batch 6: 清理 & 验证
**文件**:
- `src/stratix-project/examples/`（删除或更新）
- `src/stratix-project/ui/`（更新引用）
- `src/stratix-project/index.ts`（清理导出）
- `src/stratix-agent/core/ZoneAgent.ts`
- `src/stratix-agent/core/executors/ZoneSkillExecutor.ts`
- `src/stratix-core/stratix-protocol.ts`
- `src/stratix-core/state.ts`

**改动**:
- 清理所有残留的 Project 引用
- 统一命名
- 跑完整 UI 测试验证

**验收**: `npx tsc --noEmit` 通过 + `node scripts/ui-test-v3.mjs` 通过

## 通用规则
1. 每个 batch 完成后 `npx tsc --noEmit` 必须通过
2. 每个 batch 单独 commit，commit message 格式：`refactor(batch-N): 简述`
3. 禁止 mock 数据
4. 最小改动原则：只改命名和引用，不重构逻辑
5. 删除文件用 `git rm`，不用注释代码
6. 清空历史数据：直接 DELETE，不做 migration
