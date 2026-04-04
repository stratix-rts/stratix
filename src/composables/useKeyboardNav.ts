import { ref, computed, onMounted, onUnmounted, type Ref } from 'vue'

// =============================================================================
// Types
// =============================================================================

export interface ShortcutHandler {
  key: string
  handler: (e: KeyboardEvent) => void
  description?: string
}

export interface SpatialNavDirection {
  x: number
  y: number
}

export interface KeyboardNavOptions {
  /** Initial focused index */
  initialIndex?: number
  /** Whether vim mode (j/k for up/down) is enabled by default */
  vimMode?: boolean
  /** Whether to trap Tab key in modal mode */
  trapTab?: boolean
  /** Callback when an item is selected via Enter */
  onSelect?: (index: number) => void
  /** Callback when navigation is cancelled via Escape */
  onCancel?: () => void
  /** List length for wraparound calculations */
  listLength?: Ref<number> | number
}

export interface KeyboardNavState {
  focusedIndex: Ref<number>
  isNavigating: Ref<boolean>
  isModalMode: Ref<boolean>
  isVimMode: Ref<boolean>
  focusRingEnabled: Ref<boolean>
}

// =============================================================================
// Pure Functions (Framework-Agnostic, Testable)
// =============================================================================

/**
 * Parse a shortcut string like 'ctrl+k' or 'cmd+shift+f' into components
 */
export function parseShortcut(shortcut: string): {
  modifiers: string[]
  key: string
} {
  const parts = shortcut.toLowerCase().split('+').map(s => s.trim())
  const modifiers = parts.slice(0, -1)
  const key = parts[parts.length - 1]
  return { modifiers, key }
}

/**
 * Check if a KeyboardEvent matches a shortcut definition
 */
export function matchesShortcut(
  event: KeyboardEvent,
  shortcut: string,
  platform: string = navigator.platform
): boolean {
  const { modifiers, key } = parseShortcut(shortcut)
  const isMac = platform.toUpperCase().includes('MAC')

  // Normalize key - handle special cases
  const eventKey = event.key.toLowerCase()
  const normalizedKey = normalizeKey(eventKey, event.code)

  // Check if the main key matches
  if (normalizedKey !== key && eventKey !== key) {
    return false
  }

  // Check modifiers
  const requiredModifiers = new Set(modifiers)
  const eventModifiers = new Set<string>()

  if (event.ctrlKey) eventModifiers.add('ctrl')
  if (event.metaKey) eventModifiers.add(isMac ? 'cmd' : 'meta')
  if (event.altKey) eventModifiers.add('alt')
  if (event.shiftKey) eventModifiers.add('shift')

  // Handle platform-specific modifier equivalence
  if (isMac && modifiers.includes('ctrl')) {
    // On Mac, ctrl+key also matches when meta+key is pressed for some shortcuts
    // But we keep them separate for precision
  }

  // Check all required modifiers are present
  for (const mod of requiredModifiers) {
    if (mod === 'cmd' && !isMac) {
      // 'cmd' on non-Mac doesn't make sense
      if (!eventModifiers.has('meta')) return false
    } else if (!eventModifiers.has(mod)) {
      return false
    }
  }

  return true
}

/**
 * Normalize key representation for cross-platform compatibility
 */
function normalizeKey(key: string, code: string): string {
  // Special key mappings
  const keyMap: Record<string, string> = {
    ' ': 'space',
    'arrowup': 'up',
    'arrowdown': 'down',
    'arrowleft': 'left',
    'arrowright': 'right',
    'escape': 'esc',
    'enter': 'enter',
    'tab': 'tab',
    'backspace': 'backspace',
    'delete': 'delete',
    'home': 'home',
    'end': 'end',
    'pageup': 'pageup',
    'pagedown': 'pagedown',
  }

  return keyMap[key] || key
}

/**
 * Calculate next index with wraparound
 */
export function getNextIndex(
  currentIndex: number,
  listLength: number,
  direction: 'up' | 'down' | 'left' | 'right',
  spatialLayout?: { columns: number }
): number {
  if (listLength <= 0) return 0

  switch (direction) {
    case 'up':
      return currentIndex <= 0 ? listLength - 1 : currentIndex - 1
    case 'down':
      return currentIndex >= listLength - 1 ? 0 : currentIndex + 1
    case 'left':
      return currentIndex <= 0 ? listLength - 1 : currentIndex - 1
    case 'right':
      return currentIndex >= listLength - 1 ? 0 : currentIndex + 1
    default:
      return currentIndex
  }
}

