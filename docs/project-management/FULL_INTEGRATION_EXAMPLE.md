# 项目管理完整集成示例

本文档展示如何在 Stratix 应用中完整集成项目管理功能。

## 场景集成示例

### 1. 在主场景中集成

```typescript
// src/App.vue 或主场景组件
<template>
  <div class="stratix-app">
    <div ref="gameContainer" class="game-container"></div>
    
    <!-- 项目配置面板 -->
    <ProjectConfigPanel
      :visible="showConfigPanel"
      :initial-config="selectedProject?.config"
      @save="handleSaveConfig"
      @close="showConfigPanel = false"
    />
    
    <!-- 项目列表面板 -->
    <ProjectListPanel
      :visible="showProjectList"
      @select="handleProjectSelect"
      @edit="handleProjectEdit"
      @create="handleProjectCreate"
      @start="handleProjectStart"
      @pause="handleProjectPause"
      @delete="handleProjectDelete"
      @refresh="handleRefreshProjects"
      @locate-project="handleLocateProject"
      ref="projectListRef"
    />
    
    <!-- 工具栏 -->
    <div class="toolbar">
      <button @click="toggleProjectList">项目列表</button>
      <button @click="toggleDrawMode">
        {{ isDrawMode ? '取消绘制' : '绘制项目区' }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import Phaser from 'phaser';
import { ProjectConfigPanel, ProjectListPanel, Project, ProjectConfig } from '@/stratix-project';
import { ProjectManagementExampleScene } from '@/stratix-project/examples/ProjectManagementExampleScene';

const gameContainer = ref<HTMLElement>();
const projectListRef = ref();
const showConfigPanel = ref(false);
const showProjectList = ref(false);
const selectedProject = ref<Project | null>(null);
const isDrawMode = ref(false);

let game: Phaser.Game;
let scene: ProjectManagementExampleScene;

onMounted(() => {
  // 创建 Phaser 游戏实例
  game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameContainer.value,
    width: window.innerWidth,
    height: window.innerHeight,
    scene: ProjectManagementExampleScene
  });

  // 获取场景实例
  scene = game.scene.getScene('ProjectManagementExampleScene') as ProjectManagementExampleScene;
  
  // 设置项目创建回调
  scene.setProjectConfigCallback((project) => {
    selectedProject.value = project;
    showConfigPanel.value = true;
  });

  // 定期更新项目列表
  setInterval(updateProjectList, 2000);
});

onUnmounted(() => {
  if (game) {
    game.destroy(true);
  }
});

// 更新项目列表
async function updateProjectList() {
  if (scene && showProjectList.value) {
    const projects = await scene.getAllProjects();
    projectListRef.value?.updateProjects(projects);
  }
}

// 切换项目列表显示
function toggleProjectList() {
  showProjectList.value = !showProjectList.value;
  if (showProjectList.value) {
    updateProjectList();
  }
}

// 切换绘制模式
function toggleDrawMode() {
  if (scene) {
    scene.toggleProjectDrawMode();
    isDrawMode.value = scene.isInDrawMode();
  }
}

// 保存项目配置
async function handleSaveConfig(config: ProjectConfig) {
  if (selectedProject.value && scene) {
    await scene.saveProjectConfig(selectedProject.value.id, config);
    showConfigPanel.value = false;
    updateProjectList();
  }
}

// 选择项目
function handleProjectSelect(project: Project) {
  if (scene) {
    scene.selectProject(project.id);
  }
}

// 编辑项目
function handleProjectEdit(project: Project) {
  selectedProject.value = project;
  showConfigPanel.value = true;
}

// 创建新项目
function handleProjectCreate() {
  if (scene) {
    // 进入绘制模式
    if (!scene.isInDrawMode()) {
      scene.toggleProjectDrawMode();
      isDrawMode.value = true;
    }
  }
}

// 启动项目
async function handleProjectStart(projectId: string) {
  if (scene) {
    await scene.startProject(projectId);
    updateProjectList();
  }
}

// 暂停项目
async function handleProjectPause(projectId: string) {
  if (scene) {
    await scene.pauseProject(projectId);
    updateProjectList();
  }
}

// 删除项目
async function handleProjectDelete(projectId: string) {
  if (scene) {
    await scene.deleteProject(projectId);
    updateProjectList();
  }
}

// 刷新项目列表
function handleRefreshProjects() {
  updateProjectList();
}

// 定位到项目
function handleLocateProject(projectId: string) {
  if (scene) {
    const project = scene.getProjectManager().getProjectZone(projectId);
    if (project) {
      const bounds = project.getBounds();
      scene.cameras.main.pan(bounds.x, bounds.y, 500);
    }
  }
}
</script>

<style scoped>
.stratix-app {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.game-container {
  width: 100%;
  height: 100%;
}

.toolbar {
  position: fixed;
  top: 20px;
  left: 20px;
  display: flex;
  gap: 12px;
  z-index: 100;
}

.toolbar button {
  padding: 10px 20px;
  background: rgba(0, 170, 255, 0.9);
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  transition: all 0.2s;
}

.toolbar button:hover {
  background: rgba(0, 170, 255, 1);
  transform: translateY(-1px);
}
</style>
```

