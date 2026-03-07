import { shortcutManager, type ActiveShortcut, type ShortcutContext } from './ShortcutManager';

export interface ShortcutBarConfig {
  position?: 'bottom' | 'top';
  align?: 'left' | 'center' | 'right';
  maxShortcuts?: number;
  autoHide?: boolean;
  hideDelay?: number;
  showOnContextChange?: boolean;
}

interface ShortcutBarState {
  visible: boolean;
  shortcuts: ActiveShortcut[];
  fadeOut: boolean;
}

type ShortcutBarListener = () => void;

export class ShortcutBar {
  private config: Required<ShortcutBarConfig>;
  private state: ShortcutBarState;
  private listeners: Set<ShortcutBarListener> = new Set();
  private hideTimeout: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeManager: (() => void) | null = null;
  private unsubscribeContext: (() => void) | null = null;
  private container: HTMLElement | null = null;

  constructor(config?: ShortcutBarConfig) {
    this.config = {
      position: config?.position ?? 'bottom',
      align: config?.align ?? 'left',
      maxShortcuts: config?.maxShortcuts ?? 8,
      autoHide: config?.autoHide ?? false,
      hideDelay: config?.hideDelay ?? 3000,
      showOnContextChange: config?.showOnContextChange ?? true,
    };

    this.state = {
      visible: true,
      shortcuts: [],
      fadeOut: false,
    };

    this.initialize();
  }

  private initialize(): void {
    this.updateShortcuts();
    
    this.unsubscribeManager = shortcutManager.subscribe(() => {
      this.updateShortcuts();
    });

    this.unsubscribeContext = shortcutManager.onContextChange((context: ShortcutContext) => {
      if (this.config.showOnContextChange) {
        this.updateShortcuts();
        if (this.config.autoHide) {
          this.resetHideTimer();
        }
      }
    });
  }

  private updateShortcuts(): void {
    const activeShortcuts = shortcutManager.getActiveShortcuts();
    this.state.shortcuts = activeShortcuts.slice(0, this.config.maxShortcuts);
    this.notifyListeners();
  }

  private resetHideTimer(): void {
    this.clearHideTimer();
    this.state.fadeOut = false;
    this.state.visible = true;
    
    this.hideTimeout = setTimeout(() => {
      this.state.fadeOut = true;
      this.notifyListeners();
      
      setTimeout(() => {
        this.state.visible = false;
        this.notifyListeners();
      }, 300);
    }, this.config.hideDelay);
  }

