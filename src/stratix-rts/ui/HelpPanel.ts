import { shortcutManager, type ShortcutDefinition, type ShortcutCategory, type ShortcutContext } from './ShortcutManager';

export interface HelpPanelConfig {
  width?: number;
  maxHeight?: number;
  position?: 'center' | 'right';
  showSearch?: boolean;
  showCategories?: boolean;
}

interface HelpPanelState {
  isVisible: boolean;
  searchQuery: string;
  selectedCategory: string | null;
  selectedIndex: number;
  allCategories: ShortcutCategory[];
  filteredShortcuts: ShortcutDefinition[];
}

type HelpPanelListener = () => void;

export class HelpPanel {
  private config: Required<HelpPanelConfig>;
  private state: HelpPanelState;
  private listeners: Set<HelpPanelListener> = new Set();
  private boundKeyHandler: ((event: KeyboardEvent) => void) | null = null;
  private unsubscribeContext: (() => void) | null = null;

  constructor(config?: HelpPanelConfig) {
    this.config = {
      width: config?.width ?? 600,
      maxHeight: config?.maxHeight ?? 500,
      position: config?.position ?? 'center',
      showSearch: config?.showSearch ?? true,
      showCategories: config?.showCategories ?? true,
    };

    this.state = {
      isVisible: false,
      searchQuery: '',
      selectedCategory: null,
      selectedIndex: 0,
      allCategories: [],
      filteredShortcuts: [],
    };

    this.initialize();
  }

  private initialize(): void {
    this.state.allCategories = shortcutManager.getCategories();
    this.updateFilteredShortcuts();
    this.setupKeyboardListeners();
  }

