# RTS任务区交互优化完整方案

## 📋 项目概述

本文档定义了 Stratix RTS 任务区交互系统的完整优化方案，涵盖性能、用户体验、代码质量和功能扩展四个维度。

---

## 🎯 优化目标

### 核心指标
- **性能提升**: 重叠检测从 O(n²) → O(n)
- **用户体验**: 添加撤销/重做、批量操作、可视化反馈
- **代码质量**: 统一配置管理、类型定义、错误处理
- **功能扩展**: Zone模板、工作流、快捷键提示

### 质量标准
- 回归测试通过率: 100%
- 代码覆盖率: >80%
- 性能基准: 60 FPS（100个Zone）
- 错误恢复时间: <3秒

---

## 📊 任务优先级矩阵

### P0 - 立即修复（本周完成）
1. **状态同步问题** - 多客户端状态不一致
2. **错误处理缺失** - 用户操作失败无反馈

### P1 - 短期优化（2周内）
3. **性能优化** - 区域重叠检测
4. **状态管理** - 选中状态重构
5. **撤销重做** - 基础功能缺失

### P2 - 中期改进（1个月）
6. **交互体验** - 绘制模式可视化
7. **代码质量** - 配置管理统一
8. **性能优化** - 渲染与对象池

### P3 - 长期规划（季度目标）
9. **Zone模板** - 快速创建
10. **工作流** - Zone间关联
11. **帮助系统** - 快捷键提示
12. **可访问性** - 键盘导航

---

## 🏗️ 技术架构设计

### 1. 状态同步管理器 (P0)

**位置**: `src/stratix-rts/managers/ZoneSyncManager.ts`

```typescript
interface ZoneSyncManager {
  // 核心功能
  syncZoneStatus(zoneId: string, status: ZoneStatus): Promise<void>;
  resolveConflicts(local: ZoneState, remote: ZoneState): ZoneState;
  broadcastChange(event: ZoneChangeEvent): void;
  
  // 事件驱动
  onZoneStatusChange: Subject<ZoneStatusChangeEvent>;
  onConflictDetected: Subject<ConflictEvent>;
}

// 实现策略
class ZoneSyncManagerImpl implements ZoneSyncManager {
  private eventBus = rtsEventBus;
  private syncQueue = new PriorityQueue<SyncTask>();
  private conflictResolver = new LastWriteWinsResolver();
  
  async syncZoneStatus(zoneId: string, status: ZoneStatus): Promise<void> {
    const syncTask = { zoneId, status, timestamp: Date.now() };
    this.syncQueue.enqueue(syncTask);
    
    try {
      await this.projectManager.updateZone(zoneId, { status });
      this.eventBus.emit('zone:synced', { zoneId, status });
    } catch (error) {
      this.eventBus.emit('zone:sync_failed', { zoneId, error });
      throw error;
    }
  }
}
```

**依赖关系**:
- 事件系统 (RTSEventBus)
- ProjectManager 集成
- 网络状态检测

**测试策略**:
```typescript
describe('ZoneSyncManager', () => {
  it('should sync zone status to server', async () => {
    const manager = new ZoneSyncManagerImpl(mockProjectManager);
    await manager.syncZoneStatus('zone-1', 'active');
    
    expect(mockProjectManager.updateZone).toHaveBeenCalledWith(
      'zone-1',
      { status: 'active' }
    );
  });
  
  it('should handle sync failure gracefully', async () => {
    mockProjectManager.updateZone.mockRejectedValue(new Error('Network error'));
    
    const manager = new ZoneSyncManagerImpl(mockProjectManager);
    await expect(manager.syncZoneStatus('zone-1', 'active'))
      .rejects.toThrow('Network error');
      
    expect(eventBusSpy).toHaveBeenCalledWith('zone:sync_failed', expect.any(Object));
  });
});
```

---

### 2. 错误处理系统 (P0)

**位置**: `src/stratix-rts/error/ErrorBoundary.ts`

