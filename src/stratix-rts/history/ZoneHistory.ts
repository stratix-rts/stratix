import { rtsEventBus } from '../events/core/RTSEventBus';

export interface ZoneAction {
  id: string;
  type: 'create' | 'delete' | 'move' | 'resize' | 'status_change';
  timestamp: number;
  zoneId: string;
  data: any;
  undo(): Promise<void>;
  redo(): Promise<void>;
}

export class ZoneHistory {
  private undoStack: ZoneAction[] = [];
  private redoStack: ZoneAction[] = [];
  private maxHistorySize: number = 50;
  private isPerformingAction = false;

  async execute(action: ZoneAction): Promise<void> {
    if (this.isPerformingAction) return;

    this.isPerformingAction = true;
    try {
      await action.redo();
      this.undoStack.push(action);
      this.redoStack = [];

      if (this.undoStack.length > this.maxHistorySize) {
        this.undoStack.shift();
      }
    } finally {
      this.isPerformingAction = false;
      this.emitHistoryChange();
    }
  }

  async undo(): Promise<void> {
    if (this.isPerformingAction || this.undoStack.length === 0) return;

    this.isPerformingAction = true;
    try {
      const action = this.undoStack.pop()!;
      await action.undo();
      this.redoStack.push(action);
    } finally {
      this.isPerformingAction = false;
      this.emitHistoryChange();
    }
  }

  async redo(): Promise<void> {
    if (this.isPerformingAction || this.redoStack.length === 0) return;

    this.isPerformingAction = true;
    try {
      const action = this.redoStack.pop()!;
      await action.redo();
      this.undoStack.push(action);
    } finally {
      this.isPerformingAction = false;
      this.emitHistoryChange();
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0 && !this.isPerformingAction;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0 && !this.isPerformingAction;
  }

  getUndoStack(): ZoneAction[] {
    return [...this.undoStack];
  }

  getRedoStack(): ZoneAction[] {
    return [...this.redoStack];
  }

  getUndoStackLength(): number {
    return this.undoStack.length;
  }

  getRedoStackLength(): number {
    return this.redoStack.length;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.emitHistoryChange();
  }

  private emitHistoryChange(): void {
    rtsEventBus.emit('history:changed' as any, {
      canUndo: this.canUndo(),
      canRedo: this.canRedo(),
      undoStackLength: this.undoStack.length,
      redoStackLength: this.redoStack.length,
    });
  }

  destroy(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.isPerformingAction = false;
  }
}

export class ZoneMoveAction implements ZoneAction {
  id: string;
  type = 'move' as const;
  timestamp: number;
  zoneId: string;
  data: any;

  constructor(
    private zone: any,
    private oldPosition: { x: number; y: number },
    private newPosition: { x: number; y: number }
  ) {
    this.id = `move-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = Date.now();
    this.zoneId = zone.getZoneId ? zone.getZoneId() : zone.id;
    this.data = {
      oldPosition,
      newPosition,
    };
  }

  async undo(): Promise<void> {
    if (this.zone.setPosition) {
      this.zone.setPosition(this.oldPosition.x, this.oldPosition.y);
    } else {
      this.zone.x = this.oldPosition.x;
      this.zone.y = this.oldPosition.y;
    }

    rtsEventBus.emit('zone:moved' as any, {
      zoneId: this.zoneId,
      position: this.oldPosition,
      isUndo: true,
    });
  }

  async redo(): Promise<void> {
    if (this.zone.setPosition) {
      this.zone.setPosition(this.newPosition.x, this.newPosition.y);
    } else {
      this.zone.x = this.newPosition.x;
      this.zone.y = this.newPosition.y;
    }

    rtsEventBus.emit('zone:moved' as any, {
      zoneId: this.zoneId,
      position: this.newPosition,
      isRedo: true,
    });
  }
}

export class ZoneResizeAction implements ZoneAction {
  id: string;
  type = 'resize' as const;
  timestamp: number;
  zoneId: string;
  data: any;

  constructor(
    private zone: any,
    private oldSize: { width: number; height: number },
    private newSize: { width: number; height: number }
  ) {
    this.id = `resize-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = Date.now();
    this.zoneId = zone.getZoneId ? zone.getZoneId() : zone.id;
    this.data = {
      oldSize,
      newSize,
    };
  }

  async undo(): Promise<void> {
    if (this.zone.resize) {
      this.zone.resize(this.oldSize.width, this.oldSize.height);
    }

    rtsEventBus.emit('zone:resized' as any, {
      zoneId: this.zoneId,
      size: this.oldSize,
      isUndo: true,
    });
  }

  async redo(): Promise<void> {
    if (this.zone.resize) {
      this.zone.resize(this.newSize.width, this.newSize.height);
    }

    rtsEventBus.emit('zone:resized' as any, {
      zoneId: this.zoneId,
      size: this.newSize,
      isRedo: true,
    });
  }
}

export class ZoneCreateAction implements ZoneAction {
  id: string;
  type = 'create' as const;
  timestamp: number;
  zoneId: string;
  data: any;

  constructor(
    private zone: any,
    private scene: any
  ) {
    this.id = `create-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = Date.now();
    this.zoneId = zone.getZoneId ? zone.getZoneId() : zone.id;
    this.data = {
      zoneConfig: {
        id: this.zoneId,
        x: zone.x,
        y: zone.y,
        width: zone.width || zone.zoneWidth,
        height: zone.height || zone.zoneHeight,
      },
    };
  }

  async undo(): Promise<void> {
    if (this.zone.destroy) {
      this.zone.destroy();
    }

    rtsEventBus.emit('zone:deleted' as any, {
      zoneId: this.zoneId,
      isUndo: true,
    });
  }

  async redo(): Promise<void> {
    if (this.scene && this.scene.add) {
      this.scene.add.existing(this.zone);
    }

    rtsEventBus.emit('zone:created' as any, {
      zoneId: this.zoneId,
      isRedo: true,
    });
  }
}

export class ZoneDeleteAction implements ZoneAction {
  id: string;
  type = 'delete' as const;
  timestamp: number;
  zoneId: string;
  data: any;

  constructor(
    private zone: any,
    private scene: any,
    private recreateFn: () => Promise<any>
  ) {
    this.id = `delete-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    this.timestamp = Date.now();
    this.zoneId = zone.getZoneId ? zone.getZoneId() : zone.id;
    this.data = {
      zoneConfig: {
        id: this.zoneId,
        x: zone.x,
        y: zone.y,
        width: zone.width || zone.zoneWidth,
        height: zone.height || zone.zoneHeight,
      },
    };
  }

  async undo(): Promise<void> {
    this.zone = await this.recreateFn();

    rtsEventBus.emit('zone:created' as any, {
      zoneId: this.zoneId,
      isUndo: true,
    });
  }

  async redo(): Promise<void> {
    if (this.zone && this.zone.destroy) {
      this.zone.destroy();
    }

    rtsEventBus.emit('zone:deleted' as any, {
      zoneId: this.zoneId,
      isRedo: true,
    });
  }
}