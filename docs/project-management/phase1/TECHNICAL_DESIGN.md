# 阶段1技术设计文档

## 🏗️ 核心类设计

### 1. BaseZone (新增基础类)

```typescript
// src/stratix-rts/zones/BaseZone.ts

import Phaser from 'phaser';

/**
 * 基础Zone类
 * ProjectZone和TaskZone的共同基类
 */
export abstract class BaseZone extends Phaser.GameObjects.Container {
  protected zoneId: string;
  protected zoneName: string;
  protected zoneStatus: ZoneStatus;
  
  // 视觉元素
  protected borderGraphics: Phaser.GameObjects.Graphics;
  protected nameText: Phaser.GameObjects.Text;
  protected statusText: Phaser.GameObjects.Text;
  
  // 交互状态
  protected isDragging: boolean = false;
  protected isResizing: boolean = false;
  protected isSelected: boolean = false;
  
  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    config: BaseZoneConfig
  ) {
    super(scene, x, y);
    
    this.zoneId = config.id;
    this.zoneName = config.name || '';
    this.zoneStatus = 'idle';
    
    this.createVisuals();
    this.setupInteractions();
  }
  
  // 抽象方法
  protected abstract createVisuals(): void;
  protected abstract updateVisuals(): void;
  
  // 公共方法
  setZoneName(name: string): void {
    this.zoneName = name;
    this.updateVisuals();
  }
  
  getZoneId(): string {
    return this.zoneId;
  }
  
  setZoneStatus(status: ZoneStatus): void {
    this.zoneStatus = status;
    this.updateVisuals();
  }
  
  // 拖拽功能
  enableDrag(): void {
    this.setInteractive({ draggable: true });
    
    this.on('dragstart', () => {
      this.isDragging = true;
      this.scene.input.setDefaultCursor('grabbing');
    });
    
    this.on('drag', (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      this.x = dragX;
      this.y = dragY;
    });
    
    this.on('dragend', () => {
      this.isDragging = false;
      this.scene.input.setDefaultCursor('default');
      this.onDragEnd();
    });
  }
  
  protected onDragEnd(): void {
    // 子类重写
  }
  
  // 选中功能
  setSelected(selected: boolean): void {
    this.isSelected = selected;
    this.updateVisuals();
  }
}

export type ZoneStatus = 'idle' | 'active' | 'busy' | 'error' | 'completed';

export interface BaseZoneConfig {
  id: string;
  name?: string;
  x: number;
  y: number;
  width: number;
  height: number;
}
```

---

### 2. ProjectZone (项目区类)

