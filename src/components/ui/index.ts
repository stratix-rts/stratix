/**
 * Vue UI 基础组件导出
 */

export { default as StratixButton } from './StratixButton.vue';
export { default as StratixInput } from './StratixInput.vue';
export { default as StratixPanel } from './StratixPanel.vue';
export { default as StratixLabel } from './StratixLabel.vue';
export { default as StratixFormField } from './StratixFormField.vue';
export { default as StratixTextarea } from './StratixTextarea.vue';
export { default as StratixSelect } from './StratixSelect.vue';
export { default as StratixCheckbox } from './StratixCheckbox.vue';
export { default as StratixRadio } from './StratixRadio.vue';
export { default as StratixSwitch } from './StratixSwitch.vue';
export { default as StratixDropdown } from './StratixDropdown.vue';
export { default as SvgIcon } from './SvgIcon.vue';

export { default as StratixModal } from './StratixModal.vue';
export { default as StratixConfirmDialog } from './StratixConfirmDialog.vue';

// Dropdown 类型定义
export interface DropdownOption {
  label: string;
  value: string | number;
  icon?: string;
  color?: string;
  disabled?: boolean;
  divided?: boolean;
}
export { Modal, type ModalOptions, type ModalResult } from './modal-api';

export { 
  provideSizeContext, 
  useSizeContext, 
  useIconSize, 
  type SizeVariant,
  type SizeContext,
} from '@/design-system/composables/useSizeContext';

export {
  useZIndexManager,
  resetZIndexCounter,
  getZIndexCounter,
  type ZIndexManager,
} from '@/design-system/composables/useZIndexManager';

// Toast system
export { default as ToastContainer } from './ToastContainer.vue';
export type { ToastItem, ToastOptions } from './ToastItem';
export { toastService } from './ToastService';
export { useToast } from '@/composables/useToast';
