<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, toRef, nextTick, type CSSProperties } from 'vue';
import { useZIndexManager } from '@/design-system/composables/useZIndexManager';
import { provideSizeContext, type SizeVariant } from '@/design-system/composables/useSizeContext';
import { ModalBaseConfig, POSITION_CONFIG, type ModalPosition } from '@/design-system/components/vue/modal';
import { getCurrentTheme, getToken } from '@/design-system/config';
import StratixButton from './StratixButton.vue';
import SvgIcon from './SvgIcon.vue';
import { useModalState } from '@/composables/useModalState';

interface Props {
  visible: boolean;
  title?: string;
  width?: string | number;
  height?: string | number;
  size?: SizeVariant;
  position?: ModalPosition;
  maskClosable?: boolean;
  closable?: boolean;
  closeIcon?: string;
  keyboard?: boolean;
  draggable?: boolean;
  resizable?: boolean;
  destroyOnClose?: boolean;
  mask?: boolean;
  maskStyle?: CSSProperties;
  bodyStyle?: CSSProperties;
  headerStyle?: CSSProperties;
  footerStyle?: CSSProperties;
  loading?: boolean;
  confirmLoading?: boolean;
  footer?: boolean;
  okText?: string;
  cancelText?: string;
  wrapClassName?: string;
  zIndex?: number;
}

const props = withDefaults(defineProps<Props>(), {
  visible: false,
  size: 'md',
  position: 'center',
  maskClosable: true,
  closable: true,
  closeIcon: 'x',
  keyboard: true,
  draggable: false,
  resizable: false,
  destroyOnClose: false,
  mask: true,
  footer: false,
  okText: '确定',
  cancelText: '取消',
});

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'close': [];
  'ok': [];
  'cancel': [];
  'afterClose': [];
  'afterOpen': [];
}>();

const { acquire, release } = useZIndexManager();
const { openModal, closeModal } = useModalState();
const internalZIndex = ref(3000);

provideSizeContext(toRef(props, 'size'));

const modalRef = ref<HTMLElement | null>(null);
const isDragging = ref(false);
const isResizing = ref(false);
const dragOffset = ref({ x: 0, y: 0 });
const dragPosition = ref({ x: 0, y: 0 });
const internalVisible = ref(false);
const shouldRender = ref(false);
const resizeSize = ref({ width: 0, height: 0 });
const resizeStart = ref({ x: 0, y: 0, width: 0, height: 0 });
const focusableElements = ref<HTMLElement[]>([]);

const positionConfig = computed(() => POSITION_CONFIG[props.position]);
const sizeConfig = computed(() => ModalBaseConfig.size[props.size]);

const isDrawer = computed(() => positionConfig.value.isDrawer === true);

const transitionName = computed(() => {
  const animation = positionConfig.value.animation;
  return `stratix-modal-${animation}`;
});

const headerStyleResolved = computed(() => {
  const theme = getCurrentTheme();
  const baseStyle = (theme === 'cyberpunk' || theme === 'minimal')
    ? ModalBaseConfig.header.gradient
    : ModalBaseConfig.header.solid;
  
  return {
    ...baseStyle,
    ...props.headerStyle,
  };
});

const bodyStyleResolved = computed<CSSProperties>(() => {
  const basePadding = sizeConfig.value.padding;
  const hPadding = `calc(${basePadding} * 1.5)`;
  return {
    paddingTop: basePadding,
    paddingBottom: basePadding,
    paddingLeft: hPadding,
    paddingRight: hPadding,
  };
});

const modalStyle = computed<CSSProperties>(() => {
  const style: CSSProperties = {};
  
  if (props.width) {
    style.width = typeof props.width === 'number' ? `${props.width}px` : props.width;
  } else if (isDrawer.value) {
    style.width = ModalBaseConfig.drawer.width;
  } else {
    style.width = sizeConfig.value.width;
  }
  
  if (props.height) {
    style.height = typeof props.height === 'number' ? `${props.height}px` : props.height;
  } else if (isDrawer.value) {
    style.height = ModalBaseConfig.drawer.height;
  } else if (sizeConfig.value.height) {
    style.height = sizeConfig.value.height;
  }
  
  if (resizeSize.value.width > 0) {
    style.width = `${resizeSize.value.width}px`;
  }
  if (resizeSize.value.height > 0) {
    style.height = `${resizeSize.value.height}px`;
  }
  
  if (sizeConfig.value.maxWidth) {
    style.maxWidth = sizeConfig.value.maxWidth;
  }
  if (sizeConfig.value.maxHeight) {
    style.maxHeight = sizeConfig.value.maxHeight;
  }
  
  style.borderRadius = props.size === 'fullscreen' 
    ? '0' 
    : (isDrawer.value 
      ? (props.position === 'left' ? '0 12px 12px 0' : '12px 0 0 12px')
      : ModalBaseConfig.style.borderRadius);
  
  if (props.draggable && (dragPosition.value.x || dragPosition.value.y)) {
    style.transform = `translate(${dragPosition.value.x}px, ${dragPosition.value.y}px)`;
  }
  
  return style;
});