```typescript
interface ErrorHandler {
  handleError(error: Error, context: ErrorContext): void;
  showUserFeedback(error: UserError): void;
  recoverFromError(error: RecoverableError): Promise<void>;
}

class RTSErrorBoundary implements ErrorHandler {
  private toastManager: ToastManager;
  private errorTracker: ErrorTracker;
  
  handleError(error: Error, context: ErrorContext): void {
    // 分类错误
    const classifiedError = this.classifyError(error);
    
    // 记录到追踪系统
    this.errorTracker.capture(error, context);
    
    // 用户反馈
    if (classifiedError.userFacing) {
      this.showUserFeedback(classifiedError);
    }
    
    // 自动恢复
    if (classifiedError.recoverable) {
      this.recoverFromError(classifiedError);
    }
  }
  
  showUserFeedback(error: UserError): void {
    this.toastManager.show({
      type: error.severity,
      title: error.title,
      message: error.message,
      duration: error.duration || 5000,
      actions: error.actions || []
    });
  }
}

// 全局错误处理器
const globalErrorHandler = new RTSErrorBoundary();

// 使用装饰器包装异步操作
function withErrorBoundary<T>(
  target: any,
  propertyKey: string,
  descriptor: TypedPropertyDescriptor<(...args: any[]) => Promise<T>>
) {
  const originalMethod = descriptor.value;
  
  descriptor.value = async function(...args: any[]): Promise<T> {
    try {
      return await originalMethod.apply(this, args);
    } catch (error) {
      globalErrorHandler.handleError(error, {
        method: propertyKey,
        args,
        timestamp: Date.now()
      });
      throw error;
    }
  };
  
  return descriptor;
}
```

**使用示例**:
```typescript
class StratixRTSGameScene extends Phaser.Scene {
  @withErrorBoundary
  async handleZoneDrawEnd(): Promise<Phaser.Geom.Rectangle | null> {
    if (this.taskZonePreview.isOverlapping()) {
      throw new UserError({
        title: '无法创建区域',
        message: '新区域与现有区域重叠',
        severity: 'warning',
        actions: [
          { label: '撤销', action: () => this.taskZonePreview.cancel() },
          { label: '调整位置', action: () => this.enterZoneDrawingMode() }
        ]
      });
    }
    
    const bounds = this.taskZonePreview.end();
    if (bounds && bounds.width >= 100 && bounds.height >= 100) {
      const result = await this.projectManagerIntegration.createProjectWithBounds(bounds);
      return result;
    }
    
    return null;
  }
}
```

---

### 3. 空间索引优化 (P1)

**位置**: `src/stratix-rts/systems/ZoneSpatialIndex.ts`

```typescript
interface SpatialIndex {
  insert(zone: TaskZone): void;
  remove(zoneId: string): void;
  update(zone: TaskZone): void;
  query(bounds: Phaser.Geom.Rectangle): TaskZone[];
  checkOverlap(rect: Phaser.Geom.Rectangle, excludeId?: string): boolean;
}

class ZoneSpatialIndex implements SpatialIndex {
  private grid: SpatialHashGrid<TaskZone>;
  private cellSize: number = 100; // 网格单元大小
  
  constructor() {
    this.grid = new SpatialHashGrid<TaskZone>(this.cellSize);
  }
  
  insert(zone: TaskZone): void {
    const bounds = zone.getBounds();
    const cells = this.getBoundsCells(bounds);
    
    cells.forEach(cellKey => {
      this.grid.insert(cellKey, zone);
    });
  }
  
  query(bounds: Phaser.Geom.Rectangle): TaskZone[] {
    const cells = this.getBoundsCells(bounds);
    const zones = new Set<TaskZone>();
    
    cells.forEach(cellKey => {
      const cellZones = this.grid.get(cellKey);
      cellZones.forEach(zone => zones.add(zone));
    });
    
    // 精确过滤
    return Array.from(zones).filter(zone => 
      Phaser.Geom.Rectangle.Overlaps(bounds, zone.getBounds())
    );
  }
  
  checkOverlap(rect: Phaser.Geom.Rectangle, excludeId?: string): boolean {
    const nearbyZones = this.query(rect);
    return nearbyZones.some(zone => 
      zone.getZoneId() !== excludeId && 
      Phaser.Geom.Rectangle.Overlaps(rect, zone.getBounds())
    );
  }
  
  private getBoundsCells(bounds: Phaser.Geom.Rectangle): string[] {
    const startX = Math.floor(bounds.x / this.cellSize);
    const endX = Math.ceil((bounds.x + bounds.width) / this.cellSize);
    const startY = Math.floor(bounds.y / this.cellSize);
    const endY = Math.ceil((bounds.y + bounds.height) / this.cellSize);
    
    const cells: string[] = [];
    for (let x = startX; x <= endX; x++) {
      for (let y = startY; y <= endY; y++) {
        cells.push(`${x},${y}`);
      }
    }
    
    return cells;
  }
}

// 性能测试
describe('ZoneSpatialIndex Performance', () => {
  it('should handle 100 zones with < 1ms query time', () => {
    const index = new ZoneSpatialIndex();
    
    // 插入100个Zone
    for (let i = 0; i < 100; i++) {
      const zone = createMockZone(i, i * 10, i * 10, 50, 50);
      index.insert(zone);
    }
    
    // 测试查询性能
    const start = performance.now();
    const results = index.query(new Phaser.Geom.Rectangle(0, 0, 100, 100));
    const duration = performance.now() - start;
    
    expect(duration).toBeLessThan(1); // < 1ms
    expect(results.length).toBeGreaterThan(0);
  });
});
```