  private setupKeyboardListeners(): void {
    this.boundKeyHandler = (event: KeyboardEvent) => {
      if (!this.state.isVisible) {
        if (event.key === '?' || event.key === 'F1') {
          event.preventDefault();
          this.toggle();
        }
        return;
      }

      if (event.key === '/' && this.state.isVisible) {
        event.preventDefault();
        this.focusSearch();
        return;
      }

      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          this.hide();
          break;
        case 'ArrowUp':
          if (document.activeElement?.classList.contains('help-panel-search-input')) break;
          event.preventDefault();
          this.navigateUp();
          break;
        case 'ArrowDown':
          if (document.activeElement?.classList.contains('help-panel-search-input')) break;
          event.preventDefault();
          this.navigateDown();
          break;
        case 'Enter':
          if (document.activeElement?.classList.contains('help-panel-search-input')) break;
          event.preventDefault();
          this.executeSelected();
          break;
        case 'f':
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            this.focusSearch();
          }
          break;
      }
    };

    window.addEventListener('keydown', this.boundKeyHandler);
  }

  show(): void {
    this.state.isVisible = true;
    this.updateFilteredShortcuts();
    this.notifyListeners();
  }

  hide(): void {
    this.state.isVisible = false;
    this.state.searchQuery = '';
    this.state.selectedIndex = 0;
    this.notifyListeners();
  }

  toggle(): void {
    if (this.state.isVisible) {
      this.hide();
    } else {
      this.show();
    }
  }

  setSearchQuery(query: string): void {
    this.state.searchQuery = query;
    this.state.selectedIndex = 0;
    this.updateFilteredShortcuts();
    this.notifyListeners();
  }

  selectCategory(categoryId: string | null): void {
    this.state.selectedCategory = categoryId;
    this.state.selectedIndex = 0;
    this.updateFilteredShortcuts();
    this.notifyListeners();
  }

  private updateFilteredShortcuts(): void {
    let shortcuts: ShortcutDefinition[];

    if (this.state.searchQuery) {
      shortcuts = shortcutManager.searchShortcuts(this.state.searchQuery);
    } else if (this.state.selectedCategory) {
      shortcuts = shortcutManager.getShortcutsByCategory(this.state.selectedCategory);
    } else {
      shortcuts = shortcutManager.getAllShortcuts();
    }

    this.state.filteredShortcuts = shortcuts;
  }

  private navigateUp(): void {
    if (this.state.selectedIndex > 0) {
      this.state.selectedIndex--;
      this.notifyListeners();
    }
  }

  private navigateDown(): void {
    if (this.state.selectedIndex < this.state.filteredShortcuts.length - 1) {
      this.state.selectedIndex++;
      this.notifyListeners();
    }
  }

  private executeSelected(): void {
    const shortcut = this.state.filteredShortcuts[this.state.selectedIndex];
    if (shortcut?.action) {
      shortcut.action();
      this.hide();
    }
  }

  private focusSearch(): void {
    const searchInput = document.querySelector('.help-panel-search-input') as HTMLInputElement;
    if (searchInput) {
      searchInput.focus();
    }
  }

  private highlightMatch(text: string, query: string): string {
    if (!query) return text;
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return text.replace(new RegExp(`(${escaped})`, 'gi'), '<mark>$1</mark>');
  }

  isVisible(): boolean {
    return this.state.isVisible;
  }

  getState(): Readonly<HelpPanelState> {
    return { ...this.state };
  }

  getConfig(): Readonly<Required<HelpPanelConfig>> {
    return { ...this.config };
  }

  subscribe(listener: HelpPanelListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  getStyles(): string {
    return `
      .help-panel-overlay {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.85);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
        animation: fadeIn 0.2s ease-out;
      }

      .help-panel-container {
        background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%);
        border: 1px solid #2a2a3e;
        border-radius: 12px;
        width: ${this.config.width}px;
        max-width: 95vw;
        max-height: ${this.config.maxHeight}px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        animation: zoomIn 0.2s ease-out;
      }

      .help-panel-header {
        padding: 16px 20px;
        border-bottom: 1px solid #2a2a3e;
        display: flex;
        align-items: center;
        justify-content: space-between;
      }

      .help-panel-title {
        font-size: 18px;
        font-weight: 600;
        color: #00CCCC;
        margin: 0;
      }

      .help-panel-close {
        background: transparent;
        border: none;
        color: #a0a0a0;
        font-size: 24px;
        cursor: pointer;
        padding: 4px 8px;
        line-height: 1;
      }

      .help-panel-close:hover {
        color: #ff4444;
      }

      .help-panel-search {
        padding: 12px 20px;
        border-bottom: 1px solid #2a2a3e;
      }

      .help-panel-search input {
        width: 100%;
        padding: 10px 14px;
        background: #0d0d14;
        border: 1px solid #2a2a3e;
        border-radius: 8px;
        color: #ffffff;
        font-size: 14px;
        outline: none;
      }

      .help-panel-search input:focus {
        border-color: #00CCCC;
      }

      .help-panel-search input::placeholder {
        color: #6a6a8a;
      }

      .help-panel-body {
        display: flex;
        flex: 1;
        overflow: hidden;
      }

      .help-panel-categories {
        width: 160px;
        border-right: 1px solid #2a2a3e;
        overflow-y: auto;
        padding: 8px 0;
        flex-shrink: 0;
      }

      .help-panel-category {
        padding: 8px 16px;
        color: #a0a0a0;
        cursor: pointer;
        border-left: 2px solid transparent;
        transition: all 0.15s ease;
      }

      .help-panel-category:hover {
        color: #ffffff;
        background: rgba(0, 204, 204, 0.1);
      }

      .help-panel-category.active {
        color: #00CCCC;
        border-left-color: #00CCCC;
        background: rgba(0, 204, 204, 0.15);
      }

      .help-panel-content {
        flex: 1;
        overflow-y: auto;
        padding: 12px 20px;
      }

      .help-panel-section {
        margin-bottom: 16px;
      }

      .help-panel-section-title {
        font-size: 12px;
        font-weight: 600;
        color: #6a6a8a;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        margin-bottom: 8px;
        padding: 0 4px;
      }

      .help-panel-shortcut {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 8px 12px;
        border-radius: 6px;
        cursor: pointer;
        transition: background 0.15s ease;
      }

      .help-panel-shortcut:hover {
        background: rgba(255, 255, 255, 0.05);
      }

      .help-panel-shortcut.selected {
        background: rgba(0, 204, 204, 0.15);
      }

      .help-panel-shortcut-keys {
        display: flex;
        gap: 4px;
        flex-wrap: wrap;
      }

      .help-panel-key {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 28px;
        height: 24px;
        padding: 0 8px;
        background: #0d0d14;
        border: 1px solid #3a3a5e;
        border-radius: 4px;
        font-family: 'SF Mono', 'Monaco', monospace;
        font-size: 11px;
        color: #00CCCC;
        font-weight: 500;
      }

      .help-panel-shortcut-desc {
        color: #a0a0a0;
        font-size: 13px;
      }

      .help-panel-shortcut-desc mark,
      .help-panel-key mark {
        background: rgba(255, 200, 0, 0.3);
        color: #ffdd00;
        border-radius: 2px;
        padding: 0 2px;
      }

      .help-panel-empty {
        text-align: center;
        padding: 40px 20px;
        color: #6a6a8a;
      }

      .help-panel-footer {
        padding: 12px 20px;
        border-top: 1px solid #2a2a3e;
        display: flex;
        gap: 16px;
        justify-content: center;
      }

      .help-panel-hint {
        display: flex;
        align-items: center;
        gap: 6px;
        color: #6a6a8a;
        font-size: 12px;
      }

      .help-panel-hint kbd {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 22px;
        height: 20px;
        padding: 0 6px;
        background: #0d0d14;
        border: 1px solid #3a3a5e;
        border-radius: 3px;
        font-family: 'SF Mono', monospace;
        font-size: 10px;
        color: #a0a0a0;
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes zoomIn {
        from {
          opacity: 0;
          transform: scale(0.95);
        }
        to {
          opacity: 1;
          transform: scale(1);
        }
      }

      @media (max-width: 640px) {
        .help-panel-container {
          width: 100vw !important;
          max-width: 100vw;
          height: 100vh;
          max-height: 100vh;
          border-radius: 0;
        }

        .help-panel-categories {
          display: none;
        }
      }
    `;
  }

  render(): string {
    const { isVisible, searchQuery, selectedCategory, selectedIndex, allCategories, filteredShortcuts } = this.state;

    if (!isVisible) {
      return '';
    }

    const groupedShortcuts = this.groupShortcutsByCategory(filteredShortcuts);

    return `
      <style>${this.getStyles()}</style>
      <div class="help-panel-overlay" onclick="this.closest('.help-panel-overlay')?.querySelector('.help-panel-close')?.click()">
        <div class="help-panel-container" onclick="event.stopPropagation()">
          <div class="help-panel-header">
            <h2 class="help-panel-title">快捷键帮助</h2>
            <button class="help-panel-close" onclick="window.helpPanel?.hide()" aria-label="关闭">×</button>
          </div>
          
          ${this.config.showSearch ? `
            <div class="help-panel-search">
              <input
                type="text"
                class="help-panel-search-input"
                placeholder="搜索快捷键... (/)"
                value="${searchQuery}"
                oninput="window.helpPanel?.setSearchQuery(this.value)"
              />
            </div>
          ` : ''}
          
          <div class="help-panel-body">
            ${this.config.showCategories ? `
              <div class="help-panel-categories">
                <div 
                  class="help-panel-category ${!selectedCategory ? 'active' : ''}"
                  onclick="window.helpPanel?.selectCategory(null)"
                >
                  全部
                </div>
                ${allCategories.map(cat => `
                  <div 
                    class="help-panel-category ${selectedCategory === cat.id ? 'active' : ''}"
                    onclick="window.helpPanel?.selectCategory('${cat.id}')"
                  >
                    ${cat.name}
                  </div>
                `).join('')}
              </div>
            ` : ''}
            
            <div class="help-panel-content">
              ${filteredShortcuts.length === 0 ? `
                <div class="help-panel-empty">
                  没有找到匹配的快捷键
                </div>
              ` : Object.entries(groupedShortcuts).map(([category, shortcuts]) => `
                <div class="help-panel-section">
                  <div class="help-panel-section-title">${category}</div>
                  ${shortcuts.map((s, i) => `
                    <div
                      class="help-panel-shortcut ${filteredShortcuts.indexOf(s) === selectedIndex ? 'selected' : ''}"
                      data-index="${filteredShortcuts.indexOf(s)}"
                    >
                      <div class="help-panel-shortcut-desc">${this.highlightMatch(s.description, searchQuery)}</div>
                      <div class="help-panel-shortcut-keys">
                        ${s.keys.map(key => `
                          <span class="help-panel-key">${this.highlightMatch(shortcutManager.formatKeyDisplay(key), searchQuery)}</span>
                        `).join('')}
                      </div>
                    </div>
                  `).join('')}
                </div>
              `).join('')}
            </div>
          </div>
          
          <div class="help-panel-footer">
            <div class="help-panel-hint">
              <kbd>↑</kbd><kbd>↓</kbd> 导航
            </div>
            <div class="help-panel-hint">
              <kbd>Esc</kbd> 关闭
            </div>
            <div class="help-panel-hint">
              <kbd>Ctrl</kbd>+<kbd>F</kbd> 搜索
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private groupShortcutsByCategory(shortcuts: ShortcutDefinition[]): Record<string, ShortcutDefinition[]> {
    const grouped: Record<string, ShortcutDefinition[]> = {};
    const categories = this.state.allCategories;
    
    for (const category of categories) {
      const categoryShortcuts = shortcuts.filter(s => s.category === category.id);
      if (categoryShortcuts.length > 0) {
        grouped[category.name] = categoryShortcuts;
      }
    }
    
    return grouped;
  }

  mount(container: HTMLElement): void {
    const styleElement = document.createElement('style');
    styleElement.textContent = this.getStyles();
    document.head.appendChild(styleElement);

    const panelElement = document.createElement('div');
    panelElement.className = 'help-panel-wrapper';
    container.appendChild(panelElement);

    (window as any).helpPanel = this;

    this.subscribe(() => {
      panelElement.innerHTML = this.render();
    });

    panelElement.innerHTML = this.render();
  }

  destroy(): void {
    if (this.boundKeyHandler) {
      window.removeEventListener('keydown', this.boundKeyHandler);
      this.boundKeyHandler = null;
    }
    if (this.unsubscribeContext) {
      this.unsubscribeContext();
    }
    delete (window as any).helpPanel;
    this.listeners.clear();
  }
}