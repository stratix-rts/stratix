<template>
  <StratixModal
    :visible="visible"
    :size="'sm'"
    @update:visible="$emit('cancel')"
  >
    <template #header>
      <div class="header-content">
        <SvgIcon name="x-circle" class="header-icon" />
        <span>取消指令确认</span>
      </div>
    </template>

    <div class="dialog-body">
      <p class="dialog-desc">确定要取消此指令吗？此操作不可撤销。</p>

      <div v-if="log" class="command-info">
        <InfoItem label="指令 ID" direction="horizontal" plain mono>
          {{ log.commandId.slice(0, 20) }}...
        </InfoItem>
        <InfoItem label="技能名称" direction="horizontal" plain>
          {{ log.skillName }}
        </InfoItem>
        <InfoItem label="Agent" direction="horizontal" plain>
          {{ log.agentName }}
        </InfoItem>
        <InfoItem label="当前状态" direction="horizontal" plain>
          <span :class="['status-badge', `status-${log.status}`]">
            {{ statusText }}
          </span>
        </InfoItem>
      </div>

      <WarningBox type="warning">
        取消后指令将终止执行，Agent 状态将恢复
      </WarningBox>
    </div>

    <template #footer>
      <ButtonGroup>
        <StratixButton variant="secondary" @click="$emit('cancel')">
          返回
        </StratixButton>
        <StratixButton variant="danger" @click="$emit('confirm')">
          确认取消
        </StratixButton>
      </ButtonGroup>
    </template>
  </StratixModal>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { StratixModal, StratixButton, SvgIcon, ButtonGroup, InfoItem, WarningBox } from '@/components/ui';
import type { CommandLogItem } from './CommandLog.vue';

interface Props {
  visible: boolean;
  log: CommandLogItem | null;
}

const props = defineProps<Props>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const statusText = computed(() => {
  if (!props.log) return '';
  const texts: Record<string, string> = {
    pending: '等待执行',
    running: '执行中',
    success: '执行成功',
    failed: '执行失败'
  };
  return texts[props.log.status] || props.log.status;
});
</script>

<style scoped>
.header-content {
  display: flex;
  align-items: center;
  gap: 10px;
}

.header-icon {
  color: var(--ds-semantic-danger);
}

.dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.dialog-desc {
  margin: 0;
  font-size: 14px;
  color: var(--ds-text-secondary);
}

.command-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--ds-bg-secondary);
  border: 1px solid var(--ds-border-default);
  border-radius: 6px;
  padding: 12px;
}

.status-badge {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
}

.status-badge.status-pending {
  background: var(--ds-info) + "26";
  color: var(--ds-info);
}

.status-badge.status-running {
  background: var(--ds-warning) + "26";
  color: var(--ds-warning);
}

.status-badge.status-success {
  background: var(--ds-semantic-success) + "26";
  color: var(--ds-semantic-success);
}

.status-badge.status-failed {
  background: var(--ds-semantic-danger) + "26";
  color: var(--ds-semantic-danger);
}
</style>
