import type { CSSProperties } from 'vue'

export const panelTransitionProps = {
  name: 'panel',
  enterActiveClass: 'panel-enter-active',
  leaveActiveClass: 'panel-leave-active',
  enterFromClass: 'panel-enter-from',
  leaveToClass: 'panel-leave-to',
}

export const panelTransitionStyles: CSSProperties = {
  '--panel-duration': '200ms',
  '--panel-easing': 'ease',
}

export function usePanelTransition() {
  return { panelTransitionProps, panelTransitionStyles }
}
