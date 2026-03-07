# 项目管理模块 - 测试与优化指南

## 测试策略

由于项目当前使用 Playwright 进行测试，项目管理模块建议采用以下测试策略：

### 1. 手动测试（推荐）

按照 [完整集成示例](../../docs/project-management/FULL_INTEGRATION_EXAMPLE.md) 中的步骤进行手动测试：

#### 测试清单

**项目创建流程**
- [ ] P 键切换绘制模式
- [ ] 右键拖动绘制项目区
- [ ] 配置面板正确弹出
- [ ] 保存配置成功
- [ ] 项目区正确显示

**项目管理流程**
- [ ] 项目列表正确显示
- [ ] 启动项目功能正常
- [ ] 暂停项目功能正常
- [ ] 完成项目功能正常
- [ ] 删除项目功能正常

**数据持久化**
- [ ] 刷新页面后项目仍然存在
- [ ] 数据正确保存到 JSON 文件
- [ ] 项目状态正确更新

**可视化功能**
- [ ] 项目区拖拽正常
- [ ] 项目区缩放正常
- [ ] 状态指示器正确显示
- [ ] 进度条实时更新

### 2. 自动化测试（未来计划）

#### Jest 单元测试
```
tests/project-management/
├── unit/
│   ├── ProjectStore.test.ts
│   ├── ProjectManager.test.ts
│   └── helpers.test.ts
└── integration/
    └── project-workflow.test.ts
```

## 性能优化

### 已实现的优化

1. **事件驱动架构**
   - 使用 mitt 事件总线
   - 避免直接数据修改
   - 模块解耦

2. **按需加载**
   - 自动加载现有项目
   - 懒加载配置面板

3. **数据缓存**
   - ProjectStore 内部缓存
   - 减少 JSON 文件读写

### 待实现的优化

#### 1. 虚拟滚动（优先级：高）

当项目数量超过 50 时，项目列表应使用虚拟滚动：

```vue
<template>
  <RecycleScroller
    :items="projects"
    :item-size="80"
    key-field="id"
  >
    <template #default="{ item }">
      <ProjectItem :project="item" />
    </template>
  </RecycleScroller>
</template>

<script setup>
import { RecycleScroller } from 'vue-virtual-scroller';
</script>
```

#### 2. 项目区分组渲染（优先级：中）

大量项目时，只渲染视口内的项目：

```typescript
class ProjectZoneManager {
  private visibleZones: Set<string> = new Set();
  
  updateVisibleZones(viewport: Phaser.Geom.Rectangle) {
    this.projectZones.forEach((zone, id) => {
      const bounds = zone.getBounds();
      const isVisible = Phaser.Geom.Rectangle.Overlaps(viewport, bounds);
      
      if (isVisible && !this.visibleZones.has(id)) {
        zone.setVisible(true);
        this.visibleZones.add(id);
      } else if (!isVisible && this.visibleZones.has(id)) {
        zone.setVisible(false);
        this.visibleZones.delete(id);
      }
    });
  }
}
```

#### 3. 防抖和节流（优先级：中）

频繁操作时使用防抖：

```typescript
import { debounce, throttle } from 'lodash';

// 防抖更新项目列表
const debouncedUpdateList = debounce(updateProjectList, 500);

// 节流视口更新
const throttledViewportUpdate = throttle(updateVisibleZones, 100);
```

#### 4. 数据分页（优先级：低）

超大量数据时分页加载：

```typescript
class ProjectStore {
  async getProjectsPaged(page: number, pageSize: number): Promise<Project[]> {
    const all = await this.getAllProjects();
    const start = page * pageSize;
    return all.slice(start, start + pageSize);
  }
}
```

## 性能指标

### 目标性能

| 操作 | 目标 | 测试方法 |
|------|------|----------|
| 创建项目 | < 100ms | 手动计时 |
| 加载 100 个项目 | < 1s | Console.time |
| 项目列表滚动 | 60fps | Chrome DevTools |
| 项目区拖拽 | 60fps | Chrome DevTools |
| 数据保存 | < 50ms | Console.time |

