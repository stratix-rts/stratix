# PermissionOrchestrator 深度集成方案

> 日期：2026-04-04
> 状态：设计稿

---

## 1. 现状分析

### 1.1 PermissionOrchestrator 架构回顾

```typescript
// PermissionOrchestrator.decide() 决策流程
decide(context: PermissionContext): PermissionResult {
  1. checkZoneRules(context)  // 最高优先级：Zone 规则匹配
  2. runClassifier(context)    // 默认分类器（低风险操作自动 allow，破坏性操作自动 deny）
  3. runPermissionHooks(context, decision)  // 自定义钩子
  4. fallback: return 'ask'   // 需要用户确认
}
```

**关键行为：**
- `checkPermission()` 在 `decision === 'deny'` 或 `'ask'` 时 **抛出异常**
- `decision === 'allow'` 时静默放行
- `permissionOrchestrator` 为 null 时 **静默放行**（无感知）

### 1.2 decide() 调用情况

| ZoneService 方法 | 调用 checkPermission | action 参数 | 备注 |
|---|---|---|---|
| `getZones` | ❌ 无 | - | 读取，无权限检查 |
| `getZone` | ❌ 无 | - | 读取，无权限检查 |
| `createZone` | ✅ 有 | `'create'` | |
| `updateZone` | ✅ 有 | `'update'` | |
| `deleteZone` | ✅ 有 | `'delete'` | |
| `getDeletedZones` | ❌ 无 | - | 读取，无权限检查 |
| `searchZones` | ❌ 无 | - | 搜索，无权限检查 |
| `restoreZone` | ✅ 有 | `'restore'` | |
| `permanentlyDeleteZone` | ✅ 有 | `'permanent_delete'` | |
| `emptyTrash` | ✅ 有 | `'empty_trash'` | |
| `addMember` | ✅ 有 | `'add_member'` | |
| `removeMember` | ✅ 有 | `'remove_member'` | |
| `addMembers` | ✅ 有 | `'add_members'` | |
| `removeMembers` | ✅ 有 | `'remove_members'` | |
| `addFile` | ✅ 有 | `'add_file'` | |
| `addFiles` | ✅ 有 | `'add_files'` | |
| `removeFile` | ✅ 有 | `'remove_file'` | |
| `getFileWithContent` | ❌ 无 | - | 读取，无权限检查 |
| `refreshFile` | ✅ 有 | `'update_file'` | |
| `fetchUrlMetadata` | ❌ 无 | - | 读取 URL 元数据，无权限检查 |
| `searchFiles` | ❌ 无 | - | 搜索，无权限检查 |
| `getFileVersions` | ❌ 无 | - | 读取，无权限检查 |
| `updateFileWithVersion` | ✅ 有 | `'update_file'` | |
| `rollbackFileToVersion` | ✅ 有 | `'rollback_file'` | |
| `scanFolder` | ✅ 有 | `'scan_folder'` | |
| `getZoneStatistics` | ❌ 无 | - | 读取统计，无权限检查 |
| `getTasks` | ❌ 无 | - | 读取，无权限检查 |
| `getTasksCount` | ❌ 无 | - | 读取，无权限检查 |
| `getTask` | ❌ 无 | - | 读取，无权限检查 |
| `createTask` | ✅ 有 | `'create_task'` | |
| `updateTask` | ✅ 有 | `'update_task'` | |
| `deleteTask` | ✅ 有 | `'delete_task'` | |
| `claimTask` | ✅ 有 | `'claim_task'` | |
| `createTasksBatch` | ✅ 有 | `'create_tasks_batch'` | |
| `updateTasksBatch` | ✅ 有 | `'update_tasks_batch'` | |
| `getMessages` | ❌ 无 | - | 读取，无权限检查 |
| `getMessagesCount` | ❌ 无 | - | 读取，无权限检查 |
| `addMessage` | ✅ 有 | `'add_message'` | |
| `exportZone` | ❌ 无 | - | 导出，无权限检查 |
| `cloneZone` | ✅ 有 | `'clone'` | |
| `importZone` | ✅ 有 | `'import'` | |

