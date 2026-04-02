export interface ShortcutDefinition {
  id: string;
  keys: string[];
  description: string;
  category: string;
  context?: string;
  action?: () => void;
  enabled?: boolean | (() => boolean);
  priority?: number;
}

export interface ShortcutCategory {
  id: string;
  name: string;
  icon?: string;
  order: number;
}

export interface ActiveShortcut {
  definition: ShortcutDefinition;
  displayText: string;
}

export type ShortcutContext = 
  | 'global'
  | 'zoneDrawing'
  | 'selection'
  | 'command'
  | 'camera'
  | 'editor';

export class ShortcutManager {
  private static instance: ShortcutManager;
  private shortcuts = new Map<string, ShortcutDefinition>();
  private categories = new Map<string, ShortcutCategory>();
  private currentContext: ShortcutContext = 'global';
  private contextListeners: Set<(context: ShortcutContext) => void> = new Set();
  private keyBindings = new Map<string, Set<string>>();
  private listeners: Set<() => void> = new Set();
  private enabled = true;

  private constructor() {
    this.initializeCategories();
    this.initializeDefaultShortcuts();
  }

  static getInstance(): ShortcutManager {
    if (!ShortcutManager.instance) {
      ShortcutManager.instance = new ShortcutManager();
    }
    return ShortcutManager.instance;
  }

  static destroyInstance(): void {
    if (ShortcutManager.instance) {
      ShortcutManager.instance.destroy();
      ShortcutManager.instance = undefined as unknown as ShortcutManager;
    }
  }

  private initializeCategories(): void {
    this.registerCategory({ id: 'general', name: '常规', order: 1 });
    this.registerCategory({ id: 'selection', name: '选择', order: 2 });
    this.registerCategory({ id: 'camera', name: '镜头', order: 3 });
    this.registerCategory({ id: 'zones', name: 'Zone操作', order: 4 });
    this.registerCategory({ id: 'units', name: '单位控制', order: 5 });
    this.registerCategory({ id: 'groups', name: '控制组', order: 6 });
    this.registerCategory({ id: 'help', name: '帮助', order: 7 });
  }

