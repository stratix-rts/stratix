<script setup lang="ts">
import { computed } from 'vue';
import { StratixSoulConfig } from '@/stratix-core/stratix-protocol';

const props = defineProps<{
  modelValue: StratixSoulConfig;
}>();

const emit = defineEmits<{
  (e: 'update:modelValue', value: StratixSoulConfig): void;
}>();

const identity = computed({
  get: () => props.modelValue.identity,
  set: (value) => emit('update:modelValue', { ...props.modelValue, identity: value }),
});

const personality = computed({
  get: () => props.modelValue.personality,
  set: (value) => emit('update:modelValue', { ...props.modelValue, personality: value }),
});

const addGoal = () => {
  emit('update:modelValue', {
    ...props.modelValue,
    goals: [...props.modelValue.goals, ''],
  });
};

const removeGoal = (index: number) => {
  const newGoals = [...props.modelValue.goals];
  newGoals.splice(index, 1);
  emit('update:modelValue', { ...props.modelValue, goals: newGoals });
};

const updateGoal = (index: number, value: string) => {
  const newGoals = [...props.modelValue.goals];
  newGoals[index] = value;
  emit('update:modelValue', { ...props.modelValue, goals: newGoals });
};
</script>

<template>
  <div class="soul-editor">
    <div class="section-header">
      <svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4.318 6.318a4.5 4.5 0 000 6.364L12 20.364l7.682-7.682a4.5 4.5 0 00-6.364-6.364L12 7.636l-1.318-1.318a4.5 4.5 0 00-6.364 0z"/>
      </svg>
      <span class="section-title">Soul 灵魂配置</span>
    </div>

    <div class="form-group">
      <label class="label label-required">身份 Identity</label>
      <textarea
        v-model="identity"
        class="textarea-field"
        :rows="3"
        placeholder="描述英雄的身份和定位..."
      />
      <span class="hint">定义英雄的核心身份，例如：专业文案创作者</span>
    </div>

    <div class="form-group">
      <label class="label label-required">目标 Goals</label>
      <div class="goals-list">
        <div v-for="(goal, index) in modelValue.goals" :key="index" class="goal-item">
          <div class="goal-number">{{ index + 1 }}</div>
          <input
            :value="goal"
            @input="updateGoal(index, ($event.target as HTMLInputElement).value)"
            class="input-field goal-input"
            :placeholder="`目标 ${index + 1}`"
          />
          <button
            class="icon-btn danger"
            @click="removeGoal(index)"
            :disabled="modelValue.goals.length <= 1"
            title="删除目标"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
          </button>
        </div>
      </div>
      <button class="btn-add" @click="addGoal">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path stroke-linecap="round" stroke-linejoin="round" d="M12 4v16m8-8H4"/>
        </svg>
        添加目标
      </button>
    </div>

    <div class="form-group">
      <label class="label">性格 Personality</label>
      <textarea
        v-model="personality"
        class="textarea-field"
        :rows="2"
        placeholder="描述英雄的性格特点..."
      />
      <span class="hint">定义英雄的性格特质，例如：细心、高效、有创意</span>
    </div>
  </div>
</template>

<style scoped>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500;600;700&family=Fira+Sans:wght@300;400;500;600;700&display=swap');

.soul-editor {
  font-family: 'Fira Sans', sans-serif;
  padding: 20px;
  animation: fadeIn 200ms ease;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid #1E293B;
}

.section-icon {
  width: 20px;
  height: 20px;
  color: #22C55E;
}

.section-title {
  font-family: 'Fira Code', monospace;
  font-size: 14px;
  font-weight: 600;
  color: #F8FAFC;
}

.form-group {
  margin-bottom: 20px;
}

.label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: #94A3B8;
  margin-bottom: 8px;
}

.label-required::after {
  content: ' *';
  color: #EF4444;
}

.hint {
  display: block;
  font-size: 12px;
  color: #64748B;
  margin-top: 6px;
}

.input-field {
  width: 100%;
  padding: 10px 14px;
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  color: #F8FAFC;
  font-size: 14px;
  font-family: 'Fira Sans', sans-serif;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.input-field::placeholder {
  color: #64748B;
}

.input-field:focus {
  outline: none;
  border-color: #22C55E;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.textarea-field {
  width: 100%;
  padding: 10px 14px;
  background: #0F172A;
  border: 1px solid #1E293B;
  border-radius: 8px;
  color: #F8FAFC;
  font-size: 14px;
  font-family: 'Fira Sans', sans-serif;
  resize: vertical;
  min-height: 80px;
  transition: border-color 200ms ease, box-shadow 200ms ease;
}

.textarea-field::placeholder {
  color: #64748B;
}

.textarea-field:focus {
  outline: none;
  border-color: #22C55E;
  box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.2);
}

.goals-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.goal-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.goal-number {
  width: 24px;
  height: 24px;
  background: rgba(34, 197, 94, 0.1);
  color: #22C55E;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  flex-shrink: 0;
}

.goal-input {
  flex: 1;
}

.icon-btn {
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: 1px solid #1E293B;
  border-radius: 6px;
  color: #64748B;
  cursor: pointer;
  transition: all 200ms ease;
  flex-shrink: 0;
}

.icon-btn svg {
  width: 16px;
  height: 16px;
}

.icon-btn:hover:not(:disabled) {
  background: #1E293B;
  color: #F8FAFC;
}

.icon-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  border-color: #EF4444;
  color: #EF4444;
}

.icon-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.btn-add {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: transparent;
  border: 1px dashed #334155;
  border-radius: 8px;
  color: #22C55E;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 200ms ease;
  margin-top: 8px;
}

.btn-add svg {
  width: 16px;
  height: 16px;
}

.btn-add:hover {
  background: rgba(34, 197, 94, 0.1);
  border-color: #22C55E;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(8px); }
  to { opacity: 1; transform: translateY(0); }
}

@media (prefers-reduced-motion: reduce) {
  .soul-editor {
    animation: none;
  }
}
</style>
