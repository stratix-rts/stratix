export interface FocusableComponent {
  id: string;
  element: HTMLElement | Phaser.GameObjects.Container;
  role: string;
  label: string;
  description?: string;
  disabled?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
  onActivate?: () => void;
  parent?: string;
  children?: string[];
  tabIndex?: number;
}

export interface FocusEvent {
  type: 'focus' | 'blur' | 'activate';
  componentId: string;
  previousId?: string;
  timestamp: number;
}

export type FocusDirection = 'next' | 'previous' | 'up' | 'down' | 'left' | 'right';

export interface FocusManagerConfig {
  enableVisualIndicator?: boolean;
  enableAnnouncements?: boolean;
  wrapNavigation?: boolean;
  autoFocus?: boolean;
}

export class FocusManager {
  private static instance: FocusManager;
  private components = new Map<string, FocusableComponent>();
  private focusedId: string | null = null;
  private focusOrder: string[] = [];
  private listeners = new Set<(event: FocusEvent) => void>();
  private config: FocusManagerConfig;
  private rootElements = new Set<string>();
  private modalStack: string[] = [];

  private constructor(config: FocusManagerConfig = {}) {
    this.config = {
      enableVisualIndicator: true,
      enableAnnouncements: true,
      wrapNavigation: true,
      autoFocus: true,
      ...config,
    };

    this.setupKeyboardListeners();
  }

  static getInstance(config?: FocusManagerConfig): FocusManager {
    if (!FocusManager.instance) {
      FocusManager.instance = new FocusManager(config);
    }
    return FocusManager.instance;
  }

  static destroyInstance(): void {
    if (FocusManager.instance) {
      FocusManager.instance.destroy();
      FocusManager.instance = undefined as unknown as FocusManager;
    }
  }

  register(component: FocusableComponent): void {
    if (this.components.has(component.id)) {
      console.warn(`[FocusManager] Component "${component.id}" already registered`);
      return;
    }

    this.components.set(component.id, component);
    this.updateFocusOrder();

    if (component.element instanceof HTMLElement) {
      this.setupHTMLElement(component);
    }

    if (this.config.autoFocus && !this.focusedId && this.rootElements.has(component.id)) {
      this.focus(component.id);
    }
  }

  unregister(id: string): void {
    if (this.focusedId === id) {
      this.blur();
    }

    this.components.delete(id);
    this.rootElements.delete(id);
    this.updateFocusOrder();

    const modalIndex = this.modalStack.indexOf(id);
    if (modalIndex !== -1) {
      this.modalStack.splice(modalIndex, 1);
    }
  }

  focus(id: string): boolean {
    const component = this.components.get(id);
    if (!component || component.disabled) {
      return false;
    }

    const previousId = this.focusedId ?? undefined;

    if (previousId) {
      const previous = this.components.get(previousId);
      if (previous?.onBlur) {
        previous.onBlur();
      }
    }

    this.focusedId = id;

    if (component.element instanceof HTMLElement) {
      component.element.focus();
    }

    if (component.onFocus) {
      component.onFocus();
    }

    this.emitEvent({
      type: 'focus',
      componentId: id,
      previousId,
      timestamp: Date.now(),
    });

    return true;
  }

  blur(): void {
    if (!this.focusedId) return;

    const component = this.components.get(this.focusedId);
    if (component?.onBlur) {
      component.onBlur();
    }

    const previousId = this.focusedId ?? undefined;
    this.focusedId = null;

    this.emitEvent({
      type: 'blur',
      componentId: previousId,
      timestamp: Date.now(),
    });
  }

  moveFocus(direction: FocusDirection): string | null {
    if (!this.focusedId && this.focusOrder.length > 0) {
      const firstId = direction === 'previous' 
        ? this.focusOrder[this.focusOrder.length - 1]
        : this.focusOrder[0];
      this.focus(firstId);
      return firstId;
    }

    if (!this.focusedId) return null;

    const currentIndex = this.focusOrder.indexOf(this.focusedId);
    if (currentIndex === -1) return null;

    let nextIndex: number;

    switch (direction) {
      case 'next':
        nextIndex = currentIndex + 1;
        if (nextIndex >= this.focusOrder.length) {
          nextIndex = this.config.wrapNavigation ? 0 : this.focusOrder.length - 1;
        }
        break;

      case 'previous':
        nextIndex = currentIndex - 1;
        if (nextIndex < 0) {
          nextIndex = this.config.wrapNavigation ? this.focusOrder.length - 1 : 0;
        }
        break;

      case 'up':
      case 'down':
      case 'left':
      case 'right':
        nextIndex = this.findSpatialFocus(direction, currentIndex);
        if (nextIndex === -1) return null;
        break;

      default:
        return null;
    }

    const nextId = this.focusOrder[nextIndex];
    if (nextId && this.focus(nextId)) {
      return nextId;
    }

    return null;
  }

  activate(): void {
    if (!this.focusedId) return;

    const component = this.components.get(this.focusedId);
    if (!component || component.disabled) return;

    if (component.onActivate) {
      component.onActivate();
    }

    this.emitEvent({
      type: 'activate',
      componentId: this.focusedId,
      timestamp: Date.now(),
    });
  }

  getFocusedId(): string | null {
    return this.focusedId;
  }

  getComponent(id: string): FocusableComponent | undefined {
    return this.components.get(id);
  }

  getAllComponents(): FocusableComponent[] {
    return Array.from(this.components.values());
  }

