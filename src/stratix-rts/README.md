# Stratix RTS Zone系统

基于Phaser.js的实时策略风格区域管理系统，提供直观的图形化操作界面和强大的Zone管理功能。

## 功能特性

### 核心功能

- **Zone创建与编辑**: 支持拖拽绘制、调整大小、移动等操作
- **多种Zone类型**: 支持4种任务类型 (Code, Analysis, Writing, General)
- **模板系统**: 内置网格、线性、圆形模板，支持自定义模板
- **连接管理**: Zone间的可视化连接，支持多种连接类型
- **工作流引擎**: 完整的工作流定义、执行和监控
- **撤销/重做**: 完整的历史记录管理
- **批量操作**: 支持批量移动、删除、复制、对齐等操作

### 性能优化

- **空间索引**: 基于网格的空间索引，优化重叠检测性能
- **事件驱动**: 高效的事件系统，降低模块间耦合
- **批量渲染**: 减少渲染调用，提升性能
- **状态管理**: 统一的状态流管理，便于调试和追踪

### 用户体验

- **RTS风格交互**: 借鉴RTS游戏的操作方式，降低学习成本
- **视觉反馈**: 丰富的视觉反馈（选中、警告、拖拽状态等）
- **快捷键支持**: 完整的键盘快捷键系统
- **实时预览**: Zone创建和编辑时的实时预览

## 技术栈

- **游戏引擎**: Phaser 3
- **开发语言**: TypeScript
- **构建工具**: Vite
- **测试框架**: Jest
- **代码规范**: ESLint + Prettier

## 快速开始

### 安装

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### 基本使用

```typescript
import { TaskZone } from '@/stratix-rts/zones/TaskZone';
import { ZoneTemplateManager } from '@/stratix-rts/zones/ZoneTemplateManager';
import { ZoneConnectionManager } from '@/stratix-rts/zones/ZoneConnectionManager';

// 创建Zone
const zone = new TaskZone(scene, {
  id: 'zone-001',
  name: '任务区域',
  x: 100,
  y: 100,
  width: 200,
  height: 150,
  taskType: 'code'
});

// 使用模板
const templateManager = new ZoneTemplateManager();
const result = await templateManager.applyTemplate(
  'grid-template',
  { baseX: 0, baseY: 0, scale: 1 },
  createZoneFunction
);

// 创建连接
const connectionManager = new ZoneConnectionManager();
connectionManager.createConnection('zone-1', 'zone-2', 'sequential');
```

## 目录结构

```
src/stratix-rts/
├── zones/              # Zone核心类
│   ├── BaseZone.ts            # Zone基类
│   ├── TaskZone.ts            # 任务Zone
│   ├── ZoneConnection.ts      # 连接类
│   ├── ZoneConnectionManager.ts # 连接管理器
│   ├── ZoneTemplateManager.ts  # 模板管理器
│   └── WorkflowVisualizer.ts   # 工作流可视化
├── state/              # 状态管理
│   └── ZoneStateFlow.ts       # 状态流管理
├── history/            # 历史记录
│   └── ZoneHistory.ts         # 撤销/重做
├── managers/           # 管理器
│   └── ZoneSyncManager.ts     # 同步管理
├── spatial/            # 空间索引
│   └── ZoneSpatialIndex.ts    # 空间索引实现
├── ui/                 # UI组件
│   ├── ZoneDrawingUI.ts       # 绘制UI
│   ├── ZoneBatchOperations.ts # 批量操作
│   └── SelectBox.ts           # 选择框
├── events/             # 事件系统
│   └── core/
│       └── RTSEventBus.ts     # 事件总线
├── config/             # 配置
│   └── zone-config.ts         # Zone配置
└── tests/              # 测试文件
    └── ...
```

## 核心概念

### Zone

Zone是系统的核心概念，代表一个工作区域。每个Zone具有：

- **唯一标识**: ID和名称
- **空间属性**: 位置、大小
- **状态**: idle, active, busy, error, completed
- **任务类型**: code, analysis, writing, general
- **交互能力**: 拖拽、调整大小、选择

### 连接

连接表示Zone之间的关系，支持：

- **Sequential**: 顺序执行
- **Parallel**: 并行执行
- **Conditional**: 条件执行
- **Feedback**: 反馈回路

### 模板

模板是预定义的Zone布局，可以快速创建多个Zone：

- **Grid**: 网格布局
- **Linear**: 线性布局
- **Circular**: 圆形布局
- **Custom**: 自定义布局

### 工作流

工作流是由多个Zone和连接组成的执行流程：

- 支持启动、暂停、恢复、重置
- 实时跟踪执行状态
- 可视化工作流结构

## 文档

- [架构文档](../../docs/RTS_ZONE_ARCHITECTURE.md) - 系统架构和设计理念
- [API文档](../../docs/RTS_ZONE_API.md) - 完整的API参考
- [用户指南](../../docs/RTS_ZONE_USER_GUIDE.md) - 使用指南和最佳实践

## 开发指南

### 代码规范

- 使用TypeScript严格模式
- 遵循ESLint和Prettier配置
- 编写单元测试覆盖核心功能
- 添加清晰的代码注释

### 测试

```bash
# 运行所有测试
npm test

# 运行特定测试文件
npm test -- ZoneHistory.test.ts

# 生成覆盖率报告
npm test -- --coverage
```

### 构建

```bash
# 开发构建
npm run build:dev

# 生产构建
npm run build

# 类型检查
npm run typecheck

# 代码检查
npm run lint
```

## 性能优化建议

### Zone数量管理

- **小型项目 (< 100个Zone)**: 默认配置即可
- **中型项目 (100-500个Zone)**: 调整空间索引网格大小为150
- **大型项目 (> 500个Zone)**: 启用所有优化选项，使用200的网格大小

### 空间索引配置

```typescript
// 根据Zone平均大小调整
const cellSize = Math.max(100, avgZoneSize / 2);
const spatialIndex = new ZoneSpatialIndex(cellSize);
```

### 批量操作优化

```typescript
// 暂停渲染，执行批量操作
scene.scene.pause();
// 批量创建或修改Zone
// ...
scene.scene.resume();
```

## 常见问题

### Q: 如何自定义Zone类型？

继承 `BaseZone` 类并实现 `updateVisuals()` 方法：

```typescript
class CustomZone extends BaseZone {
  protected updateVisuals(): void {
    // 自定义渲染逻辑
  }
}
```

### Q: 如何监听Zone事件？

使用EventBus订阅事件：

```typescript
rtsEventBus.on('zone:created', (event) => {
  console.log('Zone创建:', event.zoneId);
});
```

### Q: 如何实现Zone持久化？

使用模板系统的导入导出功能：

```typescript
const json = templateManager.exportTemplates();
// 保存json到数据库或文件

templateManager.importTemplates(json);
```

## 版本历史

### v1.0.0 (2026-03-05)

- ✅ 完整的Zone创建和编辑功能
- ✅ 模板系统
- ✅ 连接和工作流
- ✅ 撤销/重做
- ✅ 批量操作
- ✅ 空间索引优化
- ✅ 完整的文档

## 贡献指南

1. Fork项目
2. 创建功能分支 (`git checkout -b feature/amazing-feature`)
3. 提交更改 (`git commit -m 'Add amazing feature'`)
4. 推送到分支 (`git push origin feature/amazing-feature`)
5. 创建Pull Request

## 许可证

MIT License

## 联系方式

- 项目主页: [GitHub Repository]
- 问题反馈: [Issues]
- 文档: [Documentation]

---

**维护团队**: Stratix Team  
**最后更新**: 2026-03-05