const zIndexResolved = computed(() => {
  return props.zIndex ?? internalZIndex.value;
});

watch(() => props.visible, (newVal) => {
  if (newVal) {
    internalZIndex.value = acquire();
    shouldRender.value = true;
    setTimeout(() => {
      internalVisible.value = true;
    }, 0);
    document.body.style.overflow = 'hidden';
    openModal();
    nextTick(() => {
      updateFocusableElements();
      trapFocus();
    });
  } else {
    internalVisible.value = false;
    closeModal();
  }
}, { immediate: true });

const handleClose = () => {
  emit('update:visible', false);
  emit('close');
};

const handleOk = () => {
  emit('ok');
};

const handleCancel = () => {
  emit('cancel');
  handleClose();
};

const handleAfterClose = () => {
  release();
  document.body.style.overflow = '';
  dragPosition.value = { x: 0, y: 0 };
  resizeSize.value = { width: 0, height: 0 };
  if (props.destroyOnClose) {
    shouldRender.value = false;
  }
  emit('afterClose');
};

const handleAfterOpen = () => {
  emit('afterOpen');
};

const handleMaskClick = (e: MouseEvent) => {
  if (!props.maskClosable) return;
  if (e.target === e.currentTarget) {
    handleClose();
  }
};

const stopPropagation = (e: Event) => {
  e.stopPropagation();
};

const updateFocusableElements = () => {
  if (!modalRef.value) return;
  focusableElements.value = Array.from(
    modalRef.value.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    )
  ).filter((el) => {
    const htmlEl = el as HTMLElement;
    return !('disabled' in htmlEl && (htmlEl as any).disabled);
  }) as HTMLElement[];
};

const trapFocus = () => {
  if (focusableElements.value.length > 0) {
    focusableElements.value[0].focus();
  }
};

const handleKeydown = (e: KeyboardEvent) => {
  if (props.keyboard && e.key === 'Escape') {
    handleClose();
    return;
  }
  
  if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey) {
    const activeEl = document.activeElement as HTMLElement;
    if (activeEl?.tagName === 'TEXTAREA') return;
    
    const primaryBtn = modalRef.value?.querySelector('.stratix-modal__footer .stratix-btn--primary') as HTMLElement;
    if (primaryBtn && props.footer) {
      e.preventDefault();
      primaryBtn.click();
      return;
    }
  }
  
  if (e.key === 'Tab') {
    if (focusableElements.value.length === 0) return;
    
    const firstEl = focusableElements.value[0];
    const lastEl = focusableElements.value[focusableElements.value.length - 1];
    const activeEl = document.activeElement;
    
    if (e.shiftKey) {
      if (activeEl === firstEl) {
        e.preventDefault();
        lastEl.focus();
      }
    } else {
      if (activeEl === lastEl) {
        e.preventDefault();
        firstEl.focus();
      }
    }
  }
};

const handleDragStart = (e: MouseEvent) => {
  if (!props.draggable || !modalRef.value) return;
  
  const header = modalRef.value.querySelector('.stratix-modal__header');
  if (!header?.contains(e.target as Node)) return;
  
  isDragging.value = true;
  const rect = modalRef.value.getBoundingClientRect();
  dragOffset.value = {
    x: e.clientX - rect.left,
    y: e.clientY - rect.top,
  };
  
  document.addEventListener('mousemove', handleDragMove);
  document.addEventListener('mouseup', handleDragEnd);
  e.preventDefault();
};

const handleDragMove = (e: MouseEvent) => {
  if (!isDragging.value || !modalRef.value) return;
  
  const x = e.clientX - dragOffset.value.x;
  const y = e.clientY - dragOffset.value.y;
  
  const maxX = window.innerWidth - modalRef.value.offsetWidth;
  const maxY = window.innerHeight - modalRef.value.offsetHeight;
  
  dragPosition.value = {
    x: Math.max(-maxX / 2, Math.min(x, maxX / 2)),
    y: Math.max(0, Math.min(y, maxY)),
  };
};

