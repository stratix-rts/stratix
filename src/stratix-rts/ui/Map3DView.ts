import { MAP_WIDTH, MAP_HEIGHT } from '../constants';

import { getToken } from '@/design-system/config';

export interface Map3DZone {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: 'idle' | 'active' | 'busy' | 'error';
  agentCount: number;
}

export interface Map3DAgent {
  id: string;
  name: string;
  x: number;
  y: number;
  type: string;
  status: 'online' | 'offline' | 'busy' | 'error';
  zoneId: string | null;
}

export interface Map3DCallbacks {
  onZoneClick?: (zoneId: string) => void;
  onZoneDoubleClick?: (zoneId: string) => void;
  onAgentClick?: (agentId: string) => void;
}

/**
 * Map3DView - CSS 3D isometric map view for zones and agents
 * Uses CSS 3D transforms for lightweight 3D rendering without heavy 3D engines
 */
export class Map3DView {
  private container: HTMLElement;
  private sceneEl: HTMLElement | null = null;
  private groundEl: HTMLElement | null = null;
  private zonesEl: HTMLElement | null = null;
  private agentsEl: HTMLElement | null = null;

  private rotationX = 55; // Tilt angle (isometric-like)
  private rotationY = -30; // Y-axis rotation
  private zoom = 1;
  private panX = 0;
  private panY = 0;

  private isDragging = false;
  private lastMouseX = 0;
  private lastMouseY = 0;

  private zones: Map<string, Map3DZone> = new Map();
  private agents: Map<string, Map3DAgent> = new Map();
  private callbacks: Map3DCallbacks = {};

  // Scale factor: convert RTS coordinates to 3D view coordinates
  private scale = 0.15;

  constructor(container: HTMLElement, callbacks?: Map3DCallbacks) {
    this.container = container;
    this.callbacks = callbacks || {};
    this.init();
  }

  private init(): void {
    // Create scene structure
    this.sceneEl = document.createElement('div');
    this.sceneEl.className = 'map3d-scene';
    this.sceneEl.style.cssText = `
      width: 100%;
      height: 100%;
      perspective: 1200px;
      perspective-origin: 50% 50%;
      overflow: hidden;
      background: linear-gradient(180deg, #0a0a12 0%, #1a1a2e 100%);
      cursor: grab;
    `;

    // Ground plane
    this.groundEl = document.createElement('div');
    this.groundEl.className = 'map3d-ground';
    this.groundEl.style.cssText = `
      position: absolute;
      width: ${MAP_WIDTH * this.scale * 2}px;
      height: ${MAP_HEIGHT * this.scale * 2}px;
      left: 50%;
      top: 50%;
      transform-style: preserve-3d;
      transform: translateX(-50%) translateY(-50%) rotateX(75deg) rotateZ(45deg);
      background:
        linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
        linear-gradient(135deg, rgba(30,30,60,0.8) 0%, rgba(20,20,40,0.9) 100%);
      background-size: 40px 40px, 40px 40px, 100% 100%;
      border: 1px solid rgba(100,100,200,0.2);
      box-shadow: 0 0 60px rgba(60,60,120,0.3);
    `;

    // Grid overlay on ground
    const gridOverlay = document.createElement('div');
    gridOverlay.className = 'map3d-grid';
    gridOverlay.style.cssText = `
      position: absolute;
      inset: 0;
      background:
        repeating-linear-gradient(0deg, transparent, transparent 39px, rgba(100,100,200,0.1) 40px),
        repeating-linear-gradient(90deg, transparent, transparent 39px, rgba(100,100,200,0.1) 40px);
      pointer-events: none;
    `;
    this.groundEl.appendChild(gridOverlay);

    // Zones container
    this.zonesEl = document.createElement('div');
    this.zonesEl.className = 'map3d-zones';
    this.zonesEl.style.cssText = `
      position: absolute;
      width: 100%;
      height: 100%;
      transform-style: preserve-3d;
    `;

    // Agents container
    this.agentsEl = document.createElement('div');
    this.agentsEl.className = 'map3d-agents';
    this.agentsEl.style.cssText = `
      position: absolute;
      width: 100%;
      height: 100%;
      transform-style: preserve-3d;
    `;

    this.groundEl.appendChild(this.zonesEl);
    this.groundEl.appendChild(this.agentsEl);
    this.sceneEl.appendChild(this.groundEl);
    this.container.appendChild(this.sceneEl);

    // Add CSS for 3D elements
    this.injectStyles();

    // Event listeners
    this.initEventListeners();
  }