### 1.3 缺口分析

**完全无权限检查的操作：**

1. **读取类操作（Read）**
   - `getZone` / `getZones` — 任何 agent 可查看任意 zone
   - `getDeletedZones` — 可查看回收站内容
   - `getFileWithContent` — 可读取任意文件内容
   - `getFileVersions` — 可查看版本历史
   - `fetchUrlMetadata` — 可获取 URL 元数据
   - `getTasks` / `getTask` — 可查看任意任务
   - `getMessages` — 可查看任意消息历史
   - `getZoneStatistics` — 可获取统计数据

2. **搜索类操作（Query）**
   - `searchZones` — 可跨项目搜索 zones
   - `searchFiles` — 可在任意 zone 内搜索文件

3. **导出类操作**
   - `exportZone` — 可导出 zone 模板（含文件列表）

4. **ZoneContextManager（独立路由，未挂接 PermissionOrchestrator）**
   - `/api/zone-context/inject` — Agent 进入 zone，无权限检查
   - `/api/zone-context/detach` — Agent 离开 zone，无权限检查

---

## 2. 目标状态

### 2.1 权限分层模型

| 层级 | 操作类型 | 风险等级 | 默认策略 |
|---|---|---|---|
| R (Read) | get / list / search / view | 低 | allow（但仍记录） |
| C (Create) | create / add / inject | 中 | ask（首次需确认） |
| U (Update) | update / edit / refresh | 中 | ask |
| D (Delete) | delete / remove / destroy | 高 | deny（除非明确配置） |
| X (Execute) | claim / delegate / reassign | 高 | deny |

### 2.2 应该经过权限检查的操作

**必须加检查（高风险/中风险操作）：**
- 所有 CUD 操作（已有大部分）
- `exportZone` — 泄露 zone 内部结构
- `cloneZone` — 在不同 project 创建资源

**建议加检查（读取类操作可配置放行）：**
- `getZone` / `getZones` — zone 可见性控制
- `getFileWithContent` — 文件内容读取控制
- `getTasks` — 任务列表可见性
- `getMessages` — 消息历史可见性
- `searchZones` / `searchFiles` — 搜索范围控制
- `getZoneStatistics` — 统计数据可见性

**无需检查（基础只读）：**
- `fetchUrlMetadata` — 纯元数据获取，无敏感数据
- `getFileVersions` — 版本历史相对不敏感

---

## 3. 集成方案

### 3.1 核心修改：checkPermission 增强

**当前实现问题：**
```typescript
private checkPermission(action: string, zoneId: string, agentId: string): void {
  if (!this.permissionOrchestrator) return;  // ← 静默放行
  const result = this.permissionOrchestrator.decide(context);
  if (result.decision === 'deny') {
    throw new Error(`Permission denied: ...`);
  }
  if (result.decision === 'ask') {
    throw new Error(`Permission requires confirmation: ...`);
  }
}
```

**增强后：**
```typescript
private checkPermission(
  action: string,
  resource: string,
  agentId: string,
  options?: { allowRead?: boolean; defaultDecision?: PermissionDecision }
): void {
  if (!this.permissionOrchestrator) {
    // 在严格模式下抛出异常，而非静默放行
    throw new Error(`PermissionOrchestrator not configured for ${action} on ${resource}`);
  }

  const context: PermissionContext = {
    action,
    resource,
    agentId,
    params: this.parseResource(resource),
  };

  const result = this.permissionOrchestrator.decide(context);

  if (result.decision === 'deny') {
    throw new Error(`Permission denied: ${action} on ${resource} by ${agentId}`);
  }

  // 'ask' 时抛出特殊异常，由调用方处理用户确认流程
  if (result.decision === 'ask') {
    throw new PermissionRequiredError(`Permission required: ${action} on ${resource}`, result);
  }
}

// 解析 resource 字符串为 zoneId/projectId
private parseResource(resource: string): { zoneId?: string; projectId?: string } {
  if (resource.startsWith('zone:')) {
    return { zoneId: resource.slice(5) };
  }
  if (resource.startsWith('project:')) {
    return { projectId: resource.slice(8) };
  }
  return {};
}
```

