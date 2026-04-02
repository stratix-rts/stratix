export const listTransitionProps = {
  name: 'list',
  enterActiveClass: 'list-enter-active',
  leaveActiveClass: 'list-leave-active',
  moveClass: 'list-move',
  enterFromClass: 'list-enter-from',
  leaveToClass: 'list-leave-to',
}

export function useListAnimation() {
  return { listTransitionProps }
}