  private injectStyles(): void {
    if (document.getElementById('map3d-styles')) return;

    const style = document.createElement('style');
    style.id = 'map3d-styles';
    style.textContent = `
      .map3d-zone-block {
        position: absolute;
        transform-style: preserve-3d;
        cursor: pointer;
        transition: filter 0.2s ease;
      }
      .map3d-zone-block:hover {
        filter: brightness(1.2);
      }
      .map3d-zone-top {
        position: absolute;
        transform: translateZ(var(--zone-height, 30px));
      }
      .map3d-zone-front {
        position: absolute;
        transform-origin: top center;
        transform: rotateX(-90deg) translateZ(var(--zone-height, 30px));
      }
      .map3d-zone-right {
        position: absolute;
        transform-origin: left center;
        transform: rotateY(90deg) rotateZ(-90deg) translateX(calc(var(--zone-height, 30px) / 2)) translateZ(calc(var(--zone-width, 100px) / 2));
      }
      .map3d-agent-marker {
        position: absolute;
        transform-style: preserve-3d;
        cursor: pointer;
        transition: transform 0.2s ease;
      }
      .map3d-agent-marker:hover {
        transform: translateZ(10px) scale(1.1);
      }
      .map3d-agent-avatar {
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: linear-gradient(135deg, var(--agent-color, #4a9eff), var(--agent-color-dark, #2a6edf));
        border: 2px solid rgba(255,255,255,0.8);
        box-shadow: 0 2px 8px rgba(0,0,0,0.3), 0 0 12px var(--agent-glow, rgba(74,158,255,0.5));
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 10px;
        color: white;
        font-weight: bold;
      }
      .map3d-agent-status {
        position: absolute;
        width: 8px;
        height: 8px;
        border-radius: 50%;
        top: -2px;
        right: -2px;
        border: 2px solid #1a1a2e;
      }
      .map3d-agent-status.online { background: #22c55e; box-shadow: 0 0 6px #22c55e; }
      .map3d-agent-status.busy { background: #f59e0b; box-shadow: 0 0 6px #f59e0b; }
      .map3d-agent-status.offline { background: #6b7280; }
      .map3d-agent-status.error { background: #ef4444; box-shadow: 0 0 6px #ef4444; }
    `;
    document.head.appendChild(style);
  }

  private initEventListeners(): void {
    if (!this.sceneEl) return;

    // Mouse drag for rotation
    this.sceneEl.addEventListener('mousedown', (e) => {
      this.isDragging = true;
      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;
      this.sceneEl!.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isDragging) return;

      const deltaX = e.clientX - this.lastMouseX;
      const deltaY = e.clientY - this.lastMouseY;

      this.rotationY += deltaX * 0.5;
      this.rotationX = Math.max(20, Math.min(80, this.rotationX + deltaY * 0.3));

      this.lastMouseX = e.clientX;
      this.lastMouseY = e.clientY;

      this.updateTransform();
    });

    window.addEventListener('mouseup', () => {
      this.isDragging = false;
      if (this.sceneEl) {
        this.sceneEl.style.cursor = 'grab';
      }
    });

