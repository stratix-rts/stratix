<template>
  <div class="zone-manual-task-creator">
    <div class="zone-manual-task-creator__form">
      <!-- Title -->
      <div class="zone-manual-task-creator__field">
        <label class="zone-manual-task-creator__label">
          标题 <span class="zone-manual-task-creator__required">*</span>
        </label>
        <input
          v-model="form.title"
          type="text"
          class="zone-manual-task-creator__input"
          placeholder="输入任务标题"
        />
      </div>

      <!-- Description -->
      <div class="zone-manual-task-creator__field">
        <label class="zone-manual-task-creator__label">描述</label>
        <textarea
          v-model="form.description"
          class="zone-manual-task-creator__textarea"
          placeholder="输入任务描述（可选）"
          rows="3"
        />
      </div>

      <!-- Type & Priority Row -->
      <div class="zone-manual-task-creator__row">
        <div class="zone-manual-task-creator__field zone-manual-task-creator__field--half">
          <label class="zone-manual-task-creator__label">类型</label>
          <select v-model="form.type" class="zone-manual-task-creator__select">
            <option value="coding">💻 编码</option>
            <option value="writing">📝 写作</option>
            <option value="analysis">🔍 分析</option>
            <option value="research">📚 研究</option>
            <option value="general">📌 通用</option>
          </select>
        </div>

        <div class="zone-manual-task-creator__field zone-manual-task-creator__field--half">
          <label class="zone-manual-task-creator__label">优先级</label>
          <select v-model="form.priority" class="zone-manual-task-creator__select">
            <option :value="1">1 - 紧急</option>
            <option :value="2">2 - 高</option>
            <option :value="3">3 - 中</option>
            <option :value="4">4 - 低</option>
            <option :value="5">5 - 最低</option>
          </select>
        </div>
      </div>

      <!-- Assignee -->
      <div class="zone-manual-task-creator__field">
        <label class="zone-manual-task-creator__label">指定 Agent</label>
        <select v-model="form.assigneeId" class="zone-manual-task-creator__select">
          <option value="">不指定</option>
          <option v-for="member in members" :key="member.agentId" :value="member.agentId">
            {{ member.agentId.slice(0, 8) }}
          </option>
        </select>
      </div>

      <!-- Submit Button -->
      <div class="zone-manual-task-creator__actions">
        <StratixButton
          variant="primary"
          :loading="submitting"
          :disabled="!form.title.trim() || submitting"
          @click="submitTask"
        >
          创建任务
        </StratixButton>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue';
import StratixButton from '@/components/ui/StratixButton.vue';
import type { TaskType, TaskPriority } from '../../../../stratix-orchestration/zone/ZoneCoordinator';

interface ZoneMember {
  agentId: string;
  joinedAt?: string;
}

interface FormData {
  title: string;
  description: string;
  type: TaskType;
  priority: TaskPriority;
  assigneeId: string;
}

interface Props {
  zoneId: string;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  created: [];
}>();

const submitting = ref(false);
const members = ref<ZoneMember[]>([]);

const form = reactive<FormData>({
  title: '',
  description: '',
  type: 'general',
  priority: 3,
  assigneeId: ''
});

async function fetchMembers(): Promise<void> {
  try {
    const response = await fetch(`/api/zones/${props.zoneId}`);
    const result = await response.json();
    if (result.success && result.members) {
      members.value = result.members;
    }
  } catch (error) {
    console.error('[ZoneManualTaskCreator] Failed to fetch members:', error);
  }
}

async function submitTask(): Promise<void> {
  if (!form.title.trim() || submitting.value) return;

  submitting.value = true;
  try {
    const payload: Record<string, unknown> = {
      title: form.title.trim(),
      description: form.description.trim(),
      type: form.type,
      priority: form.priority
    };

    if (form.assigneeId) {
      payload.assigneeId = form.assigneeId;
    }

    const response = await fetch(`/api/zones/${props.zoneId}/tasks/manual`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    if (result.success) {
      // Reset form
      form.title = '';
      form.description = '';
      form.type = 'general';
      form.priority = 3;
      form.assigneeId = '';
      emit('created');
    } else {
      console.error('[ZoneManualTaskCreator] Create task failed:', result.error);
    }
  } catch (error) {
    console.error('[ZoneManualTaskCreator] Failed to create task:', error);
  } finally {
    submitting.value = false;
  }
}

onMounted(() => {
  fetchMembers();
});
</script>

<style scoped>
.zone-manual-task-creator {
  padding: 16px;
  background: var(--ds-bg-secondary);
  border-radius: 8px;
}

.zone-manual-task-creator__form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.zone-manual-task-creator__field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.zone-manual-task-creator__field--half {
  flex: 1;
}

.zone-manual-task-creator__row {
  display: flex;
  gap: 12px;
}

.zone-manual-task-creator__label {
  font-size: 12px;
  font-weight: 500;
  color: var(--ds-text-secondary);
}

.zone-manual-task-creator__required {
  color: var(--ds-semantic-danger);
}

.zone-manual-task-creator__input,
.zone-manual-task-creator__textarea,
.zone-manual-task-creator__select {
  padding: 8px 12px;
  font-size: 13px;
  color: var(--ds-text-primary);
  background: var(--ds-bg-tertiary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  outline: none;
  transition: border-color 0.15s ease;
}

.zone-manual-task-creator__input:focus,
.zone-manual-task-creator__textarea:focus,
.zone-manual-task-creator__select:focus {
  border-color: var(--ds-info);
}

.zone-manual-task-creator__input::placeholder,
.zone-manual-task-creator__textarea::placeholder {
  color: var(--ds-text-muted);
}

.zone-manual-task-creator__textarea {
  resize: vertical;
  min-height: 60px;
  line-height: 1.4;
}

.zone-manual-task-creator__select {
  cursor: pointer;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M2 4l4 4 4-4'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}

.zone-manual-task-creator__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: 8px;
}
</style>
