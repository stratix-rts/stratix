<script setup lang="ts">
/**
 * JsonEditor.vue — JSON 编辑器弹窗 (V4)
 *
 * 弹窗式 JSON 编辑器，用于查看和编辑角色 parts 配置。
 * 格式校验 → 保存/取消。
 *
 * Props:
 *   visible: boolean
 *   parts: Record<string, PartSelection>
 *
 * Emits:
 *   close: []
 *   save: [parts: Record<string, PartSelection>]
 *
 * 美学约束: A1-A8，全部使用 var(--ds-*) tokens
 */

import { ref, watch } from 'vue';
import { StratixModal, StratixButton } from '@/components/ui';
import type { PartSelection } from '@/stratix-character-creator/types';

// ============================================================================

const props = defineProps<{
  visible: boolean;
  parts: Record<string, PartSelection>;
}>();

const emit = defineEmits<{
  close: [];
  save: [parts: Record<string, PartSelection>];
}>();

// ============================================================================

const jsonText = ref('');
const errorMessage = ref<string | null>(null);

// 弹窗打开时同步最新 parts
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

// ============================================================================

function handleClose(): void {
  emit('close');
}

function handleSave(): void {
  errorMessage.value = null;
  try {
    const parsed = JSON.parse(jsonText.value) as Record<string, unknown>;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      errorMessage.value = 'JSON must be a non-null object';
      return;
    }
    emit('save', parsed as Record<string, PartSelection>);
    emit('close');
  } catch {
    errorMessage.value = 'JSON 格式错误 — 请检查语法';
  }
}
</script>

<template>
  <StratixModal
    :visible="visible"
    title="JSON 编辑器"
    size="md"
    :closable="true"
    :mask-closable="true"
    :footer="false"
    @close="handleClose"
  >
    <div class="json-editor">
      <!-- A5: 阅读流 — 标签 → 编辑区 → 错误 → 操作 -->
      <span class="json-editor__label">角色配置 PARTS CONFIG</span>

      <textarea
        v-model="jsonText"
        class="json-editor__textarea"
        spellcheck="false"
      />

      <div v-if="errorMessage" class="json-editor__error">
        {{ errorMessage }}
      </div>

      <!-- A2: flex 对齐，A5: CTA 在末端 -->
      <div class="json-editor__footer">
        <StratixButton size="sm" variant="secondary" @click="handleClose">
          取消
        </StratixButton>
        <StratixButton size="sm" variant="primary" @click="handleSave">
          保存
        </StratixButton>
      </div>
    </div>
  </StratixModal>
</template>

<style scoped>
/* A2: flex 布局，A7: 留白 30-50% */
.json-editor {
  display: flex;
  flex-direction: column;
  gap: var(--ds-spacing-sm, 8px);
  min-height: 350px;
}

/* A3: 10px mono label, A5: 视觉层级第三层 */
.json-editor__label {
  font-size: var(--ds-font-size-xs, 10px);
  font-family: 'SF Mono', 'Monaco', monospace;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* A1: padding 12px, A3: mono 12px, A4: min-height 280px */
.json-editor__textarea {
  flex: 1;
  width: 100%;
  min-height: 280px;
  padding: var(--ds-spacing-md, 12px);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border);
  border-radius: var(--ds-radii-md, 4px);
  color: var(--ds-text-primary);
  font-size: var(--ds-font-size-sm, 12px);
  font-family: 'SF Mono', 'Monaco', monospace;
  line-height: 1.6;
  resize: none;
  outline: none;
  box-sizing: border-box;
  transition: border-color 0.15s ease;
}

.json-editor__textarea:focus {
  border-color: var(--ds-color-primary);
}

/* A3: 状态色 */
.json-editor__error {
  font-size: var(--ds-font-size-xs, 10px);
  font-family: 'SF Mono', 'Monaco', monospace;
  color: var(--ds-status-danger, #ff3b30);
}

/* A2: flex 右对齐，A1: gap 12px */
.json-editor__footer {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: var(--ds-spacing-md, 12px);
}
</style>
