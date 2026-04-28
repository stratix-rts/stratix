<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { getToken } from '@/design-system/config';
import SvgIcon from './SvgIcon.vue';

type DrawerPlacement = 'left' | 'right' | 'top' | 'bottom';

interface Props {
  visible: boolean;
  title?: string;
  placement?: DrawerPlacement;
  width?: string;
  height?: string;
  maskClosable?: boolean;
  closable?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  placement: 'right',
  width: '360px',
  height: '360px',
  maskClosable: true,
  closable: true,
});

const emit = defineEmits<{
  'update:visible': [value: boolean];
  close: [];
}>();

const internalVisible = ref(false);

watch(() => props.visible, (val) => {
  if (val) {
    requestAnimationFrame(() => {
      internalVisible.value = true;
    });
    document.body.style.overflow = 'hidden';
  } else {
    internalVisible.value = false;
    document.body.style.overflow = '';
  }
});

const handleClose = () => {
  emit('update:visible', false);
  emit('close');
};

const handleMaskClick = () => {
  if (props.maskClosable) {
    handleClose();
  }
};

const drawerStyle = computed(() => {
  const style: Record<string, string> = {};
  if (props.placement === 'left' || props.placement === 'right') {
    style.width = props.width;
    style.maxWidth = '90vw';
  } else {
    style.height = props.height;
    style.maxHeight = '90vh';
  }
  return style;
});

const transitionName = computed(() => {
  return `stratix-drawer-${props.placement}`;
});
</script>

<template>
  <Teleport to="body">
    <Transition name="stratix-drawer-fade">
      <div v-if="visible" class="stratix-drawer-root" @click="handleMaskClick">
        <div class="stratix-drawer-mask"></div>
        <Transition :name="transitionName">
          <div
            v-if="internalVisible"
            class="stratix-drawer"
            :class="`stratix-drawer--${placement}`"
            :style="drawerStyle"
            @click.stop
          >
            <header v-if="title || $slots.header || closable" class="stratix-drawer__header">
              <slot name="header">
                <h3 class="stratix-drawer__title">{{ title }}</h3>
              </slot>
              <button
                v-if="closable"
                class="stratix-drawer__close"
                @click="handleClose"
                aria-label="关闭"
              >
                <SvgIcon name="x" :size="18" />
              </button>
            </header>
            <div class="stratix-drawer__body">
              <slot />
            </div>
            <footer v-if="$slots.footer" class="stratix-drawer__footer">
              <slot name="footer" />
            </footer>
          </div>
        </Transition>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.stratix-drawer-root {
  position: fixed;
  inset: 0;
  z-index: 5000;
}

.stratix-drawer-mask {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, black 50%, transparent);
  backdrop-filter: blur(2px);
}

.stratix-drawer {
  position: absolute;
  background: v-bind('getToken("colors.background.elevated")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  box-shadow: var(--ds-shadow-xl);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.stratix-drawer--left {
  left: 0;
  top: 0;
  bottom: 0;
  border-radius: 0 var(--ds-radius-lg) var(--ds-radius-lg) 0;
}

.stratix-drawer--right {
  right: 0;
  top: 0;
  bottom: 0;
  border-radius: var(--ds-radius-lg) 0 0 var(--ds-radius-lg);
}

.stratix-drawer--top {
  top: 0;
  left: 0;
  right: 0;
  border-radius: 0 0 var(--ds-radius-lg) var(--ds-radius-lg);
}

.stratix-drawer--bottom {
  bottom: 0;
  left: 0;
  right: 0;
  border-radius: var(--ds-radius-lg) var(--ds-radius-lg) 0 0;
}

.stratix-drawer__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
  flex-shrink: 0;
}

.stratix-drawer__title {
  margin: 0;
  font-size: var(--ds-font-size-lg);
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-drawer__close {
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

.stratix-drawer__close:hover {
  background: v-bind('getToken("colors.background.overlay")');
  color: v-bind('getToken("colors.text.primary")');
}

.stratix-drawer__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.stratix-drawer__footer {
  padding: 12px 20px;
  border-top: 1px solid v-bind('getToken("colors.border.default")');
  flex-shrink: 0;
}

/* Mask fade */
.stratix-drawer-fade-enter-active,
.stratix-drawer-fade-leave-active {
  transition: opacity var(--ds-animation-duration-fast) ease;
}

.stratix-drawer-fade-enter-from,
.stratix-drawer-fade-leave-to {
  opacity: 0;
}

/* Slide animations */
.stratix-drawer-left-enter-active,
.stratix-drawer-left-leave-active,
.stratix-drawer-right-enter-active,
.stratix-drawer-right-leave-active,
.stratix-drawer-top-enter-active,
.stratix-drawer-top-leave-active,
.stratix-drawer-bottom-enter-active,
.stratix-drawer-bottom-leave-active {
  transition: transform var(--ds-animation-duration-normal) ease;
}

.stratix-drawer-left-enter-from,
.stratix-drawer-left-leave-to {
  transform: translateX(-100%);
}

.stratix-drawer-right-enter-from,
.stratix-drawer-right-leave-to {
  transform: translateX(100%);
}

.stratix-drawer-top-enter-from,
.stratix-drawer-top-leave-to {
  transform: translateY(-100%);
}

.stratix-drawer-bottom-enter-from,
.stratix-drawer-bottom-leave-to {
  transform: translateY(100%);
}

@media (prefers-reduced-motion: reduce) {
  .stratix-drawer-fade-enter-active,
  .stratix-drawer-fade-leave-active,
  .stratix-drawer-left-enter-active,
  .stratix-drawer-left-leave-active,
  .stratix-drawer-right-enter-active,
  .stratix-drawer-right-leave-active,
  .stratix-drawer-top-enter-active,
  .stratix-drawer-top-leave-active,
  .stratix-drawer-bottom-enter-active,
  .stratix-drawer-bottom-leave-active {
    transition: none;
  }
}
</style>
