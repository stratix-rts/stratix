# RTS Zone系统API文档

## 目录

1. [Zone核心类](#zone核心类)
2. [模板管理](#模板管理)
3. [连接管理](#连接管理)
4. [工作流可视化](#工作流可视化)
5. [状态管理](#状态管理)
6. [历史记录](#历史记录)
7. [空间索引](#空间索引)
8. [UI组件](#ui组件)

---

## Zone核心类

### BaseZone

所有Zone类型的抽象基类，提供基础的Zone功能。

#### 构造函数

```typescript
constructor(scene: Phaser.Scene, config: BaseZoneConfig)
```

**参数**:
- `scene`: Phaser场景实例
- `config`: Zone配置对象

```typescript
interface BaseZoneConfig {
  id: string;           // Zone唯一标识
  name?: string;        // Zone名称
  x: number;            // 中心点X坐标
  y: number;            // 中心点Y坐标
  width: number;        // Zone宽度
  height: number;       // Zone高度
}
```

#### 公共方法

**getZoneId(): string**
- 获取Zone ID
- 返回: Zone唯一标识符

**getZoneName(): string**
- 获取Zone名称
- 返回: Zone显示名称

**setZoneName(name: string): void**
- 设置Zone名称
- 参数: `name` - 新的名称

**getZoneStatus(): ZoneStatus**
- 获取Zone状态
- 返回: `'idle' | 'active' | 'busy' | 'error' | 'completed'`

**setZoneStatus(status: ZoneStatus): void**
- 设置Zone状态
- 参数: `status` - 新的状态值

**setHighlight(selected: boolean): void**
- 设置选中状态
- 参数: `selected` - 是否选中

**setWarning(warning: boolean): void**
- 设置警告状态
- 参数: `warning` - 是否显示警告

**getBounds(): Phaser.Geom.Rectangle**
- 获取Zone边界矩形
- 返回: 包含位置和尺寸的矩形对象

**containsPoint(worldX: number, worldY: number): boolean**
- 判断点是否在Zone内
- 参数: `worldX`, `worldY` - 世界坐标
- 返回: 是否包含该点

**resize(zoneWidth: number, zoneHeight: number): void**
- 调整Zone大小
- 参数: `zoneWidth`, `zoneHeight` - 新的尺寸

**destroy(): void**
- 销毁Zone，释放资源

#### 拖拽和调整大小

**startDrag(worldX: number, worldY: number): void**
- 开始拖拽
- 参数: 起始坐标

**updateDrag(worldX: number, worldY: number): void**
- 更新拖拽位置
- 参数: 当前坐标

**endDrag(): void**
- 结束拖拽

**isZoneDragging(): boolean**
- 是否正在拖拽
- 返回: 拖拽状态

**startResize(corner: CornerPosition, worldX: number, worldY: number): void**
- 开始调整大小
- 参数: 
  - `corner`: 角落位置 `'topLeft' | 'topRight' | 'bottomRight' | 'bottomLeft'`
  - `worldX`, `worldY`: 起始坐标

**updateResize(worldX: number, worldY: number): void**
- 更新调整大小
- 参数: 当前坐标

**endResize(): void**
- 结束调整大小

**isZoneResizing(): boolean**
- 是否正在调整大小
- 返回: 调整大小状态

#### 事件

BaseZone会发出以下事件：

```typescript
'zone-moved'    // 拖拽完成时
{
  zoneId: string;
  oldX: number;
  oldY: number;
  newX: number;
  newY: number;
}
```

---

### TaskZone

继承自BaseZone，提供任务特定的功能。

#### 构造函数

```typescript
constructor(scene: Phaser.Scene, config: TaskZoneConfig)
```

**参数**:
```typescript
interface TaskZoneConfig extends BaseZoneConfig {
  taskType?: TaskZoneType;  // 任务类型
}

type TaskZoneType = 'code' | 'analysis' | 'writing' | 'general';
```

#### 公共方法

**getZoneType(): TaskZoneType**
- 获取任务类型
- 返回: `'code' | 'analysis' | 'writing' | 'general'`

**setZoneType(type: TaskZoneType): void**
- 设置任务类型
- 参数: `type` - 新的任务类型

**getAssignedAgents(): number**
- 获取已分配的Agent数量
- 返回: Agent数量

**setAssignedAgents(count: number): void**
- 设置已分配的Agent数量
- 参数: `count` - 新的数量

**getQueuedAgents(): number**
- 获取队列中的Agent数量
- 返回: 队列数量

**setQueuedAgents(count: number): void**
- 设置队列中的Agent数量
- 参数: `count` - 新的数量

**getTaskProgress(): number**
- 获取任务进度
- 返回: 0-100的进度值

**setTaskProgress(progress: number): void**
- 设置任务进度
- 参数: `progress` - 0-100的进度值

**getActiveTaskName(): string**
- 获取活动任务名称
- 返回: 任务名称

**setActiveTaskName(name: string): void**
- 设置活动任务名称
- 参数: `name` - 任务名称

**overlapsZone(other: TaskZone): boolean**
- 检查是否与另一个Zone重叠
- 参数: `other` - 另一个TaskZone
- 返回: 是否重叠

**overlapsRect(rect: Phaser.Geom.Rectangle): boolean**
- 检查是否与矩形重叠
- 参数: `rect` - 矩形对象
- 返回: 是否重叠

---

## 模板管理

### ZoneTemplateManager

Zone模板管理器，提供模板的注册、应用、验证和持久化功能。

#### 构造函数

```typescript
constructor()
```

创建模板管理器实例，自动从LocalStorage加载自定义模板。

#### 模板注册

**registerTemplate(template: ZoneTemplate): boolean**
- 注册模板
- 参数: `template` - 模板对象
- 返回: 是否注册成功

```typescript
interface ZoneTemplate {
  id: string;
  name: string;
  description: string;
  category: 'grid' | 'linear' | 'circular' | 'custom';
  positions: ZoneTemplatePosition[];
  metadata?: {
    author?: string;
    version?: string;
    tags?: string[];
    createdAt?: number;
    updatedAt?: number;
  };
}

interface ZoneTemplatePosition {
  x: number;
  y: number;
  width: number;
  height: number;
  name?: string;
  taskType?: TaskZoneType;
  status?: ZoneStatus;
}
```

**unregisterTemplate(templateId: string): boolean**
- 注销模板
- 参数: `templateId` - 模板ID
- 返回: 是否注销成功

#### 模板查询

**getTemplate(templateId: string): ZoneTemplate | undefined**
- 获取单个模板
- 参数: `templateId` - 模板ID
- 返回: 模板对象或undefined

**getAllTemplates(): ZoneTemplate[]**
- 获取所有模板
- 返回: 模板数组

**getTemplatesByCategory(category: ZoneTemplate['category']): ZoneTemplate[]**
- 按分类获取模板
- 参数: `category` - 模板分类
- 返回: 该分类的模板数组

**searchTemplates(query: string): ZoneTemplate[]**
- 搜索模板
- 参数: `query` - 搜索关键词
- 返回: 匹配的模板数组

#### 模板应用

**applyTemplate(
  templateId: string,
  options: TemplateApplicationOptions,
  createZoneFn: (config: BaseZoneConfig) => Promise<any>
): Promise<{ zones: any[]; actionId: string }>**
- 应用模板创建Zone
- 参数:
  - `templateId`: 模板ID
  - `options`: 应用选项
  - `createZoneFn`: Zone创建函数
- 返回: 创建的Zone数组和操作ID

```typescript
interface TemplateApplicationOptions {
  baseX: number;           // 基准X坐标
  baseY: number;           // 基准Y坐标
  scale?: number;          // 缩放比例
  customWidth?: number;    // 自定义宽度
  customHeight?: number;   // 自定义高度
  customSpacing?: number;  // 自定义间距
}
```

#### 模板验证

**validateTemplate(template: ZoneTemplate): TemplateValidationResult**
- 验证模板有效性
- 参数: `template` - 待验证的模板
- 返回: 验证结果

```typescript
interface TemplateValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}
```

#### 序列化

**serializeTemplate(template: ZoneTemplate): string**
- 序列化模板为JSON字符串
- 参数: `template` - 模板对象
- 返回: JSON字符串

**deserializeTemplate(json: string): ZoneTemplate | null**
- 从JSON字符串反序列化模板
- 参数: `json` - JSON字符串
- 返回: 模板对象或null

#### 自定义模板

**saveCustomTemplate(template: ZoneTemplate): boolean**
- 保存自定义模板到LocalStorage
- 参数: `template` - 模板对象
- 返回: 是否保存成功

**deleteCustomTemplate(templateId: string): boolean**
- 删除自定义模板
- 参数: `templateId` - 模板ID
- 返回: 是否删除成功

**getCustomTemplates(): ZoneTemplate[]**
- 获取所有自定义模板
- 返回: 自定义模板数组

#### 导入导出

**exportTemplates(templateIds?: string[]): string**
- 导出模板为JSON
- 参数: `templateIds` - 可选，指定要导出的模板ID
- 返回: JSON字符串

**importTemplates(json: string, overwrite: boolean = false): { imported: number; skipped: number; errors: string[] }**
- 从JSON导入模板
- 参数:
  - `json`: JSON字符串
  - `overwrite`: 是否覆盖已存在的模板
- 返回: 导入结果

#### 工具方法

**createTemplateFromZones(
  id: string,
  name: string,
  description: string,
  category: ZoneTemplate['category'],
  zones: Array<{ x: number; y: number; width: number; height: number; name?: string; taskType?: TaskZoneType }>
): ZoneTemplate | null**
- 从现有Zone创建模板
- 参数: 模板信息和Zone数组
- 返回: 创建的模板或null

**getTemplateStats(): { totalTemplates: number; customTemplates: number; builtInTemplates: number; byCategory: Record<string, number> }**
- 获取模板统计信息
- 返回: 统计数据

**destroy(): void**
- 销毁管理器，清理资源

---

## 连接管理

### ZoneConnectionManager

Zone连接管理器，管理Zone之间的连接关系。

#### 构造函数

```typescript
constructor(options: ConnectionManagerOptions = {})
```

```typescript
interface ConnectionManagerOptions {
  maxConnectionsPerZone?: number;    // 每个Zone最大连接数，默认50
  allowSelfConnections?: boolean;    // 是否允许自连接，默认false
  allowCyclicConnections?: boolean;  // 是否允许循环连接，默认true
}
```

#### 连接创建和删除

**createConnection(
  sourceZoneId: string,
  targetZoneId: string,
  type: ConnectionType = 'sequential',
  metadata: ConnectionMetadata = {}
): ZoneConnection | null**
- 创建连接
- 参数:
  - `sourceZoneId`: 源Zone ID
  - `targetZoneId`: 目标Zone ID
  - `type`: 连接类型
  - `metadata`: 元数据
- 返回: 连接对象或null

```typescript
type ConnectionType = 'sequential' | 'parallel' | 'conditional' | 'feedback';

interface ConnectionMetadata {
  label?: string;
  condition?: string;
  priority?: number;
  [key: string]: any;
}
```

**deleteConnection(connectionId: string): boolean**
- 删除连接
- 参数: `connectionId` - 连接ID
- 返回: 是否删除成功

#### 连接查询

**getConnection(connectionId: string): ZoneConnection | undefined**
- 获取单个连接
- 参数: `connectionId` - 连接ID
- 返回: 连接对象或undefined

**getConnectionsByZone(zoneId: string): ZoneConnection[]**
- 获取与Zone相关的所有连接
- 参数: `zoneId` - Zone ID
- 返回: 连接数组

**getOutgoingConnections(zoneId: string): ZoneConnection[]**
- 获取Zone的出站连接
- 参数: `zoneId` - Zone ID
- 返回: 出站连接数组

**getIncomingConnections(zoneId: string): ZoneConnection[]**
- 获取Zone的入站连接
- 参数: `zoneId` - Zone ID
- 返回: 入站连接数组

**getAllConnections(): ZoneConnection[]**
- 获取所有连接
- 返回: 连接数组

#### 连接更新

**updateConnection(
  connectionId: string,
  updates: {
    type?: ConnectionType;
    metadata?: Partial<ConnectionMetadata>;
    sourcePoint?: ConnectionPoint;
    targetPoint?: ConnectionPoint;
  }
): boolean**
- 更新连接属性
- 参数:
  - `connectionId`: 连接ID
  - `updates`: 更新内容
- 返回: 是否更新成功

#### 连接验证

**validateConnection(
  sourceZoneId: string,
  targetZoneId: string,
  type: ConnectionType
): ConnectionValidationResult**
- 验证连接是否有效
- 参数: 源Zone、目标Zone和连接类型
- 返回: 验证结果

**wouldCreateCycle(sourceZoneId: string, targetZoneId: string): boolean**
- 检查是否会创建循环
- 参数: 源Zone和目标Zone
- 返回: 是否会创建循环

#### 图算法

**getGraph(): ConnectionGraph**
- 获取连接图结构
- 返回: 图对象

```typescript
interface ConnectionGraph {
  nodes: string[];
  edges: ZoneConnectionData[];
  adjacencyList: Map<string, string[]>;
}
```

**findPath(startZoneId: string, endZoneId: string): string[] | null**
- 查找两个Zone之间的路径
- 参数: 起始和目标Zone ID
- 返回: 路径数组或null

#### 其他方法

**clearConnectionsForZone(zoneId: string): number**
- 清除Zone的所有连接
- 参数: `zoneId` - Zone ID
- 返回: 清除的连接数

**clear(): void**
- 清除所有连接

**serialize(): ZoneConnectionData[]**
- 序列化所有连接
- 返回: 连接数据数组

**deserialize(data: ZoneConnectionData[]): void**
- 反序列化连接
- 参数: `data` - 连接数据数组

---

## 工作流可视化

### WorkflowVisualizer

工作流可视化和执行管理。

#### 构造函数

```typescript
constructor(connectionManager: ZoneConnectionManager)
```

#### 工作流创建

**createWorkflow(
  id: string,
  name: string,
  zoneIds: string[],
  description?: string
): WorkflowDefinition**
- 创建工作流
- 参数:
  - `id`: 工作流ID
  - `name`: 工作流名称
  - `zoneIds`: Zone ID数组
  - `description`: 可选描述
- 返回: 工作流定义

**deleteWorkflow(workflowId: string): boolean**
- 删除工作流
- 参数: `workflowId` - 工作流ID
- 返回: 是否删除成功

#### 工作流查询

**getWorkflow(workflowId: string): WorkflowDefinition | undefined**
- 获取单个工作流
- 参数: `workflowId` - 工作流ID
- 返回: 工作流定义或undefined

**getAllWorkflows(): WorkflowDefinition[]**
- 获取所有工作流
- 返回: 工作流数组

#### 工作流执行

**startWorkflow(workflowId: string): boolean**
- 启动工作流
- 参数: `workflowId` - 工作流ID
- 返回: 是否启动成功

**pauseWorkflow(workflowId: string): boolean**
- 暂停工作流
- 参数: `workflowId` - 工作流ID
- 返回: 是否暂停成功

**resumeWorkflow(workflowId: string): boolean**
- 恢复工作流
- 参数: `workflowId` - 工作流ID
- 返回: 是否恢复成功

**completeStep(workflowId: string, zoneId: string): boolean**
- 完成步骤
- 参数: `workflowId`, `zoneId`
- 返回: 是否完成成功

**failStep(workflowId: string, zoneId: string, error?: string): boolean**
- 标记步骤失败
- 参数: `workflowId`, `zoneId`, 可选错误信息
- 返回: 是否标记成功

**resetWorkflow(workflowId: string): boolean**
- 重置工作流
- 参数: `workflowId` - 工作流ID
- 返回: 是否重置成功

#### 状态查询

**getExecutionState(workflowId: string): WorkflowExecutionState | undefined**
- 获取执行状态
- 参数: `workflowId` - 工作流ID
- 返回: 执行状态或undefined

**getWorkflowProgress(workflowId: string): number**
- 获取工作流进度
- 参数: `workflowId` - 工作流ID
- 返回: 0-100的进度值

**getActiveStep(workflowId: string): WorkflowStep | null**
- 获取当前活动步骤
- 参数: `workflowId` - 工作流ID
- 返回: 当前步骤或null

**getNextSteps(workflowId: string, zoneId: string): WorkflowStep[]**
- 获取下一步骤
- 参数: `workflowId`, `zoneId`
- 返回: 下一步骤数组

#### 可视化

**visualizeWorkflow(workflowId: string): { nodes: Array<{ id: string; name: string; status: string; position: { x: number; y: number } }>; edges: Array<{ from: string; to: string; type: ConnectionType }> }**
- 可视化工作流结构
- 参数: `workflowId` - 工作流ID
- 返回: 节点和边的数据

#### 其他方法

**updateWorkflowStep(
  workflowId: string,
  zoneId: string,
  updates: Partial<WorkflowStep>
): boolean**
- 更新工作流步骤
- 参数: `workflowId`, `zoneId`, 更新内容
- 返回: 是否更新成功

**cloneWorkflow(sourceWorkflowId: string, newId: string, newName: string): WorkflowDefinition | null**
- 克隆工作流
- 参数: 源工作流ID, 新ID, 新名称
- 返回: 克隆的工作流或null

**clear(): void**
- 清除所有工作流

---

## 状态管理

### ZoneStateFlow

全局状态事件流管理器。

#### 构造函数

```typescript
constructor(config: StateFlowConfig = {})
```

```typescript
interface StateFlowConfig {
  maxHistorySize?: number;      // 最大历史记录数，默认1000
  enableLogging?: boolean;      // 是否启用日志，默认false
  persistToStorage?: boolean;   // 是否持久化到LocalStorage，默认false
}
```

#### 事件订阅

**subscribe(eventType: string, callback: (event: StateChangeEvent) => void): () => void**
- 订阅事件
- 参数:
  - `eventType`: 事件类型，`'*'` 表示所有事件
  - `callback`: 回调函数
- 返回: 取消订阅函数

```typescript
interface StateChangeEvent {
  type: string;
  timestamp: number;
  source: 'user' | 'system' | 'sync';
  data: any;
  previousState?: any;
  newState?: any;
}
```

#### 事件查询

**getEventLog(filter?: {
  type?: string;
  source?: 'user' | 'system' | 'sync';
  startTime?: number;
  endTime?: number;
}): StateChangeEvent[]**
- 获取事件日志
- 参数: 可选过滤器
- 返回: 事件数组

**getEventCount(filter?: {
  type?: string;
  source?: 'user' | 'system' | 'sync';
}): number**
- 获取事件数量
- 参数: 可选过滤器
- 返回: 事件数量

**getLastEvent(eventType?: string): StateChangeEvent | undefined**
- 获取最后一个事件
- 参数: 可选事件类型
- 返回: 事件对象或undefined

#### 日志管理

**clearLog(): void**
- 清空事件日志

**exportLog(): string**
- 导出日志为JSON
- 返回: JSON字符串

**importLog(jsonLog: string): void**
- 从JSON导入日志
- 参数: `jsonLog` - JSON字符串

#### 统计

**getStatistics(): {
  totalEvents: number;
  userEvents: number;
  systemEvents: number;
  syncEvents: number;
  eventTypeDistribution: Record<string, number>;
}**
- 获取统计信息
- 返回: 统计数据

#### 其他

**loadPersistedLog(): void**
- 从LocalStorage加载持久化的日志

**destroy(): void**
- 销毁状态流管理器

---

## 历史记录

### ZoneHistory

撤销/重做功能管理。

#### 主要方法

**execute(action: ZoneAction): Promise<void>**
- 执行操作并记录到历史
- 参数: `action` - 操作对象

**undo(): Promise<void>**
- 撤销上一步操作

**redo(): Promise<void>**
- 重做下一步操作

**canUndo(): boolean**
- 是否可以撤销

**canRedo(): boolean**
- 是否可以重做

**getUndoStack(): ZoneAction[]**
- 获取撤销栈

**getRedoStack(): ZoneAction[]**
- 获取重做栈

**getUndoStackLength(): number**
- 获取撤销栈长度

**getRedoStackLength(): number**
- 获取重做栈长度

**clear(): void**
- 清空历史记录

**destroy(): void**
- 销毁历史管理器

#### 操作类型

**ZoneMoveAction**: 移动操作
**ZoneResizeAction**: 调整大小操作
**ZoneCreateAction**: 创建操作
**ZoneDeleteAction**: 删除操作

---

## 空间索引

### ZoneSpatialIndex

基于网格的空间索引，用于快速查询Zone重叠。

#### 构造函数

```typescript
constructor(cellSize: number = 100)
```

参数: `cellSize` - 网格单元大小，默认100

#### 主要方法

**insert(zone: SpatialZone): void**
- 插入Zone到索引
- 参数: `zone` - Zone数据

```typescript
interface SpatialZone {
  id: string;
  x: number;      // 左上角X坐标
  y: number;      // 左上角Y坐标
  width: number;
  height: number;
}
```

**remove(zoneId: string): void**
- 从索引移除Zone
- 参数: `zoneId` - Zone ID

**update(zone: SpatialZone): void**
- 更新Zone位置
- 参数: `zone` - 新的Zone数据

**queryOverlappingZones(zone: SpatialZone): SpatialZone[]**
- 查询与指定Zone重叠的所有Zone
- 参数: `zone` - 目标Zone
- 返回: 重叠的Zone数组

**queryPoint(x: number, y: number): SpatialZone[]**
- 查询包含指定点的所有Zone
- 参数: `x`, `y` - 点坐标
- 返回: 包含该点的Zone数组

**queryRegion(x: number, y: number, width: number, height: number): SpatialZone[]**
- 查询与指定区域重叠的所有Zone
- 参数: 区域参数
- 返回: 重叠的Zone数组

**getAllZones(): SpatialZone[]**
- 获取所有Zone
- 返回: Zone数组

**getZone(zoneId: string): SpatialZone | undefined**
- 获取单个Zone
- 参数: `zoneId` - Zone ID
- 返回: Zone数据或undefined

**clear(): void**
- 清空索引

**getStatistics(): { zoneCount: number; cellCount: number; averageZonesPerCell: number }**
- 获取统计信息
- 返回: 统计数据

---

## UI组件

### ZoneDrawingUI

绘制模式UI指示器。

#### 主要方法

**enable(): void**
- 启用绘制模式

**disable(): void**
- 禁用绘制模式

**showTooltip(x: number, y: number, message: string): void**
- 显示工具提示
- 参数: 位置和消息

**hideTooltip(): void**
- 隐藏工具提示

**destroy(): void**
- 销毁UI组件

### ZoneBatchOperations

批量操作工具类。

#### 静态方法

**moveZones(
  zones: TaskZone[],
  deltaX: number,
  deltaY: number,
  history: ZoneHistory
): void**
- 批量移动Zone
- 参数: Zone数组、偏移量、历史管理器

**deleteZones(
  zones: TaskZone[],
  scene: any,
  showConfirmation: boolean = true
): void**
- 批量删除Zone
- 参数: Zone数组、场景、是否显示确认

**duplicateZones(
  zones: TaskZone[],
  scene: any,
  offsetX: number = 20,
  offsetY: number = 20
): TaskZone[]**
- 批量复制Zone
- 参数: Zone数组、场景、偏移量
- 返回: 复制的Zone数组

**selectZonesInRect(
  zones: TaskZone[],
  rect: Phaser.Geom.Rectangle
): TaskZone[]**
- 选择矩形区域内的Zone
- 参数: Zone数组、选择矩形
- 返回: 选中的Zone数组

**alignZones(
  zones: TaskZone[],
  alignment: 'left' | 'right' | 'top' | 'bottom' | 'center_h' | 'center_v',
  history: ZoneHistory
): void**
- 对齐Zone
- 参数: Zone数组、对齐方式、历史管理器

---

**文档版本**: 1.0.0  
**最后更新**: 2026-03-05  
**维护者**: Stratix Team