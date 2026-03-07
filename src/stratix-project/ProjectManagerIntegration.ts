import Phaser from 'phaser';
import { ProjectManager } from './core/ProjectManager';
import { ProjectStore } from './storage/ProjectStore';
import { ProjectZone } from './core/ProjectZone';
import { ProjectZonePreview } from './core/ProjectZonePreview';
import { Project, ProjectConfig } from './types';
import { throttle } from './utils/helpers';
import mitt from 'mitt';

export interface ProjectManagerIntegrationConfig {
  dataDir?: string;
  autoLoad?: boolean;
}

export class ProjectManagerIntegration {
  private scene: Phaser.Scene;
  private projectManager: ProjectManager;
  private projectStore: ProjectStore;
  private projectZones: Map<string, ProjectZone> = new Map();
  private projectZonePreview: ProjectZonePreview;
  private eventBus: ReturnType<typeof mitt>;
  private isDrawingProjectZone: boolean = false;
  private visibleZones: Set<string> = new Set();
  private viewportUpdateThrottled: (camera: Phaser.Cameras.Scene2D.Camera) => void;

  constructor(scene: Phaser.Scene, config?: ProjectManagerIntegrationConfig) {
    this.scene = scene;
    
    this.eventBus = mitt();
    this.projectStore = new ProjectStore(config?.dataDir || 'stratix-data');
    this.projectManager = new ProjectManager(this.projectStore, this.eventBus);
    
    this.projectZonePreview = new ProjectZonePreview(scene, {
      lineColor: 0x00aaff,
      fillColor: 0x00aaff,
      lineWidth: 4
    });

    this.projectZonePreview.setOverlapCheck((rect) => this.checkProjectZoneOverlap(rect));

    if (config?.autoLoad !== false) {
      this.loadExistingProjects();
    }

    this.setupEventListeners();
    
    this.viewportUpdateThrottled = throttle((camera: Phaser.Cameras.Scene2D.Camera) => {
      this.updateVisibleZones(camera);
    }, 100);
  }

  private setupEventListeners(): void {
    (this.eventBus as any).on('project:created', ({ project }: any) => {
      console.log('[ProjectManager] Project created:', project.id);
      this.createProjectZone(project);
    });

    (this.eventBus as any).on('project:updated', ({ project }: any) => {
      console.log('[ProjectManager] Project updated:', project.id);
      this.updateProjectZone(project);
    });

    (this.eventBus as any).on('project:deleted', ({ projectId }: any) => {
      console.log('[ProjectManager] Project deleted:', projectId);
      this.removeProjectZone(projectId);
    });

    (this.eventBus as any).on('project:task-started', ({ projectId, taskId, task }: any) => {
      console.log(`[ProjectManager] Task started: ${taskId} in project ${projectId}`);
    });

    (this.eventBus as any).on('project:task-progress', ({ projectId, taskId, progress }: any) => {
      console.log(`[ProjectManager] Task progress: ${taskId} - ${progress}%`);
    });

    (this.eventBus as any).on('project:task-completed', ({ projectId, taskId, success }: any) => {
      console.log(`[ProjectManager] Task completed: ${taskId} - ${success ? 'success' : 'failed'}`);
    });

    (this.eventBus as any).on('project:execution-completed', ({ projectId }: any) => {
      console.log(`[ProjectManager] Project execution completed: ${projectId}`);
    });

    (this.eventBus as any).on('project:execution-failed', ({ projectId, error }: any) => {
      console.error(`[ProjectManager] Project execution failed: ${projectId} - ${error}`);
    });
  }

  public async initialize(): Promise<void> {
    await this.projectStore.initialize();
  }

  public async loadExistingProjects(): Promise<void> {
    await this.initialize();
    
    const projects = await this.projectManager.getAllProjects();
    console.log(`[ProjectManager] Loading ${projects.length} existing projects`);

    projects.forEach(project => {
      this.createProjectZone(project);
    });
  }

  private createProjectZone(project: Project): ProjectZone | null {
    if (this.projectZones.has(project.id)) {
      console.warn(`[ProjectManager] Project zone already exists: ${project.id}`);
      return null;
    }

    const projectZone = new ProjectZone(this.scene, project, project.zoneConfig);
    this.scene.add.existing(projectZone);
    this.projectZones.set(project.id, projectZone);

    projectZone.setInteractive();
    projectZone.on('pointerdown', () => {
      if (!this.isDrawingProjectZone) {
        this.selectProjectZone(project.id);
      }
    });

    return projectZone;
  }

