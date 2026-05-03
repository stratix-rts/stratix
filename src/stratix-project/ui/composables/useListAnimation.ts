export const listTransitionProps = {
  name: 'list',
  enterActiveClass: 'list-enter-active',
  leaveActiveClass: 'list-leave-active',
  moveClass: 'list-move',
  enterFromClass: 'list-enter-from',
  leaveToClass: 'list-leave-to',
} as const

export function useListAnimation(): { listTransitionProps: typeof listTransitionProps } {
  return { listTransitionProps }
}
