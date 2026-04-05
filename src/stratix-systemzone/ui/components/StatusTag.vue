<template>
  <span class="status-tag" :class="classForStatus">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ status: string }>();

const statusMap: Record<string, { label: string; cls: string }> = {
  pending: { label: '待审', cls: 'tag-pending' },
  approved: { label: '已批准', cls: 'tag-approved' },
  rejected: { label: '已拒绝', cls: 'tag-rejected' },
  executing: { label: '执行中', cls: 'tag-executing' },
  completed: { label: '已完成', cls: 'tag-completed' },
  failed: { label: '失败', cls: 'tag-failed' },
  rolled_back: { label: '已回滚', cls: 'tag-rolled-back' },
};

const label = computed(() => statusMap[props.status]?.label ?? props.status);
const classForStatus = computed(() => statusMap[props.status]?.cls ?? 'tag-default');
</script>

<style scoped>
.status-tag {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: var(--ds-radius-sm, 4px);
}
.tag-pending { background: color-mix(in srgb, var(--ds-status-warning, #fbbf24) 15%, transparent); color: var(--ds-status-warning, #fbbf24); }
.tag-approved { background: color-mix(in srgb, var(--ds-status-success, #22c55e) 15%, transparent); color: var(--ds-status-success, #22c55e); }
.tag-rejected { background: color-mix(in srgb, var(--ds-status-danger, #ef4444) 15%, transparent); color: var(--ds-status-danger, #ef4444); }
.tag-executing { background: color-mix(in srgb, var(--ds-status-info, #3b82f6) 15%, transparent); color: var(--ds-status-info, #3b82f6); }
.tag-completed { background: color-mix(in srgb, var(--ds-status-success, #22c55e) 15%, transparent); color: var(--ds-status-success, #22c55e); }
.tag-failed { background: color-mix(in srgb, var(--ds-status-danger, #ef4444) 15%, transparent); color: var(--ds-status-danger, #ef4444); }
.tag-rolled-back { background: color-mix(in srgb, var(--ds-text-muted, #94a3b8) 15%, transparent); color: var(--ds-text-muted, #94a3b8); }
.tag-default { background: var(--ds-bg-overlay, rgba(255,255,255,0.06)); color: var(--ds-text-secondary, #94a3b8); }
</style>