### 性能监控

```typescript
// 添加性能监控
class PerformanceMonitor {
  static measure(name: string, fn: () => Promise<any>) {
    const start = performance.now();
    return fn().finally(() => {
      const duration = performance.now() - start;
      console.log(`[Performance] ${name}: ${duration.toFixed(2)}ms`);
    });
  }
}

// 使用示例
await PerformanceMonitor.measure('Load Projects', async () => {
  await projectManager.loadExistingProjects();
});
```

## 优化清单

### 立即实施（高优先级）
- [ ] 添加项目列表虚拟滚动
- [ ] 实现视口内项目筛选
- [ ] 添加防抖/节流

### 近期实施（中优先级）
- [ ] 优化 JSON 文件写入
- [ ] 添加性能监控
- [ ] 实现数据分页

### 远期实施（低优先级）
- [ ] IndexedDB 替代 lowdb
- [ ] Service Worker 缓存
- [ ] WebWorker 数据处理

## 代码优化建议

### 1. 类型安全增强

```typescript
// 使用 branded types 避免 ID 混淆
type ProjectId = string & { readonly __brand: unique symbol };
type TaskId = string & { readonly __brand: unique symbol };

function getProject(id: ProjectId): Promise<Project | null> {
  // ...
}
```

### 2. 错误处理改进

```typescript
// 统一错误类型
class ProjectError extends Error {
  constructor(
    public code: string,
    message: string,
    public projectId?: string
  ) {
    super(message);
  }
}

// 使用 Result 模式
type Result<T> = 
  | { success: true; value: T }
  | { success: false; error: ProjectError };

async function createProject(config: ProjectConfig): Promise<Result<Project>> {
  try {
    const project = await manager.createProject(config);
    return { success: true, value: project };
  } catch (error) {
    return { 
      success: false, 
      error: new ProjectError('CREATE_FAILED', error.message) 
    };
  }
}
```

### 3. 代码分割

```typescript
// 懒加载重型组件
const ProjectConfigPanel = defineAsyncComponent(() => 
  import('./ui/ProjectConfigPanel.vue')
);

const ProjectListPanel = defineAsyncComponent(() => 
  import('./ui/ProjectListPanel.vue')
);
```

## 监控和日志

### 开发环境日志

```typescript
const DEBUG = process.env.NODE_ENV === 'development';

class Logger {
  static log(category: string, message: string, data?: any) {
    if (DEBUG) {
      console.log(`[${category}] ${message}`, data || '');
    }
  }
  
  static warn(category: string, message: string, data?: any) {
    console.warn(`[${category}] ${message}`, data || '');
  }
  
  static error(category: string, message: string, error?: Error) {
    console.error(`[${category}] ${message}`, error || '');
  }
}

// 使用
Logger.log('ProjectManager', 'Creating project', { name: config.name });
```

## 测试数据生成

```typescript
// 生成测试数据
function generateTestProject(overrides?: Partial<Project>): Project {
  return {
    id: generateId('proj'),
    name: `测试项目 ${Date.now()}`,
    priority: Math.floor(Math.random() * 5) + 1,
    status: 'pending',
    config: {
      name: '测试',
      priority: 3,
      localFolderPath: '/tmp/test',
      agentMode: 'openclaw',
      planningRule: 'sequential',
      executionPermission: 'auto',
      requirement: { type: 'text', content: '测试' },
      progressRule: 'average'
    },
    progress: 0,
    taskCount: 0,
    completedTaskCount: 0,
    zoneConfig: {
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      width: 800,
      height: 600
    },
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  };
}

// 批量生成
function generateTestProjects(count: number): Project[] {
  return Array.from({ length: count }, () => generateTestProject());
}
```

---

**更新时间**: 2026-03-02  
**状态**: 测试指南完成  
**下一步**: 实施性能优化