  private initializeDefaultShortcuts(): void {
    this.register({
      id: 'help',
      keys: ['?', 'F1'],
      description: '显示帮助面板',
      category: 'help',
      context: 'global',
      priority: 100,
    });

    this.register({
      id: 'undo',
      keys: ['Ctrl+Z'],
      description: '撤销',
      category: 'general',
      context: 'global',
      priority: 90,
    });

    this.register({
      id: 'redo',
      keys: ['Ctrl+Y', 'Ctrl+Shift+Z'],
      description: '重做',
      category: 'general',
      context: 'global',
      priority: 89,
    });

    this.register({
      id: 'select-all',
      keys: ['Ctrl+A'],
      description: '全选',
      category: 'selection',
      context: 'global',
      priority: 80,
    });

    this.register({
      id: 'delete',
      keys: ['Delete', 'Backspace'],
      description: '删除选中对象',
      category: 'selection',
      context: 'selection',
      priority: 79,
    });

    this.register({
      id: 'duplicate',
      keys: ['Ctrl+D'],
      description: '复制选中对象',
      category: 'selection',
      context: 'selection',
      priority: 78,
    });

    this.register({
      id: 'deselect',
      keys: ['Escape'],
      description: '取消选择/取消当前操作',
      category: 'general',
      context: 'global',
      priority: 95,
    });

    this.register({
      id: 'zoom-in',
      keys: ['+', '='],
      description: '放大',
      category: 'camera',
      context: 'global',
      priority: 50,
    });

    this.register({
      id: 'zoom-out',
      keys: ['-', '_'],
      description: '缩小',
      category: 'camera',
      context: 'global',
      priority: 49,
    });

    this.register({
      id: 'center-view',
      keys: ['Space'],
      description: '居中视图',
      category: 'camera',
      context: 'global',
      priority: 48,
    });

    this.register({
      id: 'save-state',
      keys: ['Ctrl+S'],
      description: '保存状态',
      category: 'general',
      context: 'global',
      priority: 95,
    });

    this.register({
      id: 'camera-up',
      keys: ['↑', 'W'],
      description: '镜头上移',
      category: 'camera',
      context: 'camera',
      priority: 48,
    });

    this.register({
      id: 'camera-down',
      keys: ['↓', 'S'],
      description: '镜头下移',
      category: 'camera',
      context: 'camera',
      priority: 47,
    });

    this.register({
      id: 'camera-left',
      keys: ['←', 'A'],
      description: '镜头左移',
      category: 'camera',
      context: 'camera',
      priority: 46,
    });

    this.register({
      id: 'camera-right',
      keys: ['→', 'D'],
      description: '镜头右移',
      category: 'camera',
      context: 'camera',
      priority: 45,
    });

    this.register({
      id: 'toggle-zone-mode',
      keys: ['Z'],
      description: '切换Zone绘制模式',
      category: 'zones',
      context: 'global',
      priority: 70,
    });

    this.register({
      id: 'cancel-zone',
      keys: ['Escape', '右键'],
      description: '取消Zone绘制',
      category: 'zones',
      context: 'zoneDrawing',
      priority: 69,
    });

    this.register({
      id: 'move-command',
      keys: ['右键', 'M'],
      description: '移动命令',
      category: 'units',
      context: 'command',
      priority: 60,
    });

    this.register({
      id: 'attack-command',
      keys: ['A'],
      description: '攻击命令',
      category: 'units',
      context: 'command',
      priority: 59,
    });

    this.register({
      id: 'attack-move',
      keys: ['Shift+A'],
      description: '攻击移动',
      category: 'units',
      context: 'command',
      priority: 58,
    });

    this.register({
      id: 'stop-command',
      keys: ['S'],
      description: '停止命令',
      category: 'units',
      context: 'command',
      priority: 57,
    });

    this.register({
      id: 'patrol-command',
      keys: ['P'],
      description: '巡逻命令',
      category: 'units',
      context: 'command',
      priority: 56,
    });

    this.register({
      id: 'hold-position',
      keys: ['H'],
      description: '原地待命',
      category: 'units',
      context: 'command',
      priority: 55,
    });

    for (let i = 1; i <= 9; i++) {
      this.register({
        id: `select-group-${i}`,
        keys: [`${i}`],
        description: `选择控制组 ${i}`,
        category: 'groups',
        context: 'global',
        priority: 30 + (9 - i),
      });

      this.register({
        id: `create-group-${i}`,
        keys: [`Ctrl+${i}`],
        description: `创建控制组 ${i}`,
        category: 'groups',
        context: 'selection',
        priority: 20 + (9 - i),
      });
    }

    this.register({
      id: 'box-select',
      keys: ['左键拖拽'],
      description: '框选单位',
      category: 'selection',
      context: 'global',
      priority: 85,
    });

    this.register({
      id: 'add-to-selection',
      keys: ['Shift+点击'],
      description: '添加到选择',
      category: 'selection',
      context: 'global',
      priority: 84,
    });

    this.register({
      id: 'double-click-select',
      keys: ['双击'],
      description: '选择所有同类单位',
      category: 'selection',
      context: 'global',
      priority: 83,
    });
  }

  register(definition: ShortcutDefinition): void {
    if (this.shortcuts.has(definition.id)) {
      console.warn(`[ShortcutManager] Shortcut "${definition.id}" already registered, overwriting`);
    }

    this.shortcuts.set(definition.id, definition);

    for (const key of definition.keys) {
      const normalizedKey = this.normalizeKey(key);
      if (!this.keyBindings.has(normalizedKey)) {
        this.keyBindings.set(normalizedKey, new Set());
      }
      this.keyBindings.get(normalizedKey)!.add(definition.id);
    }

    this.notifyListeners();
  }

  unregister(id: string): void {
    const definition = this.shortcuts.get(id);
    if (!definition) return;

    for (const key of definition.keys) {
      const normalizedKey = this.normalizeKey(key);
      const bindingSet = this.keyBindings.get(normalizedKey);
      if (bindingSet) {
        bindingSet.delete(id);
        if (bindingSet.size === 0) {
          this.keyBindings.delete(normalizedKey);
        }
      }
    }

    this.shortcuts.delete(id);
    this.notifyListeners();
  }