/**
 * Calculate spatial navigation index based on grid layout
 */
export function getSpatialNextIndex(
  currentIndex: number,
  direction: 'up' | 'down' | 'left' | 'right',
  columns: number,
  totalItems: number
): number {
  if (totalItems <= 0) return 0

  const row = Math.floor(currentIndex / columns)
  const col = currentIndex % columns
  const totalRows = Math.ceil(totalItems / columns)

  switch (direction) {
    case 'up': {
      if (row > 0) {
        // Move to same column in previous row
        const prevRow = row - 1
        const prevIndex = prevRow * columns + col
        return prevIndex < totalItems ? prevIndex : totalItems - 1
      }
      // Wrap to last row
      const lastRow = totalRows - 1
      const lastRowItems = totalItems - lastRow * columns
      return lastRow * columns + Math.min(col, lastRowItems - 1)
    }
    case 'down': {
      if (row < totalRows - 1) {
        // Move to same column in next row
        const nextRow = row + 1
        const nextIndex = nextRow * columns + col
        return nextIndex < totalItems ? nextIndex : totalItems - 1
      }
      // Wrap to first row
      return col < totalItems ? col : 0
    }
    case 'left': {
      if (col > 0) {
        return currentIndex - 1
      }
      // Wrap to end of previous row
      if (row > 0) {
        const prevRow = row - 1
        const prevRowItems = Math.min(columns, totalItems - prevRow * columns)
        return prevRow * columns + prevRowItems - 1
      }
      // Wrap to last item
      return totalItems - 1
    }
    case 'right': {
      const currentRowItems = Math.min(columns, totalItems - row * columns)
      if (col < currentRowItems - 1) {
        return currentIndex + 1
      }
      // Wrap to start of next row
      if (row < totalRows - 1) {
        return (row + 1) * columns
      }
      // Wrap to first item
      return 0
    }
    default:
      return currentIndex
  }
}

/**
 * Handle Tab trap in modal dialogs - cycles through focusable elements
 */
export function getTabTrapNextIndex(
  currentIndex: number,
  focusableElements: HTMLElement[],
  reverse: boolean
): number {
  if (focusableElements.length === 0) return 0

  const step = reverse ? -1 : 1
  let nextIndex = currentIndex + step

  // Wrap around
  if (nextIndex < 0) {
    nextIndex = focusableElements.length - 1
  } else if (nextIndex >= focusableElements.length) {
    nextIndex = 0
  }

  return nextIndex
}

// =============================================================================
// Composable
// =============================================================================

// Global shortcut registry
const globalShortcuts = new Map<string, ShortcutHandler>()

/**
 * Keyboard navigation composable for Stratix app
 *
 * Features:
 * - Arrow key navigation with wraparound
 * - Enter to select, Escape to close
 * - Tab trap for modal dialogs
 * - Global shortcut registry
 * - Visual focus ring indicator
 * - Vim mode (j/k for up/down)
 * - Spatial navigation for canvas/zone view
 */