```typescript
// src/stratix-project/core/ProjectZone.ts

import Phaser from 'phaser';
import { BaseZone, ZoneStatus } from '../../stratix-rts/zones/BaseZone';
import { Project, ProjectStatus, ProjectZoneConfig } from '../types';

/**
 * 项目区类
 * 可视化表示一个项目
 */
export class ProjectZone extends BaseZone {
  private project: Project;
  private config: ProjectZoneConfig;
  
  // 子任务区
  private taskZones: Map<string, Phaser.GameObjects.Container> = new Map();
  
  // 视觉元素
  private progressBar: Phaser.GameObjects.Graphics;
  private priorityIndicator: Phaser.GameObjects.Text;
  
  // 缩放控制点
  private resizeHandle: Phaser.GameObjects.Arc;
  
  constructor(
    scene: Phaser.Scene,
    project: Project,
    config: ProjectZoneConfig
  ) {
    super(scene, config.x, config.y, {
      id: project.id,
      name: project.name,
      x: config.x,
      y: config.y,
      width: config.width,
      height: config.height
    });
    
    this.project = project;
    this.config = config;
    
    this.createResizeHandle();
    this.updateFromProject();
  }
  
  protected createVisuals(): void {
    // 边框
    this.borderGraphics = this.scene.add.graphics();
    this.add(this.borderGraphics);
    
    // 项目名称
    this.nameText = this.scene.add.text(10, 10, this.zoneName, {
      fontSize: '16px',
      fontFamily: 'Arial',
      color: '#ffffff',
      fontStyle: 'bold'
    });
    this.add(this.nameText);
    
    // 状态文字
    this.statusText = this.scene.add.text(10, 30, '', {
      fontSize: '12px',
      fontFamily: 'Arial',
      color: '#888888'
    });
    this.add(this.statusText);
    
    // 进度条
    this.progressBar = this.scene.add.graphics();
    this.add(this.progressBar);
    
    // 优先级指示器
    this.priorityIndicator = this.scene.add.text(10, 50, '', {
      fontSize: '12px',
      fontFamily: 'Arial',
      color: '#ffaa00'
    });
    this.add(this.priorityIndicator);
  }
  
  protected updateVisuals(): void {
    this.borderGraphics.clear();
    
    const colors = this.getColors();
    const width = this.config.width;
    const height = this.config.height;
    
    // 绘制边框
    this.borderGraphics.lineStyle(4, colors.border, 1);
    this.borderGraphics.strokeRect(0, 0, width, height);
    
    // 绘制填充（半透明）
    this.borderGraphics.fillStyle(colors.fill, 0.2);
    this.borderGraphics.fillRect(0, 0, width, height);
    
    // 更新文字
    this.nameText.setText(this.zoneName);
    this.statusText.setText(this.getStatusText());
    this.priorityIndicator.setText(`优先级: ${this.project.priority}`);
    
    // 绘制进度条
    this.drawProgressBar();
  }
  
  private getColors(): { border: number; fill: number } {
    switch (this.project.status) {
      case 'pending':
        return { border: 0x888888, fill: 0x888888 };
      case 'active':
        return { border: 0x00aaff, fill: 0x00aaff };
      case 'completed':
        return { border: 0x00ff00, fill: 0x00ff00 };
      case 'paused':
        return { border: 0xffaa00, fill: 0xffaa00 };
      case 'failed':
        return { border: 0xff0000, fill: 0xff0000 };
      default:
        return { border: 0x888888, fill: 0x888888 };
    }
  }
  
  private getStatusText(): string {
    switch (this.project.status) {
      case 'pending':
        return '未启动';
      case 'active':
        return `执行中 (${this.project.progress}%)`;
      case 'completed':
        return '已完成 ✓';
      case 'paused':
        return '已暂停';
      case 'failed':
        return '失败';
      default:
        return '';
    }
  }
  
  private drawProgressBar(): void {
    this.progressBar.clear();
    
    if (this.project.status !== 'active') return;
    
    const width = this.config.width - 20;
    const height = 6;
    const x = 10;
    const y = this.config.height - 20;
    
    // 背景
    this.progressBar.fillStyle(0x333333, 1);
    this.progressBar.fillRect(x, y, width, height);
    
    // 进度
    const progressWidth = (width * this.project.progress) / 100;
    this.progressBar.fillStyle(0x00ff88, 1);
    this.progressBar.fillRect(x, y, progressWidth, height);
  }
  
  private createResizeHandle(): void {
    this.resizeHandle = this.scene.add.arc(
      this.config.width,
      this.config.height,
      8,
      0,
      360,
      false,
      0xffff00
    );
    this.resizeHandle.setInteractive({ draggable: true });
    this.add(this.resizeHandle);
    
    this.resizeHandle.on('drag', (pointer: Phaser.Input.Pointer, dragX: number, dragY: number) => {
      const newWidth = Math.max(200, dragX);
      const newHeight = Math.max(150, dragY);
      
      this.config.width = newWidth;
      this.config.height = newHeight;
      
      this.updateVisuals();
    });
  }
  
  private updateFromProject(): void {
    this.zoneName = this.project.name;
    this.setZoneStatus(this.mapProjectStatus(this.project.status));
    this.updateVisuals();
  }
  
  private mapProjectStatus(status: ProjectStatus): ZoneStatus {
    const mapping: Record<ProjectStatus, ZoneStatus> = {
      pending: 'idle',
      active: 'active',
      completed: 'completed',
      paused: 'idle',
      failed: 'error'
    };
    return mapping[status];
  }
  
  // 公共方法
  updateProject(project: Project): void {
    this.project = project;
    this.updateFromProject();
  }
  
  getProject(): Project {
    return this.project;
  }
  
  addTaskZone(taskZone: Phaser.GameObjects.Container): void {
    this.taskZones.set(taskZone.name, taskZone);
    this.add(taskZone);
  }
  
  removeTaskZone(taskId: string): void {
    const taskZone = this.taskZones.get(taskId);
    if (taskZone) {
      this.remove(taskZone, true);
      this.taskZones.delete(taskId);
    }
  }
  
  protected onDragEnd(): void {
    // 保存位置到项目数据
    this.project.zoneConfig.x = this.x;
    this.project.zoneConfig.y = this.y;
    
    // 触发事件
    this.scene.events.emit('project:updated', {
      projectId: this.project.id,
      changes: { zoneConfig: this.project.zoneConfig }
    });
  }
  
  // 序列化
  toJSON(): any {
    return {
      ...this.project,
      zoneConfig: this.config
    };
  }
}
```