---

### 4. 选中状态管理器 (P1)

**位置**: `src/stratix-rts/managers/SelectionManager.ts`

```typescript
interface SelectionManager {
  // Agent 选择
  selectAgent(agentId: string, mode?: SelectionMode): void;
  deselectAgent(agentId: string): void;
  getSelectedAgents(): Set<string>;
  
  // Zone 选择
  selectZone(zoneId: string, mode?: SelectionMode): void;
  deselectZone(zoneId: string): void;
  getSelectedZones(): Set<string>;
  
  // 全局操作
  clearAll(): void;
  invertSelection(): void;
  selectAll(): void;
  
  // 预览
  setPreview(agentIds: Set<string>): void;
  clearPreview(): void;
  
  // 事件
  onSelectionChange: Subject<SelectionChangeEvent>;
}

enum SelectionMode {
  Replace = 'replace',      // 替换当前选择
  Add = 'add',              // 添加到选择
  Remove = 'remove',        // 从选择移除
  Toggle = 'toggle'         // 切换选择状态
}

class SelectionManagerImpl implements SelectionManager {
  private agents = new Set<string>();
  private zones = new Set<string>();
  private preview = new Set<string>();
  
  private selectionChange$ = new Subject<SelectionChangeEvent>();
  onSelectionChange = this.selectionChange$.asObservable();
  
  selectAgent(agentId: string, mode: SelectionMode = SelectionMode.Replace): void {
    const previousAgents = new Set(this.agents);
    
    switch (mode) {
      case SelectionMode.Replace:
        this.agents.clear();
        this.agents.add(agentId);
        break;
      case SelectionMode.Add:
        this.agents.add(agentId);
        break;
      case SelectionMode.Remove:
        this.agents.delete(agentId);
        break;
      case SelectionMode.Toggle:
        if (this.agents.has(agentId)) {
          this.agents.delete(agentId);
        } else {
          this.agents.add(agentId);
        }
        break;
    }
    
    this.emitChange({ type: 'agent', previous: previousAgents, current: this.agents });
  }
  
  clearAll(): void {
    const previousAgents = new Set(this.agents);
    const previousZones = new Set(this.zones);
    
    this.agents.clear();
    this.zones.clear();
    this.preview.clear();
    
    this.emitChange({ type: 'all', previous: { agents: previousAgents, zones: previousZones } });
  }
  
  private emitChange(event: SelectionChangeEvent): void {
    this.selectionChange$.next(event);
    rtsEventBus.emit('selection:changed', event);
  }
}
```

**集成到 GameScene**:
```typescript
class StratixRTSGameScene extends Phaser.Scene {
  private selectionManager: SelectionManager;
  
  create(): void {
    this.selectionManager = new SelectionManagerImpl();
    
    // 订阅选择变化
    this.selectionManager.onSelectionChange.subscribe(event => {
      this.updateUI(event);
    });
  }
  
  private handleSelect(agentIds: string[], shiftKey: boolean): void {
    const mode = shiftKey ? SelectionMode.Add : SelectionMode.Replace;
    
    agentIds.forEach(id => {
      this.selectionManager.selectAgent(id, mode);
    });
  }
}
```

---

### 5. 撤销/重做系统 (P1)

**位置**: `src/stratix-rts/history/ZoneHistory.ts`