### 3.2 需要新增 checkPermission 调用的方法

#### 文件：`src/stratix-gateway/project/ZoneService.ts`

| 方法 | 新增 action | resource | 建议位置 |
|---|---|---|---|
| `getZone` | `'read'` | `zone:${zoneId}` | 读取完成后（允许错误返回而非抛异常）|
| `getZones` | `'list'` | `project:${projectId}` | 同上 |
| `getDeletedZones` | `'read'` | `project:${projectId}` | 同上 |
| `searchZones` | `'search'` | `'global'` | 函数开头 |
| `getFileWithContent` | `'read_file'` | `zone:${zoneId}` | 函数开头 |
| `searchFiles` | `'search_files'` | `zone:${zoneId}` | 函数开头 |
| `getFileVersions` | `'read_file'` | `zone:${zoneId}` | 函数开头 |
| `exportZone` | `'export'` | `zone:${zoneId}` | 函数开头 |
| `getTasks` | `'read_tasks'` | `zone:${zoneId}` | 函数开头 |
| `getTask` | `'read_task'` | `zone:${zoneId}` | 函数开头 |
| `getMessages` | `'read_messages'` | `zone:${zoneId}` | 函数开头 |
| `getZoneStatistics` | `'read_stats'` | `zone:${zoneId}` | 函数开头 |

### 3.3 ZoneContextManager 路由集成

**文件：`src/stratix-gateway/api/routes/zone-context.ts`**

当前实现直接调用 `zoneContextManager`，完全绕过了权限检查。

**建议方案：**

方案 A（在 ZoneContextManager 内部集成）：
```typescript
// 在 zoneContextManager.inject() 内部增加权限检查
async inject(agentId: string, zoneId: string): Promise<InjectResult> {
  // 获取 orchestrator 并检查权限
  const hasPermission = await checkPermission('enter_zone', `zone:${zoneId}`, agentId);
  if (!hasPermission) {
    return { success: false, error: 'Permission denied' };
  }
  // ... 原有逻辑
}
```

方案 B（在路由层统一拦截）：
在路由入口增加中间件，类似于 `validateZone` 中间件模式。

**推荐方案 A**，因为权限逻辑应内聚在业务层而非路由层。

### 3.4 read 类操作的权限处理策略

对于 `get` / `list` 等读取操作，权限检查失败时：
- **不应抛出异常**，而应返回空结果或过滤后的结果
- 理由：读取操作被拒绝应该是"看不到"，而不是"报错"

```typescript
public async getZone(zoneId: string): Promise<Zone | null> {
  await this.ensureInitialized();

  try {
    this.checkPermission('read', `zone:${zoneId}`, 'system');
  } catch (e) {
    // 权限不足时，返回 null（zone 不存在）
    return null;
  }

  return zoneRepository.getZone(zoneId);
}
```

或者更明确的方案：
```typescript
public async getZone(zoneId: string, requesterId: string = 'system'): Promise<{ zone: Zone | null; allowed: boolean }> {
  await this.ensureInitialized();

  let allowed = true;
  try {
    this.checkPermission('read', `zone:${zoneId}`, requesterId);
  } catch (e) {
    allowed = false;
  }

  const zone = zoneRepository.getZone(zoneId);
  return { zone: allowed ? zone : null, allowed };
}
```

---

## 4. 需要修改的具体文件

### 4.1 `src/stratix-gateway/project/ZoneService.ts`

**修改 1：增强 checkPermission 方法**
- 增加 `options.allowRead` 参数
- 增加 `options.defaultDecision` 参数
- 增加 `parseResource` 辅助方法

**修改 2：新增权限检查（按方法）**

