<script setup lang="ts">
/**
 * JsonEditor.vue - JSON 编辑器弹窗
 *
 * 显示并编辑角色 parts 的 JSON 配置
 */

import { ref, watch } from 'vue';
import { StratixModal, StratixButton } from '@/components/ui';
import type { PartSelection } from '@/stratix-character-creator/types';

const props = defineProps<{
  visible: boolean;
  parts: Record<string, PartSelection>;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'save', parts: Record<string, PartSelection>): void;
}>();

const jsonText = ref('');
const errorMessage = ref<string | null>(null);

// 当弹窗打开时，同步最新 parts
watch(() => props.visible, (visible) => {
  if (visible) {
    try {
      jsonText.value = JSON.stringify(props.parts, null, 2);
      errorMessage.value = null;
    } catch {
      jsonText.value = '{}';
    }
  }
});

function handleClose(): void {
  emit('close');
}

function handleSave(): void {
  errorMessage.value = null;
  try {
    const parsed = JSON.parse(jsonText.value);
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('JSON must be an object');
    }
    emit('save', parsed);
    emit('close');
  } catch {
    errorMessage.value = 'JSON 格式错误';
  }
}
</script>

<template>
  <StratixModal
    :visible="visible"
    title="JSON 编辑器 JSON EDITOR"
    size="md"
    :closable="true"
    :mask-closable="true"
    :footer="false"
    @close="handleClose"
  >
    <div class="json-editor">
      <div class="editor-header">
        <span class="editor-label">角色配置 PARTS CONFIG</span>
      </div>

      <div class="editor-body">
        <textarea
          v-model="jsonText"
          class="json-textarea"
          spellcheck="false"
        />
      </div>

      <div v-if="errorMessage" class="error-message">
        {{ errorMessage }}
      </div>

      <div class="editor-footer">
        <StratixButton size="sm" variant="secondary" @click="handleClose">
          取消 CANCEL
        </StratixButton>
        <StratixButton size="sm" variant="primary" @click="handleSave">
          保存 SAVE
        </StratixButton>
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
.json-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 350px;
}

.editor-header {
  padding-bottom: 12px;
}

.editor-label {
  font-size: 10px;
  font-family: 'SF Mono', 'Monaco', monospace;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.editor-body {
  flex: 1;
  min-height: 0;
}

.json-textarea {
  width: 100%;
  height: 100%;
  min-height: 280px;
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: 4px;
  color: var(--ds-text-primary);
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', monospace;
  resize: none;
  padding: 12px;
  box-sizing: border-box;
  outline: none;
  transition: border-color 0.15s ease;
}

.json-textarea:focus {
  border-color: var(--ds-color-primary);
}

.json-textarea::placeholder {
  color: var(--ds-text-muted);
}

.error-message {
  padding: 8px 0;
  font-size: 11px;
  font-family: 'SF Mono', 'Monaco', monospace;
  color: var(--ds-status-danger, #ff3b30);
}

.editor-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding-top: 12px;
}
</style>