  registerCategory(category: ShortcutCategory): void {
    this.categories.set(category.id, category);
    this.notifyListeners();
  }

  getCategories(): ShortcutCategory[] {
    return Array.from(this.categories.values()).sort((a, b) => a.order - b.order);
  }

  getShortcutsByCategory(categoryId: string): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values())
      .filter(s => s.category === categoryId)
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  getAllShortcuts(): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values())
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  getShortcutsByContext(context: ShortcutContext): ShortcutDefinition[] {
    return Array.from(this.shortcuts.values())
      .filter(s => s.context === context || s.context === 'global')
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  getActiveShortcuts(): ActiveShortcut[] {
    const contextShortcuts = this.getShortcutsByContext(this.currentContext);
    
    return contextShortcuts
      .filter(s => {
        if (typeof s.enabled === 'function') {
          return s.enabled();
        }
        return s.enabled !== false;
      })
      .slice(0, 8)
      .map(definition => ({
        definition,
        displayText: this.formatKeyDisplay(definition.keys[0]),
      }));
  }

  setContext(context: ShortcutContext): void {
    if (this.currentContext !== context) {
      this.currentContext = context;
      this.contextListeners.forEach(listener => listener(context));
      this.notifyListeners();
    }
  }

  getContext(): ShortcutContext {
    return this.currentContext;
  }

  onContextChange(listener: (context: ShortcutContext) => void): () => void {
    this.contextListeners.add(listener);
    return () => this.contextListeners.delete(listener);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  findConflicts(): Map<string, string[]> {
    const conflicts = new Map<string, string[]>();
    const keyToShortcuts = new Map<string, string[]>();

    for (const [id, definition] of Array.from(this.shortcuts.entries())) {
      for (const key of definition.keys) {
        const normalizedKey = this.normalizeKey(key);
        if (!keyToShortcuts.has(normalizedKey)) {
          keyToShortcuts.set(normalizedKey, []);
        }
        keyToShortcuts.get(normalizedKey)!.push(id);
      }
    }

    for (const [key, ids] of Array.from(keyToShortcuts.entries())) {
      if (ids.length > 1) {
        conflicts.set(key, ids);
      }
    }

    return conflicts;
  }

  formatKeyDisplay(key: string): string {
    return key
      .replace('Ctrl', '⌃')
      .replace('Shift', '⇧')
      .replace('Alt', '⌥')
      .replace('Meta', '⌘')
      .replace('ArrowUp', '↑')
      .replace('ArrowDown', '↓')
      .replace('ArrowLeft', '←')
      .replace('ArrowRight', '→')
      .replace('+', ' + ');
  }

  searchShortcuts(query: string): ShortcutDefinition[] {
    const lowerQuery = query.toLowerCase();
    return Array.from(this.shortcuts.values())
      .filter(s => 
        s.description.toLowerCase().includes(lowerQuery) ||
        s.keys.some(k => k.toLowerCase().includes(lowerQuery)) ||
        s.category.toLowerCase().includes(lowerQuery)
      )
      .sort((a, b) => (b.priority || 0) - (a.priority || 0));
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    this.notifyListeners();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  getShortcut(id: string): ShortcutDefinition | undefined {
    return this.shortcuts.get(id);
  }

  private normalizeKey(key: string): string {
    return key.toLowerCase()
      .replace(/\s+/g, '')
      .replace('ctrl', 'Ctrl')
      .replace('shift', 'Shift')
      .replace('alt', 'Alt')
      .replace('meta', 'Meta');
  }

  private notifyListeners(): void {
    this.listeners.forEach(listener => listener());
  }

  destroy(): void {
    this.shortcuts.clear();
    this.categories.clear();
    this.keyBindings.clear();
    this.listeners.clear();
    this.contextListeners.clear();
  }
}

export const shortcutManager = ShortcutManager.getInstance();