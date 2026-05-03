import { createVNode, render, type VNode } from 'vue';

import StratixConfirmDialog from './StratixConfirmDialog.vue';

type ModalType = 'info' | 'success' | 'warning' | 'error' | 'confirm';

interface ModalOptions {
  title?: string;
  content?: string | VNode;
  okText?: string;
  cancelText?: string;
  icon?: string;
  closable?: boolean;
  maskClosable?: boolean;
  width?: string | number;
  showCancel?: boolean;
  okDanger?: boolean;
  onOk?: () => void | Promise<void>;
  onCancel?: () => void;
}

interface ModalResult {
  destroy: () => void;
  update: (options: Partial<ModalOptions>) => void;
}

interface ModalInstance {
  container: HTMLDivElement;
  props: Record<string, unknown>;
  destroy: () => void;
  update: (options: Partial<ModalOptions>) => void;
}

const modalInstances: ModalInstance[] = [];

function createModal(type: ModalType, options: ModalOptions): ModalResult {
  if (typeof document === 'undefined') {
    throw new Error('Modal cannot be created outside of a browser environment');
  }
  const container = document.createElement('div');
  document.body.appendChild(container);

  let resolved = false;
  let removeTimer: ReturnType<typeof setTimeout> | null = null;

  const props: Record<string, unknown> = {
    visible: true,
    type,
    title: options.title,
    content: options.content,
    okText: options.okText,
    cancelText: options.cancelText,
    icon: options.icon,
    showCancel: type === 'confirm' ? (options.showCancel ?? true) : false,
    okDanger: options.okDanger,
    'onUpdate:visible': (val: boolean) => {
      if (!val) destroy();
    },
    onOk: async () => {
      if (options.onOk) {
        try {
          await options.onOk();
        } catch (e) {
          console.error('Modal onOk error:', e);
        }
      }
      destroy();
    },
    onCancel: () => {
      if (options.onCancel) {
        options.onCancel();
      }
      destroy();
    },
  };
  
  const vnode = createVNode(StratixConfirmDialog, props);
  render(vnode, container);
  
  function destroy() {
    if (resolved) return;
    resolved = true;

    render(null, container);
    if (removeTimer) clearTimeout(removeTimer);
    removeTimer = setTimeout(() => {
      removeTimer = null;
      if (document.body.contains(container)) {
        document.body.removeChild(container);
      }
    }, 0);

    const index = modalInstances.findIndex(m => m.container === container);
    if (index > -1) {
      modalInstances.splice(index, 1);
    }
  }
  
  function update(newOptions: Partial<ModalOptions>) {
    Object.assign(props, {
      title: newOptions.title,
      content: newOptions.content,
      okText: newOptions.okText,
      cancelText: newOptions.cancelText,
      icon: newOptions.icon,
    });
    render(createVNode(StratixConfirmDialog, props), container);
  }
  
  const instance: ModalInstance = { container, props, destroy, update };
  modalInstances.push(instance);
  
  return { destroy, update };
}

export const Modal = {
  info: (options: ModalOptions): ModalResult => createModal('info', options),
  success: (options: ModalOptions): ModalResult => createModal('success', options),
  warning: (options: ModalOptions): ModalResult => createModal('warning', options),
  error: (options: ModalOptions): ModalResult => createModal('error', options),
  confirm: (options: ModalOptions): ModalResult => createModal('confirm', options),
  destroyAll: (): void => {
    modalInstances.forEach(instance => instance.destroy());
    modalInstances.length = 0;
  },
};

export type { ModalOptions, ModalResult };
