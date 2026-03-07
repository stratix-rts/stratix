# 项目管理模块集成指南

## 概述

`ProjectManagerIntegration` 是一个集成了所有项目管理功能的类，可以轻松集成到 Phaser 场景中。

## 快速开始

### 1. 在场景中初始化

```typescript
import { ProjectManagerIntegration } from '@/stratix-project';

export class MyGameScene extends Phaser.Scene {
  private projectManager: ProjectManagerIntegration;

  create() {
    // 初始化项目管理器
    this.projectManager = new ProjectManagerIntegration(this, {
      dataDir: 'stratix-data',
      autoLoad: true  // 自动加载现有项目
    });
  }
}
```

### 2. 实现项目区绘制

```typescript
// 开始绘制项目区（鼠标按下时调用）
handlePointerDown(pointer: Phaser.Input.Pointer) {
  if (this.isProjectDrawMode) {
    this.projectManager.startProjectZoneDraw(pointer.worldX, pointer.worldY);
  }
}

// 更新绘制（鼠标移动时调用）
handlePointerMove(pointer: Phaser.Input.Pointer) {
  if (this.projectManager.isDrawing()) {
    this.projectManager.updateProjectZoneDraw(pointer.worldX, pointer.worldY);
  }
}

// 结束绘制（鼠标释放时调用）
async handlePointerUp() {
  if (this.projectManager.isDrawing()) {
    const result = await this.projectManager.endProjectZoneDraw();
    if (result) {
      console.log('项目区已创建:', result.project.id);
      // 显示配置面板
      this.showProjectConfigPanel(result.project);
    }
  }
}

// 取消绘制
handlePointerCancel() {
  this.projectManager.cancelProjectZoneDraw();
}
```

### 3. 显示项目配置面板

```vue
<template>
  <ProjectConfigPanel
    :visible="showConfigPanel"
    :initial-config="selectedProject?.config"
    @save="handleSaveConfig"
    @close="showConfigPanel = false"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { ProjectConfigPanel, Project, ProjectConfig } from '@/stratix-project';

const showConfigPanel = ref(false);
const selectedProject = ref<Project | null>(null);

function showProjectConfigPanel(project: Project) {
  selectedProject.value = project;
  showConfigPanel.value = true;
}

async function handleSaveConfig(config: ProjectConfig) {
  if (selectedProject.value) {
    await projectManager
      .getProjectManager()
      .updateProject(selectedProject.value.id, { config });
    showConfigPanel.value = false;
  }
}
</script>
```

### 4. 管理项目

```typescript
// 获取所有项目
const projects = await this.projectManager.getProjectManager().getAllProjects();

// 获取项目
const project = await this.projectManager.getProjectManager().getProject(projectId);

// 更新项目
await this.projectManager.getProjectManager().updateProject(projectId, {
  name: '新名称',
  priority: 1
});

// 启动项目
await this.projectManager.getProjectManager().startProject(projectId);

// 暂停项目
await this.projectManager.getProjectManager().pauseProject(projectId);

// 完成项目
await this.projectManager.getProjectManager().completeProject(projectId);

// 删除项目
await this.projectManager.getProjectManager().deleteProject(projectId);
```

### 5. 监听项目事件

```typescript
// 获取事件总线
const eventBus = this.projectManager.getEventBus();

// 监听项目创建
eventBus.on('project:created', ({ project }) => {
  console.log('新项目创建:', project.name);
});

// 监听项目更新
eventBus.on('project:updated', ({ project, changes }) => {
  console.log('项目更新:', project.name, changes);
});

// 监听项目删除
eventBus.on('project:deleted', ({ projectId }) => {
  console.log('项目删除:', projectId);
});

// 监听状态变化
eventBus.on('project:status-changed', ({ project, oldStatus, newStatus }) => {
  console.log('项目状态变化:', project.name, oldStatus, '->', newStatus);
});
```

## API 参考

### ProjectManagerIntegration

#### 构造函数
```typescript
constructor(scene: Phaser.Scene, config?: ProjectManagerIntegrationConfig)
```

**参数:**
- `scene`: Phaser 场景实例
- `config`: 配置选项
  - `dataDir`: 数据存储目录（默认: 'stratix-data'）
  - `autoLoad`: 是否自动加载现有项目（默认: true）

