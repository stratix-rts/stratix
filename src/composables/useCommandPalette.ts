import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useUIStore } from '@/stores/ui'

export type CommandCategory = 'agent' | 'zone' | 'task' | 'system' | 'navigation' | 'action' | 'view'

export interface Command {
  id: string
  name: string
  category: CommandCategory
  shortcut?: string
  icon?: string
  action: () => void
}

// Commands registry - shared across all instances
const COMMANDS_REGISTRY: ReadonlyArray<Command> = [
  // Navigation
  { id: 'nav-zones', name: 'Navigate to Zones', category: 'navigation', shortcut: 'G Z', icon: 'map', action: () => {} },
  { id: 'nav-agents', name: 'Navigate to Agents', category: 'navigation', shortcut: 'G A', icon: 'users', action: () => {} },
  { id: 'nav-tasks', name: 'Navigate to Tasks', category: 'navigation', shortcut: 'G T', icon: 'check-square', action: () => {} },
  { id: 'nav-logs', name: 'Navigate to Logs', category: 'navigation', shortcut: 'G L', icon: 'file-text', action: () => {} },
  { id: 'nav-settings', name: 'Navigate to Settings', category: 'navigation', icon: 'settings', action: () => {} },

  // Agent
  { id: 'agent-create', name: 'Create Agent', category: 'agent', shortcut: 'C A', icon: 'user-plus', action: () => {} },
  { id: 'agent-refresh', name: 'Refresh Agents', category: 'agent', shortcut: 'R', icon: 'refresh-cw', action: () => {} },
  { id: 'agent-dashboard', name: 'Open Agent Dashboard', category: 'agent', icon: 'layout', action: () => {} },

  // Zone
  { id: 'zone-create', name: 'Create Zone', category: 'zone', shortcut: 'C Z', icon: 'plus-circle', action: () => {} },
  { id: 'zone-panel', name: 'Open Zone Panel', category: 'zone', icon: 'map-pin', action: () => {} },

  // Task
  { id: 'task-create', name: 'Create Task', category: 'task', icon: 'plus', action: () => {} },
  { id: 'task-refresh', name: 'Refresh Tasks', category: 'task', icon: 'refresh-cw', action: () => {} },

  // System
  { id: 'system-theme', name: 'Toggle Theme', category: 'system', shortcut: 'T', icon: 'sun', action: () => {} },
  { id: 'system-sound', name: 'Toggle Sound', category: 'system', icon: 'volume-2', action: () => {} },
  { id: 'system-refresh', name: 'Refresh Data', category: 'system', shortcut: 'R', icon: 'refresh-cw', action: () => {} },

  // View
  { id: 'view-zoom-in', name: 'Zoom In', category: 'view', shortcut: '=', icon: 'zoom-in', action: () => {} },
  { id: 'view-zoom-out', name: 'Zoom Out', category: 'view', shortcut: '-', icon: 'zoom-out', action: () => {} },
  { id: 'view-reset-zoom', name: 'Reset Zoom', category: 'view', shortcut: '0', icon: 'maximize', action: () => {} },
  { id: 'view-3d', name: 'Toggle 3D View', category: 'view', icon: 'box', action: () => {} },
  { id: 'view-data-explorer', name: 'Open Data Explorer', category: 'view', shortcut: '⌘D', icon: 'database', action: () => {} },
]

// Shared singleton state
const isOpen = ref(false)
const query = ref('')
const selectedIndex = ref(0)

// Module-level open/close for global API
function _open() {
  isOpen.value = true
  query.value = ''
  selectedIndex.value = 0
  const uiStore = useUIStore()
  uiStore.openCommandPalette()
}

function _close() {
  isOpen.value = false
  const uiStore = useUIStore()
  uiStore.closeCommandPalette()
}

function _toggle() {
  isOpen.value ? _close() : _open()
}

// Category order and display names
const CATEGORY_ORDER: CommandCategory[] = ['navigation', 'agent', 'zone', 'task', 'system', 'view', 'action']
const CATEGORY_LABELS: Record<CommandCategory, string> = {
  navigation: 'Navigation',
  agent: 'Agent',
  zone: 'Zone',
  task: 'Task',
  system: 'System',
  view: 'View',
  action: 'Actions',
}