## 快捷键说明

- **P**: 切换项目绘制模式
- **ESC**: 取消当前操作/退出绘制模式
- **右键拖动**: 绘制项目区（需在绘制模式下）

## 完整工作流程

### 1. 创建项目

```
1. 点击"绘制项目区"按钮或按 P 键
2. 右键拖动绘制项目区
3. 释放鼠标后自动弹出配置面板
4. 填写项目信息并保存
```

### 2. 管理项目

```
1. 点击"项目列表"按钮打开列表
2. 查看所有项目状态
3. 点击项目定位到地图位置
4. 使用操作按钮启动/暂停/编辑/删除项目
```

### 3. 查看进度

```
1. 项目列表显示实时进度
2. 项目区显示进度条
3. 状态指示器显示当前状态
```

## 事件流

```
用户绘制项目区
    ↓
ProjectManagerIntegration.endProjectZoneDraw()
    ↓
创建 Project (pending 状态)
    ↓
触发 'project:created' 事件
    ↓
创建 ProjectZone 实例
    ↓
弹出 ProjectConfigPanel
    ↓
用户填写配置
    ↓
ProjectManager.updateProject()
    ↓
触发 'project:updated' 事件
    ↓
更新 ProjectZone 显示
```

## 数据流

```
Vue 组件 (UI)
    ↓
ProjectManagementExampleScene (场景)
    ↓
ProjectManagerIntegration (集成层)
    ↓
ProjectManager (业务逻辑)
    ↓
ProjectStore (数据持久化)
    ↓
projects.json (JSON 文件)
```

## 性能优化建议

1. **虚拟滚动**: 项目列表超过 50 个时使用虚拟滚动
2. **懒加载**: 地图区域较大时按需加载项目
3. **防抖**: 频繁更新时使用防抖优化
4. **缓存**: 项目列表缓存避免频繁查询

```typescript
// 示例：使用防抖优化项目列表更新
import { debounce } from 'lodash';

const debouncedUpdate = debounce(updateProjectList, 500);

// 在需要更新时调用
debouncedUpdate();
```

## 故障排查

### 问题 1: 项目区无法创建

**检查项:**
- 是否在绘制模式下（右下角应显示十字准星）
- 是否使用右键拖动
- 项目区是否足够大（最小 100x100 像素）
- 是否与现有项目区重叠

### 问题 2: 配置面板未弹出

**检查项:**
- projectConfigCallback 是否正确设置
- Vue 组件是否正确挂载
- 控制台是否有错误

### 问题 3: 项目列表不更新

**检查项:**
- 定时器是否正常运行
- ProjectManager 是否正确初始化
- 数据文件是否可读写

## 测试用例

```typescript
describe('Project Management Integration', () => {
  test('创建项目流程', async () => {
    // 1. 进入绘制模式
    scene.toggleProjectDrawMode();
    expect(scene.isInDrawMode()).toBe(true);
    
    // 2. 模拟绘制
    scene.getProjectManager().startProjectZoneDraw(100, 100);
    scene.getProjectManager().updateProjectZoneDraw(200, 200);
    const result = await scene.getProjectManager().endProjectZoneDraw();
    
    // 3. 验证项目创建
    expect(result).not.toBeNull();
    expect(result.project.name).toBeDefined();
    
    // 4. 保存配置
    await scene.saveProjectConfig(result.project.id, {
      name: '测试项目',
      priority: 3,
      localFolderPath: '/tmp/test',
      // ... 其他配置
    });
    
    // 5. 验证项目已保存
    const saved = await scene.getProject(result.project.id);
    expect(saved).not.toBeNull();
    expect(saved?.name).toBe('测试项目');
  });
  
  test('项目状态管理', async () => {
    // 创建测试项目
    const project = await scene.getProjectManager()
      .createProjectWithBounds(new Phaser.Geom.Rectangle(100, 100, 200, 200));
    
    // 启动项目
    await scene.startProject(project.id);
    const started = await scene.getProject(project.id);
    expect(started?.status).toBe('active');
    
    // 暂停项目
    await scene.pauseProject(project.id);
    const paused = await scene.getProject(project.id);
    expect(paused?.status).toBe('paused');
    
    // 完成项目
    await scene.completeProject(project.id);
    const completed = await scene.getProject(project.id);
    expect(completed?.status).toBe('completed');
  });
});
```

## 下一步

- [ ] 集成 AI 任务拆分功能（阶段2）
- [ ] 实现任务执行引擎（阶段3）
- [ ] 添加 Git 集成（阶段4）
- [ ] 性能优化和测试（阶段5）

---

**更新时间**: 2026-03-02  
**版本**: v1.0  
**示例代码**: 可直接复制使用
