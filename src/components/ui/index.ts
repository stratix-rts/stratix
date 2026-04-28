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
export { default as StratixLoading } from './StratixLoading.vue';
export { default as StratixEmpty } from './StratixEmpty.vue';

// 新增/补全组件
export { default as StratixBadge } from './StratixBadge.vue';
export { default as StratixTable } from './StratixTable.vue';
export { default as StratixTabs } from './StratixTabs.vue';
export { default as StratixAccordion } from './StratixAccordion.vue';
export { default as StratixAlert } from './StratixAlert.vue';
export { default as StratixDrawer } from './StratixDrawer.vue';
export { default as StratixBreadcrumb } from './StratixBreadcrumb.vue';
export { default as StratixSlider } from './StratixSlider.vue';
export { default as StratixPagination } from './StratixPagination.vue';

// Shared UI components for duplication abstraction
export { default as ButtonGroup } from './ButtonGroup.vue';
export { default as DataTable } from './DataTable.vue';
export { default as InfoItem } from './InfoItem.vue';
export { default as WarningBox } from './WarningBox.vue';

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

// Motion & Feedback System - New Components
export { default as StratixSkeleton } from './StratixSkeleton.vue';
export { default as ModalTransition } from './ModalTransition.vue';
export { default as PanelTransition } from './PanelTransition.vue';
export { default as ListTransition } from './ListTransition.vue';

// Motion & Feedback System - Composables
export { useFocusTrap } from '@/composables/useFocusTrap';
export { useKeyboardShortcuts } from '@/composables/useKeyboardShortcuts';
export { useNetworkStatus } from '@/composables/useNetworkStatus';
export { useGlobalLoading } from '@/composables/useGlobalLoading';
export { useClipboard } from '@/composables/useClipboard';
