export type AriaLiveMode = 'polite' | 'assertive' | 'off';

export interface AnnouncementOptions {
  priority?: AriaLiveMode;
  clear?: boolean;
  delay?: number;
}

export interface AriaAnnouncement {
  id: string;
  message: string;
  priority: AriaLiveMode;
  timestamp: number;
}

export class AriaAnnouncer {
  private static instance: AriaAnnouncer;
  private liveRegion: HTMLElement | null = null;
  private assertiveRegion: HTMLElement | null = null;
  private announcementQueue: AriaAnnouncement[] = [];
  private announcementId = 0;
  private enabled = true;
  private listeners = new Set<(announcement: AriaAnnouncement) => void>();

  private constructor() {
    this.createLiveRegions();
  }

  static getInstance(): AriaAnnouncer {
    if (!AriaAnnouncer.instance) {
      AriaAnnouncer.instance = new AriaAnnouncer();
    }
    return AriaAnnouncer.instance;
  }

  static destroyInstance(): void {
    if (AriaAnnouncer.instance) {
      AriaAnnouncer.instance.destroy();
      AriaAnnouncer.instance = undefined as unknown as AriaAnnouncer;
    }
  }

  announce(message: string, options: AnnouncementOptions = {}): string {
    if (!this.enabled || !message.trim()) {
      return '';
    }

    const {
      priority = 'polite',
      clear = false,
      delay = 0,
    } = options;

    const id = `announcement-${++this.announcementId}`;
    const announcement: AriaAnnouncement = {
      id,
      message: message.trim(),
      priority,
      timestamp: Date.now(),
    };

    if (clear) {
      this.clear();
    }

    if (delay > 0) {
      setTimeout(() => {
        this.processAnnouncement(announcement);
      }, delay);
    } else {
      this.processAnnouncement(announcement);
    }

    return id;
  }

  announceSelection(type: 'agent' | 'zone', count: number, names?: string[]): void {
    const typeText = type === 'agent' ? '智能体' : '区域';
    let message = '';

    if (count === 0) {
      message = `未选中任何${typeText}`;
    } else if (count === 1) {
      message = `已选中1个${typeText}${names && names.length > 0 ? `: ${names[0]}` : ''}`;
    } else {
      message = `已选中${count}个${typeText}`;
    }

    this.announce(message, { priority: 'polite' });
  }

  announceAction(action: string, target?: string): void {
    const message = target 
      ? `${action}: ${target}`
      : action;
    
    this.announce(message, { priority: 'polite' });
  }

  announceError(error: string): void {
    this.announce(`错误: ${error}`, { priority: 'assertive' });
  }

  announceStatus(status: string): void {
    this.announce(status, { priority: 'polite' });
  }

  announceZoneCreated(zoneName: string): void {
    this.announce(`已创建区域: ${zoneName}`, { priority: 'polite' });
  }

  announceZoneDeleted(zoneName: string): void {
    this.announce(`已删除区域: ${zoneName}`, { priority: 'polite' });
  }

  announceZoneSelected(zoneName: string): void {
    this.announce(`已选中区域: ${zoneName}`, { priority: 'polite' });
  }

  announceShortcut(shortcut: string, description: string): void {
    this.announce(`快捷键 ${shortcut}: ${description}`, { priority: 'polite' });
  }

  enable(): void {
    this.enabled = true;
  }

  disable(): void {
    this.enabled = false;
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  clear(): void {
    if (this.liveRegion) {
      this.liveRegion.textContent = '';
    }
    if (this.assertiveRegion) {
      this.assertiveRegion.textContent = '';
    }
    this.announcementQueue = [];
  }

  subscribe(listener: (announcement: AriaAnnouncement) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getPendingAnnouncements(): AriaAnnouncement[] {
    return [...this.announcementQueue];
  }

  private processAnnouncement(announcement: AriaAnnouncement): void {
    this.announcementQueue.push(announcement);

    const region = announcement.priority === 'assertive' 
      ? this.assertiveRegion 
      : this.liveRegion;

    if (region) {
      this.updateRegion(region, announcement.message);
    }

    this.emitAnnouncement(announcement);
  }

  private updateRegion(region: HTMLElement, message: string): void {
    region.textContent = '';
    
    setTimeout(() => {
      region.textContent = message;
    }, 50);
  }

  private createLiveRegions(): void {
    this.liveRegion = this.createRegion('polite', 'aria-live-polite');
    this.assertiveRegion = this.createRegion('assertive', 'aria-live-assertive');
  }

  private createRegion(priority: AriaLiveMode, id: string): HTMLElement {
    let region = document.getElementById(id);

    if (!region) {
      region = document.createElement('div');
      region.id = id;
      region.setAttribute('role', 'status');
      region.setAttribute('aria-live', priority);
      region.setAttribute('aria-atomic', 'true');
      region.className = 'sr-only';
      
      region.style.cssText = `
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border-width: 0;
      `;
      
      document.body.appendChild(region);
    }

    return region;
  }

  private emitAnnouncement(announcement: AriaAnnouncement): void {
    this.listeners.forEach(listener => {
      try {
        listener(announcement);
      } catch (error) {
        console.error('[AriaAnnouncer] Error in announcement listener:', error);
      }
    });
  }

  destroy(): void {
    if (this.liveRegion && this.liveRegion.parentNode) {
      this.liveRegion.parentNode.removeChild(this.liveRegion);
    }
    if (this.assertiveRegion && this.assertiveRegion.parentNode) {
      this.assertiveRegion.parentNode.removeChild(this.assertiveRegion);
    }
    this.announcementQueue = [];
    this.listeners.clear();
  }
}

export const ariaAnnouncer = AriaAnnouncer.getInstance();