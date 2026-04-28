import { onUnmounted } from 'vue';

export interface ShortcutConfig {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
  handler: (e: KeyboardEvent) => void;
  description?: string;
}

interface RegisteredShortcut extends ShortcutConfig {
  _id: string;
}

const shortcuts = new Map<string, RegisteredShortcut>();

function normalizeKey(key: string): string {
  return key.toLowerCase();
}

function getShortcutId(config: Omit<ShortcutConfig, 'handler' | 'description'>): string {
  const parts: string[] = [];
  if (config.ctrl) parts.push('ctrl');
  if (config.meta) parts.push('meta');
  if (config.alt) parts.push('alt');
  if (config.shift) parts.push('shift');
  parts.push(normalizeKey(config.key));
  return parts.join('+');
}

function handleKeyDown(e: KeyboardEvent) {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.metaKey) parts.push('meta');
  if (e.altKey) parts.push('alt');
  if (e.shiftKey) parts.push('shift');
  parts.push(normalizeKey(e.key));

  const id = parts.join('+');
  const shortcut = shortcuts.get(id);
  if (shortcut) {
    e.preventDefault();
    shortcut.handler(e);
  }
}

let listenerAttached = false;

function ensureListener() {
  if (!listenerAttached) {
    window.addEventListener('keydown', handleKeyDown);
    listenerAttached = true;
  }
}

function removeListenerIfEmpty() {
  if (shortcuts.size === 0 && listenerAttached) {
    window.removeEventListener('keydown', handleKeyDown);
    listenerAttached = false;
  }
}

export function registerShortcut(config: ShortcutConfig): {
  unregister: () => void;
  conflict?: string;
} {
  const id = getShortcutId(config);

  let conflict: string | undefined;
  if (shortcuts.has(id)) {
    conflict = id;
  }

  shortcuts.set(id, { ...config, _id: id });
  ensureListener();

  return {
    unregister: () => {
      shortcuts.delete(id);
      removeListenerIfEmpty();
    },
    conflict,
  };
}

export function unregisterShortcut(
  config: Omit<ShortcutConfig, 'handler' | 'description'>
): void {
  const id = getShortcutId(config);
  shortcuts.delete(id);
  removeListenerIfEmpty();
}

export function useKeyboardShortcuts() {
  const registered: string[] = [];

  const localRegister = (config: ShortcutConfig) => {
    const result = registerShortcut(config);
    if (result.conflict) {
      console.warn(
        `[useKeyboardShortcuts] Shortcut conflict detected: "${result.conflict}"`
      );
    }
    registered.push(getShortcutId(config));
    return result;
  };

  const localUnregister = (config: Omit<ShortcutConfig, 'handler' | 'description'>) => {
    const id = getShortcutId(config);
    unregisterShortcut(config);
    const idx = registered.indexOf(id);
    if (idx > -1) registered.splice(idx, 1);
  };

  onUnmounted(() => {
    registered.forEach((id) => {
      shortcuts.delete(id);
    });
    removeListenerIfEmpty();
  });

  return {
    registerShortcut: localRegister,
    unregisterShortcut: localUnregister,
  };
}