function fuzzyMatch(text: string, pattern: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerPattern = pattern.toLowerCase()
  let pi = 0
  for (let i = 0; i < lowerText.length && pi < lowerPattern.length; i++) {
    if (lowerText[i] === lowerPattern[pi]) pi++
  }
  return pi === lowerPattern.length
}

function getRecentCommandIds(): string[] {
  const uiStore = useUIStore()
  return uiStore.recentCommandIds
}

function addRecentCommandId(commandId: string): void {
  const uiStore = useUIStore()
  uiStore.addRecentCommand(commandId)
}

export function useCommandPalette() {
  const uiStore = useUIStore()

  const recentIds = computed(() => uiStore.recentCommandIds)

  const filteredCommands = computed(() => {
    if (!query.value) return [...COMMANDS_REGISTRY]
    return COMMANDS_REGISTRY.filter(cmd => fuzzyMatch(cmd.name, query.value))
  })

  const recentCommands = computed(() => {
    const recent = recentIds.value
      .map(id => COMMANDS_REGISTRY.find(c => c.id === id))
      .filter((c): c is Command => !!c)
    // Only show recent when no query
    if (!query.value) return recent
    return []
  })

  const groupedCommands = computed(() => {
    const groups: Record<string, Command[]> = {}

    // Add recent commands at top when no query
    if (recentCommands.value.length > 0 && !query.value) {
      groups['Recent'] = recentCommands.value
    }

    // Add filtered commands by category
    for (const cmd of filteredCommands.value) {
      const label = CATEGORY_LABELS[cmd.category]
      if (!groups[label]) groups[label] = []
      // Avoid duplicates in Recent
      if (!recentCommands.value.find(r => r.id === cmd.id)) {
        groups[label].push(cmd)
      }
    }

    // Ensure category order
    const ordered: Record<string, Command[]> = {}
    if (groups['Recent']) ordered['Recent'] = groups['Recent']
    for (const cat of CATEGORY_ORDER) {
      const label = CATEGORY_LABELS[cat]
      if (groups[label] && groups[label].length > 0) {
        ordered[label] = groups[label]
      }
    }

    return ordered
  })

  // Flat list for keyboard navigation
  const flatCommands = computed(() => {
    const flat: Command[] = []
    for (const commands of Object.values(groupedCommands.value)) {
      flat.push(...commands)
    }
    return flat
  })

  watch(flatCommands, (list) => {
    if (selectedIndex.value >= list.length) {
      selectedIndex.value = Math.max(0, list.length - 1)
    }
  })

  function selectCommand(cmd?: Command) {
    const command = cmd || flatCommands.value[selectedIndex.value]
    if (command) {
      addRecentCommandId(command.id)
      command.action()
      close()
    }
  }

  function open() {
    _open()
  }

  function close() {
    _close()
  }

  function toggle() {
    _toggle()
  }

  function navigateUp() {
    if (selectedIndex.value > 0) selectedIndex.value--
  }

  function navigateDown() {
    if (selectedIndex.value < flatCommands.value.length - 1) selectedIndex.value++
  }

  function resetSelection() {
    selectedIndex.value = 0
  }

  function handleKeydown(e: KeyboardEvent) {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
    const modKey = isMac ? e.metaKey : e.ctrlKey

    if (modKey && e.key === 'k') {
      e.preventDefault()
      toggle()
      return
    }

    if (!isOpen.value) return

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault()
        navigateUp()
        break
      case 'ArrowDown':
        e.preventDefault()
        navigateDown()
        break
      case 'Enter':
        e.preventDefault()
        selectCommand()
        break
      case 'Escape':
        e.preventDefault()
        close()
        break
    }
  }

  onMounted(() => window.addEventListener('keydown', handleKeydown))
  onUnmounted(() => window.removeEventListener('keydown', handleKeydown))

  return {
    isOpen,
    query,
    selectedIndex,
    filteredCommands,
    groupedCommands,
    flatCommands,
    selectCommand,
    open,
    close,
    toggle,
    navigateUp,
    navigateDown,
    resetSelection,
    CATEGORY_LABELS,
  }
}

// Global API for non-composable usage
export const commandPaletteAPI = {
  open: _open,
  close: _close,
  toggle: _toggle,
}