---

### 3. ProjectManager (项目管理器)

```typescript
// src/stratix-project/core/ProjectManager.ts

import { Project, ProjectConfig } from '../types';
import { ProjectStore } from '../storage/ProjectStore';
import { generateId } from '../utils/helpers';
import EventEmitter from 'mitt';

/**
 * 项目管理器
 * 负责项目的CRUD操作
 */
export class ProjectManager {
  private store: ProjectStore;
  private eventBus: EventEmitter;
  
  constructor(store: ProjectStore, eventBus: EventEmitter) {
    this.store = store;
    this.eventBus = eventBus;
  }
  
  /**
   * 创建项目
   */
  async createProject(config: ProjectConfig): Promise<Project> {
    const project: Project = {
      id: generateId('proj'),
      name: config.name,
      description: config.description,
      priority: config.priority,
      status: 'pending',
      config: config,
      progress: 0,
      taskCount: 0,
      completedTaskCount: 0,
      zoneConfig: {
        x: 100,
        y: 100,
        width: 800,
        height: 600,
        color: 15790320,
        opacity: 0.3,
        visible: true
      },
      createdAt: new Date(),
      updatedAt: new Date()
    };
    
    await this.store.addProject(project);
    
    this.eventBus.emit('project:created', { project });
    
    return project;
  }
  
  /**
   * 获取项目
   */
  async getProject(id: string): Promise<Project | null> {
    return await this.store.getProject(id);
  }
  
  /**
   * 更新项目
   */
  async updateProject(id: string, updates: Partial<Project>): Promise<Project> {
    const project = await this.getProject(id);
    if (!project) {
      throw new Error(`Project not found: ${id}`);
    }
    
    const updatedProject = {
      ...project,
      ...updates,
      updatedAt: new Date()
    };
    
    await this.store.updateProject(updatedProject);
    
    this.eventBus.emit('project:updated', {
      project: updatedProject,
      changes: updates
    });
    
    return updatedProject;
  }
  
  /**
   * 删除项目
   */
  async deleteProject(id: string): Promise<void> {
    await this.store.deleteProject(id);
    
    this.eventBus.emit('project:deleted', { projectId: id });
  }
  
  /**
   * 获取所有项目
   */
  async getAllProjects(): Promise<Project[]> {
    return await this.store.getAllProjects();
  }
  
  /**
   * 按状态筛选项目
   */
  async getProjectsByStatus(status: string): Promise<Project[]> {
    const projects = await this.getAllProjects();
    return projects.filter(p => p.status === status);
  }
  
  /**
   * 按优先级筛选项目
   */
  async getProjectsByPriority(priority: number): Promise<Project[]> {
    const projects = await this.getAllProjects();
    return projects.filter(p => p.priority === priority);
  }
}
```

---

### 4. ProjectStore (项目存储)