#### 方法

| 方法 | 说明 | 返回值 |
|------|------|--------|
| `initialize()` | 初始化存储 | `Promise<void>` |
| `loadExistingProjects()` | 加载现有项目 | `Promise<void>` |
| `startProjectZoneDraw(x, y)` | 开始绘制项目区 | `void` |
| `updateProjectZoneDraw(x, y)` | 更新绘制 | `void` |
| `endProjectZoneDraw()` | 结束绘制并创建项目 | `Promise<{bounds, project} \| null>` |
| `cancelProjectZoneDraw()` | 取消绘制 | `void` |
| `selectProjectZone(projectId)` | 选中项目区 | `void` |
| `clearProjectZoneSelection()` | 清除选中 | `void` |
| `checkProjectZoneOverlap(rect)` | 检查重叠 | `boolean` |
| `getProjectManager()` | 获取项目管理器 | `ProjectManager` |
| `getProjectStore()` | 获取项目存储 | `ProjectStore` |
| `getProjectZone(projectId)` | 获取项目区实例 | `ProjectZone \| undefined` |
| `getAllProjectZones()` | 获取所有项目区 | `Map<string, ProjectZone>` |
| `getEventBus()` | 获取事件总线 | `EventEmitter` |
| `isDrawing()` | 是否正在绘制 | `boolean` |
| `destroy()` | 销毁并清理 | `void` |

## 数据结构

### Project

```typescript
interface Project {
  id: string;                      // 项目ID
  name: string;                    // 项目名称
  description?: string;            // 项目描述
  priority: number;                // 优先级 (1-5)
  status: ProjectStatus;           // 状态
  config: ProjectConfig;           // 配置
  progress: number;                // 进度 (0-100)
  taskCount: number;               // 任务总数
  completedTaskCount: number;      // 已完成任务数
  zoneConfig: ProjectZoneConfig;   // 区域配置
  createdAt: Date;                 // 创建时间
  updatedAt: Date;                 // 更新时间
  startedAt?: Date;                // 启动时间
  completedAt?: Date;              // 完成时间
}
```

### ProjectStatus

```typescript
type ProjectStatus = 
  | 'pending'    // 待启动
  | 'active'     // 执行中
  | 'paused'     // 已暂停
  | 'completed'  // 已完成
  | 'failed';    // 失败
```

### ProjectConfig

```typescript
interface ProjectConfig {
  name: string;
  description?: string;
  priority: number;
  localFolderPath: string;
  agentMode: 'openclaw' | 'llm';
  planningRule: 'sequential' | 'by_type' | 'by_priority';
  executionPermission: 'auto' | 'confirm' | 'mark_only';
  requirement: ProjectRequirement;
  progressRule: 'average' | 'all_complete';
}
```

## 最佳实践

1. **初始化时自动加载**: 设置 `autoLoad: true` 以在场景启动时自动加载现有项目

2. **事件驱动**: 使用事件总线监听项目变化，而不是直接修改数据

3. **错误处理**: 在创建和更新项目时添加错误处理

```typescript
try {
  const project = await projectManager.createProjectWithBounds(bounds);
  if (!project) {
    console.error('创建项目失败');
  }
} catch (error) {
  console.error('创建项目时出错:', error);
}
```

4. **资源清理**: 在场景销毁时调用 `destroy()` 方法

```typescript
shutdown() {
  this.projectManager.destroy();
}
```

## 故障排查

### 问题：项目无法加载

**解决方案:**
- 检查数据目录是否存在
- 检查 projects.json 文件是否有效
- 查看控制台错误日志

### 问题：项目区重叠检测不工作

**解决方案:**
- 确保在绘制前调用了 `setOverlapCheck`
- 检查重叠检测逻辑是否正确

### 问题：事件未触发

**解决方案:**
- 确保事件监听器在操作前已注册
- 检查事件名称拼写是否正确

## 示例项目

查看完整示例：
- 场景集成: `src/stratix-rts/StratixRTSGameScene.ts` (待集成)
- Vue组件: `src/stratix-project/ui/ProjectConfigPanel.vue`
- 测试: `tests/project-management/` (待创建)

---

**更新时间**: 2026-03-02  
**版本**: v1.0