    // Wheel for zoom
    this.sceneEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      this.zoom = Math.max(0.3, Math.min(2, this.zoom + delta));
      this.updateTransform();
    }, { passive: false });
  }

  private updateTransform(): void {
    if (!this.groundEl) return;
    this.groundEl.style.transform = `
      translateX(calc(-50% + ${this.panX}px))
      translateY(calc(-50% + ${this.panY}px))
      translateZ(${-300 / this.zoom}px)
      rotateX(${90 - this.rotationX}deg)
      rotateZ(${this.rotationY}deg)
      scale(${this.zoom})
    `;
  }

  /**
   * Update zone data and re-render
   */
  public updateZones(zones: Map3DZone[]): void {
    this.zones.clear();
    zones.forEach(z => this.zones.set(z.id, z));
    this.renderZones();
  }

  /**
   * Update agent data and re-render
   */
  public updateAgents(agents: Map3DAgent[]): void {
    this.agents.clear();
    agents.forEach(a => this.agents.set(a.id, a));
    this.renderAgents();
  }

  /**
   * Set pan offset
   */
  public setPan(x: number, y: number): void {
    this.panX = x;
    this.panY = y;
    this.updateTransform();
  }

  /**
   * Reset view to default angle
   */
  public resetView(): void {
    this.rotationX = 55;
    this.rotationY = -30;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  }

  private renderZones(): void {
    if (!this.zonesEl) return;
    this.zonesEl.innerHTML = '';

    const theme = this.getThemeColors();

    this.zones.forEach((zone) => {
      const zoneHeight = 25 + zone.agentCount * 5; // Taller with more agents
      const w = zone.width * this.scale;
      const h = zone.height * this.scale;
      const cx = (zone.x - MAP_WIDTH / 2) * this.scale;
      const cy = (zone.y - MAP_HEIGHT / 2) * this.scale;

      const zoneEl = document.createElement('div');
      zoneEl.className = 'map3d-zone-block';
      zoneEl.style.cssText = `
        --zone-width: ${w}px;
        --zone-height: ${zoneHeight}px;
        left: ${cx - w / 2}px;
        top: ${cy - h / 2}px;
        width: ${w}px;
        height: ${h}px;
        transform-style: preserve-3d;
      `;

      // Top face
      const topFace = document.createElement('div');
      topFace.className = 'map3d-zone-top';
      topFace.style.cssText = `
        width: ${w}px;
        height: ${h}px;
        background: linear-gradient(135deg, ${theme.zoneFill(zone.status)} 0%, ${theme.zoneFillDark(zone.status)} 100%);
        border: 2px solid ${theme.zoneBorder(zone.status)};
        box-shadow: 0 0 20px ${theme.zoneGlow(zone.status)};
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 11px;
        font-weight: 600;
        text-shadow: 0 1px 2px rgba(0,0,0,0.5);
      `;
      topFace.textContent = zone.name;

      // Front face
      const frontFace = document.createElement('div');
      frontFace.className = 'map3d-zone-front';
      frontFace.style.cssText = `
        width: ${w}px;
        height: ${zoneHeight}px;
        background: linear-gradient(180deg, ${theme.zoneFillDark(zone.status)} 0%, ${theme.zoneFront(zone.status)} 100%);
        border: 2px solid ${theme.zoneBorder(zone.status)};
        border-top: none;
        opacity: 0.85;
      `;

      // Right face
      const rightFace = document.createElement('div');
      rightFace.className = 'map3d-zone-right';
      rightFace.style.cssText = `
        width: ${h}px;
        height: ${zoneHeight}px;
        background: linear-gradient(180deg, ${theme.zoneFillDark(zone.status)} 0%, ${theme.zoneRight(zone.status)} 100%);
        border: 2px solid ${theme.zoneBorder(zone.status)};
        border-left: none;
        opacity: 0.7;
      `;

      zoneEl.appendChild(topFace);
      zoneEl.appendChild(frontFace);
      zoneEl.appendChild(rightFace);

      // Click handlers
      zoneEl.addEventListener('click', () => {
        this.callbacks.onZoneClick?.(zone.id);
      });
      zoneEl.addEventListener('dblclick', () => {
        this.callbacks.onZoneDoubleClick?.(zone.id);
      });

      this.zonesEl!.appendChild(zoneEl);
    });
  }

  private renderAgents(): void {
    if (!this.agentsEl) return;
    this.agentsEl.innerHTML = '';

    const theme = this.getThemeColors();

    this.agents.forEach((agent) => {
      // Find agent's zone to position on top of it
      const zone = agent.zoneId ? this.zones.get(agent.zoneId) : null;
      let ax: number, ay: number;

      if (zone) {
        // Position on top of zone
        ax = (agent.x - MAP_WIDTH / 2) * this.scale;
        ay = (agent.y - MAP_HEIGHT / 2) * this.scale;
      } else {
        // Free floating
        ax = (agent.x - MAP_WIDTH / 2) * this.scale;
        ay = (agent.y - MAP_HEIGHT / 2) * this.scale;
      }

      const agentEl = document.createElement('div');
      agentEl.className = 'map3d-agent-marker';
      agentEl.style.cssText = `
        left: ${ax}px;
        top: ${ay}px;
        transform: translateX(-50%) translateY(-50%);
      `;

      const avatar = document.createElement('div');
      avatar.className = 'map3d-agent-avatar';
      avatar.style.cssText = `
        --agent-color: ${theme.agentColor(agent.type)};
        --agent-color-dark: ${theme.agentColorDark(agent.type)};
        --agent-glow: ${theme.agentGlow(agent.status)};
      `;
      avatar.textContent = agent.name.substring(0, 2).toUpperCase();

      const status = document.createElement('div');
      status.className = `map3d-agent-status ${agent.status}`;

      avatar.appendChild(status);
      agentEl.appendChild(avatar);

      agentEl.addEventListener('click', () => {
        this.callbacks.onAgentClick?.(agent.id);
      });

      this.agentsEl!.appendChild(agentEl);
    });
  }

  private getThemeColors() {
    const primary = getToken('colors.brand.primary');
    const secondary = getToken('colors.brand.secondary');
    const success = getToken('colors.status.success');
    const warning = getToken('colors.status.warning');
    const danger = getToken('colors.status.danger');
    const muted = getToken('colors.text.muted');

    return {
      zoneBorder: (status: string) => {
        switch (status) {
          case 'active': return success;
          case 'busy': return warning;
          case 'error': return danger;
          default: return primary;
        }
      },
      zoneFill: (status: string) => {
        switch (status) {
          case 'active': return 'rgba(34,197,94,0.4)';
          case 'busy': return 'rgba(245,158,11,0.4)';
          case 'error': return 'rgba(239,68,68,0.4)';
          default: return 'rgba(74,158,255,0.3)';
        }
      },
      zoneFillDark: (status: string) => {
        switch (status) {
          case 'active': return 'rgba(34,197,94,0.2)';
          case 'busy': return 'rgba(245,158,11,0.2)';
          case 'error': return 'rgba(239,68,68,0.2)';
          default: return 'rgba(74,158,255,0.15)';
        }
      },
      zoneFront: (status: string) => {
        switch (status) {
          case 'active': return 'rgba(34,197,94,0.1)';
          case 'busy': return 'rgba(245,158,11,0.1)';
          case 'error': return 'rgba(239,68,68,0.1)';
          default: return 'rgba(74,158,255,0.08)';
        }
      },
      zoneRight: (status: string) => {
        switch (status) {
          case 'active': return 'rgba(34,197,94,0.05)';
          case 'busy': return 'rgba(245,158,11,0.05)';
          case 'error': return 'rgba(239,68,68,0.05)';
          default: return 'rgba(74,158,255,0.04)';
        }
      },
      zoneGlow: (status: string) => {
        switch (status) {
          case 'active': return 'rgba(34,197,94,0.4)';
          case 'busy': return 'rgba(245,158,11,0.4)';
          case 'error': return 'rgba(239,68,68,0.4)';
          default: return 'rgba(74,158,255,0.3)';
        }
      },
      agentColor: (type: string) => {
        switch (type) {
          case 'writer': return secondary;
          case 'dev': return primary;
          case 'analyst': return warning;
          default: return primary;
        }
      },
      agentColorDark: (type: string) => {
        switch (type) {
          case 'writer': return '#b454d9';
          case 'dev': return '#2a6edf';
          case 'analyst': return '#d97706';
          default: return '#2a6edf';
        }
      },
      agentGlow: (status: string) => {
        switch (status) {
          case 'online': return 'rgba(34,197,94,0.5)';
          case 'busy': return 'rgba(245,158,11,0.5)';
          case 'error': return 'rgba(239,68,68,0.5)';
          default: return 'rgba(107,114,128,0.3)';
        }
      }
    };
  }

  /**
   * Show the 3D view
   */
  public show(): void {
    if (this.sceneEl) {
      this.sceneEl.style.display = 'block';
    }
  }

  /**
   * Hide the 3D view
   */
  public hide(): void {
    if (this.sceneEl) {
      this.sceneEl.style.display = 'none';
    }
  }

  /**
   * Toggle visibility
   */
  public toggle(): boolean {
    const isVisible = this.sceneEl?.style.display !== 'none';
    if (isVisible) {
      this.hide();
    } else {
      this.show();
    }
    return !isVisible;
  }

  /**
   * Check if view is visible
   */
  public isVisible(): boolean {
    return this.sceneEl?.style.display !== 'none';
  }

  /**
   * Cleanup
   */
  public destroy(): void {
    if (this.sceneEl && this.sceneEl.parentNode) {
      this.sceneEl.parentNode.removeChild(this.sceneEl);
    }
    this.zones.clear();
    this.agents.clear();
  }
}
