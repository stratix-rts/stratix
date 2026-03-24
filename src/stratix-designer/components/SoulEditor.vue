<script setup lang="ts">
import { SvgIcon } from '@/components/ui';
import { computed } from 'vue';
import { StratixSoulConfig } from '@/stratix-core/stratix-protocol';
import { StratixInput, StratixTextarea, StratixButton } from '@/components/ui';
import { getToken } from '@/design-system/config';
const props = defineProps<{ modelValue: StratixSoulConfig }>();
const emit = defineEmits<{ (e: 'update:modelValue', value: StratixSoulConfig): void }>();

const identity = computed({
  get: () => props.modelValue.identity,
  set: (value) => emit('update:modelValue', { ...props.modelValue, identity: value }),
});

const personality = computed({
  get: () => props.modelValue.personality,
  set: (value) => emit('update:modelValue', { ...props.modelValue, personality: value }),
});

const addGoal = () => {
  emit('update:modelValue', { ...props.modelValue, goals: [...props.modelValue.goals, ''] });
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
      <svg class="section-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <SvgIcon name="heart" size="16" />
      </svg>
      <span class="section-title">Soul 灵魂配置</span>
    </div>

    <div class="form-group">
      <label class="label label-required">身份 Identity</label>
      <StratixTextarea
        v-model="identity"
        :rows="3"
        placeholder="描述英雄的身份和定位..."
      />
      <span class="hint">定义英雄的核心身份，例如：专业文案创作者</span>
    </div>

    <div class="form-group">
      <label class="label label-required">目标 Goals</label>
      <div class="goals-list">
        <div v-for="(goal, index) in modelValue.goals" :key="index" class="goal-item">
          <span class="goal-number">{{ index + 1 }}</span>
          <StratixInput
            :value="goal"
            @update:value="updateGoal(index, $event)"
            :placeholder="`目标 ${index + 1}`"
            class="goal-input"
          />
          <StratixButton
            variant="secondary"
            size="sm"
            :icon="trash"
            @click="removeGoal(index)"
            :disabled="modelValue.goals.length <= 1"
          />
        </div>
      </div>
      <StratixButton variant="secondary" :icon="plus" @click="addGoal" class="btn-add">
        添加目标
      </StratixButton>
    </div>

    <div class="form-group">
      <label class="label">性格 Personality</label>
      <StratixTextarea
        v-model="personality"
        :rows="2"
        placeholder="描述英雄的性格特点..."
      />
      <span class="hint">定义英雄的性格特质，例如：细心、高效、有创意</span>
    </div>
  </div>
</template>

<style scoped>
.soul-editor {
  font-family: v-bind('getToken("typography.fontFamily.sans")');
  padding: 20px;
  animation: fadeIn 200ms ease;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 1px solid v-bind('getToken("colors.border.default")');
}

.section-icon {
  width: 20px;
  height: 20px;
  color: v-bind('getToken("colors.semantic.success")');
}

.section-title {
  font-family: v-bind('getToken("typography.fontFamily.mono")');
  font-size: 14px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: v-bind('getToken("colors.text.secondary")');
}

.label-required::after {
  content: '*';
  color: v-bind('getToken("colors.semantic.danger")');
  margin-left: 4px;
}

.hint {
  display: block;
  font-size: 12px;
  color: v-bind('getToken("colors.text.muted")');
}

.goals-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 10px;
}

.goal-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.goal-number {
  width: 24px;
  height: 24px;
  border-radius: 4px;
  background: v-bind('getToken("colors.background.tertiary")');
  border: 1px solid v-bind('getToken("colors.border.default")');
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: v-bind('getToken("colors.text.primary")');
  flex-shrink: 0;
}

.goal-input {
  flex: 1;
}

.btn-add {
  width: 100%;
  justify-content: center;
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
</style>
