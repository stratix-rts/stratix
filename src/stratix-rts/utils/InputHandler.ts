import Phaser from 'phaser';
import { MIN_ZOOM, MAX_ZOOM } from '../constants';
import { CommandType } from '../systems/CommandSystem';

export type InputMode = 'normal' | 'zoneDrawing' | 'command';

export interface InputConfig {
  zoomSpeed: number;
  pinchZoomSpeed: number;
  minZoom: number;
  maxZoom: number;
  panSpeed: number;
  trackpadPanSpeed: number;
  edgeScrollMargin: number;
  edgeScrollSpeed: number;
  doubleClickThreshold: number;
}

export interface InputCallbacks {
  onSelect?: (agentIds: string[], shiftKey: boolean) => void;
  onDeselect?: () => void;
  onBoxSelect?: (bounds: Phaser.Geom.Rectangle, shiftKey: boolean) => void;
  onCommand?: (target: { x: number; y: number }, commandType?: CommandType) => void;
  onCommandMode?: (commandType: CommandType) => void;
  onCancelCommandMode?: () => void;
  onCameraMove?: (deltaX: number, deltaY: number) => void;
  onZoom?: (zoom: number) => void;
  onDragStart?: (x: number, y: number) => void;
  onDragUpdate?: (x: number, y: number) => void;
  onDragEnd?: () => Phaser.Geom.Rectangle | null;
  onSpriteDragStart?: (agentId: string, x: number, y: number) => void;
  onSpriteDragUpdate?: (x: number, y: number) => void;
  onSpriteDragEnd?: () => void;
  onZoneDrawStart?: (x: number, y: number) => void;
  onZoneDrawUpdate?: (x: number, y: number) => void;
  onZoneDrawEnd?: () => Phaser.Geom.Rectangle | null | Promise<Phaser.Geom.Rectangle | null>;
  onZoneDrawCancel?: () => void;
  onModeChange?: (mode: InputMode) => void;
  onSelectAllSameType?: (agentId: string) => void;
  onCreateControlGroup?: (groupId: number) => void;
  onSelectControlGroup?: (groupId: number, centerCamera: boolean) => void;
  onStopCommand?: () => void;
  onPatrolCommand?: (x: number, y: number) => void;
  onZoneDragStart?: (zoneId: string, x: number, y: number) => void;
  onZoneDragUpdate?: (x: number, y: number) => void;
  onZoneDragEnd?: () => void;
  onZoneResizeStart?: (zoneId: string, corner: string, x: number, y: number) => void;
  onZoneResizeUpdate?: (x: number, y: number) => void;
  onZoneResizeEnd?: () => void;
  onCheckZoneOverlap?: (rect: Phaser.Geom.Rectangle, excludeZoneId?: string) => boolean;
  onZoneClick?: (zoneId: string) => void;
  onZoneDoubleClick?: (zoneId: string) => void;
  onDeleteSelectedZones?: () => void;
  getTaskZoneAtPoint?: (worldX: number, worldY: number) => string | null;
}

const DEFAULT_CONFIG: InputConfig = {
  zoomSpeed: 0.001,
  pinchZoomSpeed: 0.01,
  minZoom: MIN_ZOOM,
  maxZoom: MAX_ZOOM,
  panSpeed: 4,
  trackpadPanSpeed: 1,
  edgeScrollMargin: 20,
  edgeScrollSpeed: 8,
  doubleClickThreshold: 300
};

