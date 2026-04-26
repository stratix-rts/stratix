<template>
  <StratixModal
    :visible="visible"
    :title="title"
    :width="width"
    :height="height"
    @update:visible="handleClose"
  >
    <div class="nocodb-viewer">
      <!-- Toolbar -->
      <div class="nocodb-toolbar">
        <div class="nocodb-status">
          <span :class="['status-dot', { active: isConnected }]"></span>
          <span class="status-text">{{ statusText }}</span>
        </div>

        <div class="nocodb-toolbar-actions">
          <StratixButton
            size="small"
            :disabled="!isConnected"
            @click="handleRefresh"
          >
            Refresh
          </StratixButton>
          <StratixButton
            size="small"
            variant="secondary"
            @click="handleOpenExternal"
          >
            Open External
          </StratixButton>
        </div>
      </div>

      <!-- iframe Container -->
      <div class="nocodb-iframe-container">
        <iframe
          v-if="isConnected"
          ref="iframeRef"
          :src="nocoDBUrl"
          class="nocodb-iframe"
          sandbox="allow-same-origin allow-scripts"
          @load="handleIframeLoad"
        />
        <div v-else class="nocodb-loading">
          <div class="loading-spinner"></div>
          <span>{{ statusText }}</span>
        </div>
      </div>
    </div>
  </StratixModal>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import { getNocoDBService } from './NocoDBService';

interface Props {
  visible: boolean;
  title?: string;
  width?: string;
  height?: string;
}

const props = withDefaults(defineProps<Props>(), {
  title: 'Data Explorer',
  width: '90vw',
  height: '80vh',
});

const emit = defineEmits<{
  'update:visible': [value: boolean];
}>();

const iframeRef = ref<HTMLIFrameElement | null>(null);
const isConnected = ref(false);
const isLoading = ref(true);

// NocoDB URL
const nocoDBUrl = computed(() => {
  const service = getNocoDBService();
  return service.getDashboardUrl();
});

// Status text
const statusText = computed(() => {
  if (isConnected.value) {
    return 'Connected';
  }
  if (isLoading.value) {
    return 'Loading NocoDB...';
  }
  return 'Disconnected';
});

// Handle iframe load
const handleIframeLoad = () => {
  console.log('[NocoDBViewer] iframe loaded');
  isConnected.value = true;
  isLoading.value = false;
};

// Handle refresh
const handleRefresh = () => {
  if (iframeRef.value) {
    isLoading.value = true;
    isConnected.value = false;
    iframeRef.value.src = nocoDBUrl.value;
  }
};

// Handle open external
const handleOpenExternal = () => {
  window.open(nocoDBUrl.value, '_blank');
};

// Handle close
const handleClose = (value: boolean) => {
  emit('update:visible', value);
};

// Check connection on mount
onMounted(() => {
  const service = getNocoDBService();
  isConnected.value = service.isRunning();
});

// Watch for visibility changes
watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      // Reset state when modal opens
      isLoading.value = true;
      isConnected.value = getNocoDBService().isRunning();
    }
  }
);

// Cleanup iframe on unmount
onUnmounted(() => {
  if (iframeRef.value) {
    iframeRef.value.src = 'about:blank';
  }
});
</script>

<style scoped>
.nocodb-viewer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 400px;
}

.nocodb-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
  background: var(--bg-secondary, #f9fafb);
}

.nocodb-status {
  display: flex;
  align-items: center;
  gap: 8px;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--warning, #f59e0b);
  transition: background-color 0.2s;
}

.status-dot.active {
  background: var(--success, #10b981);
}

.status-text {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
}

.nocodb-toolbar-actions {
  display: flex;
  gap: 8px;
}

.nocodb-iframe-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.nocodb-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background: white;
}

.nocodb-loading {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--text-secondary, #6b7280);
}

.loading-spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color, #e5e7eb);
  border-top-color: var(--primary, #3b82f6);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