  setAsRoot(id: string): void {
    this.rootElements.add(id);
  }

  pushModal(modalId: string): void {
    this.modalStack.push(modalId);
    this.focus(modalId);
  }

  popModal(): void {
    if (this.modalStack.length === 0) return;

    const modalId = this.modalStack.pop();
    if (modalId) {
      this.blur();
      
      if (this.modalStack.length > 0) {
        this.focus(this.modalStack[this.modalStack.length - 1]);
      }
    }
  }

  isInModal(): boolean {
    return this.modalStack.length > 0;
  }

  getCurrentModal(): string | undefined {
    return this.modalStack[this.modalStack.length - 1];
  }

  subscribe(listener: (event: FocusEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  updateComponent(id: string, updates: Partial<FocusableComponent>): void {
    const component = this.components.get(id);
    if (!component) return;

    Object.assign(component, updates);
    this.updateFocusOrder();
  }

  private setupKeyboardListeners(): void {
    document.addEventListener('keydown', this.handleKeyDown.bind(this));
  }

  private handleKeyDown(event: KeyboardEvent): void {
    if (event.defaultPrevented) return;

    switch (event.key) {
      case 'Tab':
        event.preventDefault();
        this.moveFocus(event.shiftKey ? 'previous' : 'next');
        break;

      case 'ArrowUp':
        event.preventDefault();
        this.moveFocus('up');
        break;

      case 'ArrowDown':
        event.preventDefault();
        this.moveFocus('down');
        break;

      case 'ArrowLeft':
        event.preventDefault();
        this.moveFocus('left');
        break;

      case 'ArrowRight':
        event.preventDefault();
        this.moveFocus('right');
        break;

      case 'Enter':
      case ' ':
        event.preventDefault();
        this.activate();
        break;

      case 'Escape':
        if (this.isInModal()) {
          event.preventDefault();
          this.popModal();
        }
        break;
    }
  }

  private setupHTMLElement(component: FocusableComponent): void {
    const element = component.element as HTMLElement;
    
    element.setAttribute('role', component.role);
    element.setAttribute('aria-label', component.label);
    
    if (component.description) {
      element.setAttribute('aria-describedby', `${component.id}-desc`);
    }
    
    if (component.disabled) {
      element.setAttribute('aria-disabled', 'true');
    }
    
    element.tabIndex = component.tabIndex ?? 0;
  }

  private updateFocusOrder(): void {
    this.focusOrder = Array.from(this.components.values())
      .filter(c => !c.disabled)
      .sort((a, b) => (a.tabIndex ?? 0) - (b.tabIndex ?? 0))
      .map(c => c.id);
  }

  private findSpatialFocus(direction: FocusDirection, currentIndex: number): number {
    const current = this.components.get(this.focusOrder[currentIndex]);
    if (!current || current.element instanceof HTMLElement) {
      return -1;
    }

    const currentBounds = this.getElementBounds(current.element);
    if (!currentBounds) return -1;

    let bestCandidate = -1;
    let bestDistance = Infinity;

    for (let i = 0; i < this.focusOrder.length; i++) {
      if (i === currentIndex) continue;

      const candidate = this.components.get(this.focusOrder[i]);
      if (!candidate || candidate.element instanceof HTMLElement) continue;

      const candidateBounds = this.getElementBounds(candidate.element);
      if (!candidateBounds) continue;

      if (this.isInDirection(currentBounds, candidateBounds, direction)) {
        const distance = this.calculateDistance(currentBounds, candidateBounds);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestCandidate = i;
        }
      }
    }

    return bestCandidate;
  }

  private getElementBounds(element: Phaser.GameObjects.Container): { x: number; y: number; width: number; height: number } | null {
    try {
      return {
        x: element.x,
        y: element.y,
        width: element.width,
        height: element.height,
      };
    } catch {
      return null;
    }
  }

  private isInDirection(
    from: { x: number; y: number; width: number; height: number },
    to: { x: number; y: number; width: number; height: number },
    direction: FocusDirection
  ): boolean {
    const fromCenterX = from.x + from.width / 2;
    const fromCenterY = from.y + from.height / 2;
    const toCenterX = to.x + to.width / 2;
    const toCenterY = to.y + to.height / 2;

    switch (direction) {
      case 'up':
        return toCenterY < fromCenterY;
      case 'down':
        return toCenterY > fromCenterY;
      case 'left':
        return toCenterX < fromCenterX;
      case 'right':
        return toCenterX > fromCenterX;
      default:
        return false;
    }
  }

  private calculateDistance(
    from: { x: number; y: number; width: number; height: number },
    to: { x: number; y: number; width: number; height: number }
  ): number {
    const fromCenterX = from.x + from.width / 2;
    const fromCenterY = from.y + from.height / 2;
    const toCenterX = to.x + to.width / 2;
    const toCenterY = to.y + to.height / 2;

    return Math.sqrt(
      Math.pow(toCenterX - fromCenterX, 2) + Math.pow(toCenterY - fromCenterY, 2)
    );
  }

  private emitEvent(event: FocusEvent): void {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('[FocusManager] Error in focus listener:', error);
      }
    });
  }

  destroy(): void {
    document.removeEventListener('keydown', this.handleKeyDown.bind(this));
    this.components.clear();
    this.focusOrder = [];
    this.listeners.clear();
    this.rootElements.clear();
    this.modalStack = [];
    this.focusedId = null;
  }
}

export const focusManager = FocusManager.getInstance();