```typescript
// getZone - 第 141-144 行
public async getZone(zoneId: string): Promise<Zone | null> {
  await this.ensureInitialized();
  // 新增：读取权限检查（allow read on denial）
  this.checkPermission('read', `zone:${zoneId}`, 'system', { allowRead: true });
  return zoneRepository.getZone(zoneId);
}

// getZones - 第 129-139 行
public async getZones(projectId: string): Promise<Zone[]> {
  await this.ensureInitialized();
  this.checkPermission('list', `project:${projectId}`, 'system', { allowRead: true });
  // ...后续不变
}

// searchZones - 第 230-233 行
public async searchZones(keyword: string, limit: number = 20): Promise<Zone[]> {
  await this.ensureInitialized();
  this.checkPermission('search', 'global', 'system', { allowRead: true });
  return zoneRepository.searchZones(keyword, limit);
}

// getFileWithContent - 第 539-583 行
public async getFileWithContent(zoneId: string, fileId: string): Promise<{ file: ZoneFile | null; content: string | null; cacheHit: boolean }> {
  await this.ensureInitialized();
  this.checkPermission('read_file', `zone:${zoneId}`, 'system', { allowRead: true });
  // ...后续不变
}

// searchFiles - 第 690-700 行
public async searchFiles(zoneId: string, keyword: string): Promise<ZoneFile[]> {
  await this.ensureInitialized();
  this.checkPermission('search_files', `zone:${zoneId}`, 'system', { allowRead: true });
  // ...后续不变
}

// exportZone - 第 1222-1240 行
public async exportZone(zoneId: string): Promise<...> {
  await this.ensureInitialized();
  this.checkPermission('export', `zone:${zoneId}`, 'system');  // 导出是写入操作
  // ...后续不变
}

// getTasks - 第 880-887 行
public async getTasks(zoneId: string, limit?: number, offset?: number): Promise<ZoneTask[]> {
  await this.ensureInitialized();
  this.checkPermission('read_tasks', `zone:${zoneId}`, 'system', { allowRead: true });
  // ...后续不变
}

// getMessages - 第 1174-1181 行
public async getMessages(zoneId: string, limit: number = 100, offset: number = 0): Promise<ZoneMessage[]> {
  await this.ensureInitialized();
  this.checkPermission('read_messages', `zone:${zoneId}`, 'system', { allowRead: true });
  // ...后续不变
}

// getZoneStatistics - 第 839-871 行
public async getZoneStatistics(zoneId: string): Promise<...> {
  await this.ensureInitialized();
  this.checkPermission('read_stats', `zone:${zoneId}`, 'system', { allowRead: true });
  // ...后续不变
}
```

### 4.2 `src/stratix-core/permission/types.ts`（新增 action 类型）

```typescript
// 新增 PermissionActions 并集
export type ZonePermissionAction =
  // CRUD
  | 'create' | 'read' | 'update' | 'delete'
  | 'list' | 'search'
  // Zone 操作
  | 'restore' | 'permanent_delete' | 'empty_trash' | 'clone' | 'import' | 'export'
  // Member 操作
  | 'add_member' | 'remove_member' | 'add_members' | 'remove_members'
  | 'enter_zone' | 'leave_zone'
  // File 操作
  | 'add_file' | 'add_files' | 'remove_file' | 'update_file'
  | 'read_file' | 'search_files' | 'rollback_file' | 'scan_folder'
  | 'refresh_file' | 'fetch_metadata'
  // Task 操作
  | 'create_task' | 'update_task' | 'delete_task' | 'claim_task'
  | 'create_tasks_batch' | 'update_tasks_batch' | 'read_task' | 'read_tasks'
  // Message 操作
  | 'add_message' | 'read_messages' | 'read_stats';
```

---

## 5. 风险和注意事项

### 5.1 向后兼容性风险

**问题：** 添加权限检查可能导致现有调用方收到新的异常。

**缓解：**
- 所有新检查默认使用 `allowRead: true`（权限不足返回空而非抛异常）
- 仅对高风险操作（CUD）使用严格模式
- 设置配置项 `permissionOrchestrator.enforce = false` 可临时禁用（开发调试用）

### 5.2 ZoneContextManager 耦合

**问题：** `zone-context.ts` 路由不经过 ZoneService，直接调用 `zoneContextManager`。

**缓解：** 在 `ZoneContextManager.inject()` 内部增加权限钩子，而非修改路由。

### 5.3 requesterId 传递问题

