import type { CSSProperties } from 'vue'

export const panelTransitionProps = {
  name: 'panel',
  enterActiveClass: 'panel-enter-active',
  leaveActiveClass: 'panel-leave-active',
  enterFromClass: 'panel-enter-from',
  leaveToClass: 'panel-leave-to',
} as const

export const panelTransitionStyles: CSSProperties = {
  '--panel-duration': '200ms',
  '--panel-easing': 'ease',
}

export function usePanelTransition(): { panelTransitionProps: typeof panelTransitionProps; panelTransitionStyles: CSSProperties } {
  return { panelTransitionProps, panelTransitionStyles }
}
