<template>
  <StratixModal
    :visible="visible"
    :title="isEditing ? 'Edit Zone' : 'Create Zone'"
    width="520px"
    :maskClosable="false"
    @update:visible="handleClose"
    @close="handleClose"
  >
    <div class="zone-editor">
      <StratixFormField label="Zone Title" required>
        <StratixInput
          v-model="form.title"
          placeholder="e.g., Requirements Research Zone"
          @blur="validateTitle"
        />
        <div v-if="errors.title" class="zone-editor__error">{{ errors.title }}</div>
      </StratixFormField>

      <StratixFormField label="Zone Prompt">
        <template #label>
          <div class="zone-editor__label-row">
            <span>Zone Prompt</span>
            <span class="zone-editor__label-hint">Define the zone's role and behavior</span>
          </div>
        </template>
        <StratixTextarea
          v-model="form.prompt"
          placeholder="This zone is for... Agents should..."
          :rows="5"
        />
      </StratixFormField>

      <div class="zone-editor__preview">
        <div class="zone-editor__preview-header">
          <span class="zone-editor__preview-title">Agent Preview</span>
        </div>
        <div class="zone-editor__preview-content">
          <div class="zone-editor__preview-section">
            <span class="zone-editor__preview-label">Zone:</span>
            <span class="zone-editor__preview-value">{{ form.title || 'Untitled Zone' }}</span>
          </div>
          <div v-if="form.prompt" class="zone-editor__preview-section">
            <span class="zone-editor__preview-label">Role:</span>
            <span class="zone-editor__preview-value">{{ truncatePrompt(form.prompt) }}</span>
          </div>
          <div class="zone-editor__preview-section">
            <span class="zone-editor__preview-label">Files:</span>
            <span class="zone-editor__preview-value zone-editor__preview-value--muted">
              {{ zone?.files?.length || 0 }} files attached
            </span>
          </div>
          <div class="zone-editor__preview-section">
            <span class="zone-editor__preview-label">Members:</span>
            <span class="zone-editor__preview-value zone-editor__preview-value--muted">
              {{ zone?.members?.length || 0 }} agents
            </span>
          </div>
        </div>
      </div>
    </div>

    <template #footer>
      <div class="zone-editor__footer">
        <StratixButton @click="handleClose" :disabled="saving">Cancel</StratixButton>
        <StratixButton
          type="primary"
          @click="handleSave"
          :disabled="!isValid || saving"
        >
          {{ saving ? 'Saving...' : (isEditing ? 'Update' : 'Create') }}
        </StratixButton>
      </div>
      <div v-if="saveError" class="zone-editor__save-error">
        {{ saveError }}
      </div>
    </template>
  </StratixModal>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import StratixInput from '@/components/ui/StratixInput.vue';
import StratixTextarea from '@/components/ui/StratixTextarea.vue';
import StratixFormField from '@/components/ui/StratixFormField.vue';
import type { Zone } from '../types';

interface Props {
  visible: boolean;
  zone?: Zone | null;
  projectId?: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'close': [];
  'save': [data: { title: string; prompt: string; projectId?: string }];
}>();

const isEditing = computed(() => !!props.zone);

const defaultForm = {
  title: '',
  prompt: '',
};

const form = reactive({
  title: '',
  prompt: '',
});

const errors = reactive({
  title: '',
});

const saving = ref(false);
const saveError = ref('');

watch(
  () => props.visible,
  (visible) => {
    if (visible) {
      if (props.zone) {
        form.title = props.zone.title;
        form.prompt = props.zone.prompt || '';
      } else {
        form.title = defaultForm.title;
        form.prompt = defaultForm.prompt;
      }
      errors.title = '';
      saveError.value = '';
    }
  }
);

const validateTitle = (): boolean => {
  if (!form.title.trim()) {
    errors.title = 'Zone title is required';
    return false;
  }
  if (form.title.trim().length < 2) {
    errors.title = 'Zone title must be at least 2 characters';
    return false;
  }
  errors.title = '';
  return true;
};

const isValid = computed(() => {
  return form.title.trim().length >= 2 && errors.title === '';
});

const truncatePrompt = (prompt: string, maxLength = 60): string => {
  if (prompt.length <= maxLength) return prompt;
  return prompt.substring(0, maxLength) + '...';
};

const handleClose = () => {
  emit('close');
};

const handleSave = async () => {
  if (!validateTitle()) return;

  saveError.value = '';
  saving.value = true;

  try {
    emit('save', {
      title: form.title.trim(),
      prompt: form.prompt.trim(),
      projectId: props.projectId,
    });
    handleClose();
  } catch (error: any) {
    saveError.value = error?.message || 'Failed to save zone';
  } finally {
    saving.value = false;
  }
};
</script>

<style scoped>
.zone-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.zone-editor__label-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.zone-editor__label-hint {
  font-size: 11px;
  font-weight: 400;
  color: var(--ds-text-muted);
}

.zone-editor__error {
  color: var(--ds-semantic-danger);
  font-size: 12px;
  margin-top: 4px;
}

.zone-editor__preview {
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 8px;
  overflow: hidden;
}

.zone-editor__preview-header {
  padding: 8px 12px;
  background: var(--ds-bg-secondary);
  border-bottom: 1px solid var(--ds-border-default);
}

.zone-editor__preview-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--ds-text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.zone-editor__preview-content {
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.zone-editor__preview-section {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.zone-editor__preview-label {
  flex-shrink: 0;
  width: 60px;
  font-size: 12px;
  color: var(--ds-text-muted);
}

.zone-editor__preview-value {
  font-size: 12px;
  color: var(--ds-text-primary);
  line-height: 1.4;
}

.zone-editor__preview-value--muted {
  color: var(--ds-text-muted);
}

.zone-editor__footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.zone-editor__save-error {
  margin-top: 12px;
  padding: 10px 12px;
  background: rgba(255, 68, 68, 0.1);
  border: 1px solid var(--ds-semantic-danger);
  border-radius: 6px;
  color: var(--ds-semantic-danger);
  font-size: 12px;
}
</style>
