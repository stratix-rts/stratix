<template>
  <span
    class="status-badge"
    :class="[`status-${status}`, { small }]"
    :title="status"
  >
    <span class="dot"></span>
    <span v-if="!small" class="label">{{ label }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  status: string;
  small?: boolean;
}>(), { small: false });

const STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
  executing: '执行中',
  completed: '已完成',
  failed: '失败',
  rolled_back: '已回滚',
  running: '运行中',
  idle: '空闲',
  error: '错误',
  active: '活跃',
  disabled: '已禁用',
  success: '成功',
};

const label = computed(() => STATUS_LABELS[props.status] || props.status);
</script>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 2px 10px;
  border-radius: var(--ds-radius-sm, 12px);
  font-size: 12px;
  font-weight: 500;
}
.status-badge.small {
  padding: 2px 6px;
  gap: 4px;
  font-size: 11px;
}
.dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}

/* Status colors — design system semantic tokens */
.status-pending {
  background: color-mix(in srgb, var(--ds-status-warning, #eab308) 15%, transparent);
  color: var(--ds-status-warning, #eab308);
}
.status-pending .dot { background: var(--ds-status-warning, #eab308); }

.status-approved, .status-completed, .status-success, .status-active {
  background: color-mix(in srgb, var(--ds-status-success, #22c55e) 15%, transparent);
  color: var(--ds-status-success, #22c55e);
}
.status-approved .dot, .status-completed .dot, .status-success .dot, .status-active .dot {
  background: var(--ds-status-success, #22c55e);
}

.status-rejected, .status-failed, .status-error {
  background: color-mix(in srgb, var(--ds-status-danger, #ef4444) 15%, transparent);
  color: var(--ds-status-danger, #ef4444);
}
.status-rejected .dot, .status-failed .dot, .status-error .dot {
  background: var(--ds-status-danger, #ef4444);
}

.status-executing, .status-running {
  background: color-mix(in srgb, var(--ds-status-info, #3b82f6) 15%, transparent);
  color: var(--ds-status-info, #3b82f6);
}
.status-executing .dot, .status-running .dot {
  background: var(--ds-status-info, #3b82f6);
  animation: pulse 1.5s infinite;
}

.status-rolled_back {
  background: color-mix(in srgb, var(--ds-color-accent, #a855f7) 15%, transparent);
  color: var(--ds-color-accent, #a855f7);
}
.status-rolled_back .dot { background: var(--ds-color-accent, #a855f7); }

.status-idle, .status-disabled {
  background: color-mix(in srgb, var(--ds-text-muted, #94a3b8) 15%, transparent);
  color: var(--ds-text-muted, #94a3b8);
}
.status-idle .dot, .status-disabled .dot { background: var(--ds-text-muted, #94a3b8); }

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}
</style>