**问题：** 当前很多方法 `agentId` 参数默认为 `'system'`，但实际请求应携带真实 requesterId。

**当前路由层问题：**
```typescript
// zone.ts 路由 - 所有路由都没有传递真实的 requesterId
router.post('/zones', async (req: Request, res: Response): Promise<void> => {
  const zone = await zoneService.createZone(projectId, title, prompt || ''); // ← 缺少 agentId
});
```

**修复：** 需要在路由层从 `req.headers['x-agent-id']` 或 JWT token 中提取真实的 agentId 并传递。

### 5.4 测试覆盖

- 所有新增的 `checkPermission` 调用需要对应的单元测试
- 需要测试权限拒绝时的行为（返回 null 还是抛异常）
- 需要测试 `permissionOrchestrator` 为 null 时的降级行为

---

## 6. 验收标准

### 6.1 功能验收

| ID | 检查项 | 验证方法 |
|---|---|---|
| V1 | `getZone` 未授权时返回 null | 单元测试 |
| V2 | `createZone` 未授权时抛出 PermissionDenied 异常 | 单元测试 |
| V3 | `deleteZone` 未授权时抛出 PermissionDenied 异常 | 单元测试 |
| V4 | `permissionOrchestrator` 为 null 时，已有点火检查方法仍正常工作 | 回归测试 |
| V5 | 新增检查的方法（getTasks, getMessages 等）权限不足时返回空结果 | 单元测试 |
| V6 | `exportZone` 未授权时抛出异常 | 单元测试 |

### 6.2 集成验收

| ID | 检查项 | 验证方法 |
|---|---|---|
| I1 | ZoneService.setPermissionOrchestrator() 被调用且 orchestrator 不为 null | 日志验证 |
| I2 | `zone-context/inject` 路由会检查 enter_zone 权限 | E2E 测试 |
| I3 | 路由层正确传递 agentId（非 'system'）| 端到端请求带 header 验证 |

### 6.3 配置验收

| ID | 检查项 |
|---|---|
| C1 | 可通过 `permissionOrchestrator.addZoneRule()` 配置特定 zone 的白名单 |
| C2 | `allowRead: true` 的操作权限不足时不会触发异常 |
| C3 | ZoneRule 支持新 actions（read, list, search, read_file 等）|

---

## 7. 实施计划

### Phase 1: 基础增强（不改现有行为）
1. 在 `ZoneService.checkPermission` 增加 `allowRead` 选项
2. 在 `checkPermission` 为 null 时抛出明确异常（而非静默放行）
3. **不**修改任何现有方法的调用逻辑，仅记录

### Phase 2: 读取操作权限化
1. `getZone` / `getZones` / `getTasks` / `getMessages` 等增加 `checkPermission(read)`
2. 验证向后兼容性
3. 路由层传递真实 agentId

### Phase 3: 搜索/导出操作权限化
1. `searchZones` / `searchFiles` / `exportZone` 增加检查
2. ZoneContextManager inject 增加 enter_zone 权限检查

### Phase 4: 测试与配置完善
1. 补充单元测试
2. 完善 ZoneRule 配置示例
3. 文档更新

---

## 附录 A：完整方法权限矩阵

