# RTS Zone系统用户指南

## 目录

1. [快速开始](#快速开始)
2. [Zone创建和管理](#zone创建和管理)
3. [模板使用](#模板使用)
4. [连接和工作流](#连接和工作流)
5. [快捷键说明](#快捷键说明)
6. [高级功能](#高级功能)
7. [故障排查](#故障排查)

---

## 快速开始

### 系统要求

- Node.js 16+
- 现代浏览器 (Chrome, Firefox, Safari, Edge)
- 支持WebGL的显卡

### 安装

```bash
# 克隆项目
git clone <repository-url>
cd Stratix

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 第一个Zone

1. 打开应用后，进入RTS Zone编辑模式
2. 点击左侧工具栏的"创建Zone"按钮
3. 在画布上拖拽绘制矩形区域
4. 松开鼠标完成Zone创建

```typescript
// 代码示例：创建Zone
const zone = new TaskZone(scene, {
  id: 'zone-001',
  name: '我的第一个Zone',
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  taskType: 'code'
});
```

---

## Zone创建和管理

### 创建Zone

#### 方法1：拖拽绘制

1. 选择"绘制工具"或按快捷键 `D`
2. 在画布上点击并拖拽
3. 绘制完成后松开鼠标

#### 方法2：使用模板

1. 点击"模板库"按钮
2. 选择合适的模板
3. 点击应用，模板会在鼠标位置创建

#### 方法3：代码创建

```typescript
import { TaskZone } from '@/stratix-rts/zones/TaskZone';

const zone = new TaskZone(scene, {
  id: `zone-${Date.now()}`,
  name: '任务区域',
  x: 200,
  y: 200,
  width: 150,
  height: 100,
  taskType: 'analysis'
});

scene.add.existing(zone);
```

### 选择Zone

#### 单选
- 点击Zone即可选中
- 选中的Zone会显示绿色高亮边框和四角手柄

#### 多选
- **Shift + 点击**: 添加到选择集
- **Ctrl + 点击**: 切换选中状态
- **框选**: 拖拽创建选择框，框内所有Zone会被选中

#### 取消选择
- 点击空白区域
- 按 `Escape` 键
- 使用快捷键 `Ctrl+D` (取消选择)

### 移动Zone

#### 拖拽移动
1. 选中Zone
2. 在Zone中心区域按住鼠标左键
3. 拖拽到目标位置
4. 松开鼠标

#### 批量移动
1. 选择多个Zone
2. 拖拽任意一个选中的Zone
3. 所有选中的Zone会一起移动

#### 精确移动
- 使用方向键微调位置
- 按住 `Shift` 加速移动

### 调整Zone大小

#### 使用角手柄
1. 选中Zone
2. 鼠标移到四角的手柄上
3. 拖拽手柄调整大小
4. 最小尺寸为 40x40 像素

#### 代码调整

```typescript
zone.resize(300, 200); // 设置为 300x200
```

### 删除Zone

#### 单个删除
- 选中Zone后按 `Delete` 键
- 右键点击选择"删除"

#### 批量删除
1. 选择多个Zone
2. 按 `Delete` 键
3. 确认删除操作

#### 代码删除

```typescript
zone.destroy();
```

### Zone属性设置

#### 任务类型

Zone支持4种任务类型，每种有不同的颜色和图标：

- **Code** (紫色): 编码任务
- **Analysis** (橙色): 分析任务
- **Writing** (蓝色): 写作任务
- **General** (青色): 通用任务

```typescript
zone.setZoneType('code');
```

#### 状态管理

Zone有5种状态：

- **idle** (灰色): 空闲状态
- **active** (绿色): 激活状态
- **busy** (黄色): 工作中
- **error** (红色): 错误状态
- **completed** (绿色): 已完成

```typescript
zone.setZoneStatus('busy');
```

#### 进度显示

```typescript
// 设置任务进度 (0-100)
zone.setTaskProgress(75);

// 设置分配的Agent数量
zone.setAssignedAgents(3);

// 设置队列中的Agent数量
zone.setQueuedAgents(2);
```

---

## 模板使用

### 打开模板库

点击工具栏的"模板库"按钮，或使用快捷键 `T`

### 内置模板

#### Grid Template (网格模板)
- 用于创建网格布局的Zone
- 适合批量创建相同大小的区域

#### Linear Template (线性模板)
- 用于创建线性排列的Zone
- 适合工作流程场景

#### Circular Template (圆形模板)
- 用于创建圆形排列的Zone
- 适合中心辐射式布局

### 应用模板

1. 从模板库选择模板
2. 点击"应用"按钮
3. 在弹出的对话框中设置参数：
   - **基准坐标**: 模板的起始位置
   - **缩放比例**: 调整Zone大小
   - **自定义尺寸**: 覆盖模板默认尺寸
   - **自定义间距**: 调整Zone之间的间距

4. 点击确认创建

```typescript
// 代码示例：应用模板
const result = await templateManager.applyTemplate(
  'grid-template',
  {
    baseX: 100,
    baseY: 100,
    scale: 1.2,
    customWidth: 150,
    customHeight: 100
  },
  createZoneFunction
);

console.log(`创建了 ${result.zones.length} 个Zone`);
```

### 自定义模板

#### 从现有Zone创建模板

1. 选择要保存为模板的Zone
2. 右键点击选择"保存为模板"
3. 在对话框中输入模板信息：
   - 模板ID
   - 模板名称
   - 描述
   - 分类
   - 标签

```typescript
// 代码示例：创建自定义模板
const template = templateManager.createTemplateFromZones(
  'my-custom-template',
  '自定义模板',
  '这是一个自定义模板',
  'custom',
  [
    { x: 0, y: 0, width: 100, height: 100, name: 'Zone 1' },
    { x: 120, y: 0, width: 100, height: 100, name: 'Zone 2' }
  ]
);

templateManager.saveCustomTemplate(template);
```

#### 导入/导出模板

**导出模板**:
```typescript
// 导出所有模板
const json = templateManager.exportTemplates();

// 导出指定模板
const json = templateManager.exportTemplates(['template-1', 'template-2']);

// 保存到文件
const blob = new Blob([json], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'zone-templates.json';
a.click();
```

**导入模板**:
```typescript
// 从文件读取
const file = document.querySelector('input[type="file"]').files[0];
const text = await file.text();

// 导入
const result = templateManager.importTemplates(text, true);
console.log(`导入了 ${result.imported} 个模板`);
console.log(`跳过了 ${result.skipped} 个模板`);
```

---

## 连接和工作流

### 创建连接

#### 手动连接
1. 选中源Zone
2. 按住 `Ctrl` 点击目标Zone
3. 连接自动创建

#### 拖拽连接
1. 鼠标移到Zone边缘
2. 按住鼠标左键拖拽到目标Zone
3. 松开鼠标创建连接

#### 代码创建

```typescript
const connection = connectionManager.createConnection(
  'zone-1',       // 源Zone
  'zone-2',       // 目标Zone
  'sequential',   // 连接类型
  {
    label: '任务流程',
    priority: 1
  }
);
```

### 连接类型

- **Sequential** (顺序): 按顺序执行
- **Parallel** (并行): 同时执行
- **Conditional** (条件): 根据条件决定
- **Feedback** (反馈): 反馈回路

### 删除连接

1. 点击连接线选中
2. 按 `Delete` 键删除

```typescript
connectionManager.deleteConnection('connection-id');
```

### 工作流管理

#### 创建工作流

```typescript
const workflow = workflowVisualizer.createWorkflow(
  'workflow-1',
  '数据处理流程',
  ['zone-1', 'zone-2', 'zone-3'],
  '完整的数据处理工作流'
);
```

#### 执行工作流

```typescript
// 启动
workflowVisualizer.startWorkflow('workflow-1');

// 暂停
workflowVisualizer.pauseWorkflow('workflow-1');

// 恢复
workflowVisualizer.resumeWorkflow('workflow-1');

// 重置
workflowVisualizer.resetWorkflow('workflow-1');
```

#### 步骤管理

```typescript
// 完成当前步骤
workflowVisualizer.completeStep('workflow-1', 'zone-1');

// 标记步骤失败
workflowVisualizer.failStep('workflow-1', 'zone-2', '错误信息');

// 查询进度
const progress = workflowVisualizer.getWorkflowProgress('workflow-1');
console.log(`进度: ${progress}%`);

// 获取当前活动步骤
const activeStep = workflowVisualizer.getActiveStep('workflow-1');
```

#### 可视化工作流

```typescript
const visualization = workflowVisualizer.visualizeWorkflow('workflow-1');

// visualization.nodes: 节点信息
// visualization.edges: 边信息

// 用于绘制流程图
```

---

## 快捷键说明

### 通用快捷键

| 快捷键 | 功能 |
|--------|------|
| `D` | 绘制工具 |
| `S` | 选择工具 |
| `T` | 打开模板库 |
| `Delete` | 删除选中的Zone |
| `Escape` | 取消选择/关闭对话框 |
| `Ctrl+Z` | 撤销 |
| `Ctrl+Y` | 重做 |
| `Ctrl+Shift+Z` | 重做 (备选) |
| `Ctrl+A` | 全选 |
| `Ctrl+D` | 取消选择 |

### Zone操作快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+C` | 复制Zone |
| `Ctrl+V` | 粘贴Zone |
| `Ctrl+D` | 快速复制 |
| `方向键` | 微调位置 (1像素) |
| `Shift+方向键` | 快速移动 (10像素) |

### 视图快捷键

| 快捷键 | 功能 |
|--------|------|
| `鼠标滚轮` | 缩放视图 |
| `空格+拖拽` | 平移视图 |
| `Home` | 重置视图 |
| `Ctrl+0` | 适应窗口 |

### 批量操作快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl+G` | 对齐到网格 |
| `Ctrl+L` | 左对齐 |
| `Ctrl+R` | 右对齐 |
| `Ctrl+T` | 顶部对齐 |
| `Ctrl+B` | 底部对齐 |
| `Ctrl+Shift+H` | 水平居中对齐 |
| `Ctrl+Shift+V` | 垂直居中对齐 |

---

## 高级功能

### 批量操作

#### 批量移动

```typescript
import { ZoneBatchOperations } from '@/stratix-rts/ui/ZoneBatchOperations';

ZoneBatchOperations.moveZones(
  selectedZones,
  50,  // deltaX
  30,  // deltaY
  history
);
```

#### 批量删除

```typescript
ZoneBatchOperations.deleteZones(
  selectedZones,
  scene,
  true  // 显示确认对话框
);
```

#### 批量复制

```typescript
const duplicated = ZoneBatchOperations.duplicateZones(
  selectedZones,
  scene,
  20,  // offsetX
  20   // offsetY
);
```

#### 批量对齐

```typescript
ZoneBatchOperations.alignZones(
  selectedZones,
  'center_h',  // 对齐方式
  history
);
```

### 状态订阅

#### 订阅Zone事件

```typescript
import { rtsEventBus } from '@/stratix-rts/events/core/RTSEventBus';

// 订阅Zone创建事件
const unsubscribe = rtsEventBus.on('zone:created', (event) => {
  console.log('Zone创建:', event.zoneId);
});

// 取消订阅
unsubscribe();
```

#### 订阅状态流

```typescript
import { ZoneStateFlow } from '@/stratix-rts/state/ZoneStateFlow';

const stateFlow = new ZoneStateFlow({ enableLogging: true });

// 订阅所有事件
stateFlow.subscribe('*', (event) => {
  console.log('事件:', event.type, event.data);
});

// 订阅特定事件
stateFlow.subscribe('zone:moved', (event) => {
  console.log('Zone移动:', event.data);
});
```

### 撤销/重做

```typescript
import { ZoneHistory, ZoneMoveAction } from '@/stratix-rts/history/ZoneHistory';

const history = new ZoneHistory();

// 执行操作
const action = new ZoneMoveAction(zone, oldPos, newPos);
await history.execute(action);

// 撤销
if (history.canUndo()) {
  await history.undo();
}

// 重做
if (history.canRedo()) {
  await history.redo();
}
```

### 空间查询

```typescript
import { ZoneSpatialIndex } from '@/stratix-rts/spatial/ZoneSpatialIndex';

const spatialIndex = new ZoneSpatialIndex(100);

// 插入Zone
spatialIndex.insert({
  id: 'zone-1',
  x: 100,
  y: 100,
  width: 150,
  height: 100
});

// 查询重叠Zone
const overlapping = spatialIndex.queryOverlappingZones({
  id: 'test',
  x: 150,
  y: 150,
  width: 100,
  height: 100
});

// 查询包含点的Zone
const zonesAtPoint = spatialIndex.queryPoint(200, 200);

// 查询区域内的Zone
const zonesInRegion = spatialIndex.queryRegion(0, 0, 500, 500);
```

---

## 故障排查

### 常见问题

#### 1. Zone无法选中

**可能原因**:
- Zone被其他对象遮挡
- 交互区域未正确设置

**解决方案**:
- 检查Zone的深度设置
- 确保Zone已设置为可交互

```typescript
zone.setInteractive(
  new Phaser.Geom.Rectangle(-width/2, -height/2, width, height),
  Phaser.Geom.Rectangle.Contains
);
```

#### 2. 撤销功能不工作

**可能原因**:
- 操作未记录到历史
- Zone引用丢失

**解决方案**:
- 确保使用 `history.execute()` 执行操作
- 检查Zone对象是否仍然存在

```typescript
// 正确做法
const action = new ZoneMoveAction(zone, oldPos, newPos);
await history.execute(action);

// 错误做法 - 不会记录到历史
zone.x = newPos.x;
zone.y = newPos.y;
```

#### 3. 模板应用失败

**可能原因**:
- 模板验证失败
- 创建函数抛出异常

**解决方案**:
- 检查模板验证结果
- 查看控制台错误信息

```typescript
const validation = templateManager.validateTemplate(template);
if (!validation.valid) {
  console.error('模板验证失败:', validation.errors);
  return;
}
```

#### 4. 连接创建失败

**可能原因**:
- 不允许自连接
- 会创建循环连接
- 超过最大连接数限制

**解决方案**:
- 检查连接验证结果
- 调整管理器配置

```typescript
const validation = connectionManager.validateConnection(
  sourceId,
  targetId,
  'sequential'
);

if (!validation.valid) {
  console.error('连接验证失败:', validation.errors);
}

if (validation.warnings.length > 0) {
  console.warn('连接警告:', validation.warnings);
}
```

#### 5. 性能下降

**可能原因**:
- Zone数量过多
- 频繁渲染更新
- 空间索引网格设置不当

**解决方案**:

```typescript
// 1. 启用空间索引
const spatialIndex = new ZoneSpatialIndex(100);

// 2. 批量更新
scene.scene.pause(); // 暂停渲染
// 执行批量操作
scene.scene.resume(); // 恢复渲染

// 3. 检查统计信息
const stats = spatialIndex.getStatistics();
console.log('Zone数量:', stats.zoneCount);
console.log('平均每格Zone数:', stats.averageZonesPerCell);
```

### 调试技巧

#### 1. 启用日志

```typescript
const stateFlow = new ZoneStateFlow({
  enableLogging: true,
  persistToStorage: true
});
```

#### 2. 查看事件流

```typescript
// 订阅所有事件
rtsEventBus.on('*', (event) => {
  console.log('[Event]', event);
});
```

#### 3. 检查状态

```typescript
// 检查Zone状态
console.log('Zone状态:', zone.getZoneStatus());
console.log('Zone类型:', zone.getZoneType());
console.log('Zone边界:', zone.getBounds());

// 检查历史
console.log('撤销栈长度:', history.getUndoStackLength());
console.log('重做栈长度:', history.getRedoStackLength());

// 检查统计
const stats = stateFlow.getStatistics();
console.log('总事件数:', stats.totalEvents);
console.log('事件分布:', stats.eventTypeDistribution);
```

#### 4. 性能分析

```typescript
// 导出事件日志分析
const log = stateFlow.exportLog();
console.log('事件日志:', log);

// 检查空间索引效率
const spatialStats = spatialIndex.getStatistics();
console.log('空间索引统计:', spatialStats);
```

### 获取帮助

如果遇到无法解决的问题，请：

1. 查看控制台错误信息
2. 导出事件日志进行分析
3. 查阅API文档和架构文档
4. 在项目仓库提交Issue

---

## 附录

### Zone颜色说明

| 状态 | 颜色 | 说明 |
|------|------|------|
| Idle | 灰色 (0x888888) | 空闲状态 |
| Active | 绿色 (0x00ff88) | 激活状态 |
| Busy | 黄色 (0xffff00) | 工作中 |
| Error | 红色 (0xff4444) | 错误状态 |
| Completed | 绿色 (0x00ff00) | 已完成 |
| Selected | 绿色 (0x00ff00) | 选中状态 |
| Warning | 红色 (0xff0000) | 警告状态 |

### 任务类型图标

| 类型 | 图标 | 颜色 |
|------|------|------|
| Code | </> | 紫色 (0x9B59B6) |
| Analysis | 📊 | 橙色 (0xE67E22) |
| Writing | ✍️ | 蓝色 (0x4A90E2) |
| General | ◆ | 青色 (0x00ffff) |

### 推荐配置

#### 小型项目 (< 100个Zone)
```typescript
const spatialIndex = new ZoneSpatialIndex(100);
const history = new ZoneHistory();
history.setMaxHistorySize(50);
```

#### 中型项目 (100-500个Zone)
```typescript
const spatialIndex = new ZoneSpatialIndex(150);
const history = new ZoneHistory();
history.setMaxHistorySize(100);
```

#### 大型项目 (> 500个Zone)
```typescript
const spatialIndex = new ZoneSpatialIndex(200);
const history = new ZoneHistory();
history.setMaxHistorySize(200);

// 启用性能优化
const stateFlow = new ZoneStateFlow({
  maxHistorySize: 2000,
  enableLogging: false
});
```

---

**文档版本**: 1.0.0  
**最后更新**: 2026-03-05  
**维护者**: Stratix Team