import { defineStore } from 'pinia';
import { ref, computed } from 'vue';

export type Theme = 'light' | 'dark' | 'auto';

export interface ToastItem {
  id: string;
  type: 'success' | 'error' | 'warning' | 'info';
  message: string;
  duration?: number;
}

export interface CommandLog {
  commandId: string;
  agentId: string;
  skillName: string;
  status: 'pending' | 'success' | 'failed';
  time: string;
  params?: Record<string, unknown>;
}

export const useUIStore = defineStore('ui', () => {
  // Sidebar state
  const sidebarOpen = ref(true);
  const sidebarWidth = ref(280);

  // Minimap state
  const minimapVisible = ref(true);
  const minimapScale = ref(0.15);

  // Modal states
  const showTaskModal = ref(false);
  const showChatModal = ref(false);
  const showCharacterCreator = ref(false);
  const showZonePanel = ref(false);
  const showProjectConfig = ref(false);
  const showDataExplorer = ref(false);

  // Theme
  const theme = ref<Theme>('auto');

  // Toasts
  const toasts = ref<ToastItem[]>([]);

  // Command logs
  const commandLogs = ref<CommandLog[]>([]);

  // Game state
  const isGameReady = ref(false);

  // Sound settings
  const soundEnabled = ref(true);
  const soundVolume = ref(0.5);

  // Computed
  const isDarkMode = computed(() => {
    if (theme.value === 'auto') {
      if (typeof window === 'undefined') return false;
      return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return theme.value === 'dark';
  });

  const recentCommandLogs = computed(() => commandLogs.value.slice(0, 20));

  // Sidebar actions
  function toggleSidebar(): void {
    sidebarOpen.value = !sidebarOpen.value;
  }

  function setSidebarOpen(open: boolean): void {
    sidebarOpen.value = open;
  }

  function setSidebarWidth(width: number): void {
    sidebarWidth.value = Math.max(200, Math.min(500, width));
  }

  // Minimap actions
  function toggleMinimap(): void {
    minimapVisible.value = !minimapVisible.value;
  }

  function setMinimapVisible(visible: boolean): void {
    minimapVisible.value = visible;
  }

  function setMinimapScale(scale: number): void {
    minimapScale.value = Math.max(0.05, Math.min(0.5, scale));
  }

  // Modal actions
  function openTaskModal(): void {
    showTaskModal.value = true;
  }

  function closeTaskModal(): void {
    showTaskModal.value = false;
  }

  function openChatModal(): void {
    showChatModal.value = true;
  }

  function closeChatModal(): void {
    showChatModal.value = false;
  }

  function openCharacterCreator(): void {
    showCharacterCreator.value = true;
  }

  function closeCharacterCreator(): void {
    showCharacterCreator.value = false;
  }

  function openZonePanel(): void {
    showZonePanel.value = true;
  }

  function closeZonePanel(): void {
    showZonePanel.value = false;
  }

  function toggleZonePanel(): void {
    showZonePanel.value = !showZonePanel.value;
  }

  function openProjectConfig(): void {
    showProjectConfig.value = true;
  }

  function closeProjectConfig(): void {
    showProjectConfig.value = false;
  }

  function openDataExplorer(): void {
    showDataExplorer.value = true;
  }

  function closeDataExplorer(): void {
    showDataExplorer.value = false;
  }

  // Theme actions
  function setTheme(newTheme: Theme): void {
    theme.value = newTheme;
  }

  // Toast actions
  const MAX_TOASTS = 10;

  function addToast(toast: Omit<ToastItem, 'id'>): string {
    const id = `toast_${crypto.randomUUID()}`;
    const newToast: ToastItem = { ...toast, id };

    // Trim oldest toasts if at limit
    if (toasts.value.length >= MAX_TOASTS) {
      toasts.value = toasts.value.slice(-MAX_TOASTS + 1);
    }

    toasts.value.push(newToast);

    // Auto-remove after duration
    const duration = toast.duration ?? 3000;
    if (duration > 0) {
      setTimeout(() => {
        removeToast(id);
      }, duration);
    }

    return id;
  }

  function removeToast(id: string): void {
    toasts.value = toasts.value.filter(t => t.id !== id);
  }

  function clearToasts(): void {
    toasts.value = [];
  }

  // Command log actions
  function addCommandLog(log: Omit<CommandLog, 'time'>): void {
    const newLog: CommandLog = {
      ...log,
      time: new Date().toLocaleTimeString()
    };
    commandLogs.value.unshift(newLog);
    if (commandLogs.value.length > 50) {
      commandLogs.value.pop();
    }
  }

  function updateCommandLogStatus(commandId: string, status: 'success' | 'failed'): void {
    const log = commandLogs.value.find(l => l.commandId === commandId);
    if (log) {
      log.status = status;
    }
  }

  function clearCommandLogs(): void {
    commandLogs.value = [];
  }

  // Game state
  function setGameReady(ready: boolean): void {
    isGameReady.value = ready;
  }

  // Sound settings
  function setSoundEnabled(enabled: boolean): void {
    soundEnabled.value = enabled;
  }

  function setSoundVolume(volume: number): void {
    soundVolume.value = Math.max(0, Math.min(1, volume));
  }

  return {
    // State
    sidebarOpen,
    sidebarWidth,
    minimapVisible,
    minimapScale,
    showTaskModal,
    showChatModal,
    showCharacterCreator,
    showZonePanel,
    showProjectConfig,
    showDataExplorer,
    theme,
    toasts,
    commandLogs,
    isGameReady,
    soundEnabled,
    soundVolume,

    // Computed
    isDarkMode,
    recentCommandLogs,

    // Sidebar actions
    toggleSidebar,
    setSidebarOpen,
    setSidebarWidth,

    // Minimap actions
    toggleMinimap,
    setMinimapVisible,
    setMinimapScale,

    // Modal actions
    openTaskModal,
    closeTaskModal,
    openChatModal,
    closeChatModal,
    openCharacterCreator,
    closeCharacterCreator,
    openZonePanel,
    closeZonePanel,
    toggleZonePanel,
    openProjectConfig,
    closeProjectConfig,
    openDataExplorer,
    closeDataExplorer,

    // Theme actions
    setTheme,

    // Toast actions
    addToast,
    removeToast,
    clearToasts,

    // Command log actions
    addCommandLog,
    updateCommandLogStatus,
    clearCommandLogs,

    // Game state
    setGameReady,

    // Sound settings
    setSoundEnabled,
    setSoundVolume,
  };
});
