import { ref, computed, onMounted, onUnmounted } from 'vue'

export interface Command {
  id: string
  name: string
  category: 'navigation' | 'action' | 'view'
  shortcut?: string
  action: () => void
}

const isOpen = ref(false)
const query = ref('')
const selectedIndex = ref(0)

// Readonly commands registry - prevent mutation at module level
const COMMANDS_REGISTRY: ReadonlyArray<Command> = [
  { id: 'nav-zones', name: 'Navigate to Zones', category: 'navigation', shortcut: 'G Z', action: () => {} },
  { id: 'nav-agents', name: 'Navigate to Agents', category: 'navigation', shortcut: 'G A', action: () => {} },
  { id: 'nav-tasks', name: 'Navigate to Tasks', category: 'navigation', shortcut: 'G T', action: () => {} },
  { id: 'nav-logs', name: 'Navigate to Logs', category: 'navigation', shortcut: 'G L', action: () => {} },
  { id: 'action-create-zone', name: 'Create Zone', category: 'action', shortcut: 'C Z', action: () => {} },
  { id: 'action-create-agent', name: 'Create Agent', category: 'action', shortcut: 'C A', action: () => {} },
  { id: 'view-theme', name: 'Toggle Theme', category: 'view', shortcut: 'T', action: () => {} },
  { id: 'view-zoom-in', name: 'Zoom In', category: 'view', shortcut: '=', action: () => {} },
  { id: 'view-zoom-out', name: 'Zoom Out', category: 'view', shortcut: '-', action: () => {} },
  { id: 'view-reset-zoom', name: 'Reset Zoom', category: 'view', shortcut: '0', action: () => {} },
  { id: 'nav-settings', name: 'Navigate to Settings', category: 'navigation', action: () => {} },
  { id: 'action-refresh', name: 'Refresh', category: 'action', shortcut: 'R', action: () => {} },
]

function fuzzyMatch(text: string, pattern: string): boolean {
  const lowerText = text.toLowerCase()
  const lowerPattern = pattern.toLowerCase()
  let pi = 0
  for (let i = 0; i < lowerText.length && pi < lowerPattern.length; i++) {
    if (lowerText[i] === lowerPattern[pi]) pi++
  }
  return pi === lowerPattern.length
}

// Filtered commands derived from module-level query state
const filteredCommands = computed(() => {
  if (!query.value) return COMMANDS_REGISTRY
  return COMMANDS_REGISTRY.filter(cmd => fuzzyMatch(cmd.name, query.value))
})

function selectCommand() {
  const cmd = filteredCommands.value[selectedIndex.value]
  if (cmd) {
    cmd.action()
    close()
  }
}

function open() {
  isOpen.value = true
  query.value = ''
  selectedIndex.value = 0
}

function close() {
  isOpen.value = false
}

function toggle() {
  isOpen.value ? close() : open()
}

function navigateUp() {
  if (selectedIndex.value > 0) selectedIndex.value--
}

function navigateDown() {
  if (selectedIndex.value < filteredCommands.value.length - 1) selectedIndex.value++
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

export function useCommandPalette() {
  return {
    isOpen,
    query,
    selectedIndex,
    filteredCommands,
    selectCommand,
    open,
    close,
    toggle,
    navigateUp,
    navigateDown,
  }
}