const handleDragEnd = () => {
  isDragging.value = false;
  document.removeEventListener('mousemove', handleDragMove);
  document.removeEventListener('mouseup', handleDragEnd);
};

const handleResizeStart = (e: MouseEvent) => {
  if (!props.resizable || !modalRef.value) return;
  
  isResizing.value = true;
  const rect = modalRef.value.getBoundingClientRect();
  resizeStart.value = {
    x: e.clientX,
    y: e.clientY,
    width: rect.width,
    height: rect.height,
  };
  
  document.addEventListener('mousemove', handleResizeMove);
  document.addEventListener('mouseup', handleResizeEnd);
  e.preventDefault();
  e.stopPropagation();
};

const handleResizeMove = (e: MouseEvent) => {
  if (!isResizing.value) return;
  
  const dx = e.clientX - resizeStart.value.x;
  const dy = e.clientY - resizeStart.value.y;
  
  resizeSize.value = {
    width: Math.max(300, resizeStart.value.width + dx),
    height: Math.max(200, resizeStart.value.height + dy),
  };
};

const handleResizeEnd = () => {
  isResizing.value = false;
  document.removeEventListener('mousemove', handleResizeMove);
  document.removeEventListener('mouseup', handleResizeEnd);
};

onMounted(() => {
  if (props.keyboard) {
    document.addEventListener('keydown', handleKeydown);
  }
});

onUnmounted(() => {
  document.removeEventListener('keydown', handleKeydown);
  if (internalVisible.value) {
    release();
    document.body.style.overflow = '';
  }
});


</script>

<template>
  <Teleport to="body">
    <Transition 
      :name="transitionName" 
      @after-leave="handleAfterClose"
      @after-enter="handleAfterOpen"
    >
      <div 
        v-if="internalVisible && shouldRender"
        class="stratix-modal-root"
        :class="[
          `stratix-modal-root--${position}`,
          wrapClassName,
          { 'stratix-modal-root--drawer': isDrawer }
        ]"
        :style="{ zIndex: zIndexResolved }"
        @click="handleMaskClick"
      >
        <div 
          v-if="mask" 
          class="stratix-modal-mask" 
          :style="{ background: ModalBaseConfig.style.maskBackground, ...maskStyle }" 
        />
        
        <div class="stratix-modal-wrapper" @click.stop="stopPropagation">
          <div 
            ref="modalRef"
            class="stratix-modal"
            :class="[
              `stratix-modal--${size}`,
              `stratix-modal--${position}`,
              { 
                'stratix-modal--drawer': isDrawer,
                'stratix-modal--fullscreen': size === 'fullscreen',
                'stratix-modal--dragging': isDragging,
                'stratix-modal--resizing': isResizing,
              }
            ]"
            :style="modalStyle"
            @click.stop="stopPropagation"
          >
          <header 
              v-if="title || $slots.header || closable"
              class="stratix-modal__header"
              :style="headerStyleResolved"
              @mousedown="handleDragStart"
            >
              <slot name="header">
                <h3 class="stratix-modal__title">{{ title }}</h3>
              </slot>
              <button 
                v-if="closable"
                type="button"
                class="stratix-modal__close"
                @click="handleClose"
                aria-label="关闭"
              >
                <SvgIcon :name="closeIcon" />
              </button>
            </header>
            
            <div class="stratix-modal__body" :style="[bodyStyleResolved, bodyStyle]">
              <slot />
            </div>
            
            <footer 
              v-if="footer || $slots.footer"
              class="stratix-modal__footer"
              :style="footerStyle"
            >
              <slot name="footer">
                <StratixButton 
                  size="sm" 
                  variant="secondary" 
                  @click="handleCancel"
                >
                  {{ cancelText }}
                </StratixButton>
                <StratixButton 
                  size="sm" 
                  variant="primary" 
                  :loading="confirmLoading"
                  @click="handleOk"
                >
                  {{ okText }}
                </StratixButton>
              </slot>
            </footer>
            
            <!-- Resize handle -->
            <div
              v-if="resizable"
              class="stratix-modal__resize-handle"
              @mousedown="handleResizeStart"
              title="拖动调整大小"
            >
              <div class="resize-indicator" v-if="isResizing">
                {{ Math.round(resizeSize.width || 0) }} × {{ Math.round(resizeSize.height || 0) }}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.stratix-modal-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  box-sizing: border-box;
}

