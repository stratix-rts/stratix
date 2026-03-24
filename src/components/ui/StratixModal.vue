<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, toRef, type CSSProperties } from 'vue';
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
const dragOffset = ref({ x: 0, y: 0 });
const dragPosition = ref({ x: 0, y: 0 });
const internalVisible = ref(false);
const shouldRender = ref(false);

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

/**
 * 阻止事件冒泡到 Phaser Canvas，防止点击穿透
 */
const stopPropagation = (e: Event) => {
  e.stopPropagation();
};

const handleKeydown = (e: KeyboardEvent) => {
  if (props.keyboard && e.key === 'Escape') {
    handleClose();
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
            
            <div class="stratix-modal__body" :style="bodyStyle">
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

.stratix-modal {
  position: relative;
  display: flex;
  flex-direction: column;
  background: var(--ds-bg-secondary);
  border: 1px solid v-bind('getToken("colors.border.default")');
  box-shadow: v-bind('ModalBaseConfig.style.shadow');
  box-sizing: border-box;
  outline: none;
}

.stratix-modal--dragging {
  cursor: move;
  user-select: none;
}

.stratix-modal--fullscreen {
  border: none;
  border-radius: 0 !important;
}

.stratix-modal--drawer {
  height: 100vh !important;
  max-height: 100vh !important;
}

.stratix-modal__header {
  height: 48px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.stratix-modal__title {
  margin: 0;
  font-size: 16px;
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
  border-radius: 4px;
  color: v-bind('getToken("colors.text.muted")');
  cursor: pointer;
  transition: all 0.15s ease;
}

.stratix-modal__close:hover {
  background: v-bind('getToken("colors.background.tertiary")');
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-modal__body {
  flex: 1;
  padding: v-bind('sizeConfig.padding');
  overflow-y: auto;
  overflow-x: hidden;
  background: var(--ds-bg-secondary);
}

.stratix-modal__footer {
  height: 56px;
  padding: 0 16px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 10px;
  border-top: 1px solid v-bind('getToken("colors.border.default")');
  flex-shrink: 0;
  background: var(--ds-bg-secondary);
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
</style>