  private clearHideTimer(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
      this.hideTimeout = null;
    }
  }

  show(): void {
    this.clearHideTimer();
    this.state.visible = true;
    this.state.fadeOut = false;
    this.notifyListeners();
  }

  hide(): void {
    this.clearHideTimer();
    this.state.visible = false;
    this.state.fadeOut = false;
    this.notifyListeners();
  }

  toggle(): void {
    if (this.state.visible) {
      this.hide();
    } else {
      this.show();
    }
  }

  isVisible(): boolean {
    return this.state.visible;
  }

  getState(): Readonly<ShortcutBarState> {
    return { ...this.state };
  }

  getConfig(): Readonly<Required<ShortcutBarConfig>> {
    return { ...this.config };
  }

  subscribe(listener: ShortcutBarListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  getStyles(): string {
    const positionStyles = this.config.position === 'bottom' 
      ? 'bottom: 0;' 
      : 'top: 0;';
    
    const alignStyles = {
      left: 'left: 0;',
      center: 'left: 50%; transform: translateX(-50%);',
      right: 'right: 0;',
    }[this.config.align];

    return `
      .shortcut-bar-container {
        position: fixed;
        ${positionStyles}
        ${alignStyles}
        z-index: 9999;
        pointer-events: none;
        padding: 8px 16px;
        transition: opacity 0.3s ease, transform 0.3s ease;
      }

      .shortcut-bar-container.hidden {
        opacity: 0;
        transform: translateY(${this.config.position === 'bottom' ? '10px' : '-10px'});
      }

      .shortcut-bar-container.fade-out {
        opacity: 0;
      }

      .shortcut-bar {
        display: flex;
        gap: 12px;
        align-items: center;
        padding: 8px 16px;
        background: rgba(13, 13, 20, 0.95);
        border: 1px solid rgba(42, 42, 62, 0.8);
        border-radius: 8px;
        backdrop-filter: blur(8px);
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
      }

      .shortcut-bar-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 8px;
        border-radius: 4px;
        transition: background 0.15s ease;
      }

      .shortcut-bar-item:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .shortcut-bar-key {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 24px;
        height: 22px;
        padding: 0 6px;
        background: linear-gradient(180deg, #1a1a2e 0%, #0d0d14 100%);
        border: 1px solid #3a3a5e;
        border-radius: 4px;
        font-family: 'SF Mono', 'Monaco', monospace;
        font-size: 11px;
        color: #00CCCC;
        font-weight: 500;
        text-shadow: 0 1px 1px rgba(0, 0, 0, 0.5);
      }

      .shortcut-bar-desc {
        font-size: 12px;
        color: #a0a0a0;
        white-space: nowrap;
      }

      .shortcut-bar-divider {
        width: 1px;
        height: 20px;
        background: rgba(42, 42, 62, 0.6);
        margin: 0 4px;
      }

      .shortcut-bar-context {
        display: flex;
        align-items: center;
        gap: 4px;
        padding: 4px 10px;
        background: rgba(0, 204, 204, 0.1);
        border: 1px solid rgba(0, 204, 204, 0.3);
        border-radius: 4px;
        font-size: 11px;
        color: #00CCCC;
        font-weight: 500;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }

      @media (max-width: 768px) {
        .shortcut-bar {
          padding: 6px 12px;
          gap: 8px;
        }

        .shortcut-bar-item {
          padding: 3px 6px;
        }

        .shortcut-bar-desc {
          font-size: 11px;
        }

        .shortcut-bar-context {
          display: none;
        }
      }
    `;
  }

  render(): string {
    const { visible, shortcuts, fadeOut } = this.state;

    if (!visible || shortcuts.length === 0) {
      return '';
    }

    const currentContext = shortcutManager.getContext();

    return `
      <div class="shortcut-bar-container ${!visible ? 'hidden' : ''} ${fadeOut ? 'fade-out' : ''}">
        <div class="shortcut-bar">
          ${currentContext !== 'global' ? `
            <div class="shortcut-bar-context">
              ${currentContext}
            </div>
            <div class="shortcut-bar-divider"></div>
          ` : ''}
          ${shortcuts.map((shortcut, index) => `
            <div class="shortcut-bar-item">
              <span class="shortcut-bar-key">${shortcut.displayText}</span>
              <span class="shortcut-bar-desc">${shortcut.definition.description}</span>
            </div>
            ${index < shortcuts.length - 1 ? '<div class="shortcut-bar-divider"></div>' : ''}
          `).join('')}
        </div>
      </div>
    `;
  }

  mount(container: HTMLElement): void {
    this.container = container;

    const styleElement = document.createElement('style');
    styleElement.textContent = this.getStyles();
    document.head.appendChild(styleElement);

    const barElement = document.createElement('div');
    barElement.className = 'shortcut-bar-wrapper';
    container.appendChild(barElement);

    this.subscribe(() => {
      barElement.innerHTML = this.render();
    });

    barElement.innerHTML = this.render();
  }

  destroy(): void {
    if (this.hideTimeout) {
      clearTimeout(this.hideTimeout);
    }
    if (this.unsubscribeManager) {
      this.unsubscribeManager();
    }
    if (this.unsubscribeContext) {
      this.unsubscribeContext();
    }
    this.listeners.clear();
    this.container = null;
  }
}