<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';
import StratixModal from '@/components/ui/StratixModal.vue';
import { WorkflowEditorPanel, type WorkflowExecutionStatus } from '@/stratix-character-creator/ui/workflow-editor/WorkflowEditorPanel';
import type { WorkflowDefinition } from '@/agent-platform/workflow/types';

interface Props {
  visible: boolean;
  initialDefinition?: WorkflowDefinition;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  'update:visible': [value: boolean];
  'workflowChange': [definition: WorkflowDefinition];
  'execute': [status: WorkflowExecutionStatus, definition?: WorkflowDefinition];
}>();

const editorContainer = ref<HTMLDivElement | null>(null);
let editorPanel: WorkflowEditorPanel | null = null;

const handleClose = () => {
  emit('update:visible', false);
};

const handleWorkflowChange = (definition: WorkflowDefinition) => {
  emit('workflowChange', definition);
};

const handleExecute = (status: WorkflowExecutionStatus, definition?: WorkflowDefinition) => {
  emit('execute', status, definition);
};

watch(() => props.visible, (newVal) => {
  if (newVal && editorContainer.value && !editorPanel) {
    // Initialize editor when modal becomes visible
    setTimeout(() => {
      initEditor();
    }, 100);
  }
});

onMounted(() => {
  if (props.visible && editorContainer.value) {
    initEditor();
  }
});

onUnmounted(() => {
  if (editorPanel) {
    editorPanel.destroy();
    editorPanel = null;
  }
});

function initEditor() {
  if (!editorContainer.value || editorPanel) return;

  editorPanel = new WorkflowEditorPanel({
    x: 0,
    y: 0,
    width: editorContainer.value.clientWidth || 900,
    height: editorContainer.value.clientHeight || 600,
    initialDefinition: props.initialDefinition,
    onChange: handleWorkflowChange,
    onExecute: handleExecute,
  });

  editorPanel.create(editorContainer.value);
}
</script>

<template>
  <StratixModal
    :visible="visible"
    title="工作流编辑器"
    width="960"
    height="700"
    position="center"
    :mask-closable="false"
    @update:visible="$emit('update:visible', $event)"
    @close="handleClose"
  >
    <div
      ref="editorContainer"
      class="workflow-editor-container"
    />
  </StratixModal>
</template>

<style scoped>
.workflow-editor-container {
  width: 100%;
  height: 100%;
  min-height: 500px;
  background: #1a1a2e;
  border-radius: 4px;
  overflow: hidden;
}
</style>