export class InputHandler {
  private scene: Phaser.Scene;
  private config: InputConfig;
  private callbacks: InputCallbacks;
  private isEnabled: boolean = true;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys;
  private mode: InputMode = 'normal';
  private isDragging: boolean = false;
  private isSpriteDragging: boolean = false;
  private isZoneDrawing: boolean = false;
  private isZoneDragging: boolean = false;
  private isZoneResizing: boolean = false;
  private draggedAgentId: string | null = null;
  private draggedZoneId: string | null = null;
  private resizingCorner: string | null = null;
  private dragStartPoint: { x: number; y: number } | null = null;
  private commandType: CommandType | null = null;
  private lastClickTime: number = 0;
  private lastClickedAgentId: string | null = null;
  private lastZoneClickTime: number = 0;
  private lastClickedZoneId: string | null = null;
  private pendingZoneDragId: string | null = null;
  private zoneDragStartPoint: { x: number; y: number } | null = null;
  private readonly zoneDragThreshold: number = 4;
  private shiftKey: Phaser.Input.Keyboard.Key;
  private ctrlKey: Phaser.Input.Keyboard.Key;
  private boundHandlers: {
    pointerdown: (pointer: Phaser.Input.Pointer) => void;
    pointermove: (pointer: Phaser.Input.Pointer) => void;
    pointerup: (pointer: Phaser.Input.Pointer) => void;
    wheel: (pointer: Phaser.Input.Pointer, gameObjects: Phaser.GameObjects.GameObject[], deltaX: number, deltaY: number) => void;
  };

  constructor(
    scene: Phaser.Scene, 
    callbacks: InputCallbacks, 
    config?: Partial<InputConfig>
  ) {
    this.scene = scene;
    this.callbacks = callbacks;
    this.config = { ...DEFAULT_CONFIG, ...config };
    
    this.boundHandlers = {
      pointerdown: this.handlePointerDown.bind(this),
      pointermove: this.handlePointerMove.bind(this),
      pointerup: this.handlePointerUp.bind(this),
      wheel: this.handleWheel.bind(this)
    };
    
    this.initKeyboard();
    this.initMouse();
  }

