import axios from 'axios';
import mitt from 'mitt';
import type { Emitter } from 'mitt';
import Phaser from 'phaser';

import { rtsEventBus } from '../stratix-rts/events/core/RTSEventBus';
import { UnifiedZoneManager } from '../stratix-rts/zones/UnifiedZoneManager';

import { ZoneClient } from './ZoneClient';
import { GameZone } from './core/GameZone';
import { GameZonePreview } from './core/GameZonePreview';
import { Project, ProjectConfig, ProjectZoneConfig, Zone } from './types';
import { throttle } from './utils/helpers';



export interface ZoneManagerIntegrationConfig {
  autoLoad?: boolean;
}

type ProjectManagerEvents = {
  'project:created': { project: Project };
  'project:updated': { project: Project };
  'zone:deleted': { zoneId: string };
  'project:status-changed': { project: Project; oldStatus: string; newStatus: string };
  'projects:loaded': void;
  'project:zone-moved': { project: Project } & Record<string, unknown>;
};

export class ZoneManagerIntegration {
  private scene: Phaser.Scene;
  private projectClient: ZoneClient;
  private unifiedZoneManager: UnifiedZoneManager;
  private projectZonePreview: GameZonePreview;
  private eventBus: Emitter<ProjectManagerEvents>;
  private isDrawingProjectZone: boolean = false;
  private visibleZones: Set<string> = new Set();
  private viewportUpdateThrottled: (camera: Phaser.Cameras.Scene2D.Camera) => void;