  private updateProjectZone(project: Project): void {
    const projectZone = this.projectZones.get(project.id);
    if (projectZone) {
      projectZone.updateProject(project);
    }
  }

  private removeProjectZone(projectId: string): void {
    const projectZone = this.projectZones.get(projectId);
    if (projectZone) {
      projectZone.destroy();
      this.projectZones.delete(projectId);
    }
  }

  public selectProjectZone(projectId: string): void {
    this.clearProjectZoneSelection();
    const projectZone = this.projectZones.get(projectId);
    if (projectZone) {
      projectZone.setHighlight(true);
    }
  }

  public clearProjectZoneSelection(): void {
    this.projectZones.forEach(zone => {
      zone.setHighlight(false);
    });
  }

  public checkProjectZoneOverlap(rect: Phaser.Geom.Rectangle, excludeProjectId?: string): boolean {
    for (const [projectId, projectZone] of this.projectZones) {
      if (excludeProjectId && projectId === excludeProjectId) continue;
      if (projectZone.containsPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)) {
        return true;
      }
    }
    return false;
  }

  public startProjectZoneDraw(x: number, y: number): void {
    this.isDrawingProjectZone = true;
    this.projectZonePreview.start(x, y);
  }

  public updateProjectZoneDraw(x: number, y: number): void {
    this.projectZonePreview.update(x, y);
  }

  public async endProjectZoneDraw(): Promise<{ bounds: Phaser.Geom.Rectangle; project: Project } | null> {
    this.isDrawingProjectZone = false;

    if (this.projectZonePreview.isOverlapping()) {
      this.projectZonePreview.cancel();
      console.log('[ProjectManager] Cannot create project zone: overlaps existing zone');
      return null;
    }

    const bounds = this.projectZonePreview.end();
    if (!bounds || bounds.width < 100 || bounds.height < 100) {
      console.log('[ProjectManager] Project zone too small');
      return null;
    }

    const project = await this.createProjectWithBounds(bounds);
    return project ? { bounds, project } : null;
  }

  public cancelProjectZoneDraw(): void {
    this.isDrawingProjectZone = false;
    this.projectZonePreview.cancel();
  }

  public async createProjectWithBounds(bounds: Phaser.Geom.Rectangle, config?: Partial<ProjectConfig>): Promise<Project | null> {
    try {
      const defaultConfig: ProjectConfig = {
        name: `项目 ${this.projectZones.size + 1}`,
        description: '',
        priority: 3,
        localFolderPath: '',
        agentMode: 'openclaw',
        planningRule: 'sequential',
        executionPermission: 'auto',
        requirement: {
          type: 'text',
          content: ''
        },
        progressRule: 'average',
        ...config
      };

      const project = await this.projectManager.createProject(defaultConfig, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
        width: bounds.width,
        height: bounds.height,
        color: 15790320,
        opacity: 0.3,
        visible: true
      });

      return project;
    } catch (error) {
      console.error('[ProjectManager] Failed to create project:', error);
      return null;
    }
  }

  public getProjectManager(): ProjectManager {
    return this.projectManager;
  }

  public getProjectStore(): ProjectStore {
    return this.projectStore;
  }

  public getProjectZone(projectId: string): ProjectZone | undefined {
    return this.projectZones.get(projectId);
  }

  public getAllProjectZones(): Map<string, ProjectZone> {
    return this.projectZones;
  }

  public getEventBus(): ReturnType<typeof mitt> {
    return this.eventBus;
  }

  public isDrawing(): boolean {
    return this.isDrawingProjectZone;
  }

  public destroy(): void {
    this.projectZones.forEach(zone => zone.destroy());
    this.projectZones.clear();
    this.projectZonePreview.destroy();
  }

  public updateViewport(camera: Phaser.Cameras.Scene2D.Camera): void {
    this.viewportUpdateThrottled(camera);
  }

  private updateVisibleZones(camera: Phaser.Cameras.Scene2D.Camera): void {
    const viewport = new Phaser.Geom.Rectangle(
      camera.scrollX,
      camera.scrollY,
      camera.width,
      camera.height
    );

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

  public getVisibleZoneCount(): number {
    return this.visibleZones.size;
  }
}
