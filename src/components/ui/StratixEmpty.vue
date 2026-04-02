<script setup lang="ts">
/**
 * StratixEmpty - Unified empty state component
 * Supports multiple scenarios: no-data, no-agents, no-tasks, no-messages, no-results
 */
import { computed } from 'vue';
import StratixButton from './StratixButton.vue';

export type EmptyScenario = 'no-data' | 'no-agents' | 'no-tasks' | 'no-messages' | 'no-results';

interface ActionButton {
  label: string;
  onClick: () => void;
  variant?: 'primary' | 'secondary' | 'ghost';
}

interface Props {
  scenario?: EmptyScenario;
  icon?: string;
  title?: string;
  description?: string;
  actionLabel?: string;
  actionIcon?: string;
  actionVariant?: 'primary' | 'secondary' | 'ghost';
  action?: ActionButton | (() => void);
}

const props = withDefaults(defineProps<Props>(), {
  scenario: 'no-data',
  icon: '',
  title: '',
  description: '',
  actionLabel: '',
  actionIcon: '',
  actionVariant: 'primary',
});

const emit = defineEmits<{
  action: [];
}>();

// SVG illustrations for each scenario (inline, no external assets)
const svgIllustrations: Record<EmptyScenario, string> = {
  'no-data': `<svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M60 10 L95 30 L95 70 L60 90 L25 70 L25 30 Z" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.25"/>
    <path d="M60 25 L80 38 L80 62 L60 75 L40 62 L40 38 Z" stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.2"/>
    <circle cx="60" cy="50" r="10" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.3"/>
  </svg>`,
  'no-agents': `<svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="60" cy="35" r="20" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.25"/>
    <path d="M35 70 L60 55 L85 70 L85 85 L60 100 L35 85 Z" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.25"/>
    <path d="M30 50 L45 40" stroke="currentColor" stroke-width="1" opacity="0.15"/>
    <path d="M90 50 L75 40" stroke="currentColor" stroke-width="1" opacity="0.15"/>
    <circle cx="25" cy="35" r="3" stroke="currentColor" stroke-width="1" fill="none" opacity="0.15"/>
    <circle cx="95" cy="35" r="3" stroke="currentColor" stroke-width="1" fill="none" opacity="0.15"/>
  </svg>`,
  'no-tasks': `<svg viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <rect x="10" y="10" width="60" height="45" rx="4" stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.2"/>
    <rect x="20" y="22" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1" fill="none" opacity="0.25"/>
    <line x1="34" y1="26" x2="60" y2="26" stroke="currentColor" stroke-width="1" opacity="0.15"/>
    <rect x="20" y="36" width="8" height="8" rx="1" stroke="currentColor" stroke-width="1" fill="none" opacity="0.25"/>
    <line x1="34" y1="40" x2="55" y2="40" stroke="currentColor" stroke-width="1" opacity="0.15"/>
    <circle cx="68" cy="12" r="2" fill="currentColor" opacity="0.15"/>
  </svg>`,
  'no-messages': `<svg viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M10 15 L40 15 L40 10 L10 10 Z" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
    <path d="M10 25 L50 25 L50 50 L10 50 Z" stroke="currentColor" stroke-width="1.2" fill="none" opacity="0.25"/>
    <circle cx="20" cy="37" r="3" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
    <circle cx="30" cy="37" r="3" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
    <circle cx="40" cy="37" r="3" stroke="currentColor" stroke-width="1" fill="none" opacity="0.2"/>
    <circle cx="70" cy="45" r="5" stroke="currentColor" stroke-width="1" fill="none" opacity="0.15"/>
  </svg>`,
  'no-results': `<svg viewBox="0 0 80 60" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="35" cy="30" r="18" stroke="currentColor" stroke-width="1.5" fill="none" opacity="0.25"/>
    <path d="M48 43 L65 60" stroke="currentColor" stroke-width="2" stroke-linecap="round" opacity="0.3"/>
    <line x1="28" y1="25" x2="42" y2="35" stroke="currentColor" stroke-width="1" opacity="0.2"/>
  </svg>`,
};

// Default content by scenario
const defaults: Record<EmptyScenario, { title: string; description: string }> = {
  'no-data': {
    title: '暂无数据',
    description: '暂无任何数据',
  },
  'no-agents': {
    title: '暂无 Agent',
    description: '创建你的第一个 Agent 来开始',
  },
  'no-tasks': {
    title: '暂无任务',
    description: '使用 LRA 创建任务',
  },
  'no-messages': {
    title: '暂无消息',
    description: '发送消息开始对话',
  },
  'no-results': {
    title: '无搜索结果',
    description: '尝试调整搜索条件',
  },
};

const resolvedTitle = computed(() => props.title || defaults[props.scenario].title);
const resolvedDescription = computed(() => props.description || defaults[props.scenario].description);
const resolvedSvg = computed(() => svgIllustrations[props.scenario]);

const handleAction = () => {
  emit('action');
  if (typeof props.action === 'function') {
    props.action();
  } else if (props.action && typeof props.action === 'object' && 'onClick' in props.action) {
    props.action.onClick();
  }
};

const actionButton = computed(() => {
  if (props.actionLabel) {
    return {
      label: props.actionLabel,
      variant: props.actionVariant || 'primary',
      icon: props.actionIcon || '',
    };
  }
  return null;
});
</script>

<template>
  <div class="stratix-empty">
    <div class="stratix-empty__illustration" v-html="resolvedSvg"></div>
    <h3 class="stratix-empty__title">{{ resolvedTitle }}</h3>
    <p v-if="resolvedDescription" class="stratix-empty__description">
      {{ resolvedDescription }}
    </p>
    <div v-if="actionButton || $slots.action" class="stratix-empty__action">
      <slot name="action">
        <StratixButton
          v-if="actionButton"
          :variant="actionButton.variant"
          :icon="actionButton.icon"
          @click="handleAction"
        >
          {{ actionButton.label }}
        </StratixButton>
      </slot>
    </div>
  </div>
</template>

<style scoped>
.stratix-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
  min-height: 200px;
}

.stratix-empty__illustration {
  width: 80px;
  height: 64px;
  margin-bottom: 16px;
  color: var(--ds-color-primary, var(--color-primary, #00aaff));
  opacity: 0;
  animation: emptyFadeIn 0.5s ease forwards;
}

.stratix-empty__illustration :deep(svg) {
  width: 100%;
  height: 100%;
}

@keyframes emptyFadeIn {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.stratix-empty__title {
  margin: 0 0 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--ds-text-primary, var(--text-primary, #e0e0e8));
}

.stratix-empty__description {
  margin: 0 0 24px;
  font-size: 14px;
  color: var(--ds-text-muted, var(--text-secondary, #8888a0));
  max-width: 280px;
  line-height: 1.5;
}

.stratix-empty__action {
  display: flex;
  gap: 12px;
  align-items: center;
}
</style>
