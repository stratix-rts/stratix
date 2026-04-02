/**
 * 项目管理场景示例
 * 
 * 这个示例展示了如何在 Phaser 场景中集成和使用项目管理功能
 */

import Phaser from 'phaser';

import { 
  ProjectManagerIntegration, 
  Project, 
  ProjectConfig 
} from '..';
import { MAP_WIDTH, MAP_HEIGHT, DEFAULT_ZOOM } from '../../stratix-rts/constants';

export class ProjectManagementExampleScene extends Phaser.Scene {
  private projectManager: ProjectManagerIntegration;
  private isProjectDrawMode: boolean = false;
  private projectConfigCallback: ((project: Project) => void) | null = null;

  constructor() {
    super({ key: 'ProjectManagementExampleScene' });
  }

  async create(): Promise<void> {
    // 初始化地图
    this.add.tileSprite(
      MAP_WIDTH / 2,
      MAP_HEIGHT / 2,
      MAP_WIDTH,
      MAP_HEIGHT,
      'stratix-tile'
    );

    // 初始化相机
    this.cameras.main.setBounds(0, 0, MAP_WIDTH, MAP_HEIGHT);
    this.cameras.main.setZoom(DEFAULT_ZOOM);

    // 初始化项目管理器
    this.projectManager = new ProjectManagerIntegration(this, {
      dataDir: 'stratix-data',
      autoLoad: true
    });

    await this.projectManager.initialize();

    // 设置输入处理
    this.setupInputHandlers();

    // 设置项目创建回调
    this.setupProjectCallbacks();

    console.log('[ProjectManagement] Scene initialized');
  }

  private setupInputHandlers(): void {
    // 鼠标按下
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isProjectDrawMode && pointer.rightButtonDown()) {
        this.projectManager.startProjectZoneDraw(pointer.worldX, pointer.worldY);
      }
    });

    // 鼠标移动
    this.input.on('pointermove', (pointer: Phaser.Input.Pointer) => {
      if (this.projectManager.isDrawing()) {
        this.projectManager.updateProjectZoneDraw(pointer.worldX, pointer.worldY);
      }
    });

    // 鼠标释放
    this.input.on('pointerup', async (pointer: Phaser.Input.Pointer) => {
      if (this.projectManager.isDrawing()) {
        const result = await this.projectManager.endProjectZoneDraw();
        if (result) {
          this.handleProjectCreated(result.project);
        }
      }
    });

    // 键盘事件
    if (this.input && this.input.keyboard) {
      this.input.keyboard.on('keydown-ESC', () => {
        if (this.projectManager && this.projectManager.isDrawing()) {
          this.projectManager.cancelProjectZoneDraw();
        }
        if (this.isProjectDrawMode) {
          this.toggleProjectDrawMode();
        }
      });

      // P 键切换项目绘制模式
      this.input.keyboard.on('keydown-P', () => {
        this.toggleProjectDrawMode();
      });
    }
  }

  private setupProjectCallbacks(): void {
    const eventBus = this.projectManager.getEventBus();

    // 监听项目创建事件
    (eventBus as any).on('project:created', ({ project }: { project: Project }) => {
      console.log('[ProjectManagement] Project created:', project.name);
    });

    // 监听项目更新事件
    (eventBus as any).on('project:updated', ({ project }: { project: Project }) => {
      console.log('[ProjectManagement] Project updated:', project.name);
    });

    // 监听项目删除事件
    (eventBus as any).on('project:deleted', ({ projectId }: { projectId: string }) => {
      console.log('[ProjectManagement] Project deleted:', projectId);
    });

    // 监听状态变化
    (eventBus as any).on('project:status-changed', ({ 
      project, 
      oldStatus, 
      newStatus 
    }: { 
      project: Project; 
      oldStatus: string; 
      newStatus: string 
    }) => {
      console.log(`[ProjectManagement] ${project.name}: ${oldStatus} -> ${newStatus}`);
    });
  }

  private handleProjectCreated(project: Project): void {
    console.log('[ProjectManagement] New project created:', project.id);
    
    // 触发配置面板回调（由外部 Vue 组件处理）
    if (this.projectConfigCallback) {
      this.projectConfigCallback(project);
    }
  }

  /**
   * 切换项目绘制模式
   */
  public toggleProjectDrawMode(): void {
    this.isProjectDrawMode = !this.isProjectDrawMode;
    console.log('[ProjectManagement] Draw mode:', this.isProjectDrawMode ? 'ON' : 'OFF');
    
    if (this.isProjectDrawMode) {
      this.input.setDefaultCursor('crosshair');
    } else if (this.input) {
      this.input.setDefaultCursor('default');
    }
  }

  /**
   * 设置配置面板回调
   */
  public setProjectConfigCallback(callback: (project: Project) => void): void {
    this.projectConfigCallback = callback;
  }

  /**
   * 保存项目配置
   */
  public async saveProjectConfig(projectId: string, config: ProjectConfig): Promise<void> {
    await this.projectManager.getProjectManager().updateProject(projectId, { config });
  }

  /**
   * 启动项目
   */
  public async startProject(projectId: string): Promise<void> {
    await this.projectManager.getProjectManager().startProject(projectId);
  }

  /**
   * 暂停项目
   */
  public async pauseProject(projectId: string): Promise<void> {
    await this.projectManager.getProjectManager().pauseProject(projectId);
  }

  /**
   * 完成项目
   */
  public async completeProject(projectId: string): Promise<void> {
    await this.projectManager.getProjectManager().completeProject(projectId);
  }

  /**
   * 删除项目
   */
  public async deleteProject(projectId: string): Promise<void> {
    await this.projectManager.getProjectManager().deleteProject(projectId);
  }

  /**
   * 获取所有项目
   */
  public async getAllProjects(): Promise<Project[]> {
    return await this.projectManager.getProjectManager().getAllProjects();
  }

  /**
   * 获取项目
   */
  public async getProject(projectId: string): Promise<Project | null> {
    return await this.projectManager.getProjectManager().getProject(projectId);
  }

  /**
   * 选中项目区
   */
  public selectProject(projectId: string): void {
    this.projectManager.selectProjectZone(projectId);
  }

  /**
   * 取消选中
   */
  public deselectAll(): void {
    this.projectManager.clearProjectZoneSelection();
  }

  /**
   * 获取项目管理器实例
   */
  public getProjectManager(): ProjectManagerIntegration {
    return this.projectManager;
  }

  /**
   * 是否处于绘制模式
   */
  public isInDrawMode(): boolean {
    return this.isProjectDrawMode;
  }

  shutdown(): void {
    if (this.projectManager) {
      this.projectManager.destroy();
    }
  }
}