  private initKeyboard(): void {
    if (!this.scene.input.keyboard) return;
    
    this.cursors = this.scene.input.keyboard.createCursorKeys();
    this.shiftKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);
    this.ctrlKey = this.scene.input.keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.CTRL);

    this.scene.input.keyboard.on('keydown-ESC', () => this.handleEscape());
    
    this.scene.input.keyboard.on('keydown-A', () => this.handleAttackMoveKey());
    this.scene.input.keyboard.on('keydown-S', () => this.handleStopKey());
    this.scene.input.keyboard.on('keydown-P', () => this.handlePatrolKey());
    this.scene.input.keyboard.on('keydown-H', () => this.handleHoldPositionKey());
    this.scene.input.keyboard.on('keydown-Z', () => this.toggleZoneDrawingMode());

    this.scene.input.keyboard.on('keydown-ONE', () => this.handleNumberKey(1));
    this.scene.input.keyboard.on('keydown-TWO', () => this.handleNumberKey(2));
    this.scene.input.keyboard.on('keydown-THREE', () => this.handleNumberKey(3));
    this.scene.input.keyboard.on('keydown-FOUR', () => this.handleNumberKey(4));
    this.scene.input.keyboard.on('keydown-FIVE', () => this.handleNumberKey(5));
    this.scene.input.keyboard.on('keydown-SIX', () => this.handleNumberKey(6));
    this.scene.input.keyboard.on('keydown-SEVEN', () => this.handleNumberKey(7));
    this.scene.input.keyboard.on('keydown-EIGHT', () => this.handleNumberKey(8));
    this.scene.input.keyboard.on('keydown-NINE', () => this.handleNumberKey(9));

    this.scene.input.keyboard.on('keydown-PLUS', () => this.zoomCamera(0.1));
    this.scene.input.keyboard.on('keydown-MINUS', () => this.zoomCamera(-0.1));
    
    this.scene.input.keyboard.on('keydown-DELETE', () => this.handleDeleteKey());
    this.scene.input.keyboard.on('keydown-BACKSPACE', () => this.handleDeleteKey());
  }

  private handleDeleteKey(): void {
    if (!this.isEnabled) return;
    if (this.callbacks.onDeleteSelectedZones) {
      this.callbacks.onDeleteSelectedZones();
    }
  }

  private handleEscape(): void {
    if (!this.isEnabled) return;

    if (this.commandType !== null) {
      this.commandType = null;
      this.mode = 'normal';
      if (this.callbacks.onCancelCommandMode) {
        this.callbacks.onCancelCommandMode();
      }
      return;
    }

    if (this.mode === 'zoneDrawing') {
      if (this.isZoneDrawing) {
        this.isZoneDrawing = false;
        this.dragStartPoint = null;
        if (this.callbacks.onZoneDrawCancel) {
          this.callbacks.onZoneDrawCancel();
        }
      }
      this.setMode('normal');
      return;
    }

    if (this.callbacks.onDeselect) {
      this.callbacks.onDeselect();
    }
  }

  private handleAttackMoveKey(): void {
    if (!this.isEnabled) return;
    this.commandType = 'attackMove';
    this.mode = 'command';
    if (this.callbacks.onCommandMode) {
      this.callbacks.onCommandMode('attackMove');
    }
  }

  private handleStopKey(): void {
    if (!this.isEnabled) return;
    if (this.callbacks.onStopCommand) {
      this.callbacks.onStopCommand();
    }
  }

  private handlePatrolKey(): void {
    if (!this.isEnabled) return;
    this.commandType = 'patrol';
    this.mode = 'command';
    if (this.callbacks.onCommandMode) {
      this.callbacks.onCommandMode('patrol');
    }
  }

  private handleHoldPositionKey(): void {
    if (!this.isEnabled) return;
    this.commandType = 'holdPosition';
    this.mode = 'command';
    if (this.callbacks.onCommandMode) {
      this.callbacks.onCommandMode('holdPosition');
    }
  }

  private handleNumberKey(groupId: number): void {
    if (!this.isEnabled) return;
    const isCtrlDown = this.ctrlKey.isDown;
    const isShiftDown = this.shiftKey.isDown;

    if (isCtrlDown) {
      if (this.callbacks.onCreateControlGroup) {
        this.callbacks.onCreateControlGroup(groupId);
      }
    } else {
      const centerCamera = this.isDoubleClick();
      if (this.callbacks.onSelectControlGroup) {
        this.callbacks.onSelectControlGroup(groupId, centerCamera);
      }
    }
  }

  private isDoubleClick(): boolean {
    const now = Date.now();
    const isDouble = now - this.lastClickTime < this.config.doubleClickThreshold;
    this.lastClickTime = now;
    return isDouble;
  }

  private initMouse(): void {
    this.scene.input.on('pointerdown', this.boundHandlers.pointerdown);
    this.scene.input.on('pointermove', this.boundHandlers.pointermove);
    this.scene.input.on('pointerup', this.boundHandlers.pointerup);
    this.scene.input.on('wheel', this.boundHandlers.wheel);
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    if (!this.isEnabled) return;
    const isShiftDown = this.shiftKey.isDown;

    if (pointer.leftButtonDown()) {
      this.dragStartPoint = { x: pointer.worldX, y: pointer.worldY };

      const cornerHandleHit = this.getCornerHandleAtPointer(pointer);
      if (cornerHandleHit) {
        const zoneId = cornerHandleHit.getData('zoneId');
        const cornerPosition = cornerHandleHit.getData('cornerPosition');
        if (zoneId && cornerPosition) {
          this.isZoneResizing = true;
          this.draggedZoneId = zoneId;
          this.resizingCorner = cornerPosition;
          if (this.callbacks.onZoneResizeStart) {
            this.callbacks.onZoneResizeStart(zoneId, cornerPosition, pointer.worldX, pointer.worldY);
          }
          return;
        }
      }

      const hitTestResults = this.scene.input.hitTestPointer(pointer);
      const hitSprite = this.getSpriteFromHitTest(hitTestResults);
      const agentId = hitSprite?.getData('agentId');

      if (agentId && this.isAgentSelected(agentId)) {
        this.isSpriteDragging = true;
        this.draggedAgentId = agentId;
        if (this.callbacks.onSpriteDragStart) {
          this.callbacks.onSpriteDragStart(agentId, pointer.worldX, pointer.worldY);
        }
        return;
      }

      if (agentId) {
        this.lastClickTime = Date.now();
        this.lastClickedAgentId = agentId;
        if (this.callbacks.onSelect) {
          this.callbacks.onSelect([agentId], isShiftDown);
        }
        return;
      }

      const taskZoneHit = this.getZoneFromHitTest(hitTestResults);
      if (taskZoneHit) {
        const zoneId = taskZoneHit.getData('zoneId') || taskZoneHit.getData('projectId');
        if (zoneId) {
          if (this.callbacks.onZoneClick) {
            this.callbacks.onZoneClick(zoneId);
          }
          
          this.pendingZoneDragId = zoneId;
          this.zoneDragStartPoint = { x: pointer.x, y: pointer.y };
          
          const now = Date.now();
          if (zoneId === this.lastClickedZoneId && 
              now - this.lastZoneClickTime < this.config.doubleClickThreshold) {
            if (this.callbacks.onZoneDoubleClick) {
              this.callbacks.onZoneDoubleClick(zoneId);
            }
            this.lastZoneClickTime = 0;
            this.lastClickedZoneId = null;
          } else {
            this.lastZoneClickTime = now;
            this.lastClickedZoneId = zoneId;
          }
          return;
        }
      }

      if (this.mode === 'zoneDrawing') {
        if (this.callbacks.onCheckZoneOverlap) {
          const testRect = new Phaser.Geom.Rectangle(pointer.worldX, pointer.worldY, 1, 1);
          if (this.callbacks.onCheckZoneOverlap(testRect)) {
            console.log('[StratixRTS] Cannot draw zone: overlaps existing zone');
            return;
          }
        }
        this.isZoneDrawing = true;
        if (this.callbacks.onZoneDrawStart) {
          this.callbacks.onZoneDrawStart(pointer.worldX, pointer.worldY);
        }
        return;
      }

      if (this.mode === 'command' && this.commandType) {
        return;
      }

      this.isDragging = true;
      if (this.callbacks.onDragStart) {
        this.callbacks.onDragStart(pointer.worldX, pointer.worldY);
      }
    }
  }

  private getSpriteFromHitTest(gameObjects: Phaser.GameObjects.GameObject[]): Phaser.GameObjects.GameObject | null {
    for (const obj of gameObjects) {
      const agentId = obj.getData('agentId');
      if (agentId) {
        return obj;
      }
      
      if (obj.parentContainer) {
        const parentAgentId = obj.parentContainer.getData('agentId');
        if (parentAgentId) {
          return obj.parentContainer;
        }
      }
    }
    return null;
  }

  private getZoneFromHitTest(gameObjects: Phaser.GameObjects.GameObject[]): Phaser.GameObjects.GameObject | null {
    for (const obj of gameObjects) {
      if (obj.getData('isCornerHandle') === true) {
        continue;
      }
      
      if (obj.getData('isTaskZone') === true || obj.getData('isProjectZone') === true || obj.getData('isBaseZone') === true) {
        return obj;
      }
      
      let current: Phaser.GameObjects.Container | null = obj.parentContainer;
      while (current) {
        if (current.getData('isTaskZone') === true || 
            current.getData('isProjectZone') === true || 
            current.getData('isBaseZone') === true ||
            current.getData('zoneId')) {
          return current;
        }
        current = current.parentContainer;
      }
    }
    
    if (this.callbacks.getTaskZoneAtPoint) {
      const pointer = this.scene.input.activePointer;
      const zoneId = this.callbacks.getTaskZoneAtPoint(pointer.worldX, pointer.worldY);
      if (zoneId) {
        const zone = this.scene.children.getFirst('zoneId', zoneId);
        if (zone) {
          return zone;
        }
      }
    }
    
    return null;
  }

  private getCornerHandleAtPointer(pointer: Phaser.Input.Pointer): Phaser.GameObjects.GameObject | null {
    const gameObjects = this.scene.input.hitTestPointer(pointer);
    
    for (const obj of gameObjects) {
      if (obj.getData('isCornerHandle') === true) {
        return obj;
      }
    }
    
    return null;
  }

  private getTaskZoneAtPointer(pointer: Phaser.Input.Pointer): Phaser.GameObjects.GameObject | null {
    const gameObjects = this.scene.input.hitTestPointer(pointer);
    return this.getZoneFromHitTest(gameObjects);
  }

  private isAgentSelected(agentId: string): boolean {
    const hitSprite = this.scene.children.list.find(
      obj => obj.getData('agentId') === agentId
    );
    return hitSprite?.getData('isSelected') === true;
  }

  private handlePointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.isEnabled) return;

    this.handleEdgeScroll(pointer);

    if (this.pendingZoneDragId && this.zoneDragStartPoint && pointer.leftButtonDown()) {
      const dx = pointer.x - this.zoneDragStartPoint.x;
      const dy = pointer.y - this.zoneDragStartPoint.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      
      if (distance >= this.zoneDragThreshold) {
        this.isZoneDragging = true;
        this.draggedZoneId = this.pendingZoneDragId;
        
        if (this.callbacks.onZoneDragStart) {
          this.callbacks.onZoneDragStart(this.pendingZoneDragId, pointer.worldX, pointer.worldY);
        }
        
        this.pendingZoneDragId = null;
        this.zoneDragStartPoint = null;
      }
    }

    if (this.isZoneResizing && pointer.leftButtonDown()) {
      if (this.callbacks.onZoneResizeUpdate) {
        this.callbacks.onZoneResizeUpdate(pointer.worldX, pointer.worldY);
      }
    } else if (this.isZoneDragging && pointer.leftButtonDown()) {
      if (this.callbacks.onZoneDragUpdate) {
        this.callbacks.onZoneDragUpdate(pointer.worldX, pointer.worldY);
      }
    } else if (this.isZoneDrawing && pointer.leftButtonDown()) {
      if (this.callbacks.onZoneDrawUpdate) {
        this.callbacks.onZoneDrawUpdate(pointer.worldX, pointer.worldY);
      }
    } else if (this.isSpriteDragging && pointer.leftButtonDown()) {
      if (this.callbacks.onSpriteDragUpdate) {
        this.callbacks.onSpriteDragUpdate(pointer.worldX, pointer.worldY);
      }
    } else if (this.isDragging && pointer.leftButtonDown()) {
      if (this.callbacks.onDragUpdate) {
        this.callbacks.onDragUpdate(pointer.worldX, pointer.worldY);
      }
    }
  }

  private handleEdgeScroll(pointer: Phaser.Input.Pointer): void {
    if (this.isDragging || this.isSpriteDragging || this.isZoneDrawing) return;
    
    const camera = this.scene.cameras.main;
    const { x, y } = pointer;
    const { width, height } = this.scene.scale;
    const margin = this.config.edgeScrollMargin;
    const speed = this.config.edgeScrollSpeed;

    let scrollX = 0;
    let scrollY = 0;

    if (x < margin) scrollX = -speed;
    else if (x > width - margin) scrollX = speed;

    if (y < margin) scrollY = -speed;
    else if (y > height - margin) scrollY = speed;

    if (scrollX !== 0 || scrollY !== 0) {
      camera.scrollX += scrollX;
      camera.scrollY += scrollY;
      
      if (this.callbacks.onCameraMove) {
        this.callbacks.onCameraMove(scrollX, scrollY);
      }
    }
  }

  private handlePointerUp(pointer: Phaser.Input.Pointer): void {
    if (!this.isEnabled) return;
    const isShiftDown = this.shiftKey.isDown;

    if (pointer.leftButtonReleased()) {
      if (this.pendingZoneDragId) {
        this.pendingZoneDragId = null;
        this.zoneDragStartPoint = null;
      }

      if (this.isZoneResizing) {
        this.isZoneResizing = false;
        this.draggedZoneId = null;
        this.resizingCorner = null;
        this.dragStartPoint = null;
        if (this.callbacks.onZoneResizeEnd) {
          this.callbacks.onZoneResizeEnd();
        }
        return;
      }

      if (this.isZoneDragging) {
        this.isZoneDragging = false;
        this.draggedZoneId = null;
        this.dragStartPoint = null;
        if (this.callbacks.onZoneDragEnd) {
          this.callbacks.onZoneDragEnd();
        }
        return;
      }

      if (this.isZoneDrawing) {
        this.isZoneDrawing = false;
        this.dragStartPoint = null;
        if (this.callbacks.onZoneDrawEnd) {
          this.callbacks.onZoneDrawEnd();
        }
        return;
      }

      if (this.mode === 'command' && this.commandType) {
        if (this.commandType === 'patrol') {
          if (this.callbacks.onPatrolCommand) {
            this.callbacks.onPatrolCommand(pointer.worldX, pointer.worldY);
          }
        } else if (this.callbacks.onCommand) {
          this.callbacks.onCommand({ x: pointer.worldX, y: pointer.worldY }, this.commandType);
        }
        this.commandType = null;
        this.mode = 'normal';
        return;
      }

      if (this.isSpriteDragging) {
        this.isSpriteDragging = false;
        this.draggedAgentId = null;
        this.dragStartPoint = null;
        if (this.callbacks.onSpriteDragEnd) {
          this.callbacks.onSpriteDragEnd();
        }
        return;
      }

      if (this.isDragging) {
        this.isDragging = false;
        if (this.callbacks.onDragEnd) {
          const bounds = this.callbacks.onDragEnd();
          if (bounds) {
            if (this.callbacks.onBoxSelect) {
              this.callbacks.onBoxSelect(bounds, isShiftDown);
            }
          } else {
            const hitSprite = this.getSpriteAtPointer(pointer);
            if (hitSprite) {
              const agentId = hitSprite.getData('agentId');
              const now = Date.now();
              
              if (agentId === this.lastClickedAgentId && 
                  now - this.lastClickTime < this.config.doubleClickThreshold) {
                if (this.callbacks.onSelectAllSameType) {
                  this.callbacks.onSelectAllSameType(agentId);
                }
              } else if (this.callbacks.onSelect) {
                this.callbacks.onSelect([agentId], isShiftDown);
              }
              
              this.lastClickTime = now;
              this.lastClickedAgentId = agentId;
            }
          }
        }
        this.dragStartPoint = null;
      }
    }

    if (pointer.rightButtonReleased()) {
      if (this.mode === 'zoneDrawing') {
        if (this.isZoneDrawing) {
          this.isZoneDrawing = false;
          this.dragStartPoint = null;
          if (this.callbacks.onZoneDrawCancel) {
            this.callbacks.onZoneDrawCancel();
          }
        }
        this.setMode('normal');
        return;
      }

      if (this.mode === 'command' && this.commandType) {
        this.commandType = null;
        this.mode = 'normal';
        if (this.callbacks.onCancelCommandMode) {
          this.callbacks.onCancelCommandMode();
        }
        return;
      }

      if (this.callbacks.onCommand) {
        this.callbacks.onCommand({ x: pointer.worldX, y: pointer.worldY });
      }
    }
  }

  private handleWheel(
    pointer: Phaser.Input.Pointer, 
    _gameObjects: Phaser.GameObjects.GameObject[], 
    deltaX: number, 
    deltaY: number
  ): void {
    if (!this.isEnabled) return;
    
    const camera = this.scene.cameras.main;
    const domEvent = pointer.event as WheelEvent | undefined;
    
    const isPinch = domEvent?.ctrlKey === true;
    
    if (isPinch) {
      const currentZoom = camera.zoom;
      const newZoom = Phaser.Math.Clamp(
        currentZoom - deltaY * this.config.pinchZoomSpeed,
        this.config.minZoom,
        this.config.maxZoom
      );
      camera.setZoom(newZoom);
      
      if (this.callbacks.onZoom) {
        this.callbacks.onZoom(newZoom);
      }
      return;
    }
    
    const isTrackpad = Math.abs(deltaX) > 0 || Math.abs(deltaY) < 50;
    
    if (isTrackpad && Math.abs(deltaX) > Math.abs(deltaY) * 0.5) {
      camera.scrollX -= deltaX * this.config.trackpadPanSpeed;
      camera.scrollY -= deltaY * this.config.trackpadPanSpeed;
      
      if (this.callbacks.onCameraMove) {
        this.callbacks.onCameraMove(-deltaX, -deltaY);
      }
      return;
    }
    
    const currentZoom = camera.zoom;
    const newZoom = Phaser.Math.Clamp(
      currentZoom - deltaY * this.config.zoomSpeed,
      this.config.minZoom,
      this.config.maxZoom
    );
    camera.setZoom(newZoom);
    
    if (this.callbacks.onZoom) {
      this.callbacks.onZoom(newZoom);
    }
  }

  private getSpriteAtPointer(pointer: Phaser.Input.Pointer): Phaser.GameObjects.GameObject | null {
    const gameObjects = this.scene.input.hitTestPointer(pointer);
    
    for (const obj of gameObjects) {
      const agentId = obj.getData('agentId');
      if (agentId) {
        return obj;
      }
      
      if (obj.parentContainer) {
        const parentAgentId = obj.parentContainer.getData('agentId');
        if (parentAgentId) {
          return obj.parentContainer;
        }
      }
    }
    
    return null;
  }

  private zoomCamera(delta: number): void {
    const camera = this.scene.cameras.main;
    const newZoom = Phaser.Math.Clamp(
      camera.zoom + delta,
      this.config.minZoom,
      this.config.maxZoom
    );
    camera.setZoom(newZoom);
    
    if (this.callbacks.onZoom) {
      this.callbacks.onZoom(newZoom);
    }
  }

  public update(): void {
    if (!this.isEnabled || !this.cursors) return;

    const camera = this.scene.cameras.main;
    let moveX = 0;
    let moveY = 0;

    if (this.cursors.left.isDown) moveX = -this.config.panSpeed;
    else if (this.cursors.right.isDown) moveX = this.config.panSpeed;

    if (this.cursors.up.isDown) moveY = -this.config.panSpeed;
    else if (this.cursors.down.isDown) moveY = this.config.panSpeed;

    if (moveX !== 0 || moveY !== 0) {
      camera.scrollX += moveX;
      camera.scrollY += moveY;
      
      if (this.callbacks.onCameraMove) {
        this.callbacks.onCameraMove(moveX, moveY);
      }
    }
  }

  public enable(): void {
    this.isEnabled = true;
  }

  public disable(): void {
    this.isEnabled = false;
  }

  public isInputEnabled(): boolean {
    return this.isEnabled;
  }

  public setMode(mode: InputMode): void {
    if (this.mode !== mode) {
      if (this.isZoneDrawing) {
        this.isZoneDrawing = false;
        this.dragStartPoint = null;
        if (this.callbacks.onZoneDrawCancel) {
          this.callbacks.onZoneDrawCancel();
        }
      }
      
      if (this.commandType) {
        this.commandType = null;
        if (this.callbacks.onCancelCommandMode) {
          this.callbacks.onCancelCommandMode();
        }
      }
      
      this.mode = mode;
      if (this.callbacks.onModeChange) {
        this.callbacks.onModeChange(mode);
      }
    }
  }

  public getMode(): InputMode {
    return this.mode;
  }

  public getCommandType(): CommandType | null {
    return this.commandType;
  }

  public isZoneDrawingMode(): boolean {
    return this.mode === 'zoneDrawing';
  }

  public isCurrentlyDrawingZone(): boolean {
    return this.mode === 'zoneDrawing' && this.isZoneDrawing;
  }

  public isInCommandMode(): boolean {
    return this.mode === 'command' && this.commandType !== null;
  }

  public toggleZoneDrawingMode(): void {
    const newMode = this.mode === 'zoneDrawing' ? 'normal' : 'zoneDrawing';
    this.setMode(newMode);
  }

  public setCommandMode(commandType: CommandType): void {
    this.commandType = commandType;
    this.mode = 'command';
    if (this.callbacks.onCommandMode) {
      this.callbacks.onCommandMode(commandType);
    }
  }

  public cancelCurrentMode(): void {
    this.handleEscape();
  }

  public destroy(): void {
    this.scene.input.off('pointerdown', this.boundHandlers.pointerdown);
    this.scene.input.off('pointermove', this.boundHandlers.pointermove);
    this.scene.input.off('pointerup', this.boundHandlers.pointerup);
    this.scene.input.off('wheel', this.boundHandlers.wheel);
  }
}