.stratix-modal-root--center .stratix-modal-wrapper {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 20px;
}

.stratix-modal-root--bottom .stratix-modal-wrapper {
  display: flex;
  align-items: flex-end;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 0;
}

.stratix-modal-root--top .stratix-modal-wrapper {
  display: flex;
  align-items: flex-start;
  justify-content: center;
  width: 100%;
  height: 100%;
  padding: 20px;
}

.stratix-modal-root--left .stratix-modal-wrapper {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  width: 100%;
  height: 100%;
  padding: 0;
}

.stratix-modal-root--right .stratix-modal-wrapper {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  width: 100%;
  height: 100%;
  padding: 0;
}

.stratix-modal-mask {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.stratix-modal-zoom-enter-active .stratix-modal-mask {
  animation: ds-fade-in var(--ds-animation-duration-fast) var(--ds-animation-easing-ease-out);
}

.stratix-modal-zoom-leave-active .stratix-modal-mask {
  animation: ds-fade-out var(--ds-animation-duration-fast) var(--ds-animation-easing-ease-in) forwards;
}

.stratix-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--ds-glass-bg, var(--ds-bg-secondary));
  border: var(--ds-glass-border, 1px solid v-bind('getToken("colors.border.default")'));
  box-shadow: var(--ds-glass-shadow, v-bind('ModalBaseConfig.style.shadow'));
  backdrop-filter: blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate));
  -webkit-backdrop-filter: blur(var(--ds-glass-blur)) saturate(var(--ds-glass-saturate));
  box-sizing: border-box;
  outline: none;
  overflow: hidden;
  transition: transform 0.2s var(--ds-animation-easing-ease-out),
              box-shadow 0.2s var(--ds-animation-easing-ease-out);
}

.stratix-modal--dragging {
  cursor: move;
  user-select: none;
  transform: scale(1.01) !important;
  box-shadow: var(--ds-shadow-xl), 0 0 40px color-mix(in srgb, black 20%, transparent);
}

.stratix-modal--resizing {
  user-select: none;
}

.stratix-modal--fullscreen {
  border: none;
  border-radius: 0 !important;
  max-height: 95vh;
}

.stratix-modal:not(.stratix-modal--fullscreen) {
  max-height: 85vh;
}

.stratix-modal--drawer {
  height: 100vh !important;
  max-height: 100vh !important;
}

.stratix-modal__header {
  height: 48px;
  padding: 0 var(--ds-spacing-md);
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.stratix-modal__title {
  margin: 0;
  font-size: var(--ds-font-size-lg);
  font-weight: 600;
  color: var(--ds-text-primary);
  line-height: 1.2;
}

.stratix-modal__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  border: 1px solid v-bind('getToken("colors.border.default")');
  border-radius: var(--ds-radius-sm);
  color: v-bind('getToken("colors.text.muted")');
  cursor: pointer;
  transition: all var(--ds-animation-duration-fast) ease;
}

.stratix-modal__close:hover {
  background: v-bind('getToken("colors.background.overlay")');
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-modal__body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--ds-bg-secondary);
}

.stratix-modal__footer {
  height: 56px;
  padding: 0 var(--ds-spacing-md);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid v-bind('getToken("colors.border.default")');
  flex-shrink: 0;
  background: var(--ds-bg-secondary);
}

/* Resize handle */
.stratix-modal__resize-handle {
  position: absolute;
  bottom: 0;
  right: 0;
  width: 16px;
  height: 16px;
  cursor: nwse-resize;
  background: linear-gradient(135deg, transparent 50%, var(--ds-text-muted) 50%);
  background-size: 4px 4px;
  opacity: 0.3;
  transition: opacity 0.15s ease;
  z-index: 10;
}

.stratix-modal__resize-handle:hover {
  opacity: 0.6;
}

.stratix-modal--resizing .stratix-modal__resize-handle {
  opacity: 0.8;
}

.resize-indicator {
  position: absolute;
  bottom: 20px;
  right: 20px;
  padding: 4px 10px;
  background: var(--ds-bg-overlay);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radius-sm);
  font-size: var(--ds-font-size-xs);
  font-family: var(--ds-font-mono);
  color: var(--ds-text-primary);
  pointer-events: none;
  white-space: nowrap;
}