```
方法名                    | action          | 资源           | 当前状态 | 建议策略
-------------------------|-----------------|---------------|---------|--------
getZones                 | list            | project:xxx   | ❌缺失  | 🔵 allowRead
getZone                  | read            | zone:xxx      | ❌缺失  | 🔵 allowRead
createZone               | create          | project:xxx   | ✅ 已有 | 🔴 严格
updateZone               | update          | zone:xxx      | ✅ 已有 | 🔴 严格
deleteZone               | delete          | zone:xxx      | ✅ 已有 | 🔴 严格
getDeletedZones          | read            | project:xxx   | ❌缺失  | 🔵 allowRead
searchZones              | search          | global        | ❌缺失  | 🟡 ask
restoreZone              | restore         | zone:xxx      | ✅ 已有 | 🔴 严格
permanentlyDeleteZone    | permanent_delete| zone:xxx      | ✅ 已有 | 🔴 严格
emptyTrash               | empty_trash     | project:xxx   | ✅ 已有 | 🔴 严格
addMember                | add_member      | zone:xxx      | ✅ 已有 | 🟡 ask
removeMember             | remove_member   | zone:xxx      | ✅ 已有 | 🟡 ask
addMembers               | add_members     | zone:xxx      | ✅ 已有 | 🟡 ask
removeMembers            | remove_members  | zone:xxx      | ✅ 已有 | 🟡 ask
addFile                  | add_file        | zone:xxx      | ✅ 已有 | 🟡 ask
addFiles                 | add_files       | zone:xxx      | ✅ 已有 | 🟡 ask
removeFile               | remove_file     | zone:xxx      | ✅ 已有 | 🔴 严格
getFileWithContent       | read_file       | zone:xxx      | ❌缺失  | 🔵 allowRead
refreshFile              | update_file     | zone:xxx      | ✅ 已有 | 🟡 ask
fetchUrlMetadata         | fetch_metadata  | zone:xxx      | ❌缺失  | ✅ 无需检查
searchFiles              | search_files    | zone:xxx      | ❌缺失  | 🔵 allowRead
getFileVersions          | read_file       | zone:xxx      | ❌缺失  | 🔵 allowRead
updateFileWithVersion    | update_file     | zone:xxx      | ✅ 已有 | 🟡 ask
rollbackFileToVersion    | rollback_file   | zone:xxx      | ✅ 已有 | 🔴 严格
scanFolder               | scan_folder     | zone:xxx      | ✅ 已有 | 🟡 ask
getZoneStatistics        | read_stats      | zone:xxx      | ❌缺失  | 🔵 allowRead
getTasks                 | read_tasks      | zone:xxx      | ❌缺失  | 🔵 allowRead
getTasksCount            | (同 getTasks)   | zone:xxx      | ❌缺失  | 🔵 allowRead
getTask                  | read_task       | zone:xxx      | ❌缺失  | 🔵 allowRead
createTask               | create_task     | zone:xxx      | ✅ 已有 | 🟡 ask
updateTask               | update_task     | zone:xxx      | ✅ 已有 | 🟡 ask
deleteTask               | delete_task     | zone:xxx      | ✅ 已有 | 🔴 严格
claimTask                | claim_task      | zone:xxx      | ✅ 已有 | 🟡 ask
createTasksBatch         | create_tasks_batch| zone:xxx    | ✅ 已有 | 🟡 ask
updateTasksBatch         | update_tasks_batch| zone:xxx    | ✅ 已有 | 🟡 ask
getMessages              | read_messages   | zone:xxx      | ❌缺失  | 🔵 allowRead
getMessagesCount         | (同 getMessages)| zone:xxx      | ❌缺失  | 🔵 allowRead
addMessage               | add_message     | zone:xxx      | ✅ 已有 | 🟡 ask
exportZone               | export          | zone:xxx      | ❌缺失  | 🔴 严格
cloneZone                | clone           | zone:xxx      | ✅ 已有 | 🔴 严格
importZone               | import          | project:xxx   | ✅ 已有 | 🔴 严格
```

**图例：**
- 🔴 严格：deny 时抛异常，ask 时抛异常（需要用户确认）
- 🟡 ask：ask 时抛 PermissionRequiredError，由调用方处理确认
- 🔵 allowRead：权限不足时返回空/null，不抛异常
- ✅ 无需检查：低风险操作，可跳过

---

## 附录 B：PermissionContext 增强建议

当前 `PermissionContext` 定义：
```typescript
interface PermissionContext {
  action: string;
  resource: string;
  agentId: string;
  params?: Record<string, any>;
}
```

建议扩展为支持更细粒度的资源定位：
```typescript
interface PermissionContext {
  action: string;
  resource: string;
  agentId: string;
  params?: {
    zoneId?: string;
    projectId?: string;
    fileId?: string;
    taskId?: string;
    // 新增：操作上下文
    isRecursive?: boolean;   // scan_folder 等
    isBatch?: boolean;       // batch 操作
    targetAgentIds?: string[]; // add_members 等
  };
}
```