export function useKeyboardNav(options: KeyboardNavOptions = {}): KeyboardNavState & {
  registerShortcut: (shortcut: string, handler: (e: KeyboardEvent) => void, description?: string) => void
  unregisterShortcut: (shortcut: string) => void
  enableVimMode: () => void
  disableVimMode: () => void
  setModalMode: (enabled: boolean) => void
  setListLength: (length: number) => void
  navigate: (direction: 'up' | 'down' | 'left' | 'right') => void
  reset: () => void
  focusElement: (element: HTMLElement | null) => void
} {
  const focusedIndex = ref(options.initialIndex ?? 0)
  const isNavigating = ref(false)
  const isModalMode = ref(false)
  const isVimMode = ref(options.vimMode ?? false)
  const focusRingEnabled = ref(false)
  const listLengthRef = ref(typeof options.listLength === 'number' ? options.listLength : 0)

  // Track the last focused element for focus ring management
  let lastFocusedElement: HTMLElement | null = null

  // Track shortcuts registered by this instance for cleanup
  const registeredShortcuts = new Set<string>()

  function setListLength(length: number) {
    listLengthRef.value = length
  }

  function navigate(direction: 'up' | 'down' | 'left' | 'right') {
    const length = listLengthRef.value
    if (length <= 0) return

    isNavigating.value = true
    focusedIndex.value = getNextIndex(focusedIndex.value, length, direction)
  }

  function handleGlobalKeydown(event: KeyboardEvent) {
    // Check global shortcuts first
    for (const [shortcut, { handler }] of globalShortcuts) {
      if (matchesShortcut(event, shortcut)) {
        event.preventDefault()
        handler(event)
        return
      }
    }

    // Handle navigation keys only when not in modal mode with tab trap
    if (isModalMode.value) {
      // In modal mode, Tab cycles focus
      if (event.key === 'Tab') {
        event.preventDefault()
        // Tab trap is handled by focus management
        return
      }
    }

    // Vim mode: j/k for down/up
    if (isVimMode.value) {
      if (event.key === 'j' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        navigate('down')
        return
      }
      if (event.key === 'k' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        navigate('up')
        return
      }
    }

    // Arrow key navigation
    switch (event.key) {
      case 'ArrowUp':
        event.preventDefault()
        navigate('up')
        break
      case 'ArrowDown':
        event.preventDefault()
        navigate('down')
        break
      case 'ArrowLeft':
        event.preventDefault()
        navigate('left')
        break
      case 'ArrowRight':
        event.preventDefault()
        navigate('right')
        break
      case 'Enter':
        event.preventDefault()
        if (options.onSelect) {
          options.onSelect(focusedIndex.value)
        }
        break
      case 'Escape':
        event.preventDefault()
        isModalMode.value = false
        if (options.onCancel) {
          options.onCancel()
        }
        break
    }
  }

  function registerShortcut(
    shortcut: string,
    handler: (e: KeyboardEvent) => void,
    description?: string
  ) {
    const normalizedShortcut = shortcut.toLowerCase()
    globalShortcuts.set(normalizedShortcut, { key: shortcut, handler, description })
    registeredShortcuts.add(normalizedShortcut)
  }

  function unregisterShortcut(shortcut: string) {
    const normalizedShortcut = shortcut.toLowerCase()
    globalShortcuts.delete(normalizedShortcut)
  }

  function enableVimMode() {
    isVimMode.value = true
  }

  function disableVimMode() {
    isVimMode.value = false
  }

  function setModalMode(enabled: boolean) {
    isModalMode.value = enabled
  }

  function reset() {
    focusedIndex.value = options.initialIndex ?? 0
    isNavigating.value = false
  }

  function focusElement(element: HTMLElement | null) {
    // Remove focus ring from previous element
    if (lastFocusedElement && lastFocusedElement !== element) {
      lastFocusedElement.classList.remove('keyboard-focus-ring')
    }

    if (element) {
      element.classList.add('keyboard-focus-ring')
      lastFocusedElement = element
    }
    focusRingEnabled.value = element !== null
  }

  // Lifecycle
  onMounted(() => {
    window.addEventListener('keydown', handleGlobalKeydown)
  })

  onUnmounted(() => {
    window.removeEventListener('keydown', handleGlobalKeydown)

    // Cleanup focus ring
    if (lastFocusedElement) {
      lastFocusedElement.classList.remove('keyboard-focus-ring')
    }

    // Unregister shortcuts registered by this instance
    for (const shortcut of registeredShortcuts) {
      globalShortcuts.delete(shortcut)
    }
    registeredShortcuts.clear()
  })

  return {
    // State
    focusedIndex,
    isNavigating,
    isModalMode,
    isVimMode,
    focusRingEnabled,
    // Methods
    registerShortcut,
    unregisterShortcut,
    enableVimMode,
    disableVimMode,
    setModalMode,
    setListLength,
    navigate,
    reset,
    focusElement,
  }
}

// =============================================================================
// CSS for Focus Ring (can be injected or used via class)
// =============================================================================

/**
 * CSS for keyboard focus ring indicator
 * Add this to your global styles or component styles:
 *
 * .keyboard-focus-ring {
 *   outline: 2px solid #3b82f6;
 *   outline-offset: 2px;
 *   box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.3);
 * }
 *
 * .keyboard-focus-ring--active {
 *   background-color: rgba(59, 130, 246, 0.1);
 * }
 */