/* Zoom animation (center) */
.stratix-modal-zoom-enter-active,
.stratix-modal-zoom-leave-active {
  transition: opacity 0.2s ease-in-out;
}

.stratix-modal-zoom-enter-active .stratix-modal,
.stratix-modal-zoom-leave-active .stratix-modal {
  transition: transform 0.2s ease-in-out, opacity 0.2s ease-in-out;
}

.stratix-modal-zoom-enter-from,
.stratix-modal-zoom-leave-to {
  opacity: 0;
}

.stratix-modal-zoom-enter-from .stratix-modal,
.stratix-modal-zoom-leave-to .stratix-modal {
  transform: scale(0.95);
  opacity: 0;
}

/* Slide up animation (bottom) */
.stratix-modal-slide-up-enter-active,
.stratix-modal-slide-up-leave-active {
  transition: opacity 0.2s ease-in-out;
}

.stratix-modal-slide-up-enter-active .stratix-modal,
.stratix-modal-slide-up-leave-active .stratix-modal {
  transition: transform 0.2s ease-in-out;
}

.stratix-modal-slide-up-enter-from,
.stratix-modal-slide-up-leave-to {
  opacity: 0;
}

.stratix-modal-slide-up-enter-from .stratix-modal {
  transform: translateY(100%);
}

.stratix-modal-slide-up-leave-to .stratix-modal {
  transform: translateY(20px);
}

/* Slide down animation (top) */
.stratix-modal-slide-down-enter-active,
.stratix-modal-slide-down-leave-active {
  transition: opacity 0.2s ease-in-out;
}

.stratix-modal-slide-down-enter-active .stratix-modal,
.stratix-modal-slide-down-leave-active .stratix-modal {
  transition: transform 0.2s ease-in-out;
}

.stratix-modal-slide-down-enter-from,
.stratix-modal-slide-down-leave-to {
  opacity: 0;
}

.stratix-modal-slide-down-enter-from .stratix-modal {
  transform: translateY(-100%);
}

.stratix-modal-slide-down-leave-to .stratix-modal {
  transform: translateY(-20px);
}

/* Slide right animation (left drawer) */
.stratix-modal-slide-right-enter-active,
.stratix-modal-slide-right-leave-active {
  transition: opacity 0.2s ease-in-out;
}

.stratix-modal-slide-right-enter-active .stratix-modal,
.stratix-modal-slide-right-leave-active .stratix-modal {
  transition: transform 0.2s ease-in-out;
}

.stratix-modal-slide-right-enter-from,
.stratix-modal-slide-right-leave-to {
  opacity: 0;
}

.stratix-modal-slide-right-enter-from .stratix-modal,
.stratix-modal-slide-right-leave-to .stratix-modal {
  transform: translateX(-100%);
}

/* Slide left animation (right drawer) */
.stratix-modal-slide-left-enter-active,
.stratix-modal-slide-left-leave-active {
  transition: opacity 0.2s ease-in-out;
}

.stratix-modal-slide-left-enter-active .stratix-modal,
.stratix-modal-slide-left-leave-active .stratix-modal {
  transition: transform 0.2s ease-in-out;
}

.stratix-modal-slide-left-enter-from,
.stratix-modal-slide-left-leave-to {
  opacity: 0;
}

.stratix-modal-slide-left-enter-from .stratix-modal,
.stratix-modal-slide-left-leave-to .stratix-modal {
  transform: translateX(100%);
}

/* Prefers reduced motion */
@media (prefers-reduced-motion: reduce) {
  .stratix-modal,
  .stratix-modal-zoom-enter-active .stratix-modal,
  .stratix-modal-zoom-leave-active .stratix-modal,
  .stratix-modal-slide-up-enter-active .stratix-modal,
  .stratix-modal-slide-up-leave-active .stratix-modal,
  .stratix-modal-slide-down-enter-active .stratix-modal,
  .stratix-modal-slide-down-leave-active .stratix-modal,
  .stratix-modal-slide-right-enter-active .stratix-modal,
  .stratix-modal-slide-right-leave-active .stratix-modal,
  .stratix-modal-slide-left-enter-active .stratix-modal,
  .stratix-modal-slide-left-leave-active .stratix-modal {
    transition: none !important;
    animation: none !important;
  }
  
  .stratix-modal--dragging {
    transform: none !important;
  }
}
</style>