```typescript
// src/stratix-project/storage/ProjectStore.ts

import { LowSync } from 'lowdb';
import { JSONSync } from 'lowdb/node';
import { Project } from '../types';
import * as path from 'path';

/**
 * 项目存储
 * 基于lowdb的JSON文件存储
 */
export class ProjectStore {
  private db: LowSync<{ projects: Project[] }>;
  private dbPath: string;
  
  constructor(dataPath: string) {
    this.dbPath = path.join(dataPath, 'projects.json');
    
    this.db = new LowSync<{ projects: Project[] }>(
      new JSONSync(this.dbPath),
      { projects: [] }
    );
    
    this.db.read();
    
    if (!this.db.data) {
      this.db.data = { projects: [] };
      this.db.write();
    }
  }
  
  async addProject(project: Project): Promise<void> {
    this.db.data!.projects.push(project);
    await this.db.write();
  }
  
  async getProject(id: string): Promise<Project | null> {
    const project = this.db.data!.projects.find(p => p.id === id);
    return project || null;
  }
  
  async updateProject(project: Project): Promise<void> {
    const index = this.db.data!.projects.findIndex(p => p.id === project.id);
    if (index !== -1) {
      this.db.data!.projects[index] = project;
      await this.db.write();
    }
  }
  
  async deleteProject(id: string): Promise<void> {
    this.db.data!.projects = this.db.data!.projects.filter(p => p.id !== id);
    await this.db.write();
  }
  
  async getAllProjects(): Promise<Project[]> {
    return this.db.data!.projects;
  }
}
```

---

### 5. ProjectConfigPanel (Vue组件)

```vue
<!-- src/stratix-project/ui/ProjectConfigPanel.vue -->

<template>
  <div class="project-config-panel" v-if="visible">
    <div class="panel-header">
      <h3>项目配置</h3>
      <button class="close-btn" @click="close">×</button>
    </div>
    
    <div class="panel-body">
      <!-- 基础信息 -->
      <div class="form-group">
        <label>项目名称</label>
        <input 
          v-model="config.name" 
          type="text" 
          placeholder="请输入项目名称"
        />
      </div>
      
      <div class="form-group">
        <label>项目描述</label>
        <textarea 
          v-model="config.description" 
          placeholder="请输入项目描述（可选）"
          rows="3"
        ></textarea>
      </div>
      
      <div class="form-group">
        <label>优先级</label>
        <select v-model="config.priority">
          <option :value="1">1级（最高）</option>
          <option :value="2">2级（高）</option>
          <option :value="3">3级（中）</option>
          <option :value="4">4级（低）</option>
          <option :value="5">5级（最低）</option>
        </select>
      </div>
      
      <!-- 存储配置 -->
      <div class="form-group">
        <label>本地文件夹路径 *</label>
        <div class="input-group">
          <input 
            v-model="config.localFolderPath" 
            type="text" 
            placeholder="例如: /Users/yourname/projects/my-project"
          />
          <button @click="browseFolder" class="btn-browse">浏览</button>
        </div>
      </div>
      
      <!-- Agent模式 -->
      <div class="form-group">
        <label>Agent模式</label>
        <select v-model="config.agentMode">
          <option value="openclaw">OpenClaw外部Agent</option>
          <option value="llm">LLM模式Agent</option>
        </select>
      </div>
      
      <!-- 执行权限 -->
      <div class="form-group">
        <label>执行权限</label>
        <select v-model="config.executionPermission">
          <option value="auto">AI自主执行</option>
          <option value="confirm">用户确认后执行</option>
          <option value="mark_only">仅标记不执行</option>
        </select>
      </div>
    </div>
    
    <div class="panel-footer">
      <button @click="close" class="btn-cancel">取消</button>
      <button @click="save" class="btn-save">保存</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue';
import { ProjectConfig } from '../types';

const props = defineProps<{
  visible: boolean;
  projectId?: string;
  initialConfig?: Partial<ProjectConfig>;
}>();

const emit = defineEmits<{
  close: [];
  save: [config: ProjectConfig];
}>();

const config = reactive<ProjectConfig>({
  name: '',
  description: '',
  priority: 3,
  localFolderPath: '',
  agentMode: 'openclaw',
  executionPermission: 'auto',
  planningRule: 'sequential',
  requirement: {
    type: 'text',
    content: ''
  },
  progressRule: 'average',
  ...props.initialConfig
});

const browseFolder = async () => {
  // TODO: 调用 Electron API 选择文件夹
  console.log('Browse folder');
};

const save = () => {
  emit('save', { ...config });
  close();
};

const close = () => {
  emit('close');
};
</script>

<style scoped>
.project-config-panel {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 500px;
  background: #1a1a1a;
  border: 1px solid #333;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  z-index: 1000;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #333;
}

.panel-header h3 {
  margin: 0;
  color: #fff;
  font-size: 18px;
}

.close-btn {
  background: none;
  border: none;
  color: #888;
  font-size: 24px;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.close-btn:hover {
  color: #fff;
}

.panel-body {
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
}

.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  color: #aaa;
  font-size: 14px;
  margin-bottom: 8px;
}

.form-group input,
.form-group textarea,
.form-group select {
  width: 100%;
  background: #0a0a0a;
  border: 1px solid #333;
  border-radius: 4px;
  color: #fff;
  padding: 10px 12px;
  font-size: 14px;
}

.form-group input:focus,
.form-group textarea:focus,
.form-group select:focus {
  outline: none;
  border-color: #00aaff;
}

.input-group {
  display: flex;
  gap: 8px;
}

.input-group input {
  flex: 1;
}

.btn-browse {
  padding: 10px 16px;
  background: #333;
  border: 1px solid #444;
  border-radius: 4px;
  color: #fff;
  cursor: pointer;
}

.btn-browse:hover {
  background: #444;
}

.panel-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 20px;
  border-top: 1px solid #333;
}

.btn-cancel,
.btn-save {
  padding: 10px 24px;
  border-radius: 4px;
  font-size: 14px;
  cursor: pointer;
  border: none;
}

.btn-cancel {
  background: #333;
  color: #fff;
}

.btn-cancel:hover {
  background: #444;
}

.btn-save {
  background: #00aaff;
  color: #fff;
}

.btn-save:hover {
  background: #0088cc;
}
</style>
```