```typescript
interface ZoneAction {
  id: string;
  type: 'create' | 'delete' | 'move' | 'resize' | 'status_change';
  timestamp: number;
  data: any;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

class ZoneHistory {
  private undoStack: ZoneAction[] = [];
  private redoStack: ZoneAction[] = [];
  private maxHistorySize: number = 50;
  
  // 执行操作并记录
  async execute(action: ZoneAction): Promise<void> {
    await action.redo();
    this.undoStack.push(action);
    this.redoStack.clear();
    
    // 限制历史大小
    if (this.undoStack.length > this.maxHistorySize) {
      this.undoStack.shift();
    }
    
    this.emitHistoryChange();
  }
  
  // 撤销
  async undo(): Promise<void> {
    const action = this.undoStack.pop();
    if (!action) return;
    
    await action.undo();
    this.redoStack.push(action);
    
    this.emitHistoryChange();
  }
  
  // 重做
  async redo(): Promise<void> {
    const action = this.redoStack.pop();
    if (!action) return;
    
    await action.redo();
    this.undoStack.push(action);
    
    this.emitHistoryChange();
  }
  
  canUndo(): boolean {
    return this.undoStack.length > 0;
  }
  
  canRedo(): boolean {
    return this.redoStack.length > 0;
  }
  
  private emitHistoryChange(): void {
    rtsEventBus.emit('history:changed', {
      canUndo: this.canUndo(),
      canRedo: this.canRedo()
    });
  }
}

// 具体操作实现
class ZoneMoveAction implements ZoneAction {
  id: string;
  type = 'move' as const;
  timestamp: number;
  
  constructor(
    private zone: TaskZone,
    private oldPosition: { x: number; y: number },
    private newPosition: { x: number; y: number }
  ) {
    this.id = `move-${Date.now()}`;
    this.timestamp = Date.now();
  }
  
  async undo(): Promise<void> {
    this.zone.setPosition(this.oldPosition.x, this.oldPosition.y);
    rtsEventBus.emit('zone:moved', {
      zoneId: this.zone.getZoneId(),
      position: this.oldPosition,
      isUndo: true
    });
  }
  
  async redo(): Promise<void> {
    this.zone.setPosition(this.newPosition.x, this.newPosition.y);
    rtsEventBus.emit('zone:moved', {
      zoneId: this.zone.getZoneId(),
      position: this.newPosition,
      isRedo: true
    });
  }
}

// 使用示例
class StratixRTSGameScene extends Phaser.Scene {
  private zoneHistory: ZoneHistory;
  
  private handleZoneDragEnd(): void {
    this.taskZones.forEach(zone => {
      if (zone.isZoneDragging()) {
        const oldPos = zone.getData('dragStartPos');
        const newPos = { x: zone.x, y: zone.y };
        
        const action = new ZoneMoveAction(zone, oldPos, newPos);
        this.zoneHistory.execute(action);
        
        zone.endDrag();
      }
    });
  }
}
```

---

### 6. 交互体验优化 (P2)

**位置**: `src/stratix-rts/ui/ZoneDrawingUI.ts`

```typescript
class ZoneDrawingUI {
  private cursorIndicator: Phaser.GameObjects.Graphics;
  private tooltipText: Phaser.GameObjects.Text;
  private toolbar: ZoneToolbar;
  
  constructor(private scene: Phaser.Scene) {
    this.createCursorIndicator();
    this.createTooltip();
    this.createToolbar();
  }
  
  // 绘制模式光标指示器
  private createCursorIndicator(): void {
    this.cursorIndicator = this.scene.add.graphics();
    this.cursorIndicator.setDepth(10000);
    
    this.scene.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.scene.inputHandler.getMode() === 'zoneDrawing') {
        this.drawDrawingCursor(pointer.worldX, pointer.worldY);
      } else {
        this.cursorIndicator.setVisible(false);
      }
    });
  }
  
  private drawDrawingCursor(x: number, y: number): void {
    this.cursorIndicator.clear();
    this.cursorIndicator.setVisible(true);
    
    // 绘制十字准线
    this.cursorIndicator.lineStyle(2, 0xff6600, 0.8);
    this.cursorIndicator.lineBetween(x - 20, y, x + 20, y);
    this.cursorIndicator.lineBetween(x, y - 20, x, y + 20);
    
    // 绘制圆形
    this.cursorIndicator.strokeCircle(x, y, 10);
  }
  
  // 工具栏
  private createToolbar(): void {
    this.toolbar = new ZoneToolbar(this.scene, 10, 10, [
      { id: 'select', icon: '🖱️', label: '选择模式', shortcut: 'ESC' },
      { id: 'draw', icon: '✏️', label: '绘制区域', shortcut: 'Z' },
      { id: 'template', icon: '📋', label: '模板', shortcut: 'T' },
      { id: 'undo', icon: '↶', label: '撤销', shortcut: 'Ctrl+Z' },
      { id: 'redo', icon: '↷', label: '重做', shortcut: 'Ctrl+Y' }
    ]);
    
    this.toolbar.on('tool:select', (toolId: string) => {
      switch (toolId) {
        case 'select':
          this.scene.inputHandler.setMode('normal');
          break;
        case 'draw':
          this.scene.inputHandler.setMode('zoneDrawing');
          break;
        case 'undo':
          this.scene.zoneHistory.undo();
          break;
        case 'redo':
          this.scene.zoneHistory.redo();
          break;
      }
    });
  }
}

// 批量操作支持
class ZoneBatchOperations {
  static moveZones(
    zones: TaskZone[],
    deltaX: number,
    deltaY: number,
    history: ZoneHistory
  ): void {
    const actions = zones.map(zone => {
      const oldPos = { x: zone.x, y: zone.y };
      const newPos = { x: zone.x + deltaX, y: zone.y + deltaY };
      return new ZoneMoveAction(zone, oldPos, newPos);
    });
    
    // 作为单个操作执行
    const batchAction = new BatchAction(actions);
    history.execute(batchAction);
  }
  
  static deleteZones(
    zones: TaskZone[],
    scene: StratixRTSGameScene
  ): void {
    // 显示确认提示（非阻塞）
    scene.toastManager.show({
      type: 'warning',
      title: '确认删除',
      message: `将删除 ${zones.length} 个区域`,
      duration: 5000,
      actions: [
        { 
          label: '确认', 
          action: () => this.executeDelete(zones, scene)
        },
        { 
          label: '取消', 
          action: () => {} 
        }
      ]
    });
  }
}
```