  constructor(scene: Phaser.Scene, unifiedZoneManager: UnifiedZoneManager, config?: ZoneManagerIntegrationConfig) {
    this.scene = scene;
    this.unifiedZoneManager = unifiedZoneManager;
    
    this.eventBus = mitt<ProjectManagerEvents>();
    this.projectClient = new ZoneClient();
    
    this.projectZonePreview = new GameZonePreview(scene, {
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

  public onLoaded(callback: () => void): void {
    this.eventBus.on('projects:loaded', callback);
  }

  private setupEventListeners(): void {
    this.eventBus.on('project:created', ({ project }) => {
      console.log('[ZoneManager] Project created:', project.id);
      this.createProjectZone(project);
    });

    this.eventBus.on('project:updated', ({ project }) => {
      console.log('[ZoneManager] Project updated:', project.id);
      this.updateProjectZone(project);
    });

    this.eventBus.on('zone:deleted', ({ zoneId }) => {
      console.log('[ZoneManager] Project deleted:', zoneId);
      this.removeProjectZone(zoneId);
    });

    rtsEventBus.on('zone:moved' as any, async (event: any) => {
      const zoneId = event.zoneId;
      const zone = this.unifiedZoneManager.getZone(zoneId);
      if (zone instanceof GameZone) {
        const bounds = event.bounds;
        try {
          await this.projectClient.updateZoneConfig(zoneId, {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
            width: bounds.width,
            height: bounds.height,
          });
          console.log(`[ZoneManager] Zone position saved: ${zoneId}`);
        } catch (error) {
          console.error(`[ZoneManager] Failed to save zone position: ${zoneId}`, error);
        }
      }
    });

    rtsEventBus.on('zone:resized' as any, async (event: any) => {
      const zoneId = event.zoneId;
      const zone = this.unifiedZoneManager.getZone(zoneId);
      if (zone instanceof GameZone) {
        const bounds = event.bounds;
        try {
          await this.projectClient.updateZoneConfig(zoneId, {
            x: bounds.x + bounds.width / 2,
            y: bounds.y + bounds.height / 2,
            width: bounds.width,
            height: bounds.height,
          });
          console.log(`[ZoneManager] Zone size saved: ${zoneId}`);
        } catch (error) {
          console.error(`[ZoneManager] Failed to save zone size: ${zoneId}`, error);
        }
      }
    });

    rtsEventBus.on('zone:deleted' as any, async (event: any) => {
      const zoneId = event.zoneId;
      const zone = this.unifiedZoneManager.getZone(zoneId);
      if (zone instanceof GameZone) {
        try {
          await this.projectClient.deleteZone(zoneId);
          console.log(`[ZoneManager] Zone deleted: ${zoneId}`);
        } catch (error) {
          console.error(`[ZoneManager] Failed to delete zone: ${zoneId}`, error);
        }
      }
    });
  }

  public async initialize(): Promise<void> {
    await this.projectClient.initialize();
  }

  public async loadExistingProjects(): Promise<void> {
    await this.initialize();

    const projects = await this.projectClient.getAllZones();
    console.log(`[ZoneManager] Loading ${projects.length} existing projects`);

    // Parallelize project zone creation for better performance
    await Promise.all(projects.map(project => this.createProjectZone(project)));

    (this.eventBus as any).emit('projects:loaded');
  }

  private updateProjectZone(project: Project): void {
    const projectZone = this.unifiedZoneManager.getZone(project.id) as GameZone | undefined;
    if (projectZone) {
      projectZone.updateZone(project);
    }
  }

  public removeProjectZone(zoneId: string): void {
    const projectZone = this.unifiedZoneManager.getZone(zoneId) as GameZone | undefined;
    if (projectZone) {
      projectZone.destroy();
      this.unifiedZoneManager.unregister(zoneId);
    }
    this.visibleZones.delete(zoneId);
  }

  public selectProjectZone(zoneId: string): void {
    this.clearProjectZoneSelection();
    const projectZone = this.unifiedZoneManager.getZone(zoneId) as GameZone | undefined;
    if (projectZone) {
      projectZone.setHighlight(true);
    }
  }

  public clearProjectZoneSelection(): void {
    this.getAllProjectZones().forEach(zone => {
      zone.setHighlight(false);
    });
  }

  public checkProjectZoneOverlap(rect: Phaser.Geom.Rectangle, excludeProjectId?: string): boolean {
    return this.unifiedZoneManager.checkOverlap(rect, excludeProjectId);
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
      console.log('[ZoneManager] Cannot create project zone: overlaps existing zone');
      return null;
    }

    const bounds = this.projectZonePreview.end();
    if (!bounds || bounds.width < 100 || bounds.height < 100) {
      console.log('[ZoneManager] Project zone too small');
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
      const projectZones = this.getAllProjectZones();
      const defaultConfig: ProjectConfig = {
        name: `项目 ${projectZones.size + 1}`,
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

      const project = await this.projectClient.createZone(defaultConfig, {
        x: bounds.x + bounds.width / 2,
        y: bounds.y + bounds.height / 2,
        width: bounds.width,
        height: bounds.height,
        color: 15790320,
        opacity: 0.3,
        visible: true
      });

      // Create Zone context for the project with retry
      let createdZone: { id: string } | null = null;
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await axios.post(`/api/zones`, {
            zoneId: project.id,
            title: '新建区域',
            prompt: ''
          });
          createdZone = response.data.zone;
          console.log('[ZoneManager] Zone context created for project:', project.id, createdZone?.id);
          break; // Success, exit retry loop
        } catch (zoneError) {
          console.error(`[ZoneManager] Zone context creation attempt ${attempt}/${maxRetries} failed:`, zoneError);
          if (attempt === maxRetries) {
            // After final attempt, log error but don't fail the whole operation
            console.error('[ZoneManager] Failed to create zone context after all retries:', zoneError);
          } else {
            // Wait before retry with exponential backoff
            await new Promise(resolve => setTimeout(resolve, 100 * Math.pow(2, attempt - 1)));
          }
        }
      }

      // Link zones record with zone_contexts via zone_context_id FK
      if (createdZone) {
        try {
          await this.projectClient.updateZoneContextId(project.id, createdZone.id);
          console.log('[ZoneManager] Zone context FK linked:', project.id, '->', createdZone.id);
        } catch (linkError) {
          console.error('[ZoneManager] Failed to link zone context FK:', linkError);
        }

        // Emit zone created event so UI can open zone panel immediately
        rtsEventBus.emit('game:ui:zone_created' as any, {
          zone: {
            id: project.id,
            title: project.name,
            prompt: '',
            description: project.description,
            priority: project.priority,
            status: project.status,
            config: project.zoneConfig,
            path: project.path,
            presentAgentIds: project.presentAgentIds,
            members: [],
            files: [],
            createdAt: project.createdAt instanceof Date ? project.createdAt.getTime() : Number(project.createdAt),
            updatedAt: project.updatedAt instanceof Date ? project.updatedAt.getTime() : Number(project.updatedAt),
          }
        });
      }

      this.eventBus.emit('project:created', { project });
      return project;
    } catch (error) {
      console.error('[ZoneManager] Failed to create project:', error);
      return null;
    }
  }

  public getProjectClient(): ZoneClient {
    return this.projectClient;
  }

  public getProjectZone(zoneId: string): GameZone | undefined {
    return this.unifiedZoneManager.getZone(zoneId) as GameZone | undefined;
  }

  public getAllProjectZones(): Map<string, GameZone> {
    return this.unifiedZoneManager.getProjectZones();
  }

  public getEventBus(): Emitter<ProjectManagerEvents> {
    return this.eventBus;
  }

  public isDrawing(): boolean {
    return this.isDrawingProjectZone;
  }

  public destroy(): void {
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

    this.getAllProjectZones().forEach((zone, id) => {
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

  public updateProjectZoneTitle(zoneId: string, title: string): void {
    const projectZone = this.unifiedZoneManager.getZone(zoneId) as GameZone | undefined;
    if (projectZone) {
      projectZone.updateZoneTitle(title);
    }
  }

  /**
   * Fetch zone context (title, prompt, members) from zone_contexts table
   * Uses GET /api/zones?zoneId=xxx which returns zones array
   */
  private async fetchZoneContext(zoneId: string): Promise<{ title: string; prompt: string; members: string[] } | null> {
    try {
      const response = await axios.get<{
        success?: boolean;
        zones?: Array<{ title: string; prompt: string; members: string[] }>;
      }>(`/api/zones?zoneId=${encodeURIComponent(zoneId)}`);
      if (response.data.success && response.data.zones && response.data.zones.length > 0) {
        const zone = response.data.zones[0];
        return {
          title: zone.title,
          prompt: zone.prompt,
          members: zone.members
        };
      }
    } catch (error) {
      console.warn(`[ZoneManager] Failed to fetch zone context for ${zoneId}:`, error);
    }
    return null;
  }

  private async createProjectZone(project: Project): Promise<GameZone | null> {
    console.log(`[ZoneManager] Creating zone for project: ${project.id}`, project.zoneConfig);

    const existing = this.unifiedZoneManager.getZone(project.id);
    if (existing) {
      console.warn(`[ZoneManager] Project zone already exists: ${project.id}`);
      return null;
    }

    try {
      // Fetch zone context data (title, prompt, members) from zone_contexts table
      const zoneContext = await this.fetchZoneContext(project.id);
      if (zoneContext) {
        project.zoneContext = zoneContext;
        console.log(`[ZoneManager] Zone context loaded for ${project.id}:`, zoneContext.title);
      }

      const projectZone = new GameZone(this.scene, project, project.zoneConfig);
      console.log(`[ZoneManager] GameZone created successfully: ${project.id}`);

      this.scene.add.existing(projectZone);
      console.log(`[ZoneManager] GameZone added to scene: ${project.id}`);

      this.unifiedZoneManager.register(projectZone);
      console.log(`[ZoneManager] GameZone registered: ${project.id}`);

      projectZone.setInteractive();
      projectZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
        if (pointer.leftButtonDown() && !this.isDrawingProjectZone) {
          this.selectProjectZone(project.id);
        }
      });

      projectZone.on('zone-moved', (data: any) => {
        console.log(`[ZoneManager] Zone moved: ${project.id}`, data);
        this.eventBus.emit('project:zone-moved', { project, ...data });
      });

      console.log(`[ZoneManager] ✅ GameZone setup complete: ${project.id}`);
      return projectZone;
    } catch (error) {
      console.error(`[ZoneManager] ❌ Failed to create zone for project ${project.id}:`, error);
      return null;
    }
  }
}