---

## 🔄 集成到现有系统

### 修改 StratixRTSGameScene

```typescript
// src/stratix-rts/StratixRTSGameScene.ts

import { ProjectZone } from '../stratix-project/core/ProjectZone';
import { ProjectManager } from '../stratix-project/core/ProjectManager';
import { ProjectStore } from '../stratix-project/storage/ProjectStore';

export class StratixRTSGameScene extends Phaser.Scene {
  private projectZones: Map<string, ProjectZone> = new Map();
  private projectManager: ProjectManager;
  private isProjectMode: boolean = false;
  
  constructor() {
    super({ key: 'StratixRTSGameScene' });
  }
  
  create() {
    // 初始化项目管理器
    const projectStore = new ProjectStore('./stratix-data');
    this.projectManager = new ProjectManager(projectStore, this.events);
    
    // 设置绘制模式
    this.setupDrawingMode();
    
    // 加载现有项目
    this.loadExistingProjects();
  }
  
  private setupDrawingMode() {
    // 绘制项目区
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isProjectMode && pointer.rightButtonDown()) {
        this.startDrawingProjectZone(pointer.x, pointer.y);
      }
    });
  }
  
  private startDrawingProjectZone(startX: number, startY: number) {
    // 创建临时项目区
    // TODO: 实现绘制逻辑
  }
  
  private async loadExistingProjects() {
    const projects = await this.projectManager.getAllProjects();
    
    projects.forEach(project => {
      const projectZone = new ProjectZone(
        this,
        project,
        project.zoneConfig
      );
      
      this.projectZones.set(project.id, projectZone);
      this.add.existing(projectZone);
    });
  }
}
```

---

## 📊 数据流程

```
用户画框
   ↓
创建临时ProjectZone
   ↓
弹出配置面板
   ↓
用户配置
   ↓
ProjectManager.createProject()
   ↓
ProjectStore.addProject()
   ↓
保存到 projects.json
   ↓
触发 'project:created' 事件
   ↓
ProjectZone 更新显示
```

---

**文档版本**: v1.0  
**更新日期**: 2026-03-02