---

### 7. 配置管理系统 (P2)

**位置**: `config/zone-config.ts`

```typescript
// 统一配置定义
export const ZONE_CONFIG = {
  // 视觉配置
  visual: {
    colors: {
      fence: 0xff6600,
      fill: 0xff6600,
      corner: 0xffaa00,
      selected: 0x00ff00,
      warning: 0xff0000,
      handle: 0xffff00,
      status: {
        idle: 0x888888,
        active: 0x00ff88,
        busy: 0xffff00,
        error: 0xff4444
      },
      type: {
        code: 0x9B59B6,
        analysis: 0xE67E22,
        writing: 0x4A90E2,
        general: 0x00ffff
      }
    },
    sizes: {
      cornerHandleRadius: 8,
      centerHandleRadius: 10,
      minZoneWidth: 40,
      minZoneHeight: 40,
      defaultZoneWidth: 200,
      defaultZoneHeight: 150,
      postSpacing: 20,
      postRadius: 2
    },
    alpha: {
      fill: 0.15,
      selected: 0.25,
      overlap: 0.3
    }
  },
  
  // 交互配置
  interaction: {
    dragThreshold: 5,
    doubleClickThreshold: 300,
    edgeScrollMargin: 20,
    edgeScrollSpeed: 8
  },
  
  // 性能配置
  performance: {
    spatialGridCellSize: 100,
    maxHistorySize: 50,
    maxZones: 200,
    objectPoolSize: 20
  }
} as const;

// 类型安全的配置访问
type ZoneConfig = typeof ZONE_CONFIG;

function getZoneConfig<K extends keyof ZoneConfig>(
  path: K
): ZoneConfig[K] {
  return ZONE_CONFIG[path];
}
```

**使用示例**:
```typescript
// 替换硬编码
class TaskZone extends BaseZone {
  constructor(scene: Phaser.Scene, config: TaskZoneConfig) {
    const colors = ZONE_CONFIG.visual.colors;
    const sizes = ZONE_CONFIG.visual.sizes;
    
    // 使用配置
    const cornerHandle = scene.add.arc(
      x, y,
      sizes.cornerHandleRadius,
      0, 360,
      false,
      colors.corner
    );
  }
}
```

---

### 8. 性能优化实现 (P2)

**位置**: `src/stratix-rts/performance/ZoneRenderer.ts`

```typescript
// 增量渲染
class ZoneRenderer {
  private dirtyZones = new Set<string>();
  private renderQueued = false;
  
  markDirty(zoneId: string): void {
    this.dirtyZones.add(zoneId);
    this.queueRender();
  }
  
  private queueRender(): void {
    if (this.renderQueued) return;
    
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderDirtyZones();
      this.renderQueued = false;
    });
  }
  
  private renderDirtyZones(): void {
    this.dirtyZones.forEach(zoneId => {
      const zone = this.zones.get(zoneId);
      if (zone) {
        zone.redraw();
      }
    });
    this.dirtyZones.clear();
  }
}

// 对象池
class TaskZonePool {
  private pool: TaskZone[] = [];
  private maxSize: number;
  
  constructor(maxSize: number = ZONE_CONFIG.performance.objectPoolSize) {
    this.maxSize = maxSize;
  }
  
  acquire(config: TaskZoneConfig, scene: Phaser.Scene): TaskZone {
    if (this.pool.length > 0) {
      const zone = this.pool.pop()!;
      zone.reset(config);
      return zone;
    }
    
    return new TaskZone(scene, config);
  }
  
  release(zone: TaskZone): void {
    if (this.pool.length < this.maxSize) {
      zone.cleanup();
      this.pool.push(zone);
    } else {
      zone.destroy();
    }
  }
}
```

