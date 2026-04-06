<script setup lang="ts">
/**
 * StepNavigator.vue - 步骤导航组件
 *
 * 三个步骤：外观 → 连接 → 配置
 * 当前步骤高亮，可点击跳转到已完成步骤
 *
 * emit: navigate(step)
 */

import { computed } from 'vue';

export type CreatorStep = 'appearance' | 'openclaw' | 'agent';

const props = defineProps<{
  currentStep: CreatorStep;
  completedSteps: CreatorStep[];
}>();

const emit = defineEmits<{
  navigate: [step: CreatorStep];
}>();

// 步骤配置
const steps: { key: CreatorStep; label: string; icon: string }[] = [
  { key: 'appearance', label: '外观', icon: '🎨' },
  { key: 'openclaw', label: '连接', icon: '⚡' },
  { key: 'agent', label: '配置', icon: '🤖' },
];

// 当前步骤索引
const currentStepIndex = computed(() => {
  return steps.findIndex(s => s.key === props.currentStep);
});

// 检查步骤是否完成
function isStepCompleted(step: CreatorStep): boolean {
  return props.completedSteps.includes(step);
}

// 检查步骤是否可点击（已完成或当前步骤之前的步骤）
function isStepNavigable(step: CreatorStep): boolean {
  if (step === props.currentStep) return true;
  const stepIndex = steps.findIndex(s => s.key === step);
  const currentIndex = currentStepIndex.value;

  // 可以跳转到已完成的步骤
  if (isStepCompleted(step)) return true;

  // 可以跳转到当前步骤之前的未完成步骤
  if (stepIndex < currentIndex) return true;

  return false;
}

// 处理步骤点击
function handleStepClick(step: CreatorStep): void {
  if (isStepNavigable(step)) {
    emit('navigate', step);
  }
}

// 获取步骤状态样式
function getStepState(step: CreatorStep): 'completed' | 'active' | 'pending' {
  if (step === props.currentStep) return 'active';
  if (isStepCompleted(step)) return 'completed';
  return 'pending';
}
</script>

<template>
  <div class="step-navigator">
    <div
      v-for="(step, index) in steps"
      :key="step.key"
      class="step-item"
      :class="{
        'step-item--active': step.key === currentStep,
        'step-item--completed': isStepCompleted(step.key),
        'step-item--navigable': isStepNavigable(step.key),
      }"
      @click="handleStepClick(step.key)"
    >
      <!-- 连接线 -->
      <div v-if="index > 0" class="step-connector" :class="{ 'step-connector--completed': isStepCompleted(step.key) }"></div>

      <!-- 步骤圆圈 -->
      <div class="step-circle">
        <span v-if="isStepCompleted(step.key)" class="step-icon">✓</span>
        <span v-else class="step-icon">{{ step.icon }}</span>
      </div>

      <!-- 步骤标签 -->
      <div class="step-label">{{ step.label }}</div>
    </div>
  </div>
</template>

<style scoped>
.step-navigator {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px 16px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border);
  border-radius: 8px;
  font-family: 'SF Mono', 'Monaco', monospace;
}

.step-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  position: relative;
  cursor: default;
  transition: all 0.2s ease;
}

.step-item--navigable {
  cursor: pointer;
}

.step-item--navigable:hover .step-circle {
  border-color: var(--ds-color-primary);
  transform: scale(1.05);
}

.step-connector {
  position: absolute;
  right: calc(100% + 8px);
  top: 16px;
  width: 40px;
  height: 2px;
  background: var(--ds-border);
  transition: background 0.2s ease;
}

.step-connector--completed {
  background: var(--ds-color-primary);
}

.step-circle {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 2px solid var(--ds-border);
  background: var(--ds-bg-tertiary);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s ease;
  font-size: 14px;
}

.step-item--active .step-circle {
  border-color: var(--ds-color-primary);
  background: var(--ds-color-primary);
  color: var(--ds-text-inverse);
  box-shadow: 0 0 12px var(--ds-color-primary);
}

.step-item--completed .step-circle {
  border-color: var(--ds-color-primary);
  background: var(--ds-color-primary);
  color: var(--ds-text-inverse);
}

.step-icon {
  font-size: 14px;
}

.step-label {
  font-size: 11px;
  color: var(--ds-text-muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  transition: color 0.2s ease;
}

.step-item--active .step-label {
  color: var(--ds-color-primary);
  font-weight: 600;
}

.step-item--completed .step-label {
  color: var(--ds-text-primary);
}

/* 响应式 */
@media (max-width: 480px) {
  .step-connector {
    width: 24px;
    right: calc(100% + 4px);
  }

  .step-circle {
    width: 28px;
    height: 28px;
    font-size: 12px;
  }

  .step-label {
    font-size: 9px;
  }
}
</style>