---

## 📝 实施计划

### 第1周 (P0任务)

**周一-周二**: 状态同步管理器
- [ ] 实现 ZoneSyncManager 类
- [ ] 集成到 TaskZone 状态变更
- [ ] 编写单元测试
- [ ] 性能测试（100个Zone同步）

**周三-周四**: 错误处理系统
- [ ] 实现 ErrorBoundary 类
- [ ] 创建 Toast UI 组件
- [ ] 包装关键操作（创建/移动/删除）
- [ ] 测试错误恢复流程

**周五**: 集成测试
- [ ] P0任务回归测试
- [ ] 性能基准测试
- [ ] 文档更新

### 第2周 (P1任务)

**周一-周二**: 空间索引优化
- [ ] 实现 ZoneSpatialIndex 类
- [ ] 替换现有重叠检测逻辑
- [ ] 性能对比测试
- [ ] 压力测试（500个Zone）

**周三**: 状态管理重构
- [ ] 实现 SelectionManager 类
- [ ] 重构 GameScene 选择逻辑
- [ ] 单元测试

**周四-周五**: 撤销重做
- [ ] 实现 ZoneHistory 类
- [ ] 创建操作类（Move/Create/Delete）
- [ ] 集成键盘快捷键
- [ ] 端到端测试

### 第3-4周 (P2任务)

**第3周**:
- 交互体验优化（工具栏、光标指示器）
- 配置管理系统
- 批量操作实现

**第4周**:
- 渲染优化
- 对象池实现
- 性能测试和优化

### 第5-8周 (P3任务)

**第5-6周**:
- Zone模板系统
- 工作流可视化

**第7-8周**:
- 帮助系统
- 可访问性支持
- 最终测试和文档

---

## ✅ 验收标准

### 功能验收
- [ ] 所有P0/P1任务单元测试通过
- [ ] 回归测试套件100%通过
- [ ] 性能基准达标（60 FPS @ 100 Zones）
- [ ] 错误恢复成功率 > 95%

### 代码质量
- [ ] 代码覆盖率 > 80%
- [ ] ESLint无错误
- [ ] TypeScript严格模式通过
- [ ] 无安全漏洞

### 用户体验
- [ ] 撤销/重做功能可用
- [ ] 错误提示清晰友好
- [ ] 操作响应时间 < 100ms
- [ ] 无UI卡顿

### 文档完整
- [ ] API文档完整
- [ ] 用户指南更新
- [ ] 架构设计文档
- [ ] 测试报告

---

## 🔧 技术债务清单

### 已知问题
1. **类型定义重复**: ZoneStatus 和 TaskZoneStatus 重复
2. **硬编码配置**: 颜色、尺寸散落各处
3. **事件监听泄漏**: 部分场景未清理订阅
4. **过度绘制**: 每次 redraw 清除重绘

### 计划偿还
- P2任务中统一配置管理
- 重构过程中清理类型定义
- 实现统一的订阅管理机制
- 增量渲染优化

---

## 📚 参考资源

### 技术文档
- [Phaser 3 官方文档](https://photonstorm.github.io/phaser3-docs/)
- [TypeScript 最佳实践](https://www.typescriptlang.org/docs/handbook/declaration-files/do-s-and-don-ts.html)
- [性能优化指南](https://web.dev/performance/)

### 设计模式
- Command Pattern (撤销/重做)
- Object Pool (性能优化)
- Observer Pattern (事件系统)
- State Pattern (状态管理)

### 工具和库
- Jest (单元测试)
- Playwright (E2E测试)
- ESLint + Prettier (代码质量)
- LRA (任务管理)

---

## 📞 联系和支持

- **项目负责人**: [指定负责人]
- **技术支持**: [技术团队]
- **问题反馈**: [GitHub Issues链接]
- **进度追踪**: [项目管理工具链接]

---

*本文档将随着项目进展持续更